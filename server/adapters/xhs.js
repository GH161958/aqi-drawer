const XHS_HOSTS = ['xiaohongshu.com', 'xhslink.com', 'xhslink.cn']
const XHS_IMAGE_HOST = 'xhscdn.com'
const USER_AGENT = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  'AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
].join(' ')
const MAX_REDIRECTS = 5
const MAX_HTML_BYTES = 4 * 1024 * 1024
const MAX_IMAGE_BYTES = 15 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 15_000

export class XhsAdapter {
  constructor({ fetchImpl = globalThis.fetch, maxHtmlBytes = MAX_HTML_BYTES, maxImageBytes = MAX_IMAGE_BYTES, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('XHS adapter requires fetch.')
    this.fetchImpl = fetchImpl
    this.maxHtmlBytes = boundedNumber(maxHtmlBytes, 64 * 1024, 16 * 1024 * 1024, MAX_HTML_BYTES)
    this.maxImageBytes = boundedNumber(maxImageBytes, 64 * 1024, 25 * 1024 * 1024, MAX_IMAGE_BYTES)
    this.timeoutMs = boundedNumber(timeoutMs, 500, 120_000, REQUEST_TIMEOUT_MS)
  }

  canHandle(value) {
    return Boolean(extractXhsUrl(value))
  }

  async parse(value) {
    const originalUrl = extractXhsUrl(value)
    if (!originalUrl) throw new Error('No Xiaohongshu URL was found.')
    let response
    try {
      response = await fetchAllowedRedirects(this.fetchImpl, originalUrl, isXhsHostname, {
        signal: AbortSignal.timeout(this.timeoutMs),
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
        },
      })
      if (!response.ok) throw new Error(`Xiaohongshu page returned HTTP ${response.status}.`)
      const html = (await readBoundedBody(response, this.maxHtmlBytes)).toString('utf8')
      return parseXhsInitialState(html, { originalUrl, finalUrl: response.url || originalUrl })
    } catch (error) {
      if (response?.url) error.finalUrl = response.url
      error.originalUrl = originalUrl
      throw error
    }
  }

  async loadImage(value) {
    const response = await fetchAllowedRedirects(this.fetchImpl, value, isXhsImageHostname, {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: {
        'user-agent': USER_AGENT,
        referer: 'https://www.xiaohongshu.com/',
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.2',
      },
    })
    if (!response.ok) throw new Error(`Xiaohongshu image returned HTTP ${response.status}.`)
    const claimedMime = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    const buffer = await readBoundedBody(response, this.maxImageBytes)
    const mimeType = verifiedImageType(buffer, claimedMime)
    if (!mimeType) throw new Error('Xiaohongshu image response was not a supported image.')
    return { buffer, mimeType, ...imageDimensions(buffer, mimeType), finalUrl: response.url || value }
  }
}

export function extractXhsUrl(value) {
  if (typeof value !== 'string') return ''
  const candidates = value.match(/https?:\/\/[^\s<>"'`，。！？；：、（）【】《》「」『』“”‘’()[\]{}]+/giu) || []
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[.,!?;:，。！？；：、)\]}>》」』”’]+$/u, '')
    try {
      const url = new URL(cleaned)
      if (['http:', 'https:'].includes(url.protocol) && isXhsHostname(url.hostname)) return url.href
    } catch {
      // Continue looking through share text.
    }
  }
  return ''
}

