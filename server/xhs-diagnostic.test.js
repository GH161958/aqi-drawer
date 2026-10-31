import assert from 'node:assert/strict'
import test from 'node:test'
import { XhsAdapter } from './adapters/xhs.js'
import { diagnoseXhs } from '../tools/xhs-connection-diagnostic.mjs'
const short = 'https://xhslink.cn/o/synthetic-private-path?token=synthetic-secret'
const canonical = 'https://www.xiaohongshu.com/explore/abcdef123456789012345678?token=synthetic-secret'
const timeout = () => new DOMException('synthetic secret URL must not escape', 'TimeoutError')
const response = (body, status = 200, headers = {}) => new Response(body, { status, headers })

test('timeout stages distinguish before redirect, after approved redirect, body and parse', async () => {
  await assert.rejects(new XhsAdapter({ fetchImpl: async () => { throw timeout() } }).parse(short), error => error.stage === 'request' && error.code === 'XHS_TIMEOUT' && !error.message.includes('secret'))
  let calls = 0
  await assert.rejects(new XhsAdapter({ fetchImpl: async () => {
    if (++calls === 1) return response('', 302, { location: canonical })
    throw timeout()
  } }).parse(short), error => error.stage === 'redirect' && error.redirectCount === 1 && error.finalUrl === canonical)
  await assert.rejects(new XhsAdapter({ fetchImpl: async () => response(new ReadableStream({ start(controller) { controller.error(timeout()) } })) }).parse(short), error => error.stage === 'body' && error.code === 'XHS_TIMEOUT')
  await assert.rejects(new XhsAdapter({ fetchImpl: async () => response('<html>unavailable</html>') }).parse(short), error => error.stage === 'parse' && error.code === 'XHS_PARSE_CHANGED')
})

test('diagnostic output never contains paths, note IDs, tokens or bodies', async () => {
  const output = []; let calls = 0
  const exit = await diagnoseXhs({ value: short, probes: false, emit: value => output.push(value), fetchImpl: async () => {
    if (++calls === 1) return response('', 302, { location: canonical })
    return response('<html>secret body</html>')
  } })
  assert.equal(exit, 1)
  const serialized = JSON.stringify(output)
  for (const secret of ['synthetic-private-path', 'token=', 'synthetic-secret', 'abcdef123456789012345678', 'secret body']) assert.ok(!serialized.includes(secret), secret)
  assert.equal(output.at(-1).stage, 'parse'); assert.equal(output.at(-1).result, 'source_unparsed')
})

test('diagnostic rejects unsupported URLs without any network request', async () => {
  let calls = 0
  for (const value of ['https://example.com/', 'https://user:pass@xhslink.cn/path', 'https://xhslink.cn:9000/path']) {
    assert.equal(await diagnoseXhs({ value, probes: false, fetchImpl: async () => { calls++ }, emit: () => {} }), 2)
  }
  assert.equal(calls, 0)
})

test('blocked outbound environment is explicitly inconclusive', async () => {
  const output = []
  assert.equal(await diagnoseXhs({ value: short, probes: false, emit: value => output.push(value), fetchImpl: async () => { throw Object.assign(new Error('network blocked'), { code: 'ENOTFOUND' }) } }), 1)
  assert.equal(output.at(-1).result, 'environment_inconclusive')
})

test('approved redirect identity survives downstream timeout in actual capture API, without a ghost alias item', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { startBridge } = await import('./index.js')
  const dataDir = await mkdtemp(path.join(tmpdir(), 'xhs-redirect-api-'))
  const adapter = new XhsAdapter({ fetchImpl: async url => {
    if (url.hostname === 'xhslink.cn') return response('', 302, { location: canonical })
    throw timeout()
  } })
  const bridge = await startBridge({ dataDir, port: 0, host: '127.0.0.1', xhsAdapter: adapter })
  t.after(async () => { await bridge.stop(); await rm(dataDir, { recursive: true, force: true }) })
  const capture = async url => {
    const result = await fetch(`http://127.0.0.1:${bridge.address.port}/api/pocket/items/upload`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ share: `完整分享 ${url}` }) })
    assert.equal(result.status, 200)
    return (await result.json()).item
  }
  const first = await capture(short)
  assert.equal(first.sourceData.errorStage, 'redirect'); assert.equal(first.sourceData.errorCode, 'XHS_TIMEOUT')
  assert.equal(first.sourceIdentity.externalId, 'abcdef123456789012345678')
  const second = await capture('https://xhslink.cn/o/synthetic-second-alias')
  assert.equal(second.id, first.id); assert.equal((await bridge.store.list()).length, 1)
  assert.equal(second.attachments.length, 0)
})
