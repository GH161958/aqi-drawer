import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PocketStore } from './store.js'
import { createXhsRecovery } from './xhs-recovery.js'
import { extractXhsUrl, xhsFailure } from './adapters/xhs.js'
const short = 'https://xhslink.cn/o/synthetic-recovery'
const canonical = 'https://www.xiaohongshu.com/explore/abcdef123456789012345678'
const buffer = Buffer.from('synthetic image bytes')
const parsed = { provider: 'xiaohongshu', noteId: 'abcdef123456789012345678', originalUrl: short, canonicalUrl: canonical, title: '原文标题', desc: '原文正文', parseStatus: 'complete', images: [{ index: 1, url: 'https://ci.xhscdn.com/synthetic.jpg' }] }
async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xhs-recovery-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir); await store.init()
  const item = await store.upsert({ title: 'EE 标题', text: '分享文字', note: 'EE note', collection: '合成分组', tags: ['keep'], sourceUrl: short, sourceApp: '小红书', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: short, titleOrigin: 'capture' } })
  return { store, item, dir }
}
function adapter(overrides = {}) { return { parse: async () => parsed, loadImage: async () => ({ buffer, mimeType: 'image/jpeg' }), ...overrides } }
test('Chinese share punctuation extracts only XHS source', () => {
  assert.equal(extractXhsUrl(`分享整段内容（${short}）。复制打开小红书`), short)
  assert.equal(extractXhsUrl('https://example.com/'), '')
})
test('failed short source recovers in place; metadata, history, bytes and restart survive; replay is no-op', async t => {
  const { store, item, dir } = await fixture(t)
  await store.reply(item.id, { text: 'reply', author: 'EE' }); await store.review(item.id, 'deferred'); await store.takeUnseen()
  const before = await store.get(item.id)
  let pages = 0; let images = 0
  const retry = createXhsRecovery({ store, adapter: adapter({ parse: async () => { pages++; return parsed }, loadImage: async () => { images++; return { buffer, mimeType: 'image/jpeg' } } }) })
  const result = await retry(item.id)
  assert.equal(result.id, item.id); assert.equal((await store.list()).length, 1)
  for (const key of ['title', 'note', 'tags', 'status', 'replies', 'receivedCount', 'seenByCAt', 'lastReceivedAt']) assert.deepEqual(result[key], before[key], key)
  assert.equal(result.sourceData.parseStatus, 'complete')
  assert.equal(result.attachments[0].sha256, createHash('sha256').update(buffer).digest('hex'))
  assert.deepEqual((await store.readAttachment(result.attachments[0].id)).data, buffer)
  await retry(item.id); assert.equal(pages, 1); assert.equal(images, 1)
  const restarted = new PocketStore(dir); await restarted.init(); assert.equal((await restarted.get(item.id)).attachments[0].sha256, result.attachments[0].sha256)
})
test('concurrent retry coalesces page and image requests', async t => {
  const { store, item } = await fixture(t); let calls = 0
  const retry = createXhsRecovery({ store, adapter: adapter({ parse: async () => { calls++; await new Promise(r => setTimeout(r, 15)); return parsed } }) })
  const results = await Promise.all(Array.from({ length: 12 }, () => retry(item.id)))
  assert.equal(calls, 1); assert.ok(results.every(result => result.id === item.id)); assert.equal(results[0].receivedCount, 1)
})
test('failed parse preserves full item and timeout ignores late adapter without publishing', async t => {
  const { store, item } = await fixture(t)
  const before = await store.get(item.id)
  await assert.rejects(createXhsRecovery({ store, adapter: adapter({ parse: async () => { throw new Error('secret raw upstream') } }) })(item.id))
  assert.deepEqual(await store.get(item.id), before)
  let finish
  const retry = createXhsRecovery({ store, budgetMs: 20, adapter: adapter({ parse: () => new Promise(resolve => { finish = resolve }) }) })
  const keepAlive = setTimeout(() => {}, 100)
  await assert.rejects(retry(item.id)); finish(parsed); await new Promise(r => setTimeout(r, 25)); clearTimeout(keepAlive)
  assert.deepEqual(await store.get(item.id), before)
})
test('resolved identity owned by another item conflicts before image download', async t => {
  const { store, item } = await fixture(t)
  await store.upsertXhs({ sourceUrl: canonical, xhs: { ...parsed, originalUrl: canonical } }, { loadImage: adapter().loadImage })
  let downloads = 0
  const retry = createXhsRecovery({ store, adapter: adapter({ loadImage: async () => { downloads++; throw new Error('must not download') } }) })
  await assert.rejects(retry(item.id), error => error.status === 409)
  assert.equal(downloads, 0); assert.equal((await store.list()).length, 2); assert.equal((await store.get(item.id)).sourceData.parseStatus, 'failed')
})
test('re-sharing short link after transient failure also recovers original ID', async t => {
  const { store, item } = await fixture(t)
  const result = await store.upsertXhs({ sourceUrl: short, xhs: parsed }, { loadImage: adapter().loadImage })
  assert.equal(result.id, item.id); assert.equal(result.receivedCount, 2); assert.equal((await store.list()).length, 1)
  const failedAgain = await store.upsert({ sourceUrl: short, text: '再次分享', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: short } })
  assert.equal(failedAgain.id, item.id); assert.equal(failedAgain.sourceData.parseStatus, 'complete'); assert.equal(failedAgain.attachments.length, 1)
})
test('partial image retry reuses originals; non-XHS fails closed', async t => {
  const { store, item } = await fixture(t)
  let fail = true; let count = 0
  const retry = createXhsRecovery({ store, adapter: adapter({ parse: async () => ({ ...parsed, images: [...parsed.images, { index: 2, url: 'https://ci.xhscdn.com/two.jpg' }] }), loadImage: async url => { count++; if (fail && url.includes('two')) throw new Error('secret cookie'); return { buffer, mimeType: 'image/jpeg' } } }) })
  const partial = await retry(item.id); assert.equal(partial.sourceData.parseStatus, 'partial'); assert.ok(!JSON.stringify(partial).includes('secret cookie'))
  fail = false; const complete = await retry(item.id); assert.equal(complete.sourceData.parseStatus, 'complete'); assert.equal(count, 3)
  const other = await store.upsert({ text: 'not XHS', sourceUrl: 'https://example.com/' })
  await assert.rejects(retry(other.id), error => error.status === 422)
})
test('upstream errors are bounded safe categories', () => {
  for (const [error, code] of [[{ code: 'ENOTFOUND' }, 'XHS_DNS'], [{ code: 'CERT_HAS_EXPIRED' }, 'XHS_TLS'], [{ name: 'TimeoutError' }, 'XHS_TIMEOUT'], [{ status: 403 }, 'XHS_ACCESS_DENIED']]) {
    const result = xhsFailure({ ...error, message: 'secret upstream response' })
    assert.equal(result.code, code); assert.ok(!result.message.includes('secret'))
  }
})

