import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'
import {
  MAX_MCP_FILE_BYTES, createMcpFileIntakeService, permittedFileHosts,
  validateMcpFileUrl, validateMcpFileBytes,
} from './mcp-file-intake.js'

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const fakeFile = (overrides = {}) => ({
  file_id: 'file_fixture_001', file_name: 'reading.pdf', mime_type: 'application/pdf',
  download_url: 'https://uploads.example.org/signed?token=never-log',
  ...overrides,
})

async function fixture(t, download = async () => pdf) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-file-intake-v1-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  const intake = createMcpFileIntakeService({
    store, allowedHosts: ['uploads.example.org'], download,
  })
  return { store, intake }
}

test('File URL SSRF protections are host-exact and block arbitrary URLs', () => {
  assert.deepEqual(permittedFileHosts('uploads.example.org, uploads.example.org,127.0.0.1,localhost'),
    ['uploads.example.org'])
  assert.equal(validateMcpFileUrl(fakeFile().download_url, ['uploads.example.org']).hostname, 'uploads.example.org')
  for (const url of [
    'http://uploads.example.org/a', 'https://uploads.example.org:8443/a',
    'https://127.0.0.1/a', 'https://169.254.169.254/a',
    'https://uploads.example.org.evil.test/a',
    'https://user:pass@uploads.example.org/a',
    'https://uploads.example.org/a#fragment', 'file:///etc/passwd',
  ]) assert.throws(() => validateMcpFileUrl(url, ['uploads.example.org']))
  assert.throws(() => validateMcpFileUrl(fakeFile().download_url, []), /not explicitly allowlisted/)
})

test('content sniffing recognizes supported files and rejects extension tricks', () => {
  const valid = validateMcpFileBytes(fakeFile(), pdf)
  assert.equal(valid.mimeType, 'application/pdf')
  assert.equal(valid.filename, 'reading.pdf')
  assert.equal(validateMcpFileBytes(fakeFile({ file_name: undefined }), pdf).filename, 'file_fixture_001.pdf')
  assert.throws(() => validateMcpFileBytes(fakeFile({ file_name: 'evil.png' }), pdf), /signature/)
  assert.throws(() => validateMcpFileBytes(fakeFile({ file_name: '../evil.exe' }), pdf), /not supported/)
  assert.throws(() => validateMcpFileBytes(fakeFile({ mime_type: 'image/png' }), pdf), /MIME metadata/)
  assert.throws(() => validateMcpFileBytes(fakeFile(), Buffer.alloc(0)), /1 to 25 MiB/)
  assert.throws(() => validateMcpFileBytes(fakeFile(), Buffer.alloc(MAX_MCP_FILE_BYTES + 1)), /1 to 25 MiB/)
  assert.equal(validateMcpFileBytes(fakeFile({ file_name: 'notes.md', mime_type: 'text/plain' }),
    Buffer.from('Hello world')).mimeType, 'text/markdown')
  assert.equal(validateMcpFileBytes(fakeFile({ file_name: 'slide.pptx',
    mime_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }),
    Buffer.from('504b0304', 'hex')).mimeType,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  assert.throws(() => validateMcpFileBytes(fakeFile({ file_name: 'evil.html',
    mime_type: 'text/html' }), Buffer.from('<script>')), /not supported/)
})

test('new file Intake persists original bytes, SHA-256, one item and durable receipt', async (t) => {
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads++; return pdf })
  const args = { requestId: 'intake:new:0001', mode: 'new', title: 'An uploaded paper',
    text: 'Please keep this.', file: fakeFile() }
  const saved = await intake.save(args)
  assert.equal(saved.duplicate, false)
  assert.match(saved.itemId, /^[0-9a-f-]{36}$/iu)
  assert.match(saved.attachmentId, /^[0-9a-f-]{36}$/iu)
  assert.equal(saved.bytes, pdf.length)
  assert.equal(saved.sha256, createHash('sha256').update(pdf).digest('hex'))
  const item = await store.get(saved.itemId)
  assert.equal(item.title, 'An uploaded paper')
  assert.equal(item.text, 'Please keep this.')
  assert.equal(item.attachments.length, 1)
  assert.equal(item.sourceIdentity.provider, 'aqi-mcp-file-intake')
  assert.equal(item.activity.filter((a) => a.type === 'attachment_added').length, 1)
  assert.equal(item.activity.at(-1).actor, 'Aqi')
  const stored = await store.readAttachment(saved.attachmentId, MAX_MCP_FILE_BYTES)
  assert.deepEqual(stored.data, pdf)
  // Retrying after a simulated URL expiry does not download again.
  const retry = await intake.save({ ...args, file: fakeFile({ download_url: 'https://uploads.example.org/expired' }) })
  assert.equal(retry.duplicate, true)
  assert.equal(retry.attachmentId, saved.attachmentId)
  assert.equal(downloads, 1)
  assert.equal((await store.list()).length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
  const disk = await stat(path.join(store.mediaDir, (await readdir(store.mediaDir))[0]))
  assert.equal(disk.size, pdf.length)
})

