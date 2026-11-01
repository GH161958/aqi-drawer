import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PocketStore } from './store.js'
import { createMcpFileOperation } from './mcp-file-operation.js'
import { createXhsCanonicalRecovery } from './xhs-canonical-recovery.js'
import { createXhsRecovery } from './xhs-recovery.js'
import { canonicalXhsUrl } from './xhs-canonical-url.js'
const noteId = 'abcdef123456789012345678'
const otherId = '1234567890abcdef12345678'
const token = 'synthetic-preview-token-only'
const url = `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=${token}&xsec_source=app_share`
const short = 'https://xhslink.cn/o/synthetic-first'
const owner = 'synthetic-owner-session'
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlS8AAAAASUVORK5CYII=', 'base64')
const parsed = { provider: 'xiaohongshu', parseStatus: 'complete', noteId, canonicalUrl: url, originalUrl: url, title: '合成来源标题', desc: '真实 fixture 正文', author: { avatar: `https://ci.xhscdn.com/avatar?xsec_token=${token}` }, images: [{ index: 1, url: `https://ci.xhscdn.com/one.png?xsec_token=${token}` }] }
async function setup(t, overrides = {}, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xhs-canonical-test-'))
  const store = new PocketStore(dir); await store.init()
  const item = await store.upsert({ title: 'EE 手工标题', text: '原分享文字', sourceUrl: short, note: 'EE note', tags: ['合成标签'], collection: '合成分组', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: short, titleOrigin: 'capture' } })
  const counts = { parse: 0, images: 0 }
  const adapter = { parse: async (...args) => { counts.parse++; return overrides.parse ? overrides.parse(...args) : structuredClone(parsed) }, loadImage: async (...args) => { counts.images++; return overrides.loadImage ? overrides.loadImage(...args) : { buffer: image, mimeType: 'image/png' } } }
  const service = createXhsCanonicalRecovery({ store, adapter, ...options })
  t.after(async () => { service.close(); await rm(dir, { recursive: true, force: true }) })
  return { dir, store, item, adapter, service, counts, prepare: () => service.prepare({ id: item.id, owner, url }) }
}
test('strict canonical URL rejects wrong host, scheme, credentials, route, encoded path, query injection and fragments', () => {
  for (const bad of ['https://xhslink.cn/o/link', url.replace('https:', 'http:'), url.replace('www.', 'evil.'), url.replace('www.', 'user:pass@www.'), url.replace('/explore/', ':8443/explore/'), url.replace('/explore/', '/explore/%2f'), `${url}&redirect=https://example.com/`, `${url}&xsec_token=duplicate`, `${url}#fragment`, url.replace(token, 'a%26b'), url.replace(noteId, 'short')]) assert.throws(() => canonicalXhsUrl(bad), error => error.status === 422)
  assert.equal(canonicalXhsUrl(url).safeUrl, `https://www.xiaohongshu.com/explore/${noteId}`)
})
test('preview is read-only; explicit confirm enriches exact item preserving provenance, metadata, bytes and other alias', async t => {
  const f = await setup(t)
  const alias = await f.store.upsert({ title: f.item.title, text: f.item.text, sourceUrl: 'https://xhslink.cn/o/synthetic-second', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed' } })
  await f.store.reply(f.item.id, { text: 'EE reply', author: 'EE' }); await f.store.review(f.item.id, 'deferred'); await f.store.takeUnseen()
  await f.store.appendAttachments(f.item.id, [{ id: 'synthetic-manual', name: 'manual.txt', mimeType: 'text/plain', size: 3, url: 'https://example.com/synthetic.txt' }], { requestId: 'synthetic-manual' })
  const aliasBefore = await f.store.get(alias.id)
  const before = await f.store.get(f.item.id); const file = path.join(f.dir, 'pocket-store.json'); const bytes = await readFile(file)
  const preview = await f.prepare()
  assert.deepEqual(await readFile(file), bytes); assert.equal(f.counts.images, 0); assert.deepEqual(await readdir(path.join(f.dir, 'media')), [])
  for (const secret of [token, url, short]) assert.ok(!JSON.stringify(preview).includes(secret))
  assert.equal(preview.note.imageCount, 1); assert.equal(preview.item.id, f.item.id)
  const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  for (const key of ['id', 'title', 'note', 'tags', 'collection', 'status', 'replies', 'receivedCount', 'lastReceivedAt', 'seenByCAt']) assert.deepEqual(item[key], before[key], key)
  assert.equal(item.sourceData.originalUrl, short); assert.equal(item.sourceData.sharedText, before.text)
  assert.equal(item.text, parsed.desc); assert.equal(item.sourceData.parseStatus, 'complete')
  assert.ok(item.attachments.some(a => a.id === 'synthetic-manual'))
  const photo = item.attachments.find(a => a.sourceImage)
  assert.equal(photo.sha256, createHash('sha256').update(image).digest('hex')); assert.deepEqual((await f.store.readAttachment(photo.id)).data, image)
  assert.deepEqual(item.activity.slice(0, before.activity.length), before.activity)
  assert.equal(item.activity.filter(e => e.type === 'received').length, before.activity.filter(e => e.type === 'received').length)
  assert.deepEqual(await f.store.get(alias.id), aliasBefore); assert.equal((await f.store.list()).length, 2)
  const serialized = await readFile(file, 'utf8'); for (const secret of [token, 'xsec_token', preview.ticket]) assert.ok(!serialized.includes(secret), secret)
  await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }); assert.equal(f.counts.images, 1)
  const restarted = new PocketStore(f.dir); await restarted.init(); assert.equal((await restarted.get(item.id)).sourceData.recoveryUrl, canonicalXhsUrl(url).safeUrl)
})
test('cancel revokes capability, wrong owner/item and unknown tickets fail closed', async t => {
  const f = await setup(t); const preview = await f.prepare()
  for (const args of [{ id: f.item.id, owner: 'other-owner', ticket: preview.ticket }, { id: 'another-id', owner, ticket: preview.ticket }, { id: f.item.id, owner, ticket: 'x'.repeat(43) }]) await assert.rejects(async () => f.service.confirm(args), error => error.status === 410)
  await f.service.cancel({ id: f.item.id, owner, ticket: preview.ticket })
  await assert.rejects(async () => f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }), error => error.status === 410)
  assert.deepEqual(await f.store.get(f.item.id), f.item); assert.equal(f.counts.images, 0)
})
test('wrong parsed note and redirect-to-other-note are rejected before image download', async t => {
  for (const patch of [{ noteId: otherId }, { canonicalUrl: `https://www.xiaohongshu.com/explore/${otherId}` }, { canonicalUrl: 'https://example.com/private' }]) {
    const f = await setup(t, { parse: async () => ({ ...parsed, ...patch }) })
    await assert.rejects(f.prepare()); assert.equal(f.counts.images, 0); assert.deepEqual(await f.store.get(f.item.id), f.item)
  }
})
test('known identity collision is rejected in preview and a new collision is rejected under Store lock', async t => {
  const f = await setup(t); const preview = await f.prepare()
  const existing = await f.store.upsertXhs({ sourceUrl: canonicalXhsUrl(url).safeUrl, xhs: { ...parsed, originalUrl: canonicalXhsUrl(url).safeUrl } }, { loadImage: f.adapter.loadImage })
  const images = f.counts.images
  await assert.rejects(f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }), error => error.status === 409 && error.candidate.id === existing.id)
  await assert.rejects(f.prepare(), error => error.status === 409 && error.candidate.id === existing.id)
  assert.equal(f.counts.images, images); assert.deepEqual(await f.store.get(f.item.id), f.item)
})
test('editing between phases makes preview stale; deleting never resurrects item', async t => {
  const f = await setup(t); const preview = await f.prepare()
  await f.store.review(f.item.id, 'deferred')
  const edited = await f.store.get(f.item.id)
  await assert.rejects(f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }), error => error.code === 'XHS_STALE_PREVIEW')
  assert.deepEqual(await f.store.get(f.item.id), edited); assert.equal(f.counts.images, 0)
  const second = await f.prepare(); await f.store.trash(f.item.id)
  await assert.rejects(f.service.confirm({ id: f.item.id, owner, ticket: second.ticket }), error => error.status === 409)
  assert.equal(await f.store.get(f.item.id), null); assert.equal(f.counts.images, 0)
})
test('parallel previews and confirmations coalesce; other tickets cannot double-download', async t => {
  const f = await setup(t, { parse: async () => { await new Promise(r => setTimeout(r, 15)); return parsed }, loadImage: async () => { await new Promise(r => setTimeout(r, 15)); return { buffer: image, mimeType: 'image/png' } } })
  const previews = await Promise.all(Array.from({ length: 8 }, () => f.prepare()))
  assert.equal(f.counts.parse, 1); assert.ok(previews.every(p => p.ticket === previews[0].ticket))
  const second = await f.prepare()
  const args = { id: f.item.id, owner, ticket: previews[0].ticket }
  const confirmations = Array.from({ length: 8 }, () => f.service.confirm(args))
  await assert.rejects(async () => f.service.confirm({ ...args, ticket: second.ticket }), error => error.code === 'XHS_COMMIT_BUSY')
  await Promise.all(confirmations); assert.equal(f.counts.images, 1)
})
test('expired preview and timed-out late downloader never publish', async t => {
  const f = await setup(t, {}, { ttlMs: 100 })
  const preview = await f.prepare(); await new Promise(r => setTimeout(r, 140))
  await assert.rejects(async () => f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }), error => error.status === 410)
  const late = await setup(t, { loadImage: async () => { await new Promise(r => setTimeout(r, 150)); return { buffer: image, mimeType: 'image/png' } } }, { budgetMs: 60 })
  const ticket = await late.prepare()
  await assert.rejects(late.service.confirm({ id: late.item.id, owner, ticket: ticket.ticket }))
  await new Promise(r => setTimeout(r, 180))
  assert.deepEqual(await late.store.get(late.item.id), late.item); assert.deepEqual(await readdir(path.join(late.dir, 'media')), [])
})
test('partial images preserve good bytes and canonical retry never goes back to short domain', async t => {
  let failing = true; const paths = []
  const f = await setup(t, { parse: async input => { paths.push(input); return { ...parsed, images: [...parsed.images, { index: 2, url: 'https://ci.xhscdn.com/two.png' }] } }, loadImage: async input => { if (failing && input.includes('two')) throw new Error('private upstream token secret'); return { buffer: image, mimeType: 'image/png' } } })
  const preview = await f.prepare(); const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.sourceData.parseStatus, 'partial'); assert.equal(item.attachments.length, 1)
  failing = false
  const result = await createXhsRecovery({ store: f.store, adapter: f.adapter })(f.item.id)
  assert.equal(paths.at(-1), canonicalXhsUrl(url).safeUrl); assert.equal(result.sourceData.originalUrl, short)
  assert.equal(result.attachments.length, 2); assert.equal(f.counts.images, 3)
  const serialized = await readFile(path.join(f.dir, 'pocket-store.json'), 'utf8'); assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes('private upstream'))
})
test('legitimate text-only note completes; parse/token failure preserves original item', async t => {
  const f = await setup(t, { parse: async () => ({ ...parsed, images: [] }) })
  const preview = await f.prepare(); const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.sourceData.parseStatus, 'complete'); assert.equal(item.attachments.length, 0)
  const denied = await setup(t, { parse: async () => { throw Object.assign(new Error('private token body'), { code: 'XHS_ACCESS_DENIED' }) } })
  await assert.rejects(denied.prepare()); assert.deepEqual(await denied.store.get(denied.item.id), denied.item)
})

