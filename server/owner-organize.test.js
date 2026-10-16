import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aqi-drawer-owner-organize-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  await store.createTag('Research')
  await store.createTag('Reference')
  await store.createTag('Design')
  await store.createCollection('Academic')
  await store.createCollection('Ideas')
  const item = await store.upsert({
    title: 'Fixture article',
    text: 'Fixture article contents',
    tags: ['Research', 'Reference'],
    collection: 'Academic',
  })
  return { store, item, dir }
}

const organize = (id, requestId, other = {}) => ({
  requestId, tagsAdd: ['Design'], tagsRemove: ['Reference'],
  collection: 'Ideas', reason: 'Group with design notes', ...other,
})

test('owner organizer edits only existing vocabulary with durable receipt, retry and guarded undo', async (t) => {
  const { store, item, dir } = await fixture(t)
  const previous = await store.get(item.id)
  const tags = await store.listTags()
  const collections = await store.listCollections()
  const request = organize(item.id, 'organize:example:0001', {
    tagsAdd: ['design'], tagsRemove: ['reference'], collection: 'ideas',
  })
  const first = await store.organizeExistingMetadata(item.id, request)
  assert.equal(first.changed, true)
  assert.equal(first.duplicate, false)
  assert.deepEqual(first.before, { tags: ['Research', 'Reference'], collection: 'Academic' })
  assert.deepEqual(first.after, { tags: ['Research', 'Design'], collection: 'Ideas' })
  assert.deepEqual(first.tagsAdded, ['Design'])
  assert.deepEqual(first.tagsRemoved, ['Reference'])
  assert.equal(first.reason, request.reason)
  assert.match(first.operationId, /^[0-9a-f-]{36}$/iu)
  assert.equal((await store.get(item.id)).text, previous.text)
  assert.equal((await store.get(item.id)).sourceUrl, previous.sourceUrl)
  assert.deepEqual(await store.listTags(), tags)
  assert.deepEqual(await store.listCollections(), collections)
  const retry = await store.organizeExistingMetadata(item.id, request)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.changed, false)
  assert.equal(retry.operationId, first.operationId)
  await assert.rejects(() => store.organizeExistingMetadata(item.id, {
    ...request, tagsRemove: [], requestId: request.requestId,
  }), /already used/)
  // Idempotency survives disk reload because it is stored in normalized item activities.
  const reopened = new PocketStore(dir)
  await reopened.init()
  assert.equal((await reopened.organizeExistingMetadata(item.id, request)).operationId, first.operationId)
  const undone = await reopened.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:example:0001',
  })
  assert.equal(undone.changed, true)
  assert.equal(undone.undone, true)
  assert.deepEqual(undone.after, first.before)
  const duplicateUndo = await reopened.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:example:0001',
  })
  assert.equal(duplicateUndo.duplicate, true)
  await assert.rejects(() => reopened.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:example:different',
  }), /already undone/)
  // Retrying original request does not replay the change after undo.
  const afterUndo = await reopened.organizeExistingMetadata(item.id, request)
  assert.equal(afterUndo.duplicate, true)
  assert.deepEqual((await reopened.get(item.id)).tags, previous.tags)
})

test('new, misspelled or conflicting tags/collections fail closed with no mutation', async (t) => {
  const { store, item } = await fixture(t)
  const original = await store.get(item.id)
  for (const [requestId, input] of [
    ['fail:tag:0001', { tagsAdd: ['Unsanctioned'] }],
    ['fail:collection:0002', { collection: 'Brand New' }],
    ['fail:remove:0003', { tagsRemove: ['Nonexistent'] }],
    ['fail:collision:0004', { tagsAdd: ['design'], tagsRemove: ['Design'] }],
    ['fail:limit:0005', { tagsAdd: Array.from({ length: 9 }, () => 'Design') }],
    ['fail:contradiction:0006', { collection: 'Ideas', clearCollection: true }],
  ]) {
    await assert.rejects(() => store.organizeExistingMetadata(item.id, {
      requestId, reason: 'Fixture', ...input,
    }))
  }
  assert.deepEqual(await store.get(item.id), original)
  assert.deepEqual(await store.listTags(), ['Design', 'Reference', 'Research'].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(await store.listCollections(), ['Academic', 'Ideas'])
})

test('undo never overwrites newer edits and never resurrects removed labels', async (t) => {
  const { store, item } = await fixture(t)
  const first = await store.organizeExistingMetadata(item.id, organize(item.id, 'organize:concurrent:0001'))
  await store.editMetadata(item.id, { tagsAdd: ['Reference'] }, { actor: 'EE' })
  const current = await store.get(item.id)
  await assert.rejects(() => store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:concurrent:0001',
  }), /Newer metadata changes/)
  assert.deepEqual(await store.get(item.id), current)

  const secondItem = await store.upsert({ title: 'Other note', text: 'Other note', tags: ['Research'] })
  const move = await store.organizeExistingMetadata(secondItem.id, {
    requestId: 'organize:removed:0001',
    tagsAdd: ['Design'], tagsRemove: ['Research'], reason: 'Test',
  })
  await store.deleteTag('Research', { actor: 'EE' })
  await assert.rejects(() => store.undoExistingOrganization(secondItem.id, {
    operationId: move.operationId, requestId: 'undo:removed:0001',
  }), /Original taxonomy was removed/)
})

test('no-op is idempotent and organizer is bounded to one object per call', async (t) => {
  const { store, item } = await fixture(t)
  const second = await store.upsert({ title: 'Another', text: 'Preserve unchanged' })
  const before = await store.get(second.id)
  const request = {
    requestId: 'organize:noop:0001', tagsAdd: ['Research'],
    reason: 'Already on this note',
  }
  const first = await store.organizeExistingMetadata(item.id, request)
  assert.equal(first.changed, false)
  assert.equal(first.after.collection, 'Academic')
  const twice = await store.organizeExistingMetadata(item.id, request)
  assert.equal(twice.duplicate, true)
  assert.equal(twice.operationId, first.operationId)
  assert.deepEqual(await store.get(second.id), before)
  // Another newer organization must invalidate an earlier receipt's undo.
  const next = await store.organizeExistingMetadata(item.id, organize(item.id, 'organize:later:0002'))
  assert.equal(next.changed, true)
  await assert.rejects(() => store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:noop:0001',
  }), /Newer metadata changes/)
})

test('one organization or undo request key cannot affect a second item or operation', async (t) => {
  const { store, item } = await fixture(t)
  const other = await store.upsert({ title: 'Other item', text: 'Independent item', tags: ['Research'] })
  const first = await store.organizeExistingMetadata(item.id, {
    requestId: 'owner:global-key:0001', tagsAdd: ['Design'], reason: 'Fixture',
  })
  await assert.rejects(() => store.organizeExistingMetadata(other.id, {
    requestId: 'owner:global-key:0001', tagsAdd: ['Reference'],
  }), /different item/)
  const second = await store.organizeExistingMetadata(other.id, {
    requestId: 'owner:global-key:0002', tagsAdd: ['Reference'], reason: 'Fixture',
  })
  await assert.rejects(() => store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'owner:global-key:0001',
  }), /already used/)
  const undo = await store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'owner:undo-key:0001',
  })
  assert.equal(undo.changed, true)
  await assert.rejects(() => store.undoExistingOrganization(other.id, {
    operationId: second.operationId, requestId: 'owner:undo-key:0001',
  }), /already used/)
  assert.deepEqual((await store.get(other.id)).tags, ['Research', 'Reference'])
})
