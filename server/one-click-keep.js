import { randomBytes } from 'node:crypto'
import { createMcpFileOperation } from './mcp-file-operation.js'
import {
  createMcpFileIntakeService, describeMcpFileHost,
  describeMcpFileIntakeRequest, readMcpFileIntakeReceipt,
} from './mcp-file-intake.js'

export const ONE_CLICK_KEEP_TTL_MS = 2 * 60 * 1000
export const ONE_CLICK_KEEP_MAX_PENDING = 8

// Experimental, Owner-only and process-local. A model-visible ticket is NEVER
// accepted as approval. Only the random UI-carried bearer can redeem this scope.
export function createOneClickKeep({
  store, download, reviewedHosts = [], ttlMs = ONE_CLICK_KEEP_TTL_MS,
  maxPending = ONE_CLICK_KEEP_MAX_PENDING, clock = () => Date.now(),
} = {}) {
  if (!store || !Number.isSafeInteger(ttlMs) || ttlMs < 100 || ttlMs > ONE_CLICK_KEEP_TTL_MS
    || !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > ONE_CLICK_KEEP_MAX_PENDING) {
    throw new Error('Invalid isolated Keep POC configuration.')
  }
  const pending = new Map()
  const forget = (token, entry) => {
    if (pending.get(token) !== entry) return
    entry.operation?.cancel()
    entry.operation?.dispose()
    clearTimeout(entry.timer)
    entry.intent = null
    pending.delete(token)
  }
  const purge = () => {
    const now = clock()
    for (const [token, entry] of pending) if (entry.expiresAt <= now) forget(token, entry)
  }
  const preview = (entry) => ({
    status: 'one_click_approval_required', hostname: entry.hostname,
    title: entry.title || 'File', mode: entry.mode,
    itemId: entry.mode === 'append' ? entry.itemId : null,
    expiresAt: new Date(entry.expiresAt).toISOString(),
    saved: false,
  })

  function prepare({ requestId, mode, itemId, title = '', text = '', file } = {}) {
    const description = describeMcpFileIntakeRequest({ requestId, mode, itemId, title, text, file })
    const { hostname } = describeMcpFileHost(file)
    if (reviewedHosts.includes(hostname)) throw new Error('Known host: use ordinary one-call File Intake.')
    purge()
    // Repeated identical preparation reuses the same private capability.
    for (const entry of pending.values()) {
      if (entry.requestId !== requestId) continue
      if (entry.requestHash !== description.requestHash) {
        throw new Error('Keep request_id conflicts with a different pinned file or target.')
      }
      return { public: preview(entry), privateCapability: entry.token }
    }
    if (pending.size >= maxPending) throw new Error('Too many pending Keep approvals.')
    const token = randomBytes(32).toString('hex')
    const expiresAt = clock() + ttlMs
    const entry = {
      token, requestId, requestHash: description.requestHash, hostname,
      mode, itemId, title, expiresAt, state: 'prepared',
      // Exact original fileParams pinned only in process memory.
      intent: Object.freeze({ requestId, mode, itemId, title, text, file: Object.freeze({ ...file }) }),
    }
    pending.set(token, entry)
    entry.timer = setTimeout(() => forget(token, entry), Math.max(0, expiresAt - clock()))
    entry.timer.unref?.()
    return { public: preview(entry), privateCapability: token }
  }

  async function redeem(capability) {
    if (typeof capability !== 'string' || !/^[a-f0-9]{64}$/u.test(capability)) {
      throw new Error('Invalid or expired private Keep approval.')
    }
    purge()
    const entry = pending.get(capability)
    if (!entry) throw new Error('Invalid or expired private Keep approval.')
    if (entry.state === 'completed') {
      const saved = await readMcpFileIntakeReceipt(store, entry.replayInput)
      if (!saved || saved.attachmentId !== entry.receipt.attachmentId
        || saved.sha256 !== entry.receipt.sha256 || saved.bytes !== entry.receipt.bytes) {
        throw new Error('Keep attachment changed; manual review required.')
      }
      return { ...entry.receipt }
    }
    if (entry.state === 'committing') return entry.promise
    if (entry.state !== 'prepared') throw new Error('Keep approval cannot be reused.')
    // Claim before the first await. Exact host authority exists only within
    // this operation; the legacy V2 Commit has no access to this ticket/token.
    entry.state = 'committing'
    entry.operation = createMcpFileOperation({ clock, expiresAt: entry.expiresAt })
    const task = (async () => {
      try {
        entry.operation.check()
        const input = describeMcpFileIntakeRequest(entry.intent)
        const intake = createMcpFileIntakeService({
          store, allowedHosts: [entry.hostname], persistFileId: false,
          ...(download ? { download } : {}),
        })
        const receipt = await intake.save(entry.intent, entry.operation)
        entry.operation.check()
        // Successful publication removes pinned source data, never puts it
        // in the MCP result, receipt, completed cache, or canonical Store.
        entry.replayInput = {
          ...input, verifiedFile: { sha256: receipt.sha256, bytes: receipt.bytes, mimeType: receipt.mimeType },
        }
        entry.receipt = Object.freeze({ ...receipt })
        entry.intent = null
        entry.state = 'completed'
        return { ...entry.receipt }
      } catch (error) {
        forget(capability, entry)
        throw error
      } finally {
        entry.operation?.dispose()
      }
    })()
    entry.promise = task
    return task
  }
  return { prepare, redeem }
}
