import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { inspectBackup, rehearseRestore } from './verify-drawer-backup.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'aqi-backup-fixture-'))
  t.after(async () => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, 'media'))
  const data = Buffer.from('This is only fake fixture media, never a real photo.')
  await writeFile(path.join(root, 'media', 'test-a.png'), data)
  const sha = createHash('sha256').update(data).digest('hex')
  const state = {
    schemaVersion: 1, attentionInitializedAt: '2026-10-17T00:00:00.000Z',
    collections: ['Research'], tags: ['test'], items: [
      {
        id: 'test-one', title: 'One', text: 'Safe fixture', sourceUrl: '',
        sourceApp: 'unit-test', status: 'inbox', tags: ['test'], collection: 'Research',
        createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z',
        attachments: [{ id: 'file-one', name: 'image.png', storageName: 'test-a.png', size: data.length, sha256: sha }],
      },
      {
        id: 'test-trash', title: 'Old', text: 'Fake trashed note', sourceApp: 'unit-test',
        status: 'archived', createdAt: '2026-10-17T00:00:00.000Z',
        updatedAt: '2026-10-17T00:00:00.000Z', deletedAt: '2026-10-17T00:00:00.000Z',
        attachments: [],
      },
    ],
  }
  await writeFile(path.join(root, 'pocket-store.json'), JSON.stringify(state))
  return { root, state }
}

test('inspects Store and media, including Trash and embedded hash', async (t) => {
  const { root } = await fixture(t)
  const v = await inspectBackup(root)
  assert.deepEqual(
    [v.totalItems, v.activeItems, v.trashItems, v.mediaFiles, v.attachmentReferences, v.verifiedEmbeddedHashes],
    [2, 1, 1, 1, 1, 1],
  )
  assert.match(v.fingerprint, /^[0-9a-f]{64}$/)
})

test('rehearses restoration only to independent temporary path; source unchanged', async (t) => {
  const { root } = await fixture(t)
  const original = await readFile(path.join(root, 'pocket-store.json'))
  const r = await rehearseRestore(root)
  assert.equal(r.restoreRehearsal, 'PASS')
  assert.equal(r.sourceUntouched, true)
  assert.deepEqual(await readFile(path.join(root, 'pocket-store.json')), original)
})

test('rejects missing media, mismatched digest, traversal and symlinks', async (t) => {
  const { root, state } = await fixture(t)
  const file = path.join(root, 'pocket-store.json')
  state.items[0].attachments[0].storageName = '../evil'
  await writeFile(file, JSON.stringify(state))
  await assert.rejects(inspectBackup(root), /Unsafe local media/)
  state.items[0].attachments[0].storageName = 'not-found.png'
  await writeFile(file, JSON.stringify(state))
  await assert.rejects(inspectBackup(root), /missing local media/)
  state.items[0].attachments[0].storageName = 'test-a.png'
  state.items[0].attachments[0].sha256 = '0'.repeat(64)
  await writeFile(file, JSON.stringify(state))
  await assert.rejects(inspectBackup(root), /SHA-256 mismatch/)
  await symlink(file, path.join(root, 'media', 'sneaky'))
  await assert.rejects(inspectBackup(root), /Expected ordinary file/)
})

test('rejects corrupt Store JSON and unexpected schema version', async (t) => {
  const { root } = await fixture(t)
  await writeFile(path.join(root, 'pocket-store.json'), 'not-json')
  await assert.rejects(inspectBackup(root), /JSON parse failed/)
  await writeFile(path.join(root, 'pocket-store.json'), JSON.stringify({ schemaVersion: 3, items: [] }))
  await assert.rejects(inspectBackup(root), /schemaVersion=1/)
})
