import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PocketStore } from './store.js'
import {
  MAX_MCP_FILE_BYTES, createMcpFileIntakeService, permittedFileHosts,
  validateMcpFileUrl, validateMcpFileBytes, validChatGptFileId,
} from './mcp-file-intake.js'

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const fakeFile = (overrides = {}) => ({
  file_id: 'file_fixture_001', file_name: 'reading.pdf', mime_type: 'application/pdf',
  download_url: 'https://uploads.example.org/signed?token=never-log',
  ...overrides,
})

async function fixture(t, download = async () => pdf, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-file-intake-v1-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  const intake = createMcpFileIntakeService({
    store, allowedHosts: ['uploads.example.org'], download, ...options,
  })
  return { store, intake }
}

test('fileParams accepts bounded opaque identifiers without a file_ prefix and remains idempotent', async (t) => {
  const opaqueId = 'urn:chatgpt:asset/opaque-qa-001'
  assert.equal(validChatGptFileId(opaqueId), true)
  assert.equal(validChatGptFileId('7a0f19cc-29b9-4987-a81b-034b945a10d1'), true)
  assert.equal(validateMcpFileBytes(fakeFile({ file_id: opaqueId }), pdf).mimeType, 'application/pdf')
  const { store, intake } = await fixture(t)
  const file = fakeFile({ file_id: opaqueId, file_name: undefined })
  const args = { requestId: 'intake:opaque-id:0001', mode: 'new', file }
  const receipt = await intake.save(args)
  assert.equal(receipt.duplicate, false)
  assert.equal(receipt.bytes, pdf.length)
  assert.equal(receipt.sha256, createHash('sha256').update(pdf).digest('hex'))
  assert.deepEqual((await store.readAttachment(receipt.attachmentId, MAX_MCP_FILE_BYTES)).data, pdf)
  const retry = await intake.save({
    ...args,
    file: { ...file, download_url: 'https://uploads.example.org/expired' },
  })
  assert.equal(retry.duplicate, true)
  assert.equal(retry.attachmentId, receipt.attachmentId)
  assert.equal((await store.list()).length, 1)
})

test('invalid opaque identifiers fail closed before network requests or Store writes', async (t) => {
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads += 1; return pdf })
  const invalid = [undefined, null, '', '  ', '\n', 'bad\u0000id', 'bad\u007fid', 'x'.repeat(513), 123]
  for (const fileId of invalid) {
    assert.equal(validChatGptFileId(fileId), false)
    assert.throws(() => validateMcpFileBytes(fakeFile({ file_id: fileId }), pdf), /valid ChatGPT file_id/)
    await assert.rejects(() => intake.save({
      requestId: 'intake:invalid-id:0001',
      mode: 'new',
      file: fakeFile({ file_id: fileId }),
    }), /valid ChatGPT file_id/)
  }
  assert.equal(downloads, 0)
  assert.equal((await store.list()).length, 0)
  assert.deepEqual(await readdir(store.mediaDir), [])
})

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
  assert.equal(validateMcpFileBytes(fakeFile({ file_name: undefined }), pdf).filename, 'chatgpt-file.pdf')
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
  // Replaying the exact original parameters needs no live source URL.
  const retry = await intake.save(args)
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

test('refreshed ChatGPT file_id is a verified duplicate only for identical original PDF bytes', async (t) => {
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads++; return pdf })
  const args = {
    requestId: 'intake:refreshed-id:0001', mode: 'new',
    title: 'Original title', text: 'Original notes', file: fakeFile(),
  }
  const saved = await intake.save(args)
  const duplicate = await intake.save({
    ...args,
    file: fakeFile({
      file_id: 'opaque-refreshed-asset-999',
      file_name: 'another-host-name.pdf',
      download_url: 'https://uploads.example.org/new-signed-url',
    }),
  })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.itemId, saved.itemId)
  assert.equal(duplicate.attachmentId, saved.attachmentId)
  assert.equal(duplicate.sha256, saved.sha256)
  assert.equal(downloads, 2)
  const item = await store.get(saved.itemId)
  assert.equal(item.title, 'Original title')
  assert.equal(item.text, 'Original notes')
  assert.equal(item.sourceData.openaiFileId, args.file.file_id)
  assert.equal(item.attachments.length, 1)
  assert.equal(item.activity.filter((a) => a.type === 'attachment_added').length, 1)
  assert.equal((await store.list()).length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
  assert.deepEqual((await store.readAttachment(saved.attachmentId, MAX_MCP_FILE_BYTES)).data, pdf)
})