test('append reuses same PocketStore and leaves title, text, tags, collection untouched', async (t) => {
  const { store, intake } = await fixture(t)
  const existing = await store.upsert({
    title: 'A previous item', text: 'Original body', tags: ['Research'],
    collection: 'Academic',
  })
  const saved = await intake.save({
    requestId: 'intake:append:0001', mode: 'append', itemId: existing.id, file: fakeFile(),
  })
  assert.equal(saved.itemId, existing.id)
  assert.equal((await store.get(existing.id)).attachments.length, 1)
  const updated = await store.get(existing.id)
  assert.equal(updated.title, existing.title)
  assert.equal(updated.text, existing.text)
  assert.deepEqual(updated.tags, existing.tags)
  assert.equal(updated.collection, existing.collection)
  const repeat = await intake.save({
    requestId: 'intake:append:0001', mode: 'append', itemId: existing.id, file: fakeFile(),
  })
  assert.equal(repeat.duplicate, true)
  assert.equal(updated.attachments[0].sha256, saved.sha256)
  assert.equal((await store.get(existing.id)).attachments.length, 1)
})

test('colliding request IDs, unsafe target and invalid file clean staged media', async (t) => {
  const { store, intake } = await fixture(t)
  const saved = await intake.save({
    requestId: 'intake:collision:0001', mode: 'new', file: fakeFile(),
  })
  const beforeMedia = await readdir(store.mediaDir)
  await assert.rejects(() => intake.save({
    requestId: 'intake:collision:0001', mode: 'new', title: 'Different',
    file: fakeFile(),
  }), /already used/)
  await assert.rejects(() => intake.save({
    requestId: 'intake:collision:0001', mode: 'append', itemId: saved.itemId,
    file: fakeFile(),
  }), /already used/)
  await assert.rejects(() => intake.save({
    requestId: 'intake:missing:0002', mode: 'append', itemId: 'not-a-real-item',
    file: fakeFile(),
  }), /target Drawer item not found/)
  assert.deepEqual(await readdir(store.mediaDir), beforeMedia)
  assert.equal((await store.get(saved.itemId)).attachments.length, 1)
  await assert.rejects(() => intake.save({
    requestId: 'intake:wronghost:0003', mode: 'new',
    file: fakeFile({ download_url: 'https://evil.example.org/file' }),
  }), /not explicitly allowlisted/)
  assert.equal((await store.list()).length, 1)
})

test('disallowed file formats do not leave a temporary file or Store object', async (t) => {
  const { store, intake } = await fixture(t, async () => Buffer.from('<html>evil</html>'))
  await assert.rejects(() => intake.save({
    requestId: 'intake:unsupported:0001', mode: 'new',
    file: fakeFile({ file_name: 'script.html', mime_type: 'text/html' }),
  }), /not supported/)
  assert.deepEqual(await readdir(store.mediaDir), [])
  assert.equal((await store.list()).length, 0)
})

test('idempotent retry never binds a different attachment after the original was removed', async (t) => {
  const { store, intake } = await fixture(t)
  const args = { requestId: 'intake:detached:0001', mode: 'new', file: fakeFile() }
  const saved = await intake.save(args)
  await store.removeAttachment(saved.itemId, saved.attachmentId)
  await store.appendAttachments(saved.itemId, [{
    id: randomUUID(), name: 'later.pdf', mimeType: 'application/pdf',
    size: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'),
  }], { requestId: 'unrelated:later:0001', actor: 'EE' })
  await assert.rejects(() => intake.save(args), /no longer attached/)
  assert.equal((await store.get(saved.itemId)).attachments.length, 1)
})
