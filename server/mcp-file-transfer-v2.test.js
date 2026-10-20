import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'
import { createPinnedFileTransferV2 } from './mcp-file-transfer-v2.js'

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const firstHost = 'oaisdmntprjapaneast.blob.core.windows.net'
const secondHost = 'oaisdmntpritalynorth.blob.core.windows.net'
const makeFile = (host = firstHost, id = 'file_qa_one') => ({
  file_id: id, mime_type: 'application/pdf', file_name: 'qa.pdf',
  download_url: 'https://' + host + '/signed?token=NEVER-REVEAL',
})

async function fixture(t, { download, clock, ttlMs, maxPending } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-pinned-transfer-v2-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  const received = []
  const downloader = download || (async (file, options) => {
    received.push({ file, allowedHosts: options.allowedHosts })
    return pdf
  })
  return {
    store, received,
    service: createPinnedFileTransferV2({ store, download: downloader, clock, ttlMs, maxPending }),
  }
}
const newIntent = (file = makeFile(), overrides = {}) => ({
  requestId: 'qa-v2-pinned-20261020-01', mode: 'new',
  title: 'Safe PDF test', text: 'EE explicitly approved this exact paper.',
  file, ...overrides,
})
const approved = (p) => ({
  ticketId: p.ticketId, approvedHostname: p.hostname, approvedTitle: p.title,
})

test('prepare is metadata-only and emits no signed URL or file ID', async (t) => {
  const { store, received, service } = await fixture(t)
  const preview = service.prepare(newIntent())
  assert.equal(preview.hostname, firstHost)
  assert.equal(preview.downloaded, false)
  assert.equal(preview.stored, false)
  assert.match(preview.ticketId, /^[a-f0-9-]{36}$/u)
  assert.ok(!JSON.stringify(preview).includes('NEVER-REVEAL'))
  assert.ok(!JSON.stringify(preview).includes('file_qa_one'))
  assert.equal(received.length, 0)
  assert.equal((await store.list()).length, 0)
  assert.deepEqual(await readdir(store.mediaDir), [])
})

test('commit pins the ORIGINAL fileParams URL and exact one-time host; no permanent allowlist needed', async (t) => {
  const { store, received, service } = await fixture(t)
  const first = service.prepare(newIntent())
  // A new ChatGPT call could now resolve the same file through Italy North;
  // Commit must use the FIRST host-provided URL, not ask fileParams again.
  const secondParams = makeFile(secondHost, 'file_qa_two')
  assert.equal(new URL(secondParams.download_url).hostname, secondHost)
  const saved = await service.commit(approved(first))
  assert.equal(saved.duplicate, false)
  assert.equal(received.length, 1)
  assert.equal(received[0].file.download_url, makeFile().download_url)
  assert.deepEqual(received[0].allowedHosts, [firstHost])
  assert.equal(saved.bytes, pdf.length)
  assert.equal(saved.sha256, createHash('sha256').update(pdf).digest('hex'))
  const item = await store.get(saved.itemId)
  assert.equal(item.title, 'Safe PDF test')
  assert.equal(item.text, 'EE explicitly approved this exact paper.')
  assert.equal(item.attachments.length, 1)
  assert.ok(!JSON.stringify(item).includes('NEVER-REVEAL'))
  assert.ok(!JSON.stringify(item).includes('file_qa_one'))
  assert.equal(item.sourceData.openaiFileId, undefined)
  assert.deepEqual((await store.readAttachment(saved.attachmentId)).data, pdf)
  await assert.rejects(service.commit(approved(first)), /missing or expired/)
  assert.equal((await store.list()).length, 1)
})

test('wrong hostname and title approvals fail closed without downloads or writes', async (t) => {
  const { store, received, service } = await fixture(t)
  const p = service.prepare(newIntent())
  await assert.rejects(service.commit({ ...approved(p), approvedHostname: secondHost }), /must match/)
  await assert.rejects(service.commit({ ...approved(p), approvedTitle: 'A different file' }), /must match/)
  await assert.rejects(service.commit({ ...approved(p), ticketId: '00000000-0000-0000-0000-000000000000' }), /missing/)
  assert.equal(received.length, 0)
  assert.equal((await store.list()).length, 0)
  const done = await service.commit(approved(p))
  assert.equal(done.duplicate, false)
})

