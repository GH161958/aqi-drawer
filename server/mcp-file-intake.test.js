import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { PassThrough } from 'node:stream'
import { Resolver } from 'node:dns/promises'
import { createMcpFileOperation } from './mcp-file-operation.js'
import { PocketStore } from './store.js'
import {
  MAX_MCP_FILE_BYTES, createMcpFileIntakeService, permittedFileHosts, downloadChatGptFile,
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


test('technical filename aliases are redacted for new and append across full canonical serialization', async (t) => {
  const sentinel = 'AUDIT-TRANSIENT-ID-NOT-TO-PERSIST'
  const compact = sentinel.replaceAll('-', '')
  const aliases = [
    ['direct', sentinel + '.pdf'],
    ['prefix', sentinel + '-paper.pdf'],
    ['middle', 'paper-' + sentinel + '-notes.pdf'],
    ['suffix', 'paper-' + sentinel + '.pdf'],
    ['path', '/tmp/' + sentinel + '/Research.pdf'],
    ['windows path', 'folder\\' + sentinel + '\\Research.pdf'],
    ['separators', sentinel.replaceAll('-', '_').toLowerCase() + '.pdf'],
    ['percent encoding', sentinel.replaceAll('-', '%2D') + '.pdf'],
    ['double encoding', sentinel.replaceAll('-', '%252D') + '.pdf'],
    ['truncated prefix', compact.slice(0, 16) + '-paper.pdf'],
    ['truncated suffix', 'paper-' + compact.slice(-16) + '.pdf'],
    ['unicode compatibility', [...sentinel].map(c => /[A-Z]/u.test(c) ? String.fromCharCode(c.charCodeAt(0) + 0xFEE0) : c).join('') + '.pdf'],
  ]
  const { store, intake } = await fixture(t, undefined, { persistFileId: false })
  const existing = await store.upsert({ title: 'Existing', text: 'Unchanged' })
  for (const [index, [label, file_name]] of aliases.entries()) {
    await t.test(label, async () => {
      const file = fakeFile({ file_id: sentinel, file_name })
      const receipts = []
      for (const mode of ['new', 'append']) {
        const args = { requestId: 'alias:' + index + ':' + mode, mode, file,
          ...(mode === 'append' ? { itemId: existing.id } : {}) }
        receipts.push(await intake.save(args))
        receipts.push(await intake.save(args))
      }
      for (const receipt of receipts) assert.equal(receipt.fileName, 'chatgpt-file.pdf')
      const raw = await readFile(store.filePath, 'utf8')
      const serialized = JSON.stringify([raw, await store.list(), receipts])
      for (const secret of [sentinel, file.download_url, 'never-log', compact.slice(0, 16), compact.slice(-16)]) {
        assert.ok(!serialized.includes(secret), label)
      }
    })
  }
})

test('opaque path-component filename aliases are redacted without modifying explicit content', async (t) => {
  const id = 'urn:chatgpt:asset/7a0f19cc-29b9-4987-a81b-034b945a10d1'
  const { store, intake } = await fixture(t, undefined, { persistFileId: false })
  const receipt = await intake.save({ requestId: 'alias:explicit-content', mode: 'new',
    title: 'My ' + id, text: 'EE explicitly asked to keep ' + id,
    file: fakeFile({ file_id: id, file_name: id.split('/').at(-1) + '.pdf' }),
  })
  const item = await store.get(receipt.itemId)
  assert.equal(receipt.fileName, 'chatgpt-file.pdf')
  assert.equal(item.title, 'My ' + id)
  assert.equal(item.text, 'EE explicitly asked to keep ' + id)
  assert.ok(!JSON.stringify(item.attachments).includes('7a0f19cc'))
})

test('readable supplied filename survives and redaction never bypasses extension MIME or signature checks', async (t) => {
  const sentinel = 'AUDIT-TRANSIENT-ID-NOT-TO-PERSIST'
  const { store, intake } = await fixture(t, async () => Buffer.from('504b0304000000', 'hex'), { persistFileId: false })
  const receipt = await intake.save({ requestId: 'readable:research-docx', mode: 'new',
    file: fakeFile({ file_id: sentinel, file_name: 'Research Notes.docx',
      mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
  })
  assert.equal(receipt.fileName, 'Research Notes.docx')
  assert.equal((await store.get(receipt.itemId)).attachments[0].name, 'Research Notes.docx')
  for (const [file_name, mime_type, bytes, expected] of [
    [sentinel + '.exe', 'application/pdf', pdf, /not supported/],
    [sentinel + '.png', 'application/pdf', pdf, /signature/],
    [sentinel + '.pdf', 'image/png', pdf, /MIME/],
    [sentinel + '.pdf', 'application/pdf', Buffer.from('bad'), /signature/],
  ]) assert.throws(() => validateMcpFileBytes(fakeFile({ file_id: sentinel, file_name, mime_type }), bytes), expected)
})

test('alias filename failure retry and durable completed recovery stay private with one attachment', async (t) => {
  let attempts = 0
  const { store, intake } = await fixture(t, async () => {
    if (++attempts === 1) throw new Error('Transient failure')
    return pdf
  }, { persistFileId: false })
  const file = fakeFile({ file_id: 'AUDIT-TRANSIENT-ID-NOT-TO-PERSIST', file_name: 'AUDIT-TRANSIENT-ID-NOT-TO-PERSIST.pdf' })
  const args = { requestId: 'alias:retry-and-restart', mode: 'new', file }
  await assert.rejects(intake.save(args), /Transient failure/)
  assert.deepEqual(await readdir(store.mediaDir), [])
  const saved = await intake.save(args)
  const reopened = new PocketStore(store.dataDir)
  await reopened.init()
  const restarted = createMcpFileIntakeService({ store: reopened, persistFileId: false,
    download: async () => { throw new Error('Must not download completed replay') },
  })
  const recovered = await restarted.save(args)
  assert.equal(recovered.attachmentId, saved.attachmentId)
  assert.equal(recovered.duplicate, true)
  assert.equal(attempts, 2)
  const serialized = JSON.stringify([saved, recovered, await readFile(store.filePath, 'utf8')])
  for (const secret of [file.file_id, file.download_url, 'never-log']) assert.ok(!serialized.includes(secret))
  assert.equal((await readdir(store.mediaDir)).length, 1)
})

test('absolute deadline detaches a forever-hung custom DNS resolver and blocks its late HTTPS start', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release, requests = 0
  const operation = createMcpFileOperation({ clock: () => 1000, budgetMs: 100 })
  const promise = downloadChatGptFile(fakeFile(), {
    allowedHosts: ['uploads.example.org'], operation,
    resolver: () => new Promise(resolve => { release = resolve }),
    request: () => { requests++; throw new Error('Unexpected HTTPS') },
  })
  const failure = assert.rejects(promise, /expired or cancelled/)
  t.mock.timers.tick(100)
  await failure
  release([{ address: '8.8.8.8', family: 4 }])
  await Promise.resolve()
  assert.equal(requests, 0)
  assert.equal(operation.signal.aborted, true)
})

test('production per-transfer DNS resolver is actually cancelled at the absolute deadline', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let cancels = 0
  t.mock.method(Resolver.prototype, 'resolve4', () => new Promise(() => {}))
  t.mock.method(Resolver.prototype, 'cancel', () => { cancels++ })
  const operation = createMcpFileOperation({ clock: () => 1000, budgetMs: 100 })
  const failure = assert.rejects(downloadChatGptFile(fakeFile(), {
    allowedHosts: ['uploads.example.org'], operation,
  }), /expired or cancelled/)
  t.mock.timers.tick(100)
  await failure
  assert.ok(cancels >= 1)
})

function fakeHttpsRequest(onRequest, response) {
  return (_url, options, onResponse) => {
    const req = new EventEmitter()
    req.destroyed = false
    req.destroy = error => {
      if (req.destroyed) return
      req.destroyed = true
      if (error) req.emit('error', error)
      req.emit('close')
    }
    onRequest({ req, options })
    if (response) queueMicrotask(() => onResponse(response))
    return req
  }
}

test('absolute deadline destroys an HTTPS connection that never reaches a response', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const operation = createMcpFileOperation({ clock: () => 1000, budgetMs: 100 })
  const failure = assert.rejects(downloadChatGptFile(fakeFile(), {
    allowedHosts: ['uploads.example.org'], operation,
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    request: fakeHttpsRequest(entered),
  }), /expired or cancelled/)
  const { req, options } = await started
  assert.equal(options.signal, operation.signal)
  let pinned
  options.lookup('uploads.example.org', {}, (_error, address) => { pinned = address })
  assert.equal(pinned, '8.8.8.8')
  t.mock.timers.tick(100)
  await failure
  assert.equal(req.destroyed, true)
})