export function isXhsHostname(value) {
  const hostname = String(value || '').toLowerCase().replace(/\.$/, '')
  return XHS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

export function isXhsImageHostname(value) {
  const hostname = String(value || '').toLowerCase().replace(/\.$/, '')
  return hostname === XHS_IMAGE_HOST || hostname.endsWith(`.${XHS_IMAGE_HOST}`)
}

export function extractXhsNoteId(value) {
  try {
    const match = new URL(value).pathname.match(/\/(?:discovery\/item|explore)\/([A-Za-z0-9_-]+)/u)
    return match?.[1] || ''
  } catch {
    return ''
  }
}

export function parseXhsInitialState(html, { originalUrl = '', finalUrl = '' } = {}) {
  const marker = 'window.__INITIAL_STATE__='
  const start = String(html).indexOf(marker)
  if (start < 0) throw new Error('Xiaohongshu page did not expose __INITIAL_STATE__.')
  const contentStart = start + marker.length
  const scriptEnd = String(html).indexOf('</script>', contentStart)
  if (scriptEnd < 0) throw new Error('Xiaohongshu initial state script was incomplete.')
  const raw = String(html).slice(contentStart, scriptEnd).trim().replace(/;$/, '')
  let state
  try {
    state = JSON.parse(sanitizeJsObject(raw))
  } catch {
    throw new Error('Xiaohongshu initial state could not be decoded.')
  }

  const primaryData = state?.noteData?.data
  const primary = primaryData?.noteData
  const fallback = state?.noteData?.normalNotePreloadData
  if (!primary && !fallback) throw new Error('Xiaohongshu initial state did not contain note data.')
  const note = primary || fallback
  const rawAuthor = primary?.user || fallback?.user || {}
  const author = {
    id: clean(rawAuthor.userId || rawAuthor.id) || null,
    name: clean(rawAuthor.nickName || rawAuthor.nickname || rawAuthor.name) || null,
    avatar: normalizeWebUrl(rawAuthor.avatar || rawAuthor.image || rawAuthor.avatarUrl) || null,
  }
  const comments = normalizeComments(primaryData?.commentData?.comments, author.id)
  const images = normalizeImages(primary, fallback)
  const canonicalUrl = finalUrl || originalUrl
  const noteId = clean(primary?.noteId || fallback?.noteId || extractXhsNoteId(canonicalUrl))
  if (!noteId) throw new Error('Xiaohongshu note did not expose a stable noteId.')

  return {
    provider: 'xiaohongshu',
    externalId: noteId,
    noteId,
    canonicalUrl,
    originalUrl,
    title: clean(note.title),
    author,
    desc: clean(note.desc),
    tags: Array.isArray(primary?.tagList) ? primary.tagList.map((tag) => clean(tag?.name)).filter(Boolean) : [],
    interactions: {
      likedCount: nullableText(primary?.interactInfo?.likedCount),
      collectedCount: nullableText(primary?.interactInfo?.collectedCount),
      commentCount: nullableText(primary?.interactInfo?.commentCount ?? primaryData?.commentData?.commentCount),
      shareCount: nullableText(primary?.interactInfo?.shareCount),
    },
    images,
    comments,
    commentsFetched: comments.length,
    commentsComplete: false,
    parseStatus: 'complete',
    fetchedAt: new Date().toISOString(),
  }
}

function sanitizeJsObject(text) {
  let output = ''
  let quote = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      output += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) inString = false
      continue
    }
    if (character === '"' || character === "'") {
      inString = true
      quote = character
      output += character
      continue
    }
    const rest = text.slice(index)
    const replacement = [/^undefined\b/, /^NaN\b/, /^Infinity\b/].find((pattern) => pattern.test(rest))
    if (replacement) {
      const matched = rest.match(replacement)[0]
      output += 'null'
      index += matched.length - 1
      continue
    }
    output += character
  }
  return output
}

function normalizeImages(primary, fallback) {
  const values = Array.isArray(primary?.imageList) && primary.imageList.length
    ? primary.imageList.map((image) => ({ url: image?.url, width: image?.width, height: image?.height }))
    : Array.isArray(fallback?.imagesList)
      ? fallback.imagesList.map((image) => ({ url: image?.urlSizeLarge || image?.url, width: image?.width, height: image?.height }))
      : []
  return values.map((image, index) => ({
    index: index + 1,
    url: normalizeWebUrl(image.url),
    width: finiteNumber(image.width),
    height: finiteNumber(image.height),
  })).filter((image) => image.url && isXhsImageUrl(image.url))
}

function normalizeComments(values, authorId) {
  if (!Array.isArray(values)) return []
  return values.map((comment) => normalizeComment(comment, authorId, 0)).filter(Boolean)
}

