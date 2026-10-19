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

// Simulates pocket_get before the first organization attempt. Retries reuse
// the exact original snapshot revision, including after Store restart.
const revisions = new Map()
async function organizeWithRevision(store, id, payload) {
  const key = id + ':' + payload.requestId
  if (!revisions.has(key)) {
    revisions.set(key, (await store.get(id)).updatedAt)
  }
  return store.organizeExistingMetadata(id, {
    ...payload,
    expectedUpdatedAt: payload.expectedUpdatedAt ?? revisions.get(key),
  })
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
  const first = await organizeWithRevision(store, item.id, request)
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
  const retry = await organizeWithRevision(store, item.id, request)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.changed, false)
  assert.equal(retry.operationId, first.operationId)
  await assert.rejects(() => organizeWithRevision(store, item.id, {
    ...request, tagsRemove: [], requestId: request.requestId,
  }), /already used/)
  // Idempotency survives disk reload because it is stored in normalized item activities.
  const reopened = new PocketStore(dir)
  await reopened.init()
  assert.equal((await organizeWithRevision(reopened, item.id, request)).operationId, first.operationId)
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
  const afterUndo = await organizeWithRevision(reopened, item.id, request)
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
    await assert.rejects(() => organizeWithRevision(store, item.id, {
      requestId, reason: 'Fixture', ...input,
    }))
  }
  assert.deepEqual(await store.get(item.id), original)
  assert.deepEqual(await store.listTags(), ['Design', 'Reference', 'Research'].sort((a, b) => a.localeCompare(b)))
  assert.deepEqual(await store.listCollections(), ['Academic', 'Ideas'])
})

test('undo never overwrites newer edits and never resurrects removed labels', async (t) => {
  const { store, item } = await fixture(t)
  const first = await organizeWithRevision(store, item.id, organize(item.id, 'organize:concurrent:0001'))
  await store.editMetadata(item.id, { tagsAdd: ['Reference'] }, { actor: 'EE' })
  const current = await store.get(item.id)
  await assert.rejects(() => store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:concurrent:0001',
  }), /Newer metadata changes/)
  assert.deepEqual(await store.get(item.id), current)

  const secondItem = await store.upsert({ title: 'Other note', text: 'Other note', tags: ['Research'] })
  const move = await organizeWithRevision(store, secondItem.id, {
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
  const first = await organizeWithRevision(store, item.id, request)
  assert.equal(first.changed, false)
  assert.equal(first.after.collection, 'Academic')
  const twice = await organizeWithRevision(store, item.id, request)
  assert.equal(twice.duplicate, true)
  assert.equal(twice.operationId, first.operationId)
  assert.deepEqual(await store.get(second.id), before)
  // Another newer organization must invalidate an earlier receipt's undo.
  const next = await organizeWithRevision(store, item.id, organize(item.id, 'organize:later:0002'))
  assert.equal(next.changed, true)
  await assert.rejects(() => store.undoExistingOrganization(item.id, {
    operationId: first.operationId, requestId: 'undo:noop:0001',
  }), /Newer metadata changes/)
})

