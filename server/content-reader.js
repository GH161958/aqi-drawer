import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fetchSafeResource, SafeFetchError } from './safe-fetch.js'

const execFileAsync = promisify(execFile)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_HTML_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_VIDEO_BYTES = 64 * 1024 * 1024
const MAX_RETURN_MEDIA_BYTES = 10 * 1024 * 1024
const COMPACT_TEXT_LIMIT = 3_200
const FULL_TEXT_LIMIT = 12_000
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif'])
const VIDEO_HOSTS = ['bilibili.com', 'douyin.com', 'iesdouyin.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com']
const INTERACTIVE_HOSTS = [
  ...VIDEO_HOSTS,
  'xiaohongshu.com', 'xhslink.com', 'taobao.com', 'tmall.com', 'm.tb.cn', 'weibo.com', 'weibo.cn', 'mp.weixin.qq.com',
]
const BROWSER_HTTP_STATUSES = new Set([401, 403, 429, 451])

export class PocketContentReader {
  constructor({
    store,
    allowPrivateHosts = false,
    cacheTtlMs = CACHE_TTL_MS,
    timeoutMs = 12_000,
    maxHtmlBytes = MAX_HTML_BYTES,
    maxMediaBytes = MAX_VIDEO_BYTES,
    ffmpegPath = 'ffmpeg',
    ffprobePath = 'ffprobe',
  } = {}) {
    this.store = store
    this.allowPrivateHosts = allowPrivateHosts === true
    this.cacheTtlMs = clampNumber(cacheTtlMs, 0, 7 * 24 * 60 * 60 * 1000, CACHE_TTL_MS)
    this.timeoutMs = clampNumber(timeoutMs, 250, 120_000, 12_000)
    this.maxHtmlBytes = clampNumber(maxHtmlBytes, 16 * 1024, 16 * 1024 * 1024, MAX_HTML_BYTES)
    this.maxMediaBytes = clampNumber(maxMediaBytes, 1024 * 1024, 256 * 1024 * 1024, MAX_VIDEO_BYTES)
    this.maxImageBytes = Math.min(MAX_IMAGE_BYTES, this.maxMediaBytes)
    this.ffmpegPath = ffmpegPath || 'ffmpeg'
    this.ffprobePath = ffprobePath || 'ffprobe'
    this.videoQueue = Promise.resolve()
  }

  async read(item, {
    detail = 'compact',
    maxImages = 3,
    videoFrames = 3,
    refresh = false,
  } = {}) {
    if (!item || typeof item !== 'object') throw new TypeError('A Pocket item is required.')
    const normalizedDetail = detail === 'full' ? 'full' : 'compact'
    const imageLimit = clampNumber(maxImages, 0, 6, 3)
    const frameLimit = clampNumber(videoFrames, 0, 3, 3)
    const warnings = []
    const cached = !refresh && cacheIsFresh(item.contentSnapshot, this.cacheTtlMs, normalizedDetail, item.sourceUrl)
    const cache = { hit: cached }
    let snapshot
    let prefetchedMedia = []

    if (cached) {
      snapshot = projectSnapshot(item.contentSnapshot, normalizedDetail)
      cache.ageSeconds = Math.max(0, Math.round((Date.now() - Date.parse(snapshot.fetchedAt)) / 1000))
    } else {
      const extracted = await this.#buildSnapshot(item, normalizedDetail)
      snapshot = extracted.snapshot
      prefetchedMedia = extracted.media
      warnings.push(...extracted.warnings)
    }

    const media = []
    await this.#appendAttachmentImages(item, media, imageLimit, warnings)
    for (const entry of prefetchedMedia) addMedia(media, entry, imageLimit, MAX_RETURN_MEDIA_BYTES)
    await this.#appendRemoteImages(snapshot.images, media, imageLimit, warnings)

    let frameResult = { status: 'not_requested', media: [] }
    let returnedFrameCount = 0
    if (frameLimit > 0 && isVideoItem(item, snapshot)) {
      frameResult = await this.#enqueueVideoFrames(item, snapshot, frameLimit)
      const beforeFrames = media.length
      for (const frame of frameResult.media) addMedia(media, frame, imageLimit + frameLimit, MAX_RETURN_MEDIA_BYTES)
      returnedFrameCount = media.length - beforeFrames
      if (frameResult.warning) warnings.push(frameResult.warning)
    }

    snapshot.frameExtraction = {
      status: frameResult.status,
      requested: frameLimit,
      extracted: returnedFrameCount,
      ...(frameResult.reason ? { reason: frameResult.reason } : {}),
      ...(frameResult.durationSeconds ? { durationSeconds: frameResult.durationSeconds } : {}),
    }
    snapshot.visuals = {
      imagesAvailable: Array.isArray(snapshot.images) ? snapshot.images.length : 0,
      imageBuffersReturned: media.length - returnedFrameCount,
      videoFramesReturned: returnedFrameCount,
    }
    if (returnedFrameCount > 0) {
      delete snapshot.browserCapturePlan
    } else if (isVideoItem(item, snapshot)) {
      snapshot.browserCapturePlan ||= makeBrowserCapturePlan(snapshot.finalUrl || snapshot.sourceUrl, frameResult.reason)
    }
    snapshot.warnings = uniqueStrings([...(snapshot.warnings || []), ...warnings]).slice(0, 8)
    if (!snapshot.warnings.length) delete snapshot.warnings

    return { snapshot, media, cache }
  }