function normalizeComment(comment, authorId, depth) {
  if (!comment || typeof comment !== 'object' || depth > 4) return null
  const rawUser = comment.user || {}
  const userId = clean(rawUser.userId || rawUser.id)
  const replies = Array.isArray(comment.subComments)
    ? comment.subComments.map((reply) => normalizeComment(reply, authorId, depth + 1)).filter(Boolean)
    : []
  return {
    id: clean(comment.id) || null,
    user: {
      id: userId || null,
      name: clean(rawUser.nickname || rawUser.nickName || rawUser.name) || null,
      avatar: normalizeWebUrl(rawUser.image || rawUser.avatar || rawUser.avatarUrl) || null,
      isAuthor: authorId && userId ? authorId === userId : null,
    },
    content: clean(comment.content),
    ipLocation: clean(comment.ipLocation) || null,
    likedCount: nullableText(comment.likeViewCount ?? comment.likeCount),
    createdAt: normalizeTimestamp(comment.createTime ?? comment.createdAt),
    replies,
  }
}

async function fetchAllowedRedirects(fetchImpl, initialValue, hostnameAllowed, options) {
  let url = allowedUrl(initialValue, hostnameAllowed)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetchImpl(url, { ...options, redirect: 'manual' })
    if (response.status < 300 || response.status >= 400) return response
    const location = response.headers.get('location')
    if (!location || redirect === MAX_REDIRECTS) throw new Error('Xiaohongshu redirect limit was exceeded.')
    url = allowedUrl(new URL(location, url).href, hostnameAllowed)
  }
  throw new Error('Xiaohongshu redirect failed.')
}

function allowedUrl(value, hostnameAllowed) {
  let url
  try { url = new URL(value) } catch { throw new Error('Xiaohongshu URL was invalid.') }
  if (!['http:', 'https:'].includes(url.protocol) || !hostnameAllowed(url.hostname)) {
    throw new Error('Xiaohongshu URL host was not allowed.')
  }
  return url
}

async function readBoundedBody(response, maximum) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximum) throw new Error('Xiaohongshu response exceeded the size limit.')
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > maximum) throw new Error('Xiaohongshu response exceeded the size limit.')
    return buffer
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximum) throw new Error('Xiaohongshu response exceeded the size limit.')
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

function verifiedImageType(buffer, claimedMime) {
  let detected = ''
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) detected = 'image/jpeg'
  else if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) detected = 'image/png'
  else if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) detected = 'image/gif'
  else if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') detected = 'image/webp'
  else if (buffer.length >= 12 && buffer.subarray(4, 12).toString('ascii').includes('ftypavif')) detected = 'image/avif'
  if (!detected) return ''
  return !claimedMime || claimedMime === 'application/octet-stream' || claimedMime === detected ? detected : ''
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  if (mimeType === 'image/gif' && buffer.length >= 10) return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  if (mimeType === 'image/jpeg') return jpegDimensions(buffer)
  if (mimeType === 'image/webp') return webpDimensions(buffer)
  return { width: null, height: null }
}

function jpegDimensions(buffer) {
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue }
    const marker = buffer[offset + 1]
    offset += 2
    if ([0xd8, 0xd9].includes(marker)) continue
    if (offset + 2 > buffer.length) break
    const length = buffer.readUInt16BE(offset)
    const frame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (frame && offset + 7 < buffer.length) return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) }
    if (length < 2) break
    offset += length
  }
  return { width: null, height: null }
}

function webpDimensions(buffer) {
  if (buffer.length < 25) return { width: null, height: null }
  const format = buffer.toString('ascii', 12, 16)
  if (format === 'VP8X' && buffer.length >= 30) return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
  if (format === 'VP8 ' && buffer.length >= 30) return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  if (format === 'VP8L' && buffer[20] === 0x2f) {
    return { width: 1 + (((buffer[22] & 0x3f) << 8) | buffer[21]), height: 1 + (((buffer[24] & 0x0f) << 10) | (buffer[23] << 2) | ((buffer[22] & 0xc0) >> 6)) }
  }
  return { width: null, height: null }
}

function isXhsImageUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol) && isXhsImageHostname(new URL(value).hostname) } catch { return false }
}

function normalizeWebUrl(value) {
  const text = clean(value)
  if (!text) return ''
  if (text.startsWith('//')) return `https:${text}`
  if (text.startsWith('http://')) return `https://${text.slice(7)}`
  try {
    const url = new URL(text)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : ''
  } catch { return '' }
}

function normalizeTimestamp(value) {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString()
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) return null
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric
  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function nullableText(value) {
  if (value === undefined || value === null || value === '') return null
  return String(value)
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}
