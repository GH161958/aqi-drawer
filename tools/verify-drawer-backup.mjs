#!/usr/bin/env node
// Offline verification of an *unpacked* Zeabur Drawer Volume.
// Never connects to Tokyo, sends data over the network or mutates the source.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, lstat, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PocketStore } from '../server/store.js'

const MAX_STORE_BYTES = 200 * 1024 * 1024

function safeName(name) {
  if (typeof name !== 'string' || !name || name === '.' || name === '..'
      || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Unsafe local media storageName in snapshot')
  }
  return name
}

async function requireType(file, type) {
  const s = await lstat(file)
  if (type === 'file' && !s.isFile()) throw new Error('Expected ordinary file')
  if (type === 'directory' && !s.isDirectory()) throw new Error('Expected ordinary directory')
  return s
}

async function sha256(file) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk)
  return h.digest('hex')
}

export async function inspectBackup(directory) {
  const root = path.resolve(directory)
  const storeFile = path.join(root, 'pocket-store.json')
  const mediaDir = path.join(root, 'media')
  await requireType(root, 'directory')
  const storeInfo = await requireType(storeFile, 'file')
  await requireType(mediaDir, 'directory')
  if (storeInfo.size > MAX_STORE_BYTES) throw new Error('Unexpectedly large Store; manual audit required')
  const raw = await readFile(storeFile, 'utf8')
  let state
  try { state = JSON.parse(raw) } catch { throw new Error('Store JSON parse failed') }
  if (state?.schemaVersion !== 1 || !Array.isArray(state.items)) {
    throw new Error('Not a valid Drawer schemaVersion=1 Store')
  }
  const names = (await readdir(mediaDir)).sort()
  const entries = new Map()
  for (const name of names) {
    safeName(name)
    const filename = path.join(mediaDir, name)
    const stats = await requireType(filename, 'file')
    entries.set(name, { bytes: stats.size, sha256: await sha256(filename) })
  }
  const referenced = new Set()
  let attachmentReferences = 0
  let verifiedEmbeddedHashes = 0
  for (const item of state.items) {
    if (!item || typeof item !== 'object'
        || (item.attachments != null && !Array.isArray(item.attachments))) {
      throw new Error('Invalid item/attachments structure')
    }
    for (const attachment of item.attachments || []) {
      if (!attachment || typeof attachment !== 'object') throw new Error('Invalid attachment')
      if (!attachment.storageName) continue
      const name = safeName(attachment.storageName)
      const stored = entries.get(name)
      if (!stored) throw new Error('An attachment references a missing local media file')
      if (Number.isFinite(Number(attachment.size)) && Number(attachment.size) > 0
          && Number(attachment.size) !== stored.bytes) {
        throw new Error('Attachment size does not match local file')
      }
      if (attachment.sha256) {
        if (!/^[a-f0-9]{64}$/iu.test(attachment.sha256)) {
          throw new Error('Invalid embedded attachment SHA-256')
        }
        if (attachment.sha256.toLowerCase() !== stored.sha256) {
          throw new Error('Attachment SHA-256 mismatch')
        }
        verifiedEmbeddedHashes++
      }
      attachmentReferences++
      referenced.add(name)
    }
  }
  const storeSha = createHash('sha256').update(raw, 'utf8').digest('hex')
  const manifest = [storeSha, ...[...entries].map(([name, v]) => JSON.stringify([name, v.bytes, v.sha256]))].join('\n')
  const fingerprint = createHash('sha256').update(manifest).digest('hex')
  return {
    schemaVersion: 1,
    totalItems: state.items.length,
    activeItems: state.items.filter((i) => !i.deletedAt).length,
    trashItems: state.items.filter((i) => !!i.deletedAt).length,
    mediaFiles: entries.size,
    mediaBytes: [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0),
    attachmentReferences,
    uniqueReferencedMedia: referenced.size,
    unreferencedMedia: names.filter((name) => !referenced.has(name)).length,
    verifiedEmbeddedHashes,
    storeBytes: storeInfo.size,
    fingerprint,
  }
}

export async function rehearseRestore(directory) {
  const initial = await inspectBackup(directory)
  const root = path.resolve(directory)
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'aqi-drawer-offline-restore-'))
  const dest = path.join(sandbox, 'drawer-restored')
  try {
    await mkdir(path.join(dest, 'media'), { recursive: true, mode: 0o700 })
    await copyFile(path.join(root, 'pocket-store.json'), path.join(dest, 'pocket-store.json'))
    for (const name of await readdir(path.join(root, 'media'))) {
      safeName(name)
      await copyFile(path.join(root, 'media', name), path.join(dest, 'media', name))
    }
    const restored = await inspectBackup(dest)
    if (initial.fingerprint !== restored.fingerprint
        || initial.totalItems !== restored.totalItems
        || initial.attachmentReferences !== restored.attachmentReferences) {
      throw new Error('Restored copy differs from source; source may have changed')
    }
    // Run actual PocketStore initialization and reads ONLY inside the temp copy.
    const store = new PocketStore(dest)
    await store.init()
    const hydrated = await store.list({ includeDeleted: true, limit: Math.max(1, initial.totalItems + 5) })
    if (hydrated.length !== initial.totalItems) throw new Error('Restored Store runtime read failed')
    const after = await inspectBackup(dest)
    if (after.totalItems !== initial.totalItems || after.attachmentReferences !== initial.attachmentReferences) {
      throw new Error('Restored Store changed item/attachment counts during initialization')
    }
    return { ...initial, restoreRehearsal: 'PASS', sourceUntouched: true }
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, folder, ...other] = process.argv.slice(2)
  if (!['inspect', 'rehearse'].includes(mode) || !folder || other.length) {
    process.stderr.write('Usage: node tools/verify-drawer-backup.mjs inspect|rehearse /path/to/unpacked/drawer-production\n')
    process.exitCode = 2
  } else {
    try {
      const receipt = mode === 'inspect' ? await inspectBackup(folder) : await rehearseRestore(folder)
      process.stdout.write(JSON.stringify({ check: mode, ...receipt }, null, 2) + '\n')
    } catch (error) {
      process.stderr.write('BACKUP CHECK FAILED: ' + error.message + '\n')
      process.exitCode = 1
    }
  }
}