  async #buildSnapshot(item, detail) {
    const fetchedAt = new Date().toISOString()
    const base = {
      version: 1,
      detail,
      fetchedAt,
      expiresAt: new Date(Date.parse(fetchedAt) + this.cacheTtlMs).toISOString(),
      sourceUrl: clean(item.sourceUrl),
      finalUrl: clean(item.sourceUrl),
      pageType: item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : 'page',
      title: clean(item.title),
      description: clean(item.note),
      text: limitText(clean(item.text), detail),
      textTruncated: clean(item.text).length > textLimit(detail),
      images: [],
      attachments: summarizeAttachments(item.attachments),
      extraction: { source: 'pocket_item' },
    }
    const warnings = []
    const media = []
    if (!base.sourceUrl) {
      if (item.attachments?.some((entry) => isVideoMime(entry.mimeType))) base.pageType = 'video'
      return { snapshot: base, media, warnings }
    }

    const hintedType = mimeFromUrl(base.sourceUrl)
    if (isImageMime(hintedType)) {
      let image
      try {
        image = await this.#fetchImage(base.sourceUrl, 'source image')
      } catch (error) {
        warnings.push(readerErrorMessage(error))
      }
      if (image) {
        base.finalUrl = image.url
        base.httpStatus = image.status
        base.contentType = image.mimeType
        base.pageType = 'image'
        base.images = [{ url: image.url, source: 'source' }]
        base.extraction = { source: 'direct_image' }
        media.push(image.media)
      } else {
        warnings.push('The linked image could not be downloaded.')
      }
      return { snapshot: base, media, warnings }
    }

    if (isVideoMime(hintedType) || isDirectVideoUrl(base.sourceUrl)) {
      base.pageType = 'video'
      base.video = { detected: true, directUrl: base.sourceUrl, mimeType: hintedType || 'video/*' }
      base.extraction = { source: 'direct_video' }
      return { snapshot: base, media, warnings }
    }

    let response
    try {
      response = await fetchSafeResource(base.sourceUrl, {
        maxBytes: this.maxHtmlBytes,
        timeoutMs: this.timeoutMs,
        allowPrivateHosts: this.allowPrivateHosts,
      })
    } catch (error) {
      warnings.push(readerErrorMessage(error))
      base.extraction = { source: 'unavailable', errorCode: safeErrorCode(error) }
      if (canOfferBrowserCapture(error) && (item.kind === 'video' || isInteractiveHost(base.sourceUrl))) {
        if (item.kind === 'video' || isVideoHost(base.sourceUrl)) base.pageType = 'video'
        base.browserCapturePlan = makeBrowserCapturePlan(base.sourceUrl, readerErrorMessage(error))
      }
      return { snapshot: base, media, warnings }
    }

    base.finalUrl = response.url
    base.httpStatus = response.status
    base.contentType = response.contentType
    if (response.status >= 400) warnings.push(`The page returned HTTP ${response.status}.`)
    if (BROWSER_HTTP_STATUSES.has(response.status)) {
      base.extraction = { source: 'unavailable', errorCode: `HTTP_${response.status}` }
      base.browserCapturePlan = makeBrowserCapturePlan(response.url, `The site returned HTTP ${response.status} and may require an interactive or signed-in browser.`)
      return { snapshot: base, media, warnings }
    }

    if (isImageMime(response.contentType)) {
      base.pageType = 'image'
      base.images = [{ url: response.url, source: 'source' }]
      base.extraction = { source: 'direct_image' }
      const mimeType = verifiedImageType(response.body, response.contentType)
      if (mimeType) media.push({ data: response.body, mimeType, label: 'source image', sourceUrl: response.url })
      return { snapshot: base, media, warnings }
    }
    if (isVideoMime(response.contentType)) {
      base.pageType = 'video'
      base.video = { detected: true, directUrl: response.url, mimeType: response.contentType }
      base.extraction = { source: 'direct_video' }
      return { snapshot: base, media, warnings }
    }

