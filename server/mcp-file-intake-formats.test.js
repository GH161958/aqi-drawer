import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PocketStore } from './store.js'
import { createMcpFileIntakeService } from './mcp-file-intake.js'
import { startBridge } from './index.js'

// All fixtures are disposable 1x1 real encoded images or short UTF-8 text.
// No real ChatGPT file is downloaded or any Tokyo Store accessed.
const fixtureCases = [
  {
    name: 'one-pixel.png', mimeType: 'image/png',
    bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoypsGAAL8AYfKfBGAAAAAAElFTkSuQmCC', 'base64'),
  },
  {
    name: 'one-pixel.jpg', mimeType: 'image/jpeg',
    bytes: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJqaopaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCCiiiu82P/2Q==', 'base64'),
  },
  {
    name: 'one-pixel.webp', mimeType: 'image/webp',
    bytes: Buffer.from('UklGRi4AAABXRUJQVlA4ICIAAABQAQCdASoBAAEAAUAmJQBOgDEIAP7aJvi7sRxk7rJ3iAAA', 'base64'),
  },
  {
    name: 'one-pixel.gif', mimeType: 'image/gif',
    bytes: Buffer.from('R0lGODdhAQABAIEAAIJulgAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==', 'base64'),
  },
  { name: 'project-notes.md', mimeType: 'text/markdown', bytes: Buffer.from('# 项目灵感\n\n来看看这个 repo 🐆\n', 'utf8') },
  { name: 'design-reference.txt', mimeType: 'text/plain', bytes: Buffer.from('Keep the original; notes are derivatives.\n', 'utf8') },
  { name: 'source.json', mimeType: 'application/json', bytes: Buffer.from('{"source":"disposable fixture"}\n') },
]
const host = 'uploads.example.org'
const mockFile = (fixture, id) => ({
  download_url: 'https://' + host + '/signed/disposable?no-real-secret=1',
  file_id: 'disposable-' + id,
  file_name: fixture.name,
  mime_type: fixture.mimeType,
})
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const freshStore = async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-file-formats-'))
  t.after(async () => rm(dir, { recursive: true, force: true }))
  const store = new PocketStore(dir)
  await store.init()
  return store
}

test('PNG/JPEG/WebP/GIF/Markdown/TXT/JSON Intake persists exact original bytes and stable receipts', async t => {
  const store = await freshStore(t)
  let downloadCount = 0
  let downloaded
  const intake = createMcpFileIntakeService({
    store, allowedHosts: [host],
    download: async () => { downloadCount += 1; return downloaded },
  })
  for (const [i, fixture] of fixtureCases.entries()) {
    downloaded = fixture.bytes
    const request = {
      requestId: 'intake-formats-disposable-' + (i + 1),
      mode: 'new',
      title: 'One deliberately retained reference ' + i,
      text: 'Disposable fixture, not production source.',
      file: mockFile(fixture, i),
    }
    const receipt = await intake.save(request)
    assert.equal(receipt.duplicate, false)
    assert.equal(receipt.fileName, fixture.name)
    assert.equal(receipt.mimeType, fixture.mimeType)
    assert.equal(receipt.bytes, fixture.bytes.length)
    assert.equal(receipt.sha256, sha256(fixture.bytes))
    const item = await store.get(receipt.itemId)
    assert.equal(item.attachments.length, 1)
    assert.equal(item.attachments[0].id, receipt.attachmentId)
    assert.equal(item.attachments[0].sha256, receipt.sha256)
    const found = await store.readItemAttachment(receipt.itemId, receipt.attachmentId)
    assert.deepEqual(found.data, fixture.bytes)
    const duplicated = await intake.save(request)
    assert.equal(duplicated.duplicate, true)
    assert.equal(duplicated.itemId, receipt.itemId)
    assert.equal(duplicated.attachmentId, receipt.attachmentId)
  }
  assert.equal(downloadCount, fixtureCases.length)
  assert.equal((await store.list()).length, fixtureCases.length)
  assert.equal((await readdir(store.mediaDir)).length, fixtureCases.length)
})

test('unsupported/mismatched/invalid images or text never create an orphan item or media file', async t => {
  const store = await freshStore(t)
  let downloaded
  const intake = createMcpFileIntakeService({
    store, allowedHosts: [host], download: async () => downloaded,
  })
  const scenarios = [
    { name: 'bad.png', mimeType: 'image/png', bytes: Buffer.from('not a png') },
    { name: 'not-jpeg.jpg', mimeType: 'image/jpeg', bytes: fixtureCases[0].bytes },
    { name: 'spoofed.png', mimeType: 'text/plain', bytes: fixtureCases[0].bytes },
    { name: 'bad.txt', mimeType: 'text/plain', bytes: Buffer.from([0xff, 0xfe]) },
    { name: 'binary.md', mimeType: 'text/markdown', bytes: Buffer.from([0x00, 0x61]) },
    { name: 'invalid.json', mimeType: 'application/json', bytes: Buffer.from('{broken') },
    { name: 'unsafe.svg', mimeType: 'image/svg+xml', bytes: Buffer.from('<svg />') },
  ]
  for (const [i, fixture] of scenarios.entries()) {
    downloaded = fixture.bytes
    await assert.rejects(() => intake.save({
      requestId: 'intake-invalid-disposable-' + (i + 1),
      mode: 'new', title: 'Unwanted invalid file',
      file: mockFile(fixture, 'invalid-' + i),
    }))
    assert.equal((await store.list()).length, 0)
    assert.deepEqual(await readdir(store.mediaDir), [])
  }
})