test('retry API inherits owner authentication, rejects URL payloads, and sanitizes failures', async t => {
  const { startBridge } = await import('./index.js')
  const dir = await mkdtemp(path.join(tmpdir(), 'xhs-api-recovery-'))
  const bridge = await startBridge({ dataDir: dir, port: 0, host: '127.0.0.1', bridgeToken: 'synthetic-owner-test-token', xhsAdapter: adapter({ parse: async () => { throw Object.assign(new Error('cookie=secret-value https://private.example/capability'), { cause: { code: 'ENOTFOUND' } }) } }) })
  t.after(async () => { await bridge.stop(); await rm(dir, { recursive: true, force: true }) })
  const item = await bridge.store.upsert({ sourceUrl: short, sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: short } })
  const url = `http://127.0.0.1:${bridge.address.port}/api/pocket/items/${item.id}/retry-source`
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1' }
  assert.equal((await fetch(url, { method: 'POST', headers, body: '{}' })).status, 401)
  headers.authorization = 'Bearer synthetic-owner-test-token'
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ sourceUrl: 'https://example.com/' }) })).status, 400)
  const response = await fetch(url, { method: 'POST', headers, body: '{}' })
  assert.equal(response.status, 502)
  const data = await response.json(); assert.equal(data.code, 'XHS_DNS'); assert.ok(!JSON.stringify(data).includes('secret-value')); assert.ok(!JSON.stringify(data).includes('private.example'))
  assert.equal((await bridge.store.get(item.id)).sourceData.parseStatus, 'failed')
})

test('adapter redirect boundary, cap, access denial and HTML size are classified safely', async () => {
  const { XhsAdapter } = await import('./adapters/xhs.js')
  let requests = 0
  const blocked = new XhsAdapter({ fetchImpl: async () => { requests++; return new Response('', { status: 302, headers: { location: 'https://example.com/private' } }) } })
  await assert.rejects(blocked.parse(short), error => error.code === 'XHS_REDIRECT_BLOCKED'); assert.equal(requests, 1)
  requests = 0
  const loop = new XhsAdapter({ fetchImpl: async () => { requests++; return new Response('', { status: 302, headers: { location: short } }) } })
  await assert.rejects(loop.parse(short), error => error.code === 'XHS_REDIRECT_BLOCKED'); assert.equal(requests, 6)
  const denied = new XhsAdapter({ fetchImpl: async () => new Response('secret denial body', { status: 403 }) })
  await assert.rejects(denied.parse(short), error => error.code === 'XHS_ACCESS_DENIED' && !error.message.includes('secret'))
  const oversized = new XhsAdapter({ maxHtmlBytes: 1024, fetchImpl: async () => new Response('x'.repeat(5 * 1024 * 1024)) })
  await assert.rejects(oversized.parse(short), error => error.code === 'XHS_RESPONSE_LIMIT')
})