    const decoded = decodeBody(response.body, response.headers['content-type'])
    if (looksLikeHtml(decoded, response.contentType)) {
      const extracted = extractHtml(decoded, response.url, detail)
      Object.assign(base, extracted)
      base.extraction = { source: 'html', htmlBytes: response.body.length }
      if (isVideoItem(item, base) && !base.video?.directUrl) {
        base.browserCapturePlan = makeBrowserCapturePlan(response.url, 'The page exposes video metadata but not a safe direct video file.')
      } else if (isInteractiveHost(response.url) && clean(base.text).length < 300) {
        base.browserCapturePlan = makeBrowserCapturePlan(response.url, 'The public HTML contains too little content; the useful view likely requires an interactive or signed-in browser.')
      }
    } else {
      const text = limitText(decoded, detail)
      base.pageType = response.contentType === 'application/json' ? 'data' : 'text'
      base.text = text || base.text
      base.textTruncated = decoded.length > textLimit(detail)
      base.extraction = { source: 'plain_text', bytes: response.body.length }
    }
    return { snapshot: base, media, warnings }
  }

  async #appendAttachmentImages(item, media, limit, warnings) {
    if (!this.store?.readAttachment || media.length >= limit) return
    for (const attachment of item.attachments || []) {
      if (media.length >= limit) break
      if (!isImageMime(attachment.mimeType)) continue
      try {
        const loaded = await this.store.readAttachment(attachment.id, this.maxImageBytes)
        const mimeType = loaded && verifiedImageType(loaded.data, loaded.attachment.mimeType)
        if (mimeType) addMedia(media, { data: loaded.data, mimeType, label: loaded.attachment.name || 'Pocket attachment' }, limit, MAX_RETURN_MEDIA_BYTES)
      } catch {
        warnings.push(`Attachment image “${clean(attachment.name) || attachment.id}” could not be read.`)
      }
    }
  }

  async #appendRemoteImages(images, media, limit, warnings) {
    for (const image of images || []) {
      if (media.length >= limit) break
      if (!image?.url || media.some((entry) => entry.sourceUrl === image.url)) continue
      try {
        const loaded = await this.#fetchImage(image.url, image.alt || image.source || 'page image')
        if (loaded) addMedia(media, loaded.media, limit, MAX_RETURN_MEDIA_BYTES)
      } catch {
        warnings.push(`A page image from ${safeHostname(image.url)} could not be read.`)
      }
    }
  }

  async #fetchImage(url, label) {
    const response = await fetchSafeResource(url, {
      maxBytes: this.maxImageBytes,
      timeoutMs: this.timeoutMs,
      allowPrivateHosts: this.allowPrivateHosts,
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2' },
    })
    if (response.status < 200 || response.status >= 300) return null
    const mimeType = verifiedImageType(response.body, response.contentType)
    if (!mimeType) return null
    return {
      url: response.url,
      status: response.status,
      mimeType,
      media: { data: response.body, mimeType, label, sourceUrl: response.url },
    }
  }

  async #readVideoFrames(item, snapshot, count) {
    const attachment = (item.attachments || []).find((entry) => isVideoMime(entry.mimeType))
    if (attachment && this.store?.getAttachmentFile) {
      try {
        const local = await this.store.getAttachmentFile(attachment.id)
        if (local?.filePath) return await this.#extractFrames(local.filePath, count, false)
      } catch (error) {
        return frameFailure(error, 'The attached video could not be opened.')
      }
    }

    const directUrl = snapshot.video?.directUrl
    if (!directUrl) return { status: 'browser_needed', media: [], reason: 'No safe direct video file was exposed by the page.' }
    if (isPlaylistUrl(directUrl) || isPlaylistMime(snapshot.video?.mimeType)) {
      return { status: 'browser_needed', media: [], reason: 'Streaming playlists are sampled through a browser instead of server-side fetching.' }
    }

    let response
    try {
      response = await fetchSafeResource(directUrl, {
        maxBytes: this.maxMediaBytes,
        timeoutMs: this.timeoutMs,
        allowPrivateHosts: this.allowPrivateHosts,
        headers: { accept: 'video/*,application/octet-stream;q=0.7' },
      })
      if (response.status < 200 || response.status >= 300) {
        return { status: 'browser_needed', media: [], reason: `The direct video returned HTTP ${response.status}.` }
      }
    } catch (error) {
      return frameFailure(error, 'The direct video could not be downloaded safely.')
    }

    const directory = await mkdtemp(path.join(tmpdir(), 'aqi-drawer-video-'))
    const extension = videoExtension(response.contentType, response.url)
    const inputPath = path.join(directory, `source${extension}`)
    try {
      await writeFile(inputPath, response.body)
      return await this.#extractFrames(inputPath, count, true, directory)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      return frameFailure(error, 'Video frame extraction failed.')
    }
  }

  #enqueueVideoFrames(item, snapshot, count) {
    const run = () => this.#readVideoFrames(item, snapshot, count)
    const job = this.videoQueue.then(run, run)
    this.videoQueue = job.catch(() => undefined)
    return job
  }

  async #extractFrames(inputPath, count, ownsDirectory, existingDirectory) {
    const directory = existingDirectory || await mkdtemp(path.join(tmpdir(), 'aqi-drawer-frames-'))
    try {
      let duration = 0
      try {
        const result = await execFileAsync(this.ffprobePath, [
          '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', inputPath,
        ], { timeout: 15_000, windowsHide: true, maxBuffer: 512 * 1024 })
        duration = Number.parseFloat(result.stdout)
        if (!Number.isFinite(duration) || duration < 0) duration = 0
      } catch (error) {
        if (isCommandMissing(error)) {
          return { status: 'unavailable', media: [], reason: 'ffprobe/ffmpeg is not installed on this host.' }
        }
      }

      const positions = framePositions(duration, count)
      const media = []
      for (let index = 0; index < positions.length; index += 1) {
        const outputPath = path.join(directory, `frame-${index + 1}.jpg`)
        try {
          await execFileAsync(this.ffmpegPath, [
            '-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', positions[index].toFixed(3), '-i', inputPath,
            '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=960:-2:force_original_aspect_ratio=decrease',
            '-q:v', '3', '-y', outputPath,
          ], { timeout: 30_000, windowsHide: true, maxBuffer: 1024 * 1024 })
          media.push({
            data: await readFile(outputPath),
            mimeType: 'image/jpeg',
            label: `video frame ${index + 1}/${positions.length} (${formatSeconds(positions[index])})`,
          })
        } catch (error) {
          if (isCommandMissing(error)) {
            return { status: 'unavailable', media: [], reason: 'ffprobe/ffmpeg is not installed on this host.' }
          }
        }
      }
      return media.length
        ? { status: 'ok', media, durationSeconds: duration || undefined }
        : { status: 'browser_needed', media: [], reason: 'The video decoder could not produce a readable frame.' }
    } finally {
      if (ownsDirectory || !existingDirectory) await rm(directory, { recursive: true, force: true })
    }
  }
}

