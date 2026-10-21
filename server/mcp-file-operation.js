import { performance } from 'node:perf_hooks'

// Process-local write capability. Never persisted or accepted from MCP input.
export const MCP_FILE_OPERATION_MS = 60_000

export function createMcpFileOperation({
  clock = () => Date.now(), expiresAt = Infinity, budgetMs = MCP_FILE_OPERATION_MS,
} = {}) {
  const start = clock()
  if (!Number.isFinite(start) || !(budgetMs > 0 && budgetMs <= MCP_FILE_OPERATION_MS)
    || !(expiresAt === Infinity || Number.isFinite(expiresAt))) {
    throw new Error('Invalid file operation deadline.')
  }
  const deadline = Math.min(expiresAt, start + budgetMs)
  // Wall-clock rollback cannot lengthen a running operation's budget.
  const monotonicDeadline = performance.now() + Math.max(0, deadline - start)
  const controller = new AbortController()
  const expired = () => new Error('File operation expired or cancelled; prepare a fresh file.')
  let accepted = false
  let timer
  const cancel = () => {
    if (accepted || controller.signal.aborted) return
    clearTimeout(timer)
    controller.abort(expired())
  }
  const check = () => {
    const now = clock()
    if (!accepted && (!Number.isFinite(now) || now >= deadline || performance.now() >= monotonicDeadline)) cancel()
    if (controller.signal.aborted) throw controller.signal.reason
  }
  timer = setTimeout(cancel, Math.max(0, deadline - start))
  timer.unref?.()
  return Object.freeze({
    signal: controller.signal, deadline,
    get accepted() { return accepted },
    check, cancel,
    dispose: () => clearTimeout(timer),
    // Detach our await even when an injected downloader ignores cancellation.
    // A late result cannot resume the caller or reacquire this capability.
    wait(promise) {
      return new Promise((resolve, reject) => {
        const abort = () => {
          controller.signal.removeEventListener('abort', abort)
          reject(controller.signal.reason)
        }
        controller.signal.addEventListener('abort', abort, { once: true })
        Promise.resolve(promise).then(value => {
          controller.signal.removeEventListener('abort', abort)
          try { check(); resolve(value) } catch (error) { reject(error) }
        }, error => {
          controller.signal.removeEventListener('abort', abort)
          reject(error)
        })
        try { check() } catch { abort() }
      })
    },
    // Atomic publication and cancellation are ordered in one synchronous turn.
    // Once canonical rename succeeds this is a completed transaction: a later
    // timer cannot turn success into timeout and remove its referenced media.
    publish(write) {
      if (accepted) throw new Error('File operation already committed.')
      check()
      const result = write()
      accepted = true
      clearTimeout(timer)
      return result
    },
  })
}
