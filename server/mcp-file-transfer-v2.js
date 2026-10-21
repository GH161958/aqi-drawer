// File Intake V2: pin one host-provided fileParams value until EE authorizes
// that exact hostname and file intent. Ticket and signed URL are in-memory only.
// Reuses V1 byte validation and durable receipts; independently feature-gated.
import { createHash, randomUUID } from 'node:crypto'
import { createMcpFileOperation, MCP_FILE_OPERATION_MS } from './mcp-file-operation.js'
import {
  createMcpFileIntakeService, describeMcpFileHost, validChatGptFileId,
  describeMcpFileIntakeRequest, readMcpFileIntakeReceipt, validateMcpFileRequestIdPrivacy,
} from './mcp-file-intake.js'

export const PINNED_FILE_TTL_MS = 15 * 60 * 1000
export const MAX_PINNED_FILES = 12

export function createPinnedFileTransferV2({
  store, download, clock = () => Date.now(),
  ttlMs = PINNED_FILE_TTL_MS, maxPending = MAX_PINNED_FILES,
  budgetMs = MCP_FILE_OPERATION_MS,
} = {}) {
  if (!store) throw new Error('Pinned File Intake requires the existing PocketStore.')
  if (!(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= PINNED_FILE_TTL_MS)) {
    throw new Error('Invalid pinned-file TTL.')
  }
  if (!(Number.isSafeInteger(maxPending) && maxPending > 0 && maxPending <= MAX_PINNED_FILES)) {
    throw new Error('Invalid pinned-file capacity.')
  }

  if (!(budgetMs > 0 && budgetMs <= MCP_FILE_OPERATION_MS)) throw new Error('Invalid file operation budget.')

  const pending = new Map()
  const completed = new Map()
  const discard = (map, ticket) => {
    const entry = map.get(ticket)
    // Revoke BEFORE making capacity/request_id available to another prepare.
    entry?.operation?.cancel()
    entry?.operation?.dispose()
    clearTimeout(entry?.timer)
    if (entry) entry.input = null
    map.delete(ticket)
  }
  const expire = (map, ticket, entry) => {
    entry.timer = setTimeout(() => {
      if (!entry.operation?.accepted) discard(map, ticket)
    }, Math.max(0, entry.expiresAt - clock()))
    entry.timer.unref?.()
  }
  const sweep = (now) => {
    for (const map of [pending, completed]) {
      for (const [ticket, entry] of map) {
        if (!entry.operation?.accepted && (entry.expiresAt <= now
          || (entry.operation && entry.operation.deadline <= now))) discard(map, ticket)
      }
    }
  }
  const previewFor = (ticketId, entry) => ({
    ticketId, hostname: entry.hostname, expiresAt: new Date(entry.expiresAt).toISOString(),
    mode: entry.mode, title: entry.title, itemId: entry.mode === 'append' ? entry.itemId : null,
    ...(entry.state === 'completed'
      ? { status: 'receipt_available' }
      : { downloaded: false, stored: false }),
  })

  function prepare({ requestId, mode, itemId, title = '', text = '', file } = {}) {
    if (!/^[A-Za-z0-9_.:-]{8,120}$/u.test(String(requestId ?? ''))) {
      throw new Error('A stable request_id is required.')
    }
    if (!['new', 'append'].includes(mode)) throw new Error('Choose new or append.')
    if (mode === 'new' && itemId) throw new Error('New transfer cannot supply an existing item ID.')
    if (mode === 'append' && (!itemId || title || text)) {
      throw new Error('Append cannot replace existing title or text.')
    }
    if (typeof title !== 'string' || title.length > 160
      || typeof text !== 'string' || text.length > 20000) {
      throw new Error('File item title/text is invalid.')
    }
    // No DNS resolution, download, or persistent write during prepare.
    const preview = describeMcpFileHost(file)
    if (!validChatGptFileId(file.file_id)) throw new Error('Invalid ChatGPT file parameter.')
    validateMcpFileRequestIdPrivacy(requestId, file.file_id)

    const now = clock()
    if (!Number.isFinite(now)) throw new Error('Invalid transfer clock.')
    sweep(now)
    const fingerprint = createHash('sha256').update(JSON.stringify([
      mode, itemId || '', title, text, file.download_url, file.file_id,
      file.mime_type ?? null, file.file_name ?? null,
    ])).digest('hex')
    for (const [ticket, entry] of pending) {
      if (entry.requestId !== requestId) continue
      if (entry.fingerprint !== fingerprint) throw new Error('Pending request_id was already used for different file input or intent.')
      return previewFor(ticket, entry)
    }
    for (const [ticket, entry] of completed) {
      if (entry.requestId === requestId && entry.fingerprint === fingerprint) return previewFor(ticket, entry)
    }
    if (pending.size >= maxPending) throw new Error('Too many pending file approvals.')

    const ticketId = randomUUID()
    const expiresAt = now + ttlMs
    // Never return/log/store a signed URL, file ID or token in persistent data.
    const pinnedFile = Object.freeze({
      download_url: file.download_url,
      file_id: file.file_id,
      ...(file.mime_type !== undefined ? { mime_type: file.mime_type } : {}),
      ...(file.file_name !== undefined ? { file_name: file.file_name } : {}),
    })
    const entry = {
      hostname: preview.hostname, expiresAt, state: 'prepared',
      requestId, fingerprint, mode, itemId, title,
      input: Object.freeze({
        requestId, mode, itemId, title, text, file: pinnedFile,
      }),
    }
    pending.set(ticketId, entry)
    expire(pending, ticketId, entry)
    return previewFor(ticketId, entry)
  }

  async function commit({ ticketId, approvedHostname, approvedTitle } = {}) {
    const now = clock()
    if (!Number.isFinite(now)) throw new Error('Invalid transfer clock.')
    sweep(now)
    const entry = pending.get(ticketId) ?? completed.get(ticketId)
    if (!entry) throw new Error('Pinned transfer ticket is missing or expired; prepare a fresh file.')
    if (approvedHostname !== entry.hostname || approvedTitle !== entry.title) {
      throw new Error('Explicit approval must match the pinned hostname and title.')
    }
    if (entry.state === 'completed') {
      // Recheck canonical attachment identity and bytes, without retaining or
      // re-fetching the source URL. Replay preserves the FIRST response exactly.
      const current = await readMcpFileIntakeReceipt(store, entry.replayInput)
      if (!current || current.attachmentId !== entry.receipt.attachmentId
        || current.sha256 !== entry.receipt.sha256 || current.bytes !== entry.receipt.bytes) {
        throw new Error('Completed transfer attachment changed. Manual review required.')
      }
      return { ...entry.receipt }
    }
    if (entry.state !== 'prepared') throw new Error('Pinned transfer already in progress.')

    // Claim the single-use ticket before any await; prevent double submissions.
    entry.state = 'committing'
    if (!entry.operation) {
      entry.operation = createMcpFileOperation({ clock, expiresAt: entry.expiresAt, budgetMs })
      entry.operation.signal.addEventListener('abort', () => {
        if (pending.get(ticketId) === entry) discard(pending, ticketId)
      }, { once: true })
    }
    // Retries retain the FIRST commit's deadline, even after transient errors.
    const operation = entry.operation
    try {
      operation.check()
      const replayInputBase = describeMcpFileIntakeRequest(entry.input)
      // Exact per-ticket hostname, never wildcard and never a globally added host.
      // Reuse V1's hardened DNS/TLS, size/type/hash and durable idempotency path.
      const intake = createMcpFileIntakeService({
        store, allowedHosts: [entry.hostname], persistFileId: false,
        ...(download ? { download } : {}),
      })
      const receipt = await intake.save(entry.input, operation)
      operation.check()
      const replayInput = {
        ...replayInputBase,
        verifiedFile: { sha256: receipt.sha256, bytes: receipt.bytes, mimeType: receipt.mimeType },
      }
      discard(pending, ticketId)
      // Completed receipts use a separate bounded cache and contain no source
      // URL or original file ID. Reads never extend its TTL or permit a fetch.
      while (completed.size >= maxPending) discard(completed, completed.keys().next().value)
      const done = {
        hostname: entry.hostname, title: entry.title, mode: entry.mode, itemId: entry.itemId,
        requestId: entry.requestId, fingerprint: entry.fingerprint,
        state: 'completed', expiresAt: clock() + ttlMs,
        replayInput, receipt: Object.freeze({ ...receipt }),
      }
      completed.set(ticketId, done)
      expire(completed, ticketId, done)
      return receipt
    } catch (error) {
      // Safe retry of the *same* pinned URL while the approval is still alive.
      if (!operation.signal.aborted && clock() < operation.deadline && pending.get(ticketId) === entry) {
        entry.state = 'prepared'
      } else {
        discard(pending, ticketId)
      }
      throw error
    }
  }

  return { prepare, commit }
}