function extractHtml(html, baseUrl, detail) {
  const metas = extractMeta(html)
  const links = extractLinks(html)
  const jsonNodes = extractJsonLd(html)
  const articleSchema = chooseSchemaByType(jsonNodes, /article|posting|report/i)
  const videoSchema = chooseSchemaByType(jsonNodes, /^videoobject$/i)
  const productSchema = chooseSchemaByType(jsonNodes, /^product$/i)
  const schema = articleSchema || productSchema || videoSchema || chooseSchemaNode(jsonNodes)
  const schemaTypes = jsonNodes.flatMap(schemaTypesOf)
  const title = limitMetadata(firstClean(
    metaFirst(metas, 'og:title'), metaFirst(metas, 'twitter:title'),
    schema?.headline, schema?.name, videoSchema?.name, tagText(html, 'title'),
  ), 300)
  const description = limitMetadata(firstClean(
    metaFirst(metas, 'og:description'), metaFirst(metas, 'twitter:description'),
    schema?.description, videoSchema?.description, metaFirst(metas, 'description'),
  ), 1_000)
  const imageCandidates = []
  for (const value of [...metaAll(metas, 'og:image'), ...metaAll(metas, 'twitter:image')]) {
    pushImageCandidate(imageCandidates, value, baseUrl, 'metadata')
  }
  for (const node of [schema, articleSchema, videoSchema, productSchema]) {
    pushImageCandidate(imageCandidates, node?.image, baseUrl, 'json-ld')
    pushImageCandidate(imageCandidates, node?.thumbnailUrl, baseUrl, 'json-ld thumbnail')
  }
  for (const image of extractTagImages(selectContentRegion(html), baseUrl)) pushUniqueImage(imageCandidates, image)

  const directVideo = firstClean(
    metaFirst(metas, 'og:video:secure_url'), metaFirst(metas, 'og:video:url'), metaFirst(metas, 'og:video'),
    metaFirst(metas, 'twitter:player:stream'), valueAsUrl(videoSchema?.contentUrl), valueAsUrl(schema?.contentUrl),
    extractVideoTag(html, baseUrl)?.directUrl,
  )
  const posterUrl = firstClean(
    valueAsUrl(videoSchema?.thumbnailUrl), valueAsUrl(schema?.thumbnailUrl),
    extractVideoTag(html, baseUrl)?.posterUrl, metaFirst(metas, 'og:image'),
  )
  const embedUrl = firstClean(valueAsUrl(videoSchema?.embedUrl), valueAsUrl(schema?.embedUrl), metaFirst(metas, 'twitter:player'))
  const articleText = firstClean(longText(articleSchema?.articleBody), longText(schema?.articleBody), extractReadableText(html))
  const limitedText = limitText(articleText, detail)
  const isVideo = schemaTypes.some((type) => type.toLowerCase() === 'videoobject')
    || /video/i.test(metaFirst(metas, 'og:type'))
    || Boolean(directVideo || embedUrl || extractVideoTag(html, baseUrl))
  const isArticle = schemaTypes.some((type) => /article|posting|report/i.test(type))
  const isProduct = schemaTypes.some((type) => type.toLowerCase() === 'product')
  const canonical = sameOriginUrl(links.canonical, baseUrl)
  const duration = limitMetadata(firstClean(videoSchema?.duration, schema?.duration, metaFirst(metas, 'og:video:duration')), 80)

  return {
    finalUrl: baseUrl,
    ...(canonical ? { canonicalUrl: canonical } : {}),
    pageType: isVideo ? 'video' : isArticle ? 'article' : isProduct ? 'product' : limitedText.length > 500 ? 'article' : 'page',
    title,
    description,
    siteName: limitMetadata(firstClean(metaFirst(metas, 'og:site_name'), metaFirst(metas, 'application-name')), 200),
    author: limitMetadata(firstClean(authorName(articleSchema?.author), authorName(schema?.author), metaFirst(metas, 'author'), metaFirst(metas, 'article:author')), 300),
    publishedAt: limitMetadata(firstClean(articleSchema?.datePublished, schema?.datePublished, metaFirst(metas, 'article:published_time'), metaFirst(metas, 'date')), 100),
    modifiedAt: limitMetadata(firstClean(articleSchema?.dateModified, schema?.dateModified, metaFirst(metas, 'article:modified_time')), 100),
    text: limitedText,
    textTruncated: articleText.length > textLimit(detail),
    images: imageCandidates.slice(0, detail === 'full' ? 12 : 6),
    ...(isVideo ? {
      video: {
        detected: true,
        ...(resolveWebUrl(directVideo, baseUrl) ? { directUrl: resolveWebUrl(directVideo, baseUrl) } : {}),
        ...(resolveWebUrl(posterUrl, baseUrl) ? { posterUrl: resolveWebUrl(posterUrl, baseUrl) } : {}),
        ...(resolveWebUrl(embedUrl, baseUrl) ? { embedUrl: resolveWebUrl(embedUrl, baseUrl) } : {}),
        ...(duration ? { duration } : {}),
        ...(durationToSeconds(duration) ? { durationSeconds: durationToSeconds(duration) } : {}),
        ...(firstClean(videoSchema?.uploadDate, schema?.uploadDate)
          ? { uploadDate: limitMetadata(firstClean(videoSchema?.uploadDate, schema?.uploadDate), 100) }
          : {}),
      },
    } : {}),
  }
}