test('refreshed file_id append retry verifies bytes without replacing item metadata', async (t) => {
  const { store, intake } = await fixture(t)
  const original = await store.upsert({
    title: 'Keep original', text: 'Unchanged notes', tags: ['Research'], collection: 'Academic',
  })
  const args = {
    requestId: 'intake:refreshed-append:0001', mode: 'append',
    itemId: original.id, file: fakeFile(),
  }
  const saved = await intake.save(args)
  const duplicate = await intake.save({
    ...args,
    file: fakeFile({ file_id: 'opaque-new-append-asset' }),
  })
  assert.equal(duplicate.duplicate, true)
  assert.equal(duplicate.attachmentId, saved.attachmentId)
  const item = await store.get(original.id)
  assert.equal(item.title, original.title)
  assert.equal(item.text, original.text)
  assert.deepEqual(item.tags, original.tags)
  assert.equal(item.collection, original.collection)
  assert.equal(item.attachments.length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
})

test('changed file_id with different bytes or original intent stays a conflict with no extra media', async (t) => {
  let downloaded = pdf
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads++; return downloaded })
  const args = {
    requestId: 'intake:refreshed-conflict:0001', mode: 'new',
    title: 'Original title', text: 'Original notes', file: fakeFile(),
  }
  const saved = await intake.save(args)
  const freshFile = fakeFile({ file_id: 'opaque-other-file' })
  downloaded = Buffer.concat([pdf, Buffer.from('different bytes')])
  await assert.rejects(() => intake.save({ ...args, file: freshFile }), /already used/)
  downloaded = pdf
  await assert.rejects(() => intake.save({
    ...args, title: 'Changed title', file: freshFile,
  }), /already used/)
  await assert.rejects(() => intake.save({
    ...args, text: 'Changed notes', file: freshFile,
  }), /already used/)
  await assert.rejects(() => intake.save({
    ...args, mode: 'append', itemId: saved.itemId, title: '', text: '', file: freshFile,
  }), /already used/)
  assert.equal(downloads, 2) // Intent conflicts fail before outbound verification.
  assert.equal((await store.list()).length, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
  const item = await store.get(saved.itemId)
  assert.equal(item.attachments.length, 1)
  assert.equal(item.attachments[0].sha256, saved.sha256)
  assert.deepEqual((await store.readAttachment(saved.attachmentId, MAX_MCP_FILE_BYTES)).data, pdf)
})

test('refreshed retry still rejects unapproved hosts before bytes leave the server', async (t) => {
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads++; return pdf })
  const args = { requestId: 'intake:refreshed-host:0001', mode: 'new', file: fakeFile() }
  const saved = await intake.save(args)
  await assert.rejects(() => intake.save({
    ...args,
    file: fakeFile({
      file_id: 'fresh-new-id',
      download_url: 'https://another.example.org/signed',
    }),
  }), /not explicitly allowlisted/)
  assert.equal(downloads, 1)
  assert.equal((await readdir(store.mediaDir)).length, 1)
  assert.equal((await store.get(saved.itemId)).attachments.length, 1)
})