test('continuous response trickle cannot renew deadline and its response stream is destroyed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const res = new PassThrough()
  res.statusCode = 200
  res.headers = {}
  const operation = createMcpFileOperation({ clock: () => 1000, budgetMs: 100 })
  const failure = assert.rejects(downloadChatGptFile(fakeFile(), {
    allowedHosts: ['uploads.example.org'], operation,
    resolver: async () => [{ address: '8.8.8.8', family: 4 }],
    request: fakeHttpsRequest(entered, res),
  }), /expired or cancelled/)
  const { req } = await started
  await Promise.resolve()
  for (let i = 0; i < 9; i++) {
    res.write(Buffer.from('x')) // Activity every 10 ms, never socket-idle.
    t.mock.timers.tick(10)
    await Promise.resolve()
  }
  assert.equal(operation.signal.aborted, false)
  t.mock.timers.tick(10)
  await failure
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(req.destroyed, true)
  assert.equal(res.destroyed, true)
})

test('V1 owns a full-operation deadline even with an uncooperative injected downloader', async (t) => {
  let enter, release
  const started = new Promise(resolve => { enter = resolve })
  const late = new Promise(resolve => { release = resolve })
  const { store, intake } = await fixture(t, (_file, { signal }) => { enter(signal); return late }, { persistFileId: false })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const before = await readFile(store.filePath, 'utf8')
  const failure = assert.rejects(intake.save({ requestId: 'v1:deadline:standalone', mode: 'new', file: fakeFile() }), /expired or cancelled/)
  const signal = await started
  t.mock.timers.tick(60_000)
  await failure
  assert.equal(signal.aborted, true)
  release(pdf)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await readFile(store.filePath, 'utf8'), before)
  assert.deepEqual(await readdir(store.mediaDir), [])
})

