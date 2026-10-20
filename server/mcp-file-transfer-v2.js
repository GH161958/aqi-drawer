// File Intake V2: pin one host-provided fileParams value until EE authorizes
// that exact hostname and file intent. Ticket and signed URL are in-memory only.
// V1 Intake remains unchanged; this module is separately feature-gated.
import { randomUUID } from 'node:crypto'
import {
  createMcpFileIntakeService, describeMcpFileHost, validChatGptFileId,
} from './mcp-file-intake.js'

export const PINNED_FILE_TTL_MS = 15 * 60 * 1000
export const MAX_PINNED_FILES = 12

export function createPinnedFileTransferV2({
  store, download, clock = () => Date.now(),
  ttlMs = PINNED_FILE_TTL_MS, maxPending = MAX_PINNED_FILES,
} = {}) {
  if (!store) throw new Error('Pinned File Intake requires the existing PocketStore.')
  if (!(Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= PINNED_FILE_TTL_MS)) {
    throw new Error('Invalid pinned-file TTL.')
  }
  if (!(Number.isSafeInteger(maxPending) && maxPending > 0 && maxPending <= MAX_PINNED_FILES)) {
    throw new Error('Invalid pinned-file capacity.')
  }

  const pending = new Map()
  const sweep = (now) => {
    for (const [ticket, entry] of pending) {
      if (entry.expiresAt <= now) pending.delete(ticket)
    }
  }

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

    const now = clock()
    if (!Number.isFinite(now)) throw new Error('Invalid transfer clock.')
    sweep(now)
    if (pending.size >= maxPending) throw new Error('Too many pending file approvals.')

    const ticketId = randomUUID()
    const expiresAt = now + ttlMs
    // Never return/log/store a signed URL, file ID or token in persistent data.
    const pinnedFile = Object.freeze({
      download_url: file.download_url,
      file_id: file.file_id,
      ...(file.mime_type ? { mime_type: file.mime_type } : {}),
      ...(file.file_name ? { file_name: file.file_name } : {}),
    })
    pending.set(ticketId, {
      hostname: preview.hostname, expiresAt, state: 'prepared',
      input: Object.freeze({
        requestId, mode, itemId, title, text, file: pinnedFile,
      }),
    })
    const expiry = setTimeout(() => pending.delete(ticketId), ttlMs)
    expiry.unref?.()
    return {
      ticketId, hostname: preview.hostname, expiresAt: new Date(expiresAt).toISOString(),
      mode, title, itemId: mode === 'append' ? itemId : null,
      downloaded: false, stored: false,
    }
  }

  async function commit({ ticketId, approvedHostname, approvedTitle } = {}) {
    const now = clock()
    sweep(now)
    const entry = pending.get(ticketId)
    if (!entry) throw new Error('Pinned transfer ticket is missing or expired; prepare a fresh file.')
    if (entry.state !== 'prepared') throw new Error('Pinned transfer already in progress.')
    if (approvedHostname !== entry.hostname || approvedTitle !== entry.input.title) {
      throw new Error('Explicit approval must match the pinned hostname and title.')
    }

    // Claim the single-use ticket before any await; prevent double submissions.
    entry.state = 'committing'
    try {
      // Exact per-ticket hostname, never wildcard and never a globally added host.
      // Reuse V1's hardened DNS/TLS, size/type/hash and durable idempotency path.
      const intake = createMcpFileIntakeService({
        store, allowedHosts: [entry.hostname], persistFileId: false,
        ...(download ? { download } : {}),
      })
      const receipt = await intake.save(entry.input)
      pending.delete(ticketId)
      return receipt
    } catch (error) {
      // Safe retry of the *same* pinned URL while the approval is still alive.
      if (clock() < entry.expiresAt && pending.get(ticketId) === entry) {
        entry.state = 'prepared'
      } else {
        pending.delete(ticketId)
      }
      throw error
    }
  }

  return { prepare, commit }
}