test('actual HTTP endpoints enforce owner, origin and session scope; errors do not echo URL tokens', async t => {
  const { startBridge } = await import('./index.js')
  const dir = await mkdtemp(path.join(tmpdir(), 'xhs-canonical-api-'))
  const bridge = await startBridge({ dataDir: dir, port: 0, host: '127.0.0.1', bridgeToken: 'synthetic-owner-bearer', drawerSecret: 'synthetic-browser-secret', xhsAdapter: { parse: async () => parsed, loadImage: async () => ({ buffer: image, mimeType: 'image/png' }) } })
  t.after(async () => { await bridge.stop(); await rm(dir, { recursive: true, force: true }) })
  const item = await bridge.store.upsert({ sourceUrl: short, text: 'synthetic', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: short } })
  const base = `http://127.0.0.1:${bridge.address.port}`
  const endpoint = `${base}/api/pocket/items/${item.id}/xhs-canonical`
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.1' }
  const post = (action, body, extra = {}) => fetch(`${endpoint}/${action}`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) })
  assert.equal((await post('preview', { canonicalUrl: url })).status, 401)
  headers.authorization = 'Bearer synthetic-owner-bearer'
  assert.equal((await post('preview', { canonicalUrl: url }, { origin: 'https://evil.example' })).status, 403)
  const previewResponse = await post('preview', { canonicalUrl: url })
  assert.equal(previewResponse.status, 200); assert.equal(previewResponse.headers.get('cache-control'), 'no-store')
  const preview = await previewResponse.json(); assert.ok(!JSON.stringify(preview).includes(token))
  const wrongOwner = await fetch(`${endpoint}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ticket: preview.ticket }) })
  assert.equal(wrongOwner.status, 410)
  const sessionCookie = async () => {
    const login = await fetch(`${base}/drawer/session`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ secret: 'synthetic-browser-secret' }) })
    assert.equal(login.status, 200)
    return login.headers.get('set-cookie').split(';')[0]
  }
  const cookieA = await sessionCookie(); const cookieB = await sessionCookie()
  const sessionPost = (action, data, cookie) => post(action, data, { authorization: 'Bearer identical-but-invalid', cookie, origin: base })
  const sessionPreviewResponse = await sessionPost('preview', { canonicalUrl: url }, cookieA)
  assert.equal(sessionPreviewResponse.status, 200)
  const sessionPreview = await sessionPreviewResponse.json()
  assert.equal((await sessionPost('confirm', { ticket: sessionPreview.ticket }, cookieB)).status, 410)
  assert.equal((await sessionPost('cancel', { ticket: sessionPreview.ticket }, cookieA)).status, 200)
  const confirm = await post('confirm', { ticket: preview.ticket }); assert.equal(confirm.status, 200)
  assert.equal((await confirm.json()).item.id, item.id)
  const retry = await fetch(`${base}/api/pocket/items/${item.id}/retry-source`, { method: 'POST', headers, body: JSON.stringify({ sourceUrl: url }) }); assert.equal(retry.status, 400)
  const malformed = await fetch(`${endpoint}/preview`, { method: 'POST', headers, body: `{"canonicalUrl":"${url}" broken` })
  assert.equal(malformed.status, 400); assert.ok(!(await malformed.text()).includes(token))
  assert.ok(!(await readFile(path.join(dir, 'pocket-store.json'), 'utf8')).includes(token))
})

test('serialized version check catches an edit queued before confirmation', async t => {
  const f = await setup(t)
  const preview = await f.prepare()
  // Queue a normal metadata write immediately before confirm without waiting for it.
  const edit = f.store.review(f.item.id, 'deferred')
  const commit = f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  await edit
  await assert.rejects(commit, error => error.code === 'XHS_STALE_PREVIEW')
  assert.equal(f.counts.images, 0); assert.equal((await f.store.get(f.item.id)).status, 'deferred')
})

test('after restoring one unknown alias, the other remains untouched and gets a safe collision candidate', async t => {
  const f = await setup(t)
  const other = await f.store.upsert({ sourceUrl: 'https://xhslink.cn/o/synthetic-unresolved', text: f.item.text, title: f.item.title, sourceData: { provider: 'xiaohongshu', parseStatus: 'failed' } })
  const preview = await f.prepare(); await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  await assert.rejects(f.service.prepare({ id: other.id, owner, url }), error => error.code === 'XHS_IDENTITY_CONFLICT' && error.candidate.id === f.item.id)
  assert.deepEqual(await f.store.get(other.id), other); assert.equal((await f.store.list()).length, 2)
})

test('note and tag edits invalidate a pending preview without overwriting metadata', async t => {
  for (const kind of ['note', 'tags']) {
    const f = await setup(t); const preview = await f.prepare()
    if (kind === 'note') await f.store.editNote(f.item.id, 'EE newly edited note')
    else await f.store.organizeExistingMetadata(f.item.id, { requestId: 'synthetic-remove-tags', expectedUpdatedAt: f.item.updatedAt, tagsRemove: ['合成标签'] })
    const edited = await f.store.get(f.item.id)
    await assert.rejects(f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }), error => error.code === 'XHS_STALE_PREVIEW')
    assert.deepEqual(await f.store.get(f.item.id), edited); assert.equal(f.counts.images, 0)
  }
})

test('ticket capacity is bounded and cancelling releases a slot; non-XHS and known wrong identities reject', async t => {
  const f = await setup(t, {}, { capacity: 1 })
  const preview = await f.prepare()
  await assert.rejects(f.prepare(), error => error.status === 429)
  f.service.cancel({ id: f.item.id, owner, ticket: preview.ticket })
  const next = await f.prepare(); assert.notEqual(next.ticket, preview.ticket)
  const ordinary = await f.store.upsert({ text: 'ordinary article', sourceUrl: 'https://example.com/article' })
  f.service.cancel({ id: f.item.id, owner, ticket: next.ticket })
  await assert.rejects(f.service.prepare({ id: ordinary.id, owner, url }), error => error.code === 'XHS_ITEM_STATE')
  const partial = await f.store.upsertXhs({ sourceUrl: short, xhs: { ...parsed, images: [{ index: 1, url: 'https://ci.xhscdn.com/fail.png' }] } }, { loadImage: async () => { throw new Error('unavailable') } })
  assert.equal(partial.sourceData.parseStatus, 'partial')
  await assert.rejects(f.service.prepare({ id: f.item.id, owner, url: url.replace(noteId, otherId) }), error => error.code === 'XHS_NOTE_MISMATCH')
})

test('new partial preview retains good images while requiring a fresh confirmation', async t => {
  let failed = true
  const f = await setup(t, { parse: async () => ({ ...parsed, images: [...parsed.images, { index: 2, url: 'https://ci.xhscdn.com/two.png' }] }), loadImage: async input => {
    if (failed && input.includes('two')) throw Object.assign(new Error('denied'), { status: 403 })
    return { buffer: image, mimeType: 'image/png' }
  } })
  const first = await f.prepare(); const partial = await f.service.confirm({ id: f.item.id, owner, ticket: first.ticket })
  assert.equal(partial.item.sourceData.parseStatus, 'partial')
  failed = false
  const second = await f.prepare(); assert.equal(f.counts.images, 2)
  const complete = await f.service.confirm({ id: f.item.id, owner, ticket: second.ticket })
  assert.equal(f.counts.images, 3); assert.equal(complete.item.attachments[0].id, partial.item.attachments[0].id)
  assert.equal(complete.item.sourceData.parseStatus, 'complete'); assert.equal(complete.item.receivedCount, 1)
})

test('completed replay reads current metadata and never resurrects a subsequently deleted item', async t => {
  const f = await setup(t); const preview = await f.prepare()
  const args = { id: f.item.id, owner, ticket: preview.ticket }
  await f.service.confirm(args); await f.store.editNote(f.item.id, 'edited after success')
  assert.equal((await f.service.confirm(args)).item.note, 'edited after success'); assert.equal(f.counts.images, 1)
  await f.store.trash(f.item.id)
  await assert.rejects(f.service.confirm(args), error => error.status === 410)
})

test('a late, non-cooperating preview cannot produce a ticket or modify Store', async t => {
  const f = await setup(t, { parse: async () => { await new Promise(r => setTimeout(r, 150)); return parsed } }, { budgetMs: 60 })
  await assert.rejects(f.prepare())
  await new Promise(r => setTimeout(r, 180))
  assert.deepEqual(await f.store.get(f.item.id), f.item); assert.equal(f.counts.images, 0)
})

test('canonical adapter refuses HTTP downgrade before egress and reports timeout after approved HTTPS redirect', async t => {
  const { XhsAdapter } = await import('./adapters/xhs.js')
  for (const downgrade of [true, false]) {
    let requests = 0
    const actual = new XhsAdapter({ fetchImpl: async () => {
      requests++
      if (requests === 1) return new Response('', { status: 302, headers: { location: url.replace('/explore/', '/discovery/item/').replace('https:', downgrade ? 'http:' : 'https:') } })
      throw new DOMException('private URL and token must not escape', 'TimeoutError')
    } })
    const f = await setup(t, { parse: (...args) => actual.parse(...args) })
    await assert.rejects(f.prepare(), error => error.code === (downgrade ? 'XHS_REDIRECT_BLOCKED' : 'XHS_TIMEOUT') && !error.message.includes(token))
    assert.equal(requests, downgrade ? 1 : 2); assert.equal(f.counts.images, 0); assert.deepEqual(await f.store.get(f.item.id), f.item)
  }
})

test('canonical image saving verifies MIME/signature and rejects unencrypted image requests', async t => {
  const { XhsAdapter } = await import('./adapters/xhs.js')
  let requests = 0
  const actual = new XhsAdapter({ fetchImpl: async () => { requests++; return new Response('not image bytes', { headers: { 'content-type': 'image/png' } }) } })
  const f = await setup(t, { loadImage: (...args) => actual.loadImage(...args) })
  const preview = await f.prepare(); const result = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(result.item.sourceData.parseStatus, 'partial'); assert.equal(result.item.attachments.length, 0)
  assert.equal(result.item.sourceData.images[0].errorStage, 'image'); assert.deepEqual(await readdir(path.join(f.dir, 'media')), [])
  await assert.rejects(actual.loadImage('http://ci.xhscdn.com/plain.png', { httpsOnly: true }))
  assert.equal(requests, 1)
})

test('legacy canonical metadata without explicit sourceIdentity still owns its stable note ID', async t => {
  const f = await setup(t)
  const other = await f.store.upsert({ sourceUrl: url, text: 'legacy unresolved canonical record', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed' } })
  await assert.rejects(f.prepare(), error => error.code === 'XHS_IDENTITY_CONFLICT' && error.candidate.id === other.id)
  assert.equal(f.counts.images, 0); assert.deepEqual(await f.store.get(f.item.id), f.item)
})

test('intent TTL expiring during image download independently revokes final Store publication', async t => {
  const f = await setup(t, { loadImage: async () => { await new Promise(r => setTimeout(r, 250)); return { buffer: image, mimeType: 'image/png' } } }, { ttlMs: 120, budgetMs: 1000 })
  const preview = await f.prepare()
  await assert.rejects(f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket }))
  await new Promise(r => setTimeout(r, 280))
  assert.deepEqual(await f.store.get(f.item.id), f.item); assert.deepEqual(await readdir(path.join(f.dir, 'media')), [])
})

for (const total of [1, 18, 30]) test(`bounded confirmed ${total}-image restore persists exact bytes including last image`, async t => {
  let active = 0; let maximum = 0
  const f = await setup(t, {
    parse: async () => ({ ...parsed, images: Array.from({ length: total }, (_, i) => ({ index: i + 1, url: `https://ci.xhscdn.com/${i}.png` })) }),
    loadImage: async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setTimeout(resolve, 3)); active--; return { buffer: image, mimeType: 'image/png' } },
  })
  const start = performance.now(); const preview = await f.prepare()
  const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.id, f.item.id); assert.equal(item.sourceData.parseStatus, 'complete'); assert.equal(item.attachments.length, total)
  assert.ok(maximum <= 3); assert.equal(item.attachments.at(-1).sourceImage.index, total)
  for (const attachment of item.attachments) assert.deepEqual((await f.store.readAttachment(attachment.id)).data, image)
  assert.equal(f.counts.images, total)
  t.diagnostic(`${total} images: ${Math.round(performance.now() - start)}ms, peak loaders=${maximum}`)
})

