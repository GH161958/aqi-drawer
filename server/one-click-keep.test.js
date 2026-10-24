import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'
import { createOneClickKeep } from './one-click-keep.js'

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const file = Object.freeze({
  file_id: 'TEMP-SOURCE-ID-DO-NOT-PERSIST', file_name: 'notes.pdf',
  mime_type: 'application/pdf',
  download_url: 'https://unknown.example.net/original?sig=PRIVATE-URL',
})
const intent = (requestId = 'keep:fixture:one', overrides = {}) => ({
  requestId, mode: 'new', title: 'A note to keep',
  file, ...overrides,
})
async function fixture(t, extras = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-one-click-keep-poc-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  let downloads = 0
  const download = async () => { downloads++; return pdf }
  const service = createOneClickKeep({ store, download, ...extras })
  return { store, service, get downloads() { return downloads } }
}

test('preparation has no egress/write and sends bearer ONLY outside public result', async t => {
  const { store, service, downloads } = await fixture(t)
  const before = await readFile(store.filePath, 'utf8')
  const first = service.prepare(intent())
  assert.equal(first.public.status, 'one_click_approval_required')
  assert.equal(first.public.hostname, 'unknown.example.net')
  assert.match(first.privateCapability, /^[a-f0-9]{64}$/u)
  assert.ok(!JSON.stringify(first.public).includes(first.privateCapability))
  for (const secret of [file.file_id, file.download_url, 'PRIVATE-URL']) {
    assert.ok(!JSON.stringify(first.public).includes(secret))
  }
  assert.deepEqual(service.prepare(intent()), first)
  assert.equal(downloads, 0)
  assert.equal(await readFile(store.filePath, 'utf8'), before)
  assert.deepEqual(await readdir(store.mediaDir), [])
})
test('one widget bearer saves exact pinned original bytes with verified receipt and no second download', async t => {
  const { store, service } = await fixture(t)
  const p = service.prepare(intent())
  await assert.rejects(service.redeem('a'.repeat(64)), /expired private Keep approval/)
  const [first, second] = await Promise.all([service.redeem(p.privateCapability), service.redeem(p.privateCapability)])
  assert.equal(first.attachmentId, second.attachmentId)
  assert.equal(first.sha256, createHash('sha256').update(pdf).digest('hex'))
  const recovered = await service.redeem(p.privateCapability)
  assert.deepEqual(recovered, first)
  assert.deepEqual((await store.readAttachment(first.attachmentId)).data, pdf)
  const serialized = JSON.stringify([first, await store.list(), await readFile(store.filePath, 'utf8')])
  for (const secret of [file.file_id, file.download_url, 'PRIVATE-URL']) assert.ok(!serialized.includes(secret))
  assert.equal((await store.list()).length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
})
test('private capability never permits retargeting, URL rotation or new request ID reuse', async t => {
  const { service } = await fixture(t)
  const first = service.prepare(intent())
  for (const changed of [
    intent('keep:fixture:one', { title: 'Different title' }),
    intent('keep:fixture:one', { file: { ...file, download_url: 'https://another.example.com/new' } }),
    intent('keep:fixture:one', { mode: 'append', itemId: 'some-item-id', title: '' }),
  ]) assert.throws(() => service.prepare(changed), /conflicts/)
  assert.equal(first.privateCapability, service.prepare(intent()).privateCapability)
})
test('expiry rejects approval and reclaims capacity without leaving Store mutations', async t => {
  const { store, service } = await fixture(t, { ttlMs: 100, maxPending: 1 })
  const p = service.prepare(intent())
  assert.throws(() => service.prepare(intent('keep:fixture:other')), /Too many pending/)
  await new Promise(resolve => setTimeout(resolve, 125))
  await assert.rejects(service.redeem(p.privateCapability), /expired private Keep approval/)
  const next = service.prepare(intent('keep:fixture:other'))
  assert.notEqual(next.privateCapability, p.privateCapability)
  assert.equal((await store.list()).length, 0)
})
test('late downloader cannot write after cancellation or refill a revoked capability', async t => {
  let release, called = 0
  const slow = new Promise(resolve => { release = resolve })
  const { store, service } = await fixture(t, {
    ttlMs: 100, maxPending: 1, download: async () => { called++; return slow },
  })
  const p = service.prepare(intent())
  const promise = assert.rejects(service.redeem(p.privateCapability), /expired or cancelled/)
  await new Promise(resolve => setTimeout(resolve, 120))
  await promise
  release(pdf)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(called, 1)
  assert.equal((await store.list()).length, 0)
  assert.deepEqual(await readdir(store.mediaDir), [])
  const newScope = service.prepare(intent('keep:fixture:replacement'))
  assert.notEqual(newScope.privateCapability, p.privateCapability)
})
test('invalid request ID carrying opaque file ID is rejected before issuing token', async t => {
  const { service } = await fixture(t)
  assert.throws(() => service.prepare(intent('keep:' + file.file_id)), /independent stable request_id/)
})

test('cancelling a prepared capability revokes it before any file download', async t => {
  let downloads = 0
  const { store, service } = await fixture(t, { download: async () => { downloads++; return pdf } })
  const p = service.prepare(intent('keep:cancel:fixture'))
  assert.equal(service.cancel(p.privateCapability), true)
  assert.equal(service.cancel(p.privateCapability), false)
  await assert.rejects(service.redeem(p.privateCapability), /Invalid or expired private Keep approval/)
  assert.equal(downloads, 0)
  assert.equal((await store.list()).length, 0)
})

test('completed receipts do not consume pending slots; completed cache remains bounded', async t => {
  const { store, service } = await fixture(t, { maxPending: 1 })
  const first = service.prepare(intent('keep:completed:first'))
  const receipt = await service.redeem(first.privateCapability)
  assert.equal(receipt.duplicate, false)
  assert.equal(service.prepare(intent('keep:completed:first')).public.status, 'one_click_receipt_available')
  const second = service.prepare(intent('keep:completed:second'))
  assert.notEqual(second.privateCapability, first.privateCapability)
  await service.redeem(second.privateCapability)
  await assert.rejects(service.redeem(first.privateCapability), /expired private Keep approval/u)
  assert.equal((await store.list()).length, 2)
})
test('published original survives a deadline timer before async save resolves', async t => {
  let now = 1000
  let enter
  const published = new Promise(resolve => { enter = resolve })
  let release
  const held = new Promise(resolve => { release = resolve })
  const { store, service } = await fixture(t, { ttlMs: 100, clock: () => now })
  const save = store.saveMcpFileIntake.bind(store)
  store.saveMcpFileIntake = async args => {
    const saved = await save(args)
    enter()
    await held
    return saved
  }
  const first = service.prepare(intent('keep:race:published'))
  const promise = service.redeem(first.privateCapability)
  await published
  // Simulate time passing after the Store has already admitted and published
  // the canonical mutation. Purge must preserve the in-flight receipt.
  now += 500
  const other = service.prepare(intent('keep:race:second'))
  assert.equal(other.public.saved, false)
  release()
  const receipt = await promise
  assert.ok(receipt.attachmentId)
  const recovered = await service.redeem(first.privateCapability)
  assert.equal(recovered.attachmentId, receipt.attachmentId)
  assert.equal((await store.list()).length, 1)
})
test('reviewed source host uses original V1 and cannot create a redundant keep card', async t => {
  const { service } = await fixture(t, { reviewedHosts: ['unknown.example.net'] })
  assert.throws(() => service.prepare(intent('keep:reviewed:source')), /Known host/u)
})
