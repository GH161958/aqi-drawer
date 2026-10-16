import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aqi-drawer-mcp-fixture-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  return store
}

test('search finds title/text/tags/collection and excludes Trash', async (t) => {
  const store = await fixture(t)
  const first = await store.upsert({
    title: 'Paper motion reference',
    text: 'A tiny typography experiment with scroll animations',
    tags: ['前端灵感', 'motion'],
    collection: 'Design',
    sourceUrl: 'https://example.org/paper',
  })
  await store.upsert({ title: 'Unrelated research', text: 'Sleep and children', tags: ['academic'] })
  assert.equal((await store.search({ query: 'paper' }))[0].id, first.id)
  assert.deepEqual((await store.search({ query: 'typography animations' }))[0].matchedFields, ['text'])
  assert.equal((await store.search({ tag: '前端灵感' }))[0].id, first.id)
  assert.equal((await store.search({ collection: 'design', query: 'scroll' }))[0].id, first.id)
  assert.equal((await store.search({ query: 'paper', tag: 'academic' })).length, 0)
  assert.equal((await store.search({ query: 'sleep' })).length, 1)
  await store.trash(first.id)
  assert.equal((await store.search({ query: 'paper' })).length, 0)
  await assert.rejects(() => store.search({}), /requires a query/)
})

test('MCP capture saves one item, indexes tags, and preserves idempotency', async (t) => {
  const store = await fixture(t)
  const request = {
    requestId: 'test:a-capture:001',
    title: 'Little inspiration',
    text: 'A note to keep',
    sourceUrl: 'https://example.org/page',
    collection: 'Design',
    tags: ['前端灵感', 'motion'],
  }
  const first = await store.captureFromMcp(request)
  assert.equal(first.duplicate, false)
  assert.equal(first.item.sourceApp, 'ChatGPT / Aqi')
  assert.equal(first.item.activity[0].actor, 'Aqi')
  assert.equal(first.item.status, 'inbox')
  assert.equal(first.item.attachments.length, 0)
  assert.deepEqual(await store.listTags(), ['motion', '前端灵感'].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(await store.listCollections(), ['Design'])
  assert.equal((await store.search({ query: 'inspiration' }))[0].id, first.item.id)
  const second = await store.captureFromMcp(request)
  assert.equal(second.duplicate, true)
  assert.equal(second.item.id, first.item.id)
  assert.equal((await store.list({ limit: 50 })).length, 1)
  await assert.rejects(() => store.captureFromMcp({ ...request, text: 'Different', requestId: request.requestId }), /already used/)
  assert.equal((await store.list({ limit: 50 })).length, 1)
})

test('MCP capture rejects empty input, unsafe URLs and short retry keys', async (t) => {
  const store = await fixture(t)
  await assert.rejects(() => store.captureFromMcp({ requestId: 'valid-key-001' }), /Text or source URL/)
  await assert.rejects(() => store.captureFromMcp({ requestId: 'valid-key-002', sourceUrl: 'file:///tmp/nope' }), /Only HTTP/)
  await assert.rejects(() => store.captureFromMcp({ requestId: 'valid-key-003', sourceUrl: 'https://user:pass@example.com' }), /without credentials/)
  await assert.rejects(() => store.captureFromMcp({ requestId: 'bad', text: 'Example' }), /stable requestId/)
  assert.equal((await store.list({})).length, 0)
})