test('refreshed retry refuses missing or replaced original attachment', async (t) => {
  const { store, intake } = await fixture(t)
  const args = { requestId: 'intake:refreshed-detached:0001', mode: 'new', file: fakeFile() }
  const saved = await intake.save(args)
  await store.removeAttachment(saved.itemId, saved.attachmentId)
  await store.appendAttachments(saved.itemId, [{
    id: randomUUID(), name: 'replacement.pdf', mimeType: 'application/pdf',
    size: pdf.length, sha256: createHash('sha256').update(pdf).digest('hex'),
  }], { requestId: 'later-unrelated:0001', actor: 'EE' })
  await assert.rejects(() => intake.save({
    ...args,
    file: fakeFile({ file_id: 'fresh-after-removal' }),
  }), /no longer attached/)
  const item = await store.get(saved.itemId)
  assert.equal(item.attachments.length, 1)
  assert.notEqual(item.attachments[0].id, saved.attachmentId)
  assert.deepEqual(await readdir(store.mediaDir), [])
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

test('missing names never persist transient file IDs or signed URLs anywhere in new or append receipts', async (t) => {
  const { store, intake } = await fixture(t, undefined, { persistFileId: false })
  const file = fakeFile({ file_name: undefined, file_id: 'PRIVATE-OPAQUE-TRANSIENT-0001' })
  const saved = await intake.save({ requestId: 'privacy:no-name:new', mode: 'new', file })
  const appended = await intake.save({ requestId: 'privacy:no-name:append', mode: 'append', itemId: saved.itemId, file })
  const item = await store.get(saved.itemId)
  const serialized = JSON.stringify([item, saved, appended, await readFile(store.filePath, 'utf8')])
  for (const secret of [file.file_id, file.download_url, 'never-log']) assert.ok(!serialized.includes(secret))
  for (const receipt of [saved, appended]) {
    assert.equal(receipt.fileName, 'chatgpt-file.pdf')
    assert.equal(receipt.mimeType, 'application/pdf')
    assert.equal(receipt.bytes, pdf.length)
    assert.deepEqual((await store.readAttachment(receipt.attachmentId)).data, pdf)
  }
  const readable = fakeFile({ file_name: '伊伊的论文 2026.pdf' })
  assert.equal((await intake.save({ requestId: 'privacy:readable-name', mode: 'new', file: readable })).fileName, readable.file_name)
  assert.equal(validateMcpFileBytes({ file_id: file.file_id }, pdf).filename, 'chatgpt-file.pdf')
})

test('a new URL with the SAME opaque ID requires actual bytes, never a request-ID-only success', async (t) => {
  let bytes = pdf
  let unavailable = false
  let downloads = 0
  const { store, intake } = await fixture(t, async () => {
    downloads++
    if (unavailable) throw new Error('Source URL expired')
    return bytes
  })
  const args = { requestId: 'strict:url-replay:0001', mode: 'new', file: fakeFile() }
  const saved = await intake.save(args)
  unavailable = true
  assert.equal((await intake.save(args)).attachmentId, saved.attachmentId)
  assert.equal(downloads, 1)
  const changed = { ...args, file: fakeFile({ download_url: 'https://uploads.example.org/refreshed' }) }
  assert.deepEqual(await intake.replay(changed), { receipt: null, verificationRequired: true })
  assert.equal(downloads, 1)
  await assert.rejects(intake.save(changed), /expired/)
  unavailable = false
  bytes = Buffer.concat([pdf, Buffer.from('DIFFERENT')])
  await assert.rejects(intake.save(changed), /already used/)
  bytes = pdf
  const retry = await intake.save(changed)
  assert.equal(retry.duplicate, true)
  assert.equal(retry.attachmentId, saved.attachmentId)
  assert.equal(downloads, 4)
  assert.equal((await readdir(store.mediaDir)).length, 1)
  assert.equal((await store.list()).length, 1)
})

test('legacy durable fingerprints recover only after byte verification without rewriting canonical identity', async (t) => {
  let downloads = 0
  const { store, intake } = await fixture(t, async () => { downloads++; return pdf }, { persistFileId: false })
  const args = { requestId: 'legacy:recovery:0001', mode: 'new', title: 'Legacy PDF', file: fakeFile() }
  const saved = await intake.save(args)
  const state = JSON.parse(await readFile(store.filePath, 'utf8'))
  const legacyHash = createHash('sha256').update(JSON.stringify([
    'new', '', args.title, '', args.file.file_id, args.file.file_name, args.file.mime_type,
  ])).digest('hex')
  state.items[0].sourceData.fileIntakeRequestHash = legacyHash
  state.items[0].activity.find(a => a.type === 'attachment_added').detail.fileIntakeRequestHash = legacyHash
  await writeFile(store.filePath, JSON.stringify(state))
  const before = await readFile(store.filePath, 'utf8')
  assert.equal((await intake.replay(args)).verificationRequired, true)
  assert.equal(downloads, 1)
  const recovered = await intake.save(args)
  assert.equal(recovered.attachmentId, saved.attachmentId)
  assert.equal(recovered.duplicate, true)
  assert.equal(downloads, 2)
  assert.equal(await readFile(store.filePath, 'utf8'), before)
})

test('read-only replay refuses removed, corrupt or concurrently changed attachments', async (t) => {
  const { store, intake } = await fixture(t)
  const args = { requestId: 'replay:corruption:0001', mode: 'new', file: fakeFile() }
  const saved = await intake.save(args)
  const readAttachment = store.readAttachment.bind(store)
  store.readAttachment = async () => ({ data: Buffer.from('corrupt') })
  await assert.rejects(intake.replay(args), /missing or corrupted/)
  store.readAttachment = async (...values) => {
    const result = await readAttachment(...values)
    await store.removeAttachment(saved.itemId, saved.attachmentId)
    return result
  }
  await assert.rejects(intake.replay(args), /no longer attached/)
})
