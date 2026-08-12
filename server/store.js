import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { canonicalizeUrl, inferSourceApp, isGenericSourceApp, normalizeIncomingShare } from './share-normalizer.js'

const EMPTY_STORE = { schemaVersion: 1, updatedAt: null, items: [] }
const STATUSES = new Set(['inbox', 'tonight', 'discussed', 'deferred', 'memory_candidate', 'archived'])
const DEDUPE_WINDOW_MS = 10 * 60 * 1000

export class PocketStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir)
    this.filePath = path.join(this.dataDir, 'pocket-store.json')
    this.mediaDir = path.join(this.dataDir, 'media')
    this.queue = Promise.resolve()
  }

  async init() {
    await mkdir(this.mediaDir, { recursive: true })
    try {
      await readFile(this.filePath, 'utf8')
      const state = await this.#read()
      if (!state.attentionInitializedAt) {
        const now = new Date().toISOString()
        state.attentionInitializedAt = now
        for (const item of state.items) item.seenByCAt ||= now
        await this.#write(state)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.#write({ ...EMPTY_STORE, attentionInitializedAt: new Date().toISOString() })
    }
  }

  async list({ status, limit = 100, includeDeleted = false } = {}) {
    const state = await this.#read()
    return state.items
      .filter((item) => (includeDeleted || !item.deletedAt) && (!status || item.status === status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)))
      .map(publicItem)
  }

  async get(id) {
    const state = await this.#read()
    const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
    return item ? publicItem(item) : null
  }

  async getForContentRead(id) {
    const state = await this.#read()
    const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
    return item ? publicItem(item, { includeContentSnapshot: true }) : null
  }

  async peekUnseen({ limit = 8 } = {}) {
    const state = await this.#read()
    return state.items
      .filter((item) => !item.deletedAt && !item.seenByCAt && item.status !== 'archived')
      .sort((a, b) => (b.lastReceivedAt || b.updatedAt || b.createdAt).localeCompare(a.lastReceivedAt || a.updatedAt || a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
      .map(publicItem)
  }

  async upsert(input) {
    return this.#mutate((state) => {
      const now = new Date().toISOString()
      const normalized = normalizeItem(input, now)
      const hasExplicitId = Boolean(clean(input?.id))
      const duplicateIndex = hasExplicitId ? -1 : findRecentDuplicate(state.items, normalized, now)
      if (duplicateIndex >= 0) {
        state.items[duplicateIndex] = mergeDuplicate(state.items[duplicateIndex], normalized, now)
        return publicItem(state.items[duplicateIndex])
      }
      const index = state.items.findIndex((item) => item.id === normalized.id)
      if (index < 0) state.items.push(normalized)
      else if (normalized.updatedAt >= state.items[index].updatedAt) state.items[index] = normalized
      return publicItem(index < 0 ? normalized : state.items[index])
    })
  }

  async takeUnseen({ limit = 8 } = {}) {
    return this.#mutate((state) => {
      const now = new Date().toISOString()
      const items = state.items
        .filter((item) => !item.deletedAt && !item.seenByCAt && item.status !== 'archived')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
      for (const item of items) {
        item.seenByCAt = now
        item.updatedAt = now
      }
      return items.map(publicItem)
    })
  }

  async reply(id, input) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const replyId = clean(input.replyId) || randomUUID()
      const existing = item.replies.find((reply) => reply.id === replyId)
      if (existing) return { item: publicItem(item), reply: clone(existing), duplicate: true }
      const text = clean(input.text)
      if (!text) throw httpError(400, 'Reply text is required.')
      const reply = {
        id: replyId,
        author: input.author === 'Bella' ? 'Bella' : 'C',
        text,
        createdAt: input.createdAt || new Date().toISOString(),
        source: ['enervate', 'chatgpt', 'shortcut'].includes(input.source) ? input.source : 'chatgpt',
      }
      item.replies.push(reply)
      item.updatedAt = reply.createdAt
      item.syncState = 'synced'
      return { item: publicItem(item), reply: clone(reply), duplicate: false }
    })
  }

  async review(id, action, candidateResult) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      if (!STATUSES.has(action)) throw httpError(400, 'Unknown pocket review action.')
      const now = new Date().toISOString()
      item.status = action
      item.updatedAt = now
      item.syncState = 'synced'
      if (action === 'discussed') {
        item.seenByCAt ||= now
        item.discussedAt = now
      }
      if (action === 'memory_candidate') {
        item.memoryCandidate = candidateResult?.ok
          ? {
              status: 'pending_review',
              candidateIds: candidateResult.candidateIds ?? [],
              rootHash: candidateResult.rootHash,
              updatedAt: now,
            }
          : {
              status: 'pending_sync',
              candidateIds: [],
              error: candidateResult?.error || 'C-Memory is not configured.',
              updatedAt: now,
            }
      }
      return publicItem(item)
    })
  }

  async setContentSnapshot(id, snapshot) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const incoming = normalizeContentSnapshot(snapshot)
      const current = item.contentSnapshot ? normalizeContentSnapshot(item.contentSnapshot) : null
      const sameSource = current?.sourceUrl === incoming.sourceUrl
      const currentIsAtLeastAsFresh = Date.parse(current?.fetchedAt) >= Date.parse(incoming.fetchedAt)
      item.contentSnapshot = sameSource && current.detail === 'full' && incoming.detail !== 'full' && currentIsAtLeastAsFresh
        ? current
        : incoming
      return publicItem(item)
    })
  }

  async getAttachmentFile(attachmentId) {
    const state = await this.#read()
    for (const item of state.items) {
      const attachment = item.attachments.find((entry) => entry.id === attachmentId && entry.storageName)
      if (!attachment) continue
      return {
        attachment: publicAttachment(attachment),
        filePath: path.join(this.mediaDir, path.basename(attachment.storageName)),
      }
    }
    return null
  }

  async readAttachment(attachmentId, maxBytes = 5 * 1024 * 1024) {
    const state = await this.#read()
    for (const item of state.items) {
      const attachment = item.attachments.find((entry) => entry.id === attachmentId && entry.storageName)
      if (!attachment) continue
      if (attachment.size > maxBytes) throw httpError(413, 'Attachment is too large to return through MCP.')
      const storageName = path.basename(attachment.storageName)
      return {
        attachment: publicAttachment(attachment),
        data: await readFile(path.join(this.mediaDir, storageName)),
      }
    }
    return null
  }

  async #read() {
    const raw = await readFile(this.filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.items)) throw new Error('Pocket store is invalid.')
    return parsed
  }

  async #write(state) {
    const next = { ...state, updatedAt: new Date().toISOString() }
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporary, this.filePath)
  }

  #mutate(operation) {
    const run = async () => {
      const state = await this.#read()
      const result = await operation(state)
      await this.#write(state)
      return result
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }
}