function extractMeta(html) {
  const values = new Map()
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const key = clean(attributes.property || attributes.name || attributes.itemprop).toLowerCase()
    const content = decodeEntities(clean(attributes.content || attributes.value))
    if (!key || !content) continue
    const bucket = values.get(key) || []
    bucket.push(content)
    values.set(key, bucket)
  }
  return values
}

function extractLinks(html) {
  const result = {}
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const rel = clean(attributes.rel).toLowerCase().split(/\s+/)
    if (rel.includes('canonical') && attributes.href) result.canonical ||= decodeEntities(attributes.href)
  }
  return result
}

function extractJsonLd(html) {
  const nodes = []
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const raw = match[1].trim().replace(/^<!--|-->$/g, '').trim()
    if (!raw || raw.length > 2 * 1024 * 1024) continue
    try {
      flattenJsonLd(JSON.parse(raw), nodes, 0)
    } catch {
      // Invalid JSON-LD is common and should not make the whole page unreadable.
    }
  }
  return nodes
}

function flattenJsonLd(value, nodes, depth) {
  if (depth > 5 || value == null) return
  if (Array.isArray(value)) {
    for (const entry of value) flattenJsonLd(entry, nodes, depth + 1)
    return
  }
  if (typeof value !== 'object') return
  if (value['@type'] || value.headline || value.articleBody || value.contentUrl) nodes.push(value)
  if (value['@graph']) flattenJsonLd(value['@graph'], nodes, depth + 1)
}

function chooseSchemaNode(nodes) {
  let winner
  let winnerScore = -1
  for (const node of nodes) {
    const types = schemaTypesOf(node).map((value) => value.toLowerCase())
    let score = types.some((value) => value === 'videoobject') ? 80 : 0
    score += types.some((value) => /article|posting|report/.test(value)) ? 70 : 0
    score += types.includes('product') ? 60 : 0
    score += node.articleBody ? 20 : 0
    score += node.headline || node.name ? 10 : 0
    if (score > winnerScore) {
      winner = node
      winnerScore = score
    }
  }
  return winner
}

function chooseSchemaByType(nodes, pattern) {
  return nodes.find((node) => schemaTypesOf(node).some((type) => pattern.test(type)))
}

function selectContentRegion(html) {
  return firstTagInner(html, 'article') || firstTagInner(html, 'main') || firstTagInner(html, 'body') || html
}