test('stale ticket and unexpected file host fail closed', async (t) => {
  let now = 1_000_000
  const { service, store, received } = await fixture(t, { clock: () => now, ttlMs: 100 })
  const p = service.prepare(newIntent())
  now += 101
  await assert.rejects(service.commit(approved(p)), /missing or expired/)
  assert.equal(received.length, 0)
  assert.equal((await store.list()).length, 0)
  assert.throws(() => service.prepare(newIntent({ ...makeFile(), download_url: 'http://localhost/file' })), /HTTPS/)
  assert.throws(() => service.prepare(newIntent({ ...makeFile(), download_url: 'https://127.0.0.1/private' })), /HTTPS/)
})

test('concurrent commits for one ticket cannot double-write', async (t) => {
  let resolveDownload
  const waiting = new Promise(resolve => { resolveDownload = resolve })
  const download = async () => {
    await waiting
    return pdf
  }
  const { store, service } = await fixture(t, { download })
  const p = service.prepare(newIntent())
  const first = service.commit(approved(p))
  await assert.rejects(service.commit(approved(p)), /in progress/)
  resolveDownload()
  const saved = await first
  assert.equal((await store.list()).length, 1)
  assert.equal((await store.get(saved.itemId)).attachments.length, 1)
})

test('failed download can retry one pinned ticket; full file validation is retained', async (t) => {
  let attempts = 0
  const { store, service } = await fixture(t, { download: async () => {
    if (++attempts === 1) throw new Error('Transient error')
    return pdf
  } })
  const p = service.prepare(newIntent())
  await assert.rejects(service.commit(approved(p)), /Transient error/)
  assert.equal((await store.list()).length, 0)
  const saved = await service.commit(approved(p))
  assert.equal(attempts, 2)
  assert.equal(saved.bytes, pdf.length)
  await assert.rejects(service.commit(approved(p)), /missing or expired/)
})

test('durable request_id prevents duplicate items when fileParams URL and file ID rotate', async (t) => {
  const { store, service } = await fixture(t)
  const initial = service.prepare(newIntent(makeFile(firstHost, 'initial-opaque')))
  const first = await service.commit(approved(initial))
  const rotated = service.prepare(newIntent(makeFile(secondHost, 'second-opaque')))
  const retry = await service.commit(approved(rotated))
  assert.equal(retry.duplicate, true)
  assert.equal(retry.itemId, first.itemId)
  assert.equal(retry.attachmentId, first.attachmentId)
  assert.equal((await store.list()).length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
})

test('append keeps existing title/text/metadata, and queue capacity is bounded', async (t) => {
  const { store, service } = await fixture(t, { maxPending: 1 })
  const existing = await store.upsert({ title: 'Original', text: 'Unchanged', tags: ['Care'] })
  const p = service.prepare({
    requestId: 'qa-v2-append-20261020-01', mode: 'append', itemId: existing.id, file: makeFile(),
  })
  assert.throws(() => service.prepare(newIntent()), /Too many/)
  assert.throws(() => service.prepare({
    requestId: 'qa-v2-bad-append', mode: 'append', itemId: existing.id,
    text: 'silently rewriting', file: makeFile(),
  }), /cannot replace/)
  await service.commit(approved(p))
  const item = await store.get(existing.id)
  assert.equal(item.title, 'Original')
  assert.equal(item.text, 'Unchanged')
  assert.deepEqual(item.tags, ['Care'])
  assert.equal(item.attachments.length, 1)
})

test('untrusted file URL fails before any Store mutation; no executable content accepted', async (t) => {
  const { store, service } = await fixture(t, { download: async () => Buffer.from('<script>alert(1)</script>') })
  const p = service.prepare(newIntent(makeFile()))
  await assert.rejects(service.commit(approved(p)), /signature/)
  assert.equal((await store.list()).length, 0)
  assert.deepEqual(await readdir(store.mediaDir), [])
})