function normalizeItem(input, now) {
  const incoming = normalizeIncomingShare(input)
  const text = clean(incoming.text)
  const sourceUrl = clean(incoming.sourceUrl)
  const attachments = Array.isArray(incoming.attachments) ? incoming.attachments.map(normalizeAttachment) : []
  if (!text && !sourceUrl && attachments.length === 0) throw httpError(400, 'Text, sourceUrl, or an attachment is required.')
  const id = clean(incoming.id) || randomUUID()
  const createdAt = validIso(incoming.createdAt) ? incoming.createdAt : now
  const inferredSource = inferSourceApp(sourceUrl)
  const requestedSource = clean(incoming.sourceApp)
  const sourceApp = inferredSource && isGenericSourceApp(requestedSource)
    ? inferredSource
    : requestedSource || inferredSource || 'C Pocket'
  return {
    id,
    title: clean(incoming.title) || deriveTitle(text, sourceUrl),
    text,
    sourceUrl,
    sourceApp,
    note: clean(incoming.note),
    kind: ['link', 'text', 'image', 'video', 'mixed'].includes(incoming.kind)
      ? incoming.kind
      : attachments.length ? 'mixed' : sourceUrl ? 'link' : 'text',
    status: STATUSES.has(incoming.status) ? incoming.status : 'inbox',
    attachments,
    replies: Array.isArray(incoming.replies) ? incoming.replies.map(normalizeReply).filter(Boolean) : [],
    memoryCandidate: normalizeCandidate(incoming.memoryCandidate, createdAt),
    ...(incoming.contentSnapshot ? { contentSnapshot: normalizeContentSnapshot(incoming.contentSnapshot) } : {}),
    fingerprint: clean(incoming.fingerprint) || createFingerprint(text, sourceUrl, attachments),
    receivedCount: Math.max(1, Number(incoming.receivedCount) || 1),
    lastReceivedAt: validIso(incoming.lastReceivedAt) ? incoming.lastReceivedAt : createdAt,
    seenByCAt: validIso(incoming.seenByCAt) ? incoming.seenByCAt : null,
    discussedAt: validIso(incoming.discussedAt) ? incoming.discussedAt : null,
    createdAt,
    updatedAt: validIso(incoming.updatedAt) ? incoming.updatedAt : now,
    deletedAt: validIso(incoming.deletedAt) ? incoming.deletedAt : null,
    syncState: 'synced',
  }
}

function normalizeContentSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Content snapshot must be an object.')
  }
  const snapshot = clone(value)
  delete snapshot.rawHtml
  delete snapshot.media
  delete snapshot.buffers
  delete snapshot.frameExtraction
  delete snapshot.visuals
  delete snapshot.browserCapturePlan
  return snapshot
}

function findRecentDuplicate(items, candidate, now) {
  if (!candidate.fingerprint) return -1
  const cutoff = Date.parse(now) - DEDUPE_WINDOW_MS
  return items.findIndex((item) => {
    if (item.deletedAt) return false
    const fingerprint = item.fingerprint || createFingerprint(item.text, item.sourceUrl, item.attachments)
    const receivedAt = Date.parse(item.lastReceivedAt || item.updatedAt || item.createdAt)
    return fingerprint === candidate.fingerprint && Number.isFinite(receivedAt) && receivedAt >= cutoff
  })
}