function extractReadableText(html) {
  let content = selectContentRegion(html)
  content = content
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|canvas|template|form|nav|footer|header)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|section|article|main|h[1-6]|li|blockquote|pre|figure|figcaption|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
  const decoded = sanitizeControlCharacters(decodeEntities(content))
  const lines = decoded.split(/\r?\n/).map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim()).filter(Boolean)
  const deduped = []
  for (const line of lines) {
    if (line.length === 1 && !/[\p{L}\p{N}]/u.test(line)) continue
    if (line !== deduped[deduped.length - 1]) deduped.push(line)
  }
  return deduped.join('\n').trim()
}

function extractTagImages(html, baseUrl) {
  const result = []
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseAttributes(match[0])
    const width = Number.parseInt(attributes.width, 10)
    const height = Number.parseInt(attributes.height, 10)
    if (width > 0 && width <= 2 || height > 0 && height <= 2) continue
    const src = attributes['data-original'] || attributes['data-src'] || attributes.src || bestSrcset(attributes.srcset)
    const url = resolveWebUrl(decodeEntities(src), baseUrl)
    if (url) pushUniqueImage(result, { url, alt: decodeEntities(clean(attributes.alt)), source: 'page' })
    if (result.length >= 20) break
  }
  return result
}

function extractVideoTag(html, baseUrl) {
  const match = html.match(/<video\b[^>]*>([\s\S]*?)<\/video\s*>|<video\b[^>]*\/?>/i)
  if (!match) return null
  const opening = match[0].match(/<video\b[^>]*>/i)?.[0] || match[0]
  const attributes = parseAttributes(opening)
  const source = match[1]?.match(/<source\b[^>]*>/i)?.[0]
  const sourceAttributes = source ? parseAttributes(source) : {}
  return {
    directUrl: resolveWebUrl(attributes.src || sourceAttributes.src, baseUrl),
    posterUrl: resolveWebUrl(attributes.poster, baseUrl),
  }
}

function parseAttributes(tag) {
  const result = {}
  for (const match of tag.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const key = match[1].toLowerCase()
    if (key.startsWith('<')) continue
    result[key] = match[2] ?? match[3] ?? match[4] ?? ''
  }
  return result
}

function firstTagInner(html, tag) {
  return html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'))?.[1] || ''
}

function tagText(html, tag) {
  const value = firstTagInner(html, tag)
  return decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function pushImageCandidate(images, value, baseUrl, source) {
  if (Array.isArray(value)) {
    for (const entry of value) pushImageCandidate(images, entry, baseUrl, source)
    return
  }
  if (value && typeof value === 'object') {
    pushImageCandidate(images, value.url || value.contentUrl || value['@id'], baseUrl, source)
    return
  }
  const url = resolveWebUrl(value, baseUrl)
  if (url) pushUniqueImage(images, { url, source })
}

function pushUniqueImage(images, image) {
  if (!image?.url || images.some((entry) => entry.url === image.url)) return
  images.push(image)
}

function metaFirst(metas, key) {
  return metas.get(key)?.[0] || ''
}

function metaAll(metas, key) {
  return metas.get(key) || []
}

function schemaTypesOf(node) {
  if (!node) return []
  const value = node['@type']
  return Array.isArray(value) ? value.map(String) : value ? [String(value)] : []
}

function authorName(value) {
  if (Array.isArray(value)) return value.map(authorName).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return clean(value.name)
  return clean(value)
}

function valueAsUrl(value) {
  if (Array.isArray(value)) return valueAsUrl(value[0])
  if (value && typeof value === 'object') return value.url || value.contentUrl || value['@id'] || ''
  return clean(value)
}

function longText(value) {
  const text = clean(value)
  return text.length >= 80 ? text : ''
}

function decodeBody(buffer, contentType) {
  const headerCharset = String(contentType || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1]
  const sniff = buffer.subarray(0, 4096).toString('latin1')
  const htmlCharset = sniff.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>;]+)/i)?.[1]
    || sniff.match(/<meta[^>]+content\s*=\s*["'][^"']*charset=([^\s"';]+)/i)?.[1]
  let charset = (headerCharset || htmlCharset || 'utf-8').toLowerCase()
  if (charset === 'gb2312' || charset === 'gb18030') charset = 'gbk'
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function decodeEntities(value) {
  const named = { amp: '&', apos: "'", gt: '>', hellip: '…', ldquo: '“', lsquo: '‘', lt: '<', mdash: '—', nbsp: ' ', ndash: '–', quot: '"', rdquo: '”', rsquo: '’' }
  return String(value || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const number = code[1].toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10)
    try { return Number.isFinite(number) ? String.fromCodePoint(number) : entity } catch { return entity }
  })
}

function looksLikeHtml(text, contentType) {
  return contentType.includes('html') || /<!doctype\s+html|<html\b|<head\b|<meta\b/i.test(text.slice(0, 4_096))
}