test('real isolated Owner MCP returns a PNG original image, then a Markdown original readable by attachment tool', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-file-mcp-formats-'))
  let bridge
  let client
  t.after(async () => {
    await Promise.allSettled([client?.close(), bridge?.stop()])
    await rm(dir, { recursive: true, force: true })
  })
  let selected = fixtureCases[0]
  const mcpPath = '/mcp/' + randomBytes(32).toString('base64url')
  bridge = await startBridge({
    dataDir: dir, port: 0, host: '127.0.0.1', mcpPath,
    enableOwnerInPlace: true, enableMcpCapture: true,
    enableUnifiedOwner: true, enableLegacyMcp: true,
    enableMcpFileIntake: true, enableMcpFileHostProbe: false,
    mcpFileHosts: [host],
    mcpFileDownloader: async () => selected.bytes,
  })
  client = new Client({ name: 'disposable-formats-mcp', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(
    new URL('http://127.0.0.1:' + bridge.address.port + mcpPath),
  ))
  const names = (await client.listTools()).tools
  const intakeTool = names.find(x => x.name === 'pocket_file_intake')
  assert.ok(intakeTool)
  assert.deepEqual(intakeTool._meta?.['openai/fileParams'], ['file'])
  assert.equal(names.filter(x => x.name === 'pocket_file_intake').length, 1)
  const fixture = selected
  const png = await client.callTool({
    name: 'pocket_file_intake',
    arguments: {
      request_id: 'mcp-file-image-disposable-0001',
      mode: 'new', title: 'Generated art fixture',
      text: 'One safe sample original.',
      file: mockFile(fixture, 'mcp-png'),
    },
  })
  assert.equal(png.isError, undefined, JSON.stringify(png))
  const pngReceipt = png.structuredContent
  assert.equal(pngReceipt.sha256, sha256(fixture.bytes))
  const gotten = await client.callTool({
    name: 'pocket_get', arguments: { id: pngReceipt.itemId },
  })
  assert.equal(gotten.structuredContent.item.attachments.length, 1)
  const image = gotten.content.find(x => x.type === 'image')
  assert.ok(image, 'The saved PNG is returned as the same stored image, not only a filename.')
  assert.equal(image.mimeType, fixture.mimeType)
  assert.deepEqual(Buffer.from(image.data, 'base64'), fixture.bytes)
  const before = await bridge.store.get(pngReceipt.itemId)

  selected = fixtureCases.find(x => x.name === 'project-notes.md')
  const md = await client.callTool({
    name: 'pocket_file_intake',
    arguments: {
      request_id: 'mcp-file-image-disposable-0002',
      mode: 'append', item_id: pngReceipt.itemId,
      file: mockFile(selected, 'mcp-md'),
    },
  })
  assert.equal(md.isError, undefined, JSON.stringify(md))
  assert.equal(md.structuredContent.itemId, pngReceipt.itemId)
  const saved = await bridge.store.get(pngReceipt.itemId)
  assert.equal(saved.title, before.title)
  assert.equal(saved.text, before.text)
  assert.equal(saved.attachments.length, 2)
  const read = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: {
      item_id: pngReceipt.itemId, attachment_id: md.structuredContent.attachmentId,
    },
  })
  assert.equal(read.isError, undefined, JSON.stringify(read))
  assert.equal(read.structuredContent.text, selected.bytes.toString('utf8'))
  assert.equal(read.structuredContent.sha256, sha256(selected.bytes))
  assert.deepEqual(
    (await bridge.store.readItemAttachment(pngReceipt.itemId, pngReceipt.attachmentId)).data,
    fixture.bytes,
  )
})

test('default-off Owner never exposes file Intake unless independently enabled', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'drawer-file-default-off-'))
  let bridge
  let client
  t.after(async () => {
    await Promise.allSettled([client?.close(), bridge?.stop()])
    await rm(dir, { recursive: true, force: true })
  })
  const mcpPath = '/mcp/' + randomBytes(32).toString('base64url')
  bridge = await startBridge({
    dataDir: dir, port: 0, host: '127.0.0.1', mcpPath,
    enableOwnerInPlace: true, enableMcpCapture: true,
    enableUnifiedOwner: true, enableLegacyMcp: true,
    enableMcpFileIntake: false, enableMcpFileHostProbe: false,
  })
  client = new Client({ name: 'disposable-default-off', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(
    new URL('http://127.0.0.1:' + bridge.address.port + mcpPath),
  ))
  const names = (await client.listTools()).tools.map(x => x.name)
  assert.equal(names.includes('pocket_file_intake'), false)
  assert.equal(names.includes('pocket_attachment_read'), true)
  assert.equal((await bridge.store.list()).length, 0)
})