function mergeDuplicate(existing, incoming, now) {
  const attachments = [...existing.attachments]
  for (const attachment of incoming.attachments) {
    const duplicate = attachments.some((entry) => entry.sha256 && attachment.sha256
      ? entry.sha256 === attachment.sha256
      : entry.name === attachment.name && entry.size === attachment.size)
    if (!duplicate) attachments.push(attachment)
  }
  return {
    ...existing,
    title: existing.title || incoming.title,
    text: incoming.text.length > clean(existing.text).length ? incoming.text : existing.text,
    sourceUrl: existing.sourceUrl || incoming.sourceUrl,
    sourceApp: isGenericSourceApp(existing.sourceApp) && !isGenericSourceApp(incoming.sourceApp)
      ? incoming.sourceApp
      : existing.sourceApp,
    note: existing.note || incoming.note,
    kind: attachments.length ? 'mixed' : existing.sourceUrl || incoming.sourceUrl ? 'link' : 'text',
    attachments,
    fingerprint: incoming.fingerprint,
    receivedCount: Math.max(1, Number(existing.receivedCount) || 1) + 1,
    lastReceivedAt: now,
    seenByCAt: null,
    updatedAt: now,
    syncState: 'synced',
  }
}

function createFingerprint(text, sourceUrl, attachments = []) {
  const url = canonicalizeUrl(sourceUrl)
  const attachmentKeys = attachments.map((entry) => entry.sha256 || `${entry.name}:${entry.size}`).sort().join('|')
  const source = url ? `url:${url}` : clean(text) ? `text:${clean(text).replace(/\s+/g, ' ')}` : `files:${attachmentKeys}`
  return source ? createHash('sha256').update(source).digest('hex') : ''
}

function normalizeAttachment(value) {
  return {
    id: clean(value?.id) || randomUUID(),
    name: clean(value?.name) || 'attachment',
    mimeType: clean(value?.mimeType) || 'application/octet-stream',
    size: Math.max(0, Number(value?.size) || 0),
    ...(clean(value?.sha256) ? { sha256: clean(value.sha256) } : {}),
    ...(clean(value?.url) ? { url: clean(value.url) } : {}),
    ...(clean(value?.storageName) ? { storageName: path.basename(clean(value.storageName)) } : {}),
  }
}

function normalizeReply(value) {
  if (!value || !clean(value.text)) return null
  return {
    id: clean(value.id) || randomUUID(),
    author: value.author === 'Bella' ? 'Bella' : 'C',
    text: clean(value.text),
    createdAt: validIso(value.createdAt) ? value.createdAt : new Date().toISOString(),
    source: ['enervate', 'chatgpt', 'shortcut'].includes(value.source) ? value.source : 'enervate',
  }
}

function normalizeCandidate(value, now) {
  const allowed = ['none', 'pending_sync', 'pending_review', 'approved', 'rejected']
  return {
    status: allowed.includes(value?.status) ? value.status : 'none',
    candidateIds: Array.isArray(value?.candidateIds) ? value.candidateIds.map(clean).filter(Boolean) : [],
    ...(clean(value?.error) ? { error: clean(value.error) } : {}),
    updatedAt: validIso(value?.updatedAt) ? value.updatedAt : now,
  }
}

function deriveTitle(text, url) {
  if (text) return text.replace(/\s+/g, ' ').slice(0, 42)
  try { return new URL(url).hostname } catch { return '刚刚叼回来的东西' }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function clone(value) {
  return structuredClone(value)
}

function publicItem(item, { includeContentSnapshot = false } = {}) {
  const visible = clone(item)
  delete visible.fingerprint
  const contentSnapshot = visible.contentSnapshot
  if (!includeContentSnapshot) delete visible.contentSnapshot
  return {
    ...visible,
    receivedCount: Math.max(1, Number(item.receivedCount) || 1),
    lastReceivedAt: item.lastReceivedAt || item.createdAt,
    seenByCAt: item.seenByCAt || null,
    discussedAt: item.discussedAt || null,
    attachments: item.attachments.map(publicAttachment),
    ...(contentSnapshot && !includeContentSnapshot ? { contentRead: summarizeContentSnapshot(contentSnapshot) } : {}),
  }
}

function summarizeContentSnapshot(snapshot) {
  return {
    cachedAt: snapshot.fetchedAt,
    detail: snapshot.detail,
    pageType: snapshot.pageType,
    title: clean(snapshot.title).slice(0, 160),
    textPreview: clean(snapshot.text).replace(/\s+/g, ' ').slice(0, 240),
    imagesAvailable: Array.isArray(snapshot.images) ? snapshot.images.length : 0,
    videoDetected: Boolean(snapshot.video),
  }
}

function publicAttachment(attachment) {
  const { storageName, ...safe } = clone(attachment)
  return {
    ...safe,
    ...(storageName && !safe.url ? { url: `/api/pocket/media/${encodeURIComponent(attachment.id)}` } : {}),
  }
}

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