function summarizeAttachments(attachments) {
  return (attachments || []).slice(0, 20).map((entry) => ({
    id: entry.id,
    name: entry.name,
    mimeType: entry.mimeType,
    size: entry.size,
    kind: isImageMime(entry.mimeType) ? 'image' : isVideoMime(entry.mimeType) ? 'video' : 'file',
  }))
}

function cacheIsFresh(snapshot, ttlMs, detail, sourceUrl) {
  if (!snapshot || ttlMs <= 0 || !snapshot.fetchedAt) return false
  if (detail === 'full' && snapshot.detail !== 'full') return false
  if (clean(sourceUrl) && clean(snapshot.sourceUrl) !== clean(sourceUrl)) return false
  const fetched = Date.parse(snapshot.fetchedAt)
  const effectiveTtl = snapshot.extraction?.source === 'unavailable' ? Math.min(ttlMs, 2 * 60 * 1000) : ttlMs
  return Number.isFinite(fetched) && Date.now() - fetched <= effectiveTtl
}

function projectSnapshot(snapshot, detail) {
  const projected = JSON.parse(JSON.stringify(snapshot))
  projected.detail = detail
  projected.text = limitText(projected.text, detail)
  projected.textTruncated = Boolean(projected.textTruncated || clean(snapshot.text).length > textLimit(detail))
  projected.images = Array.isArray(projected.images) ? projected.images.slice(0, detail === 'full' ? 12 : 6) : []
  return projected
}

function isVideoItem(item, snapshot) {
  return item.kind === 'video' || snapshot.pageType === 'video' || Boolean(snapshot.video)
    || (item.attachments || []).some((entry) => isVideoMime(entry.mimeType))
}

function isImageMime(value) {
  return String(value || '').toLowerCase().startsWith('image/')
}

function isVideoMime(value) {
  return String(value || '').toLowerCase().startsWith('video/')
}

function isPlaylistMime(value) {
  return /mpegurl|dash\+xml/i.test(String(value || ''))
}

function mimeFromUrl(value) {
  try {
    const pathname = new URL(value).pathname.toLowerCase()
    if (/\.(jpe?g)$/.test(pathname)) return 'image/jpeg'
    if (/\.png$/.test(pathname)) return 'image/png'
    if (/\.gif$/.test(pathname)) return 'image/gif'
    if (/\.webp$/.test(pathname)) return 'image/webp'
    if (/\.avif$/.test(pathname)) return 'image/avif'
    if (/\.mp4$/.test(pathname)) return 'video/mp4'
    if (/\.webm$/.test(pathname)) return 'video/webm'
    if (/\.mov$/.test(pathname)) return 'video/quicktime'
    if (/\.m4v$/.test(pathname)) return 'video/x-m4v'
    return ''
  } catch {
    return ''
  }
}

function isDirectVideoUrl(value) {
  return isVideoMime(mimeFromUrl(value))
}

function isPlaylistUrl(value) {
  try { return /\.(m3u8|mpd)$/i.test(new URL(value).pathname) } catch { return false }
}

function isInteractiveHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return INTERACTIVE_HOSTS.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

function isVideoHost(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return VIDEO_HOSTS.some((entry) => hostname === entry || hostname.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

function canOfferBrowserCapture(error) {
  return !(error instanceof SafeFetchError)
    || !['PRIVATE_ADDRESS', 'INVALID_PROTOCOL', 'URL_CREDENTIALS', 'INVALID_URL'].includes(error.code)
}

function verifiedImageType(buffer, claimedType) {
  const claimed = String(claimedType || '').split(';')[0].trim().toLowerCase()
  let detected = ''
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) detected = 'image/jpeg'
  else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detected = 'image/png'
  else if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) detected = 'image/gif'
  else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') detected = 'image/webp'
  else if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii').includes('ftypavif')) detected = 'image/avif'
  const mimeType = detected || (SUPPORTED_IMAGE_TYPES.has(claimed) && buffer.length > 16 ? claimed : '')
  const dimensions = imageDimensions(buffer, mimeType)
  if (dimensions && (dimensions.width > 16_384 || dimensions.height > 16_384 || dimensions.width * dimensions.height > 25_000_000)) return ''
  return mimeType
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (mimeType === 'image/gif' && buffer.length >= 10) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (mimeType === 'image/jpeg') return jpegDimensions(buffer)
  if (mimeType === 'image/webp') return webpDimensions(buffer)
  return null
}

function jpegDimensions(buffer) {
  for (let offset = 2; offset + 9 < buffer.length;) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9 || marker >= 0xd0 && marker <= 0xd7) { offset += 2; continue }
    if (offset + 4 > buffer.length) break
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) break
    offset += 2 + length
  }
  return null
}