test('slow image does not hold Store queue; timeout persists partial and retry fetches only missing canonical images', async t => {
  let release; const gate = new Promise(resolve => { release = resolve }); let started
  const began = new Promise(resolve => { started = resolve }); let fail = true
  const f = await setup(t, {
    parse: async source => { assert.ok(source.startsWith('https://www.xiaohongshu.com/')); return { ...parsed, images: Array.from({ length: 18 }, (_, i) => ({ index: i + 1, url: `https://ci.xhscdn.com/${i}.png` })) } },
    loadImage: async source => {
      if (fail && source.endsWith('/17.png')) { started(); await gate }
      if (fail && source.endsWith('/16.png')) throw new Error('synthetic CDN failure')
      return { buffer: image, mimeType: 'image/png' }
    },
  }, { imageTimeoutMs: 200 })
  const other = await f.store.upsert({ text: 'unrelated synthetic paper' })
  const preview = await f.prepare(); const pending = f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  await began
  const start = performance.now(); await f.store.editNote(other.id, 'responsive during CDN wait')
  assert.ok(performance.now() - start < 150)
  const { item } = await pending
  assert.equal(item.sourceData.parseStatus, 'partial'); assert.equal(item.sourceData.failedImages, 2); assert.equal(item.attachments.length, 16)
  assert.equal(item.sourceData.imageCount, 18); assert.equal((await readdir(path.join(f.dir, 'media'))).some(name => name.startsWith('.xhs-stage-')), false)
  fail = false; release(); const count = f.counts.images
  const restored = await createXhsRecovery({ store: f.store, adapter: f.adapter })(item.id)
  assert.equal(restored.id, item.id); assert.equal(restored.attachments.length, 18); assert.equal(f.counts.images - count, 2)
  assert.deepEqual(restored.attachments.slice(0, 16).map(a => a.id), item.attachments.map(a => a.id))
})