test('expired retry waiting behind Store writer never publishes after queue resumes', async t => {
  const { store, item } = await fixture(t)
  let release; let started
  const entered = new Promise(resolve => { started = resolve })
  const blocking = store.upsertXhs({ sourceUrl: 'https://www.xiaohongshu.com/explore/other-note', xhs: { ...parsed, noteId: 'other-note', originalUrl: 'https://www.xiaohongshu.com/explore/other-note', canonicalUrl: 'https://www.xiaohongshu.com/explore/other-note' } }, { loadImage: () => { started(); return new Promise(resolve => { release = () => resolve({ buffer, mimeType: 'image/jpeg' }) }) } })
  await entered
  const retry = createXhsRecovery({ store, budgetMs: 20, adapter: adapter() })
  const keepAlive = setTimeout(() => {}, 100)
  await assert.rejects(retry(item.id)); clearTimeout(keepAlive)
  release(); await blocking; await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await store.get(item.id)).sourceData.parseStatus, 'failed')
})

test('recovery preserves collection, manual attachments and prior activity without a received event', async t => {
  const { store, item } = await fixture(t)
  await store.appendAttachments(item.id, [{ id: 'synthetic-manual', name: 'manual.txt', mimeType: 'text/plain', size: 12, url: 'https://example.com/synthetic.txt' }], { requestId: 'synthetic-append' })
  const before = await store.get(item.id)
  const after = await createXhsRecovery({ store, adapter: adapter() })(item.id)
  assert.ok(after.attachments.some(a => a.id === 'synthetic-manual'))
  assert.deepEqual(after.activity.slice(0, before.activity.length), before.activity)
  assert.equal(after.activity.filter(e => e.type === 'received').length, before.activity.filter(e => e.type === 'received').length)
  assert.equal(after.collection, '合成分组'); assert.equal(before.collection, '合成分组')
})

test('failed short fallback can recover after process restart with same identity', async t => {
  const { store, item, dir } = await fixture(t)
  assert.equal((await store.get(item.id)).sourceData.parseStatus, 'failed')
  const restarted = new PocketStore(dir); await restarted.init()
  const recovered = await createXhsRecovery({ store: restarted, adapter: adapter() })(item.id)
  assert.equal(recovered.id, item.id); assert.equal((await restarted.list()).length, 1)
  assert.equal(recovered.receivedCount, 1); assert.equal(recovered.collection, '合成分组')
})

test('ambiguous old fallback URLs conflict rather than silently merging', async t => {
  const { store, item, dir } = await fixture(t)
  const { readFile, writeFile } = await import('node:fs/promises')
  const file = path.join(dir, 'pocket-store.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  state.items.push({ ...structuredClone(state.items[0]), id: 'synthetic-legacy-duplicate' })
  await writeFile(file, JSON.stringify(state))
  let downloads = 0
  await assert.rejects(createXhsRecovery({ store, adapter: adapter({ loadImage: async () => { downloads++; return { buffer, mimeType: 'image/jpeg' } } }) })(item.id), error => error.status === 409)
  assert.equal(downloads, 0); assert.equal((await store.list()).length, 2)
})

test('stored failed XHS reading stays local and explicitly reports incomplete extraction', async t => {
  const { store, item } = await fixture(t)
  const { PocketContentReader } = await import('./content-reader.js')
  const reader = new PocketContentReader({ store, fetchImpl: async () => { throw new Error('must not fetch') } })
  const read = await reader.read(await store.getForContentRead(item.id), { detail: 'full', maxImages: 2 })
  assert.equal(read.snapshot.sourceData.parseStatus, 'failed'); assert.equal(read.media.length, 0)
  assert.match(JSON.stringify(read), /尚未提取/)
})

test('two unreadable short aliases remain separate; later resolution recovers one and conflicts on the other', async t => {
  const { store, item } = await fixture(t)
  const alias = 'https://xhslink.cn/o/synthetic-other-alias'
  const second = await store.upsert({ title: item.title, text: item.text, sourceUrl: alias, sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: alias } })
  assert.notEqual(second.id, item.id); assert.equal((await store.list()).length, 2)
  const retry = createXhsRecovery({ store, adapter: adapter({ parse: async originalUrl => ({ ...parsed, originalUrl }) }) })
  await retry(item.id)
  const before = await store.get(second.id)
  await assert.rejects(retry(second.id), error => error.status === 409)
  assert.deepEqual(await store.get(second.id), before)
  assert.equal((await store.list()).length, 2)
  assert.equal((await store.get(item.id)).attachments.length, 1)
})

test('image timeout keeps a partial same-ID item without phantom media and can recover later', async t => {
  const { store, item, dir } = await fixture(t)
  let unavailable = true
  const retry = createXhsRecovery({ store, adapter: adapter({ loadImage: async () => {
    if (unavailable) throw new DOMException('timeout with private URL', 'TimeoutError')
    return { buffer, mimeType: 'image/jpeg' }
  } }) })
  const partial = await retry(item.id)
  assert.equal(partial.id, item.id); assert.equal(partial.sourceData.parseStatus, 'partial')
  assert.equal(partial.attachments.length, 0); assert.equal(partial.sourceData.images[0].errorCode, 'XHS_TIMEOUT')
  const { readdir } = await import('node:fs/promises')
  assert.deepEqual(await readdir(path.join(dir, 'media')), [])
  unavailable = false
  const repaired = await retry(item.id)
  assert.equal(repaired.attachments.length, 1); assert.equal(repaired.receivedCount, 1)
  assert.equal((await readdir(path.join(dir, 'media'))).length, 1)
})
