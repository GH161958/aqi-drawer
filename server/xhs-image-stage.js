import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { verifiedImageType, isXhsImageHostname, xhsFailure } from './adapters/xhs.js'

// Shared across concurrent recoveries: three response bodies, not 3 × active jobs.
let active = 0
const waiters = new Set()
function acquire(signal) {
  return new Promise((resolve, reject) => {
    const start = () => {
      waiters.delete(start); signal.removeEventListener('abort', abort); active++
      let released = false
      resolve(() => {
        if (released) return
        released = true; active--
        const next = waiters.values().next().value
        if (next) next()
      })
    }
    const abort = () => { waiters.delete(start); reject(signal.reason) }
    if (signal.aborted) return reject(signal.reason)
    if (active < 3) start()
    else { waiters.add(start); signal.addEventListener('abort', abort, { once: true }) }
  })
}

// Only server-held confirmed operations use this spool. No network runs in Store's queue.
export async function stageXhsImages({ images, skip, retainedBytes = 0, loadImage, mediaDir, authorization, imageTimeoutMs = 6_000, phaseTimeoutMs = 24_000 }) {
  const directory = await mkdtemp(path.join(mediaDir, '.xhs-stage-'))
  const results = new Map()
  const controller = new AbortController()
  const remaining = authorization?.deadline - Date.now()
  // Real 30s jobs reserve publication time, including after a slow retry parse.
  const phaseBudget = remaining > 1000 ? Math.min(phaseTimeoutMs, remaining - 1000) : phaseTimeoutMs
  const phaseTimer = setTimeout(() => controller.abort(new DOMException('Image phase expired', 'TimeoutError')), phaseBudget)
  const signal = AbortSignal.any([controller.signal, ...(authorization?.signal ? [authorization.signal] : [])])
  const availableBytes = Math.max(0, 80 * 1024 * 1024 - retainedBytes)
  let cursor = 0; let bytes = 0; let stop = false
  const cleanup = () => rm(directory, { recursive: true, force: true })
  try {
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (cursor < images.length && !stop && !signal.aborted) {
        authorization?.check()
        const position = cursor++; const image = images[position]
        if (skip.has(position)) continue
        if (bytes >= availableBytes) { results.set(image.url, { error: new Error('XHS per-note image budget exhausted') }); continue }
        const url = image.url
        let timer; let onAbort; let release; let pending; let settled = false
        const local = new AbortController()
        const requestSignal = AbortSignal.any([signal, local.signal])
        try {
          const target = new URL(url)
          if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443') || !isXhsImageHostname(target.hostname)) throw new Error('Invalid image source')
          const timeout = new Promise((resolve, reject) => {
            onAbort = () => reject(requestSignal.reason)
            requestSignal.addEventListener('abort', onAbort, { once: true })
            timer = setTimeout(() => local.abort(new DOMException('Image timed out', 'TimeoutError')), imageTimeoutMs)
          })
          // Start the timer before waiting for a global slot, too.
          const slot = acquire(requestSignal)
          release = await Promise.race([slot, timeout])
          if (requestSignal.aborted) throw requestSignal.reason
          pending = Promise.resolve().then(() => loadImage(url, { signal: requestSignal }))
          pending.then(() => { settled = true }, () => { settled = true })
          const loaded = await Promise.race([pending, timeout])
          authorization?.check()
          if (requestSignal.aborted) throw requestSignal.reason
          const buffer = loaded?.buffer
          if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > 15 * 1024 * 1024 || !verifiedImageType(buffer, loaded.mimeType)) throw new Error('Invalid image bytes or MIME')
          if (bytes + buffer.length > availableBytes) throw new Error('Image aggregate budget exceeded')
          bytes += buffer.length // Reserve synchronously before the filesystem await.
          const file = path.join(directory, String(position))
          await writeFile(file, buffer)
          authorization?.check()
          results.set(url, { file, mimeType: loaded.mimeType, width: loaded.width, height: loaded.height })
        } catch (error) {
          // Stop scheduling on timeout: an injected loader may ignore cancellation.
          // At most three such loaders can remain outstanding, never thirty.
          if (requestSignal.aborted) stop = true
          const failure = xhsFailure(requestSignal.aborted ? requestSignal.reason : error)
          results.set(url, { error: Object.assign(new Error(failure.message), { code: failure.code }) })
        } finally {
          clearTimeout(timer)
          // An uncooperative loader keeps its slot until it actually settles.
          // Late results never write files or regain publication authority.
          if (release) {
            if (pending && !settled) pending.then(release, release)
            else release()
          }
          if (onAbort) requestSignal.removeEventListener('abort', onAbort)
        }
      }
    }))
    authorization?.check()
    return {
      async load(url) {
        const result = results.get(url)
        if (!result) throw new DOMException('Image phase ended before this image was available', 'TimeoutError')
        if (result.error) throw result.error
        return { ...result, buffer: await readFile(result.file) }
      },
      cleanup,
    }
  } catch (error) { await cleanup(); throw error } finally { clearTimeout(phaseTimer) }
}