test('edit during staged fetch rejects final publication and removes every staged file', async t => {
  let release; let started
  const began = new Promise(resolve => { started = resolve })
  const f = await setup(t, { loadImage: async () => { started(); await new Promise(resolve => { release = resolve }); return { buffer: image, mimeType: 'image/png' } } })
  const preview = await f.prepare(); const pending = f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  await began; await f.store.editNote(f.item.id, 'EE edit while downloading'); release()
  await assert.rejects(pending, error => error.code === 'XHS_STALE_PREVIEW')
  assert.equal((await f.store.get(f.item.id)).note, 'EE edit while downloading')
  assert.deepEqual(await readdir(path.join(f.dir, 'media')), [])
})

test('aggregate exact 80 MiB persists, excess and oversized single image fail truthfully', async t => {
  const sizes = [15, 15, 15, 15, 15, 5, 1, 16]
  const f = await setup(t, {
    parse: async () => ({ ...parsed, images: sizes.map((_, i) => ({ index: i + 1, url: `https://ci.xhscdn.com/${i}.png` })) }),
    loadImage: async source => { const i = Number(new URL(source).pathname.slice(1, -4)); const buffer = Buffer.alloc(sizes[i] * 1024 * 1024); image.copy(buffer); return { buffer, mimeType: 'image/png' } },
  })
  const preview = await f.prepare(); const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.sourceData.parseStatus, 'partial'); assert.equal(item.sourceData.downloadedBytes, 80 * 1024 * 1024)
  assert.equal(item.attachments.length, 6); assert.equal(item.sourceData.failedImages, 2)
  for (const attachment of item.attachments) assert.equal((await f.store.readAttachment(attachment.id, 15 * 1024 * 1024)).data.length, attachment.size)
})