test('one organization or undo request key cannot affect a second item or operation', async (t) => {
  const { store, item } = await fixture(t)
  const other = await store.upsert({ title: 'Other item', text: 'Independent item', tags: ['Research'] })
  const first = await organizeWithRevision(store, item.id, {
    requestId: 'owner:global-key:0001', tagsAdd: ['Design'], reason: 'Fixture',
  })
  await assert.rejects(() => organizeWithRevision(store, other.id, {
    requestId: 'owner:global-key:0001', tagsAdd: ['Reference'],
  }), /different item/)
  const second = await organizeWithRevision(store, other.id, {
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

test('stale snapshot revisions are refused rather than overwriting EE metadata', async (t) => {
  const { store, item } = await fixture(t)
  const previous = await store.get(item.id)
  // Explicitly stale even if another edit happens within the same millisecond.
  const stale = new Date(new Date(previous.updatedAt).getTime() - 60000).toISOString()
  await assert.rejects(() => store.organizeExistingMetadata(item.id, {
    requestId: 'owner:stale:0001', expectedUpdatedAt: stale,
    tagsAdd: ['Design'], collection: 'Ideas',
  }), /changed since pocket_get/)
  const after = await store.get(item.id)
  assert.deepEqual(after, previous)
  await assert.rejects(() => store.organizeExistingMetadata(item.id, {
    requestId: 'owner:no-revision:0002', tagsAdd: ['Design'],
  }), /expectedUpdatedAt/)
})

test('owner taxonomy creates one approved label per request with durable no-duplicate receipts', async (t) => {
  const { store, item, dir } = await fixture(t)
  const original = await store.get(item.id)
  const args = {
    requestId: 'taxonomy:tag:case001', kind: 'tag',
    name: 'Visual Reference', approvedName: 'Visual Reference',
  }
  const first = await store.createOwnerTaxonomy(args)
  assert.equal(first.changed, true)
  assert.equal(first.duplicate, false)
  assert.equal(first.name, 'Visual Reference')
  assert.match(first.operationId, /^[a-f0-9-]{36}$/u)
  assert.ok((await store.listTags()).includes('Visual Reference'))
  assert.deepEqual(await store.get(item.id), original)

  const retry = await store.createOwnerTaxonomy(args)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.operationId, first.operationId)
  await assert.rejects(store.createOwnerTaxonomy({
    ...args, name: 'Different', approvedName: 'Different',
  }), /already used/)
  const reopened = new PocketStore(dir)
  await reopened.init()
  const afterRestart = await reopened.createOwnerTaxonomy(args)
  assert.equal(afterRestart.duplicate, true)
  assert.equal(afterRestart.operationId, first.operationId)

  const sameByCase = await reopened.createOwnerTaxonomy({
    requestId: 'taxonomy:tag:case002', kind: 'tag',
    name: 'visual reference', approvedName: 'visual reference',
  })
  assert.equal(sameByCase.changed, false)
  assert.equal(sameByCase.name, 'Visual Reference')
  assert.equal((await reopened.listTags()).filter((v) => v.toLowerCase() === 'visual reference').length, 1)

  const collection = await reopened.createOwnerTaxonomy({
    requestId: 'taxonomy:collection:case001', kind: 'collection',
    name: 'Reading Room', approvedName: 'Reading Room',
  })
  assert.equal(collection.changed, true)
  assert.ok((await reopened.listCollections()).includes('Reading Room'))
  assert.deepEqual(await reopened.get(item.id), original)

  // Explicit organization remains a separate revision-guarded item mutation.
  const organized = await reopened.organizeExistingMetadata(item.id, {
    requestId: 'taxonomy:organize:case001',
    expectedUpdatedAt: original.updatedAt,
    tagsAdd: ['visual reference'], collection: 'reading room',
  })
  assert.equal(organized.changed, true)
  assert.deepEqual(organized.tagsAdded, ['Visual Reference'])
  assert.equal(organized.after.collection, 'Reading Room')
  assert.equal((await reopened.get(item.id)).text, original.text)
  const undone = await reopened.undoExistingOrganization(item.id, {
    operationId: organized.operationId, requestId: 'taxonomy:undo:case001',
  })
  assert.equal(undone.undone, true)
  assert.deepEqual(undone.after, organized.before)
})

test('owner taxonomy rejects unapproved, invalid, conflicting or deleted labels', async (t) => {
  const { store, item } = await fixture(t)
  const beforeItem = await store.get(item.id)
  const beforeTags = await store.listTags()
  const beforeCollections = await store.listCollections()
  for (const input of [
    { requestId: 'bad:approval:0001', kind: 'tag', name: 'NewTag', approvedName: 'Different' },
    { requestId: 'bad:blank:000002', kind: 'tag', name: '   ', approvedName: '   ' },
    { requestId: 'bad:long:0000003', kind: 'tag', name: 'x'.repeat(51), approvedName: 'x'.repeat(51) },
    { requestId: 'bad:canonical:0003', kind: 'tag', name: '#Misleading', approvedName: 'Misleading' },
    { requestId: 'bad:kind:0000004', kind: 'other', name: 'NewTag', approvedName: 'NewTag' },
    { requestId: 'tiny', kind: 'tag', name: 'NewTag', approvedName: 'NewTag' },
  ]) await assert.rejects(store.createOwnerTaxonomy(input))
  assert.deepEqual(await store.listTags(), beforeTags)
  assert.deepEqual(await store.listCollections(), beforeCollections)
  assert.deepEqual(await store.get(item.id), beforeItem)

  const created = await store.createOwnerTaxonomy({
    requestId: 'taxonomy:delete:0001', kind: 'tag',
    name: 'TemporaryTag', approvedName: 'TemporaryTag',
  })
  assert.equal(created.changed, true)
  await store.deleteTag('TemporaryTag')
  await assert.rejects(store.createOwnerTaxonomy({
    requestId: 'taxonomy:delete:0001', kind: 'tag',
    name: 'TemporaryTag', approvedName: 'TemporaryTag',
  }), /no longer present/)
  assert.equal((await store.listTags()).includes('TemporaryTag'), false)
})