test('bounded downloader retains successful byte transfer DNS rejection redirect and size guards', async (t) => {
  for (const scenario of ['success', 'mixed private DNS', 'redirect', 'content length', 'stream size']) {
    await t.test(scenario, async () => {
      const operation = createMcpFileOperation()
      t.after(() => { operation.cancel(); operation.dispose() })
      const res = new PassThrough()
      res.statusCode = scenario === 'redirect' ? 302 : 200
      res.headers = scenario === 'content length' ? { 'content-length': MAX_MCP_FILE_BYTES + 1 } : {}
      let requests = 0
      const request = fakeHttpsRequest(() => {
        requests++
        queueMicrotask(() => res.end(scenario === 'stream size' ? Buffer.alloc(MAX_MCP_FILE_BYTES + 1) : pdf))
      }, res)
      const promise = downloadChatGptFile(fakeFile(), {
        allowedHosts: ['uploads.example.org'], operation, request,
        resolver: async () => scenario === 'mixed private DNS'
          ? [{ address: '8.8.8.8' }, { address: '127.0.0.1' }] : [{ address: '8.8.8.8' }],
      })
      if (scenario === 'success') assert.deepEqual(await promise, pdf)
      else await assert.rejects(promise, scenario === 'mixed private DNS' ? /public IPv4/ : /redirected|size limit|25 MiB/)
      assert.equal(requests, scenario === 'mixed private DNS' ? 0 : 1)
    })
  }
})

test('opaque punctuation-only IDs and full signed URLs cannot hide in supplied filenames', () => {
  for (const id of ['---', '🔑', '%%%']) {
    assert.equal(validateMcpFileBytes(fakeFile({ file_id: id, file_name: id + '.pdf' }), pdf).filename, 'chatgpt-file.pdf')
  }
  const file = fakeFile()
  file.file_name = file.download_url + '.pdf'
  assert.equal(validateMcpFileBytes(file, pdf).filename, 'chatgpt-file.pdf')
  assert.throws(() => validateMcpFileBytes(fakeFile({ file_name: 'x'.repeat(4097) + '.pdf' }), pdf), /too long/)
})


test('monotonic deadline survives wall-clock rollback and publication authority is single-use', (t) => {
  let elapsed = 0, now = 1000
  t.mock.method(performance, 'now', () => elapsed)
  const operation = createMcpFileOperation({ clock: () => now, budgetMs: 100 })
  t.after(() => operation.dispose())
  now -= 500
  elapsed = 100
  assert.throws(() => operation.check(), /expired or cancelled/)
  let writes = 0
  assert.throws(() => operation.publish(() => writes++), /expired or cancelled/)
  const live = createMcpFileOperation({ clock: () => now, budgetMs: 100 })
  t.after(() => live.dispose())
  live.publish(() => writes++)
  assert.throws(() => live.publish(() => writes++), /already committed/)
  assert.equal(writes, 1)
})