test('failed atomic publication cleans downloaded media and spool without changing canonical Store', async t => {
  const f = await setup(t)
  const before = await readFile(f.store.filePath)
  const op = createMcpFileOperation({ budgetMs: 2000 })
  try {
    await assert.rejects(f.store.upsertXhs({ sourceUrl: short, xhs: parsed }, {
      targetItemId: f.item.id, expectedSourceUrl: short, recoveryUrl: canonicalXhsUrl(url).safeUrl,
      authorization: { check: op.check, signal: op.signal, accepted: false, publish() { throw new Error('synthetic rename failure') } },
      loadImage: async () => ({ buffer: image, mimeType: 'image/png' }),
    }), /synthetic rename failure/)
    assert.deepEqual(await readFile(f.store.filePath), before)
    assert.deepEqual(await readdir(f.store.mediaDir), [])
  } finally { op.dispose() }
})

test('aggregate phase deadline publishes verified subset while authorization remains valid', async t => {
  let finish
  const f = await setup(t, {
    parse: async () => ({ ...parsed, images: [{ index: 1, url: 'https://ci.xhscdn.com/fast.png' }, { index: 2, url: 'https://ci.xhscdn.com/hung.png' }] }),
    loadImage: source => source.includes('hung') ? new Promise(resolve => { finish = resolve }) : Promise.resolve({ buffer: image, mimeType: 'image/png' }),
  }, { phaseTimeoutMs: 35, imageTimeoutMs: 1000 })
  const preview = await f.prepare()
  const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.sourceData.parseStatus, 'partial'); assert.equal(item.attachments.length, 1); assert.equal(item.sourceData.failedImages, 1)
  assert.equal(item.sourceData.images[1].errorCode, 'XHS_TIMEOUT')
  finish({ buffer: image, mimeType: 'image/png' })
})


