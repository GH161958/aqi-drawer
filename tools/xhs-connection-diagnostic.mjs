import { Resolver } from 'node:dns/promises'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'
import { XhsAdapter, extractXhsUrl, extractXhsNoteId, xhsFailure } from '../server/adapters/xhs.js'

// Local, read-only diagnostic. Never write source URLs, bodies, cookies or note IDs.
export async function diagnoseXhs({ value, fetchImpl = fetch, emit = line => console.log(JSON.stringify(line)), probes = true, images = false, timeoutMs = 15_000 } = {}) {
  const source = extractXhsUrl(value)
  let target
  try { target = new URL(source) } catch { emit({ result: 'input_required' }); return 2 }
  if (target.username || target.password || (target.port && !['80', '443'].includes(target.port))) {
    emit({ result: 'input_rejected' }); return 2
  }
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  if (probes) {
    const resolver = new Resolver({ timeout: 2000, tries: 1 })
    const timer = setTimeout(() => resolver.cancel(), 3000)
    const dnsStart = performance.now()
    try {
      const results = await Promise.allSettled([resolver.resolve4(target.hostname), resolver.resolve6(target.hostname)])
      emit({ host: target.hostname, stage: 'dns', elapsedMs: Math.round(performance.now() - dnsStart), category: results.some(result => result.status === 'fulfilled' && result.value.length) ? 'OK' : 'XHS_DNS' })
    } finally { clearTimeout(timer) }
    if (target.protocol === 'https:') {
      const connectionStart = performance.now()
      try {
        await new Promise((resolve, reject) => {
          const socket = tls.connect({ host: target.hostname, port: Number(target.port) || 443, servername: target.hostname, signal: AbortSignal.timeout(5000) })
          socket.setTimeout(4000, () => socket.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
          socket.once('secureConnect', () => { socket.destroy(); resolve() })
          socket.once('error', reject)
        })
        emit({ host: target.hostname, stage: 'tcp_tls', elapsedMs: Math.round(performance.now() - connectionStart), category: 'OK' })
      } catch (error) { emit({ host: target.hostname, stage: 'tcp_tls', elapsedMs: Math.round(performance.now() - connectionStart), category: xhsFailure(error).code }) }
    }
  }
  let redirects = 0
  let stage = 'headers'
  let host = target.hostname
  const measuredFetch = async (url, options) => {
    host = new URL(url).hostname
    stage = 'headers'
    const begin = performance.now()
    let response
    try { response = await fetchImpl(url, options) } catch (error) {
      emit({ host, stage, elapsedMs: Math.round(performance.now() - begin), category: xhsFailure(error).code, redirectCount: redirects })
      throw error
    }
    if (response.status >= 300 && response.status < 400) redirects++
    emit({ host, stage, status: response.status, elapsedMs: Math.round(performance.now() - begin), redirectCount: redirects })
    if (!response.body || response.status >= 300) return response
    const reader = response.body.getReader()
    const bodyStart = performance.now()
    stage = 'body'
    const measured = new Response(new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            emit({ host, stage: 'body', elapsedMs: Math.round(performance.now() - bodyStart), category: 'OK' })
            controller.close()
          } else controller.enqueue(value)
        } catch (error) {
          emit({ host, stage: 'body', elapsedMs: Math.round(performance.now() - bodyStart), category: xhsFailure(error).code })
          controller.error(error)
        }
      },
      cancel: reason => reader.cancel(reason),
    }), { status: response.status, headers: response.headers })
    Object.defineProperty(measured, 'url', { value: response.url || String(url) })
    return measured
  }
  const adapter = new XhsAdapter({ fetchImpl: measuredFetch, timeoutMs })
  try {
    const note = await adapter.parse(source)
    emit({ host: new URL(note.canonicalUrl).hostname, stage: 'parse', noteIdPresent: Boolean(note.noteId), elapsedMs: elapsed(), result: 'parsed' })
    if (images && note.images?.length) {
      stage = 'image'
      try { await adapter.loadImage(note.images[0].url); emit({ stage: 'image', result: 'loaded' }) }
      catch (error) { emit({ stage: 'image', category: xhsFailure(error).code, result: 'unavailable' }); return 1 }
    }
    return 0
  } catch (error) {
    const category = xhsFailure(error).code
    stage = error.stage || (category === 'XHS_PARSE_CHANGED' ? 'parse' : stage)
    let result = 'source_unparsed'
    if (['XHS_NETWORK', 'XHS_DNS', 'XHS_TLS', 'XHS_TIMEOUT'].includes(category)) {
      try {
        const control = await fetchImpl(new URL('https://www.xiaohongshu.com/'), { redirect: 'manual', signal: AbortSignal.timeout(5000) })
        await control.body?.cancel()
        result = 'source_unavailable'
      } catch { result = 'environment_inconclusive' }
    }
    emit({ host, stage, category, redirectCount: redirects, elapsedMs: elapsed(), noteIdPresent: Boolean(extractXhsNoteId(error.finalUrl)), result })
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await diagnoseXhs({ value: process.env.XHS_DIAG_URL, images: process.env.XHS_DIAG_IMAGES === 'true' })
}