function webpDimensions(buffer) {
  const chunk = buffer.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X' && buffer.length >= 30) {
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 }
  }
  if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ') {
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
    if (start >= 0 && start + 7 <= buffer.length) {
      return { width: buffer.readUInt16LE(start + 3) & 0x3fff, height: buffer.readUInt16LE(start + 5) & 0x3fff }
    }
  }
  return null
}

function resolveWebUrl(value, baseUrl) {
  if (!clean(value)) return ''
  try {
    const url = new URL(decodeEntities(value), baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.href.length <= 4_096 ? url.href : ''
  } catch {
    return ''
  }
}

function sameOriginUrl(value, baseUrl) {
  const resolved = resolveWebUrl(value, baseUrl)
  if (!resolved) return ''
  try { return new URL(resolved).origin === new URL(baseUrl).origin ? resolved : '' } catch { return '' }
}

function makeBrowserCapturePlan(url, reason) {
  return {
    needed: true,
    url: clean(url),
    reason: clean(reason) || 'The video requires an interactive or authenticated browser.',
    strategy: 'open_and_sample',
    maxScreenshots: 3,
    steps: [
      'Open the URL with an available browser or Chrome MCP.',
      'Read the visible title, caption, and page text once.',
      'For video, capture at most three representative states near 10%, 50%, and 90%; do not transcribe the whole video unless asked.',
    ],
    note: 'Aqi Drawer returns this plan but does not claim to control a browser by itself.',
  }
}

function framePositions(duration, count) {
  if (!duration) return [0]
  const ratios = count === 1 ? [0.5] : count === 2 ? [0.2, 0.75] : [0.1, 0.5, 0.9]
  return ratios.slice(0, count).map((ratio) => Math.max(0, Math.min(duration - 0.05, duration * ratio)))
}

function frameFailure(error, fallback) {
  if (isCommandMissing(error)) {
    return { status: 'unavailable', media: [], reason: 'ffprobe/ffmpeg is not installed on this host.' }
  }
  return {
    status: 'browser_needed',
    media: [],
    reason: readerErrorMessage(error) || fallback,
    warning: fallback,
  }
}

function isCommandMissing(error) {
  return error?.code === 'ENOENT' || error?.cause?.code === 'ENOENT'
}

function videoExtension(mimeType, url) {
  const mime = String(mimeType || '').toLowerCase()
  if (mime.includes('webm')) return '.webm'
  if (mime.includes('quicktime')) return '.mov'
  if (mime.includes('m4v')) return '.m4v'
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase()
    if (['.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv'].includes(extension)) return extension
  } catch {
    // The MIME fallback below is enough.
  }
  return '.mp4'
}

function addMedia(media, entry, limit, maxTotalBytes = MAX_RETURN_MEDIA_BYTES) {
  if (!entry?.data || !entry.mimeType || media.length >= limit) return
  if (entry.sourceUrl && media.some((existing) => existing.sourceUrl === entry.sourceUrl)) return
  if (media.reduce((total, existing) => total + existing.data.length, 0) + entry.data.length > maxTotalBytes) return
  media.push(entry)
}

function safeHostname(value) {
  try { return new URL(value).hostname } catch { return 'the linked page' }
}

function safeErrorCode(error) {
  return error instanceof SafeFetchError ? error.code : 'READ_FAILED'
}

function readerErrorMessage(error) {
  if (error instanceof SafeFetchError) return error.message
  return 'The linked content could not be read.'
}

function formatSeconds(value) {
  if (value < 60) return `${value.toFixed(1)}s`
  const minutes = Math.floor(value / 60)
  return `${minutes}m${Math.round(value % 60)}s`
}

function bestSrcset(value) {
  if (!clean(value)) return ''
  return value.split(',').map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || ''
}

function firstClean(...values) {
  return values.map(clean).find(Boolean) || ''
}

function limitMetadata(value, maximum) {
  const text = clean(value).replace(/\s+/g, ' ')
  return text.length > maximum ? `${text.slice(0, maximum).trimEnd()}…` : text
}

function durationToSeconds(value) {
  const text = clean(value)
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  const match = text.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i)
  if (!match) return 0
  return Number(match[1] || 0) * 86_400 + Number(match[2] || 0) * 3_600 + Number(match[3] || 0) * 60 + Number(match[4] || 0)
}

function uniqueStrings(values) {
  return [...new Set(values.map(clean).filter(Boolean))]
}

function sanitizeControlCharacters(value) {
  return [...value].map((character) => {
    const code = character.codePointAt(0)
    return code < 32 && ![9, 10, 13].includes(code) ? ' ' : character
  }).join('')
}

function limitText(value, detail) {
  const text = clean(value)
  const limit = textLimit(detail)
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

function textLimit(detail) {
  return detail === 'full' ? FULL_TEXT_LIMIT : COMPACT_TEXT_LIMIT
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function clampNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.trunc(number)))
}