test('legacy missing originalUrl preserves stored share instead of new token-bearing parse URL', async t => {
  const f = await setup(t)
  const state = JSON.parse(await readFile(f.store.filePath, 'utf8'))
  delete state.items[0].sourceData.originalUrl
  const { writeFile } = await import('node:fs/promises')
  await writeFile(f.store.filePath, JSON.stringify(state))
  const preview = await f.prepare()
  const { item } = await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  assert.equal(item.sourceData.originalUrl, short)
  assert.ok(!(await readFile(f.store.filePath, 'utf8')).includes(token))
})

test('parallel recoveries share a global maximum of three live image loaders', async t => {
  let active = 0; let peak = 0
  const overrides = {
    parse: async () => ({ ...parsed, images: Array.from({ length: 18 }, (_, i) => ({ index: i + 1, url: `https://ci.xhscdn.com/${i}.png` })) }),
    loadImage: async () => { peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return { buffer: image, mimeType: 'image/png' } },
  }
  const first = await setup(t, overrides); const second = await setup(t, overrides)
  await Promise.all([first, second].map(async f => {
    const preview = await f.prepare()
    assert.equal((await f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })).item.attachments.length, 18)
  }))
  assert.ok(peak <= 3)
})


test('identity collision introduced during CDN fetch blocks publication and cleans stage', async t => {
  let release; let started
  const began = new Promise(resolve => { started = resolve })
  const f = await setup(t, { loadImage: async () => { started(); await new Promise(resolve => { release = resolve }); return { buffer: image, mimeType: 'image/png' } } })
  const preview = await f.prepare(); const pending = f.service.confirm({ id: f.item.id, owner, ticket: preview.ticket })
  await began
  await f.store.upsert({ sourceUrl: canonicalXhsUrl(url).safeUrl, text: 'new owner of stable note identity', sourceIdentity: { provider: 'xiaohongshu', externalId: noteId }, sourceData: { provider: 'xiaohongshu', parseStatus: 'complete', noteId } })
  release()
  await assert.rejects(pending, error => error.code === 'XHS_IDENTITY_CONFLICT')
  assert.deepEqual(await f.store.get(f.item.id), f.item)
  assert.deepEqual(await readdir(f.store.mediaDir), [])
})
