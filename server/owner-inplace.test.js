import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createBridgeApp, startBridge } from './index.js'

const privatePath = () => '/mcp/' + randomBytes(32).toString('base64url')
const inPlaceFlags = {
  enableOwnerInPlace: true,
  enableMcpCapture: true,
  enableUnifiedOwner: true,
  enableLegacyMcp: true,
  enableMcpFileHostProbe: false,
  enableMcpFileIntake: false,
}
const secretNames = ['C_POCKET_MCP_PATH', 'C_POCKET_MCP_CAPTURE_PATH']
const connect = async (base, mcpPath) => {
  const client = new Client({ name: 'owner-in-place-test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(base + mcpPath)))
  return client
}

test('in-place Owner requires explicit safe flags and the existing private path, never a second route', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-config-'))
  t.after(async () => rm(dataDir, { recursive: true, force: true }))
  const mcpPath = privatePath()
  for (const changes of [
    { enableMcpCapture: false },
    { enableUnifiedOwner: false },
    { enableLegacyMcp: false },
    { captureMcpPath: privatePath() },
    { mcpPath: '/mcp' },
    { mcpPath: '/mcp/too-short' },
    { temporaryPublicMcp: true },
  ]) {
    await assert.rejects(createBridgeApp({
      dataDir, mcpPath, ...inPlaceFlags, ...changes,
    }))
  }
  await assert.rejects(createBridgeApp({
    dataDir, mcpPath,
    enableMcpCapture: true, enableUnifiedOwner: true,
    enableOwnerInPlace: false, captureMcpPath: '',
  }), /C_POCKET_MCP_CAPTURE_PATH is required/)
  // Shared unknown environment flags do not implicitly expose Owner.
  const plain = await createBridgeApp({ dataDir, mcpPath })
  await plain.close()
})

test('same private URL upgrades in place to Owner, preserves reads, bounded writes and exact routing', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-owner-'))
  const mcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1', mcpPath, ...inPlaceFlags,
  })
  const base = 'http://127.0.0.1:' + bridge.address.port
  const client = await connect(base, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const tools = (await client.listTools()).tools.map(x => x.name)
  for (const required of [
    'pocket_get', 'pocket_list', 'pocket_search', 'pocket_taxonomy',
    'pocket_start_context', 'pocket_read_content', 'pocket_attachment_read', 'pocket_reply',
    'pocket_review', 'memory_turn_pre', 'memory_turn_post',
    'vault_read', 'vault_update', 'pocket_capture_create',
    'pocket_organize_existing', 'pocket_organize_undo',
  ]) assert.ok(tools.includes(required), required + ' missing on same URL')
  for (const absent of ['pocket_edit_metadata', 'pocket_file_host_probe', 'pocket_file_intake']) {
    assert.ok(!tools.includes(absent), absent + ' should be excluded')
  }
  assert.equal(tools.filter(x => x === 'pocket_capture_create').length, 1)
  const health = await fetch(base + '/health')
  assert.equal(health.status, 200)
  const config = await fetch(base + '/local/config').then(x => x.json())
  assert.equal(config.mcpPath, mcpPath)
  assert.ok(!JSON.stringify(config).includes('C_POCKET_ENABLE_OWNER_IN_PLACE'))
  for (const key of secretNames) assert.ok(!JSON.stringify(config).includes(key))

  // A second writer endpoint does not exist and isn't silently mounted.
  assert.equal((await fetch(base + privatePath(), { method: 'GET' })).status, 404)

  const created = await client.callTool({
    name: 'pocket_capture_create',
    arguments: {
      request_id: 'inplace:capture:00001', title: 'One retained URL test',
      text: 'Disposable Owner-only fixture, not production',
    },
  })
  assert.equal(created.isError, undefined)
  assert.equal(created.structuredContent.duplicate, false)
  const itemId = created.structuredContent.id
  const retry = await client.callTool({
    name: 'pocket_capture_create',
    arguments: {
      request_id: 'inplace:capture:00001', title: 'One retained URL test',
      text: 'Disposable Owner-only fixture, not production',
    },
  })
  assert.equal(retry.structuredContent.duplicate, true)
  assert.equal((await bridge.store.list()).length, 1)
  const get = await client.callTool({ name: 'pocket_get', arguments: { id: itemId } })
  assert.equal(get.structuredContent.item.id, itemId)
  const list = await client.callTool({ name: 'pocket_search', arguments: { query: 'retained URL' } })
  assert.equal(list.structuredContent.matches[0].id, itemId)

  const revision = (await bridge.store.get(itemId)).updatedAt
  const denied = await client.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: itemId, request_id: 'inplace:organize:00001',
      expected_updated_at: revision, tags_add: ['Unapproved taxonomy'],
    },
  })
  assert.equal(denied.isError, true)
  assert.deepEqual(await bridge.store.listTags(), [])
  await bridge.store.createTag('Research')
  const changed = await client.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: itemId, request_id: 'inplace:organize:00002',
      expected_updated_at: revision, tags_add: ['research'],
    },
  })
  assert.equal(changed.isError, undefined)
  assert.deepEqual(changed.structuredContent.tagsAdded, ['Research'])
  const undo = await client.callTool({
    name: 'pocket_organize_undo',
    arguments: {
      id: itemId, operation_id: changed.structuredContent.operationId,
      request_id: 'inplace:undo:00001',
    },
  })
  assert.equal(undo.isError, undefined)
  assert.deepEqual((await bridge.store.get(itemId)).tags, [])
})

test('default-off rollout and rollback restore standard MCP tools on exact URL without changing Store', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-rollback-'))
  const mcpPath = privatePath()
  t.after(async () => rm(dataDir, { recursive: true, force: true }))
  const first = await startBridge({
    dataDir, port: 0, host: '127.0.0.1', mcpPath,
    ...inPlaceFlags,
  })
  const owner = await connect('http://127.0.0.1:' + first.address.port, mcpPath)
  let itemId
  try {
    const created = await owner.callTool({
      name: 'pocket_capture_create',
      arguments: {
        request_id: 'inplace:rollback:0001', title: 'Rollback fixture',
        text: 'Preserve exactly across route downgrade',
      },
    })
    assert.equal(created.isError, undefined)
    itemId = created.structuredContent.id
  } finally {
    await Promise.allSettled([owner.close(), first.stop()])
  }

  const normal = await startBridge({
    dataDir, port: 0, host: '127.0.0.1', mcpPath,
    // Flags explicitly OFF, as in a true rollback or dormant deployment.
    enableOwnerInPlace: false,
    enableMcpCapture: false,
    enableUnifiedOwner: false,
  })
  const client = await connect('http://127.0.0.1:' + normal.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), normal.stop()])
  })
  const tools = (await client.listTools()).tools.map(x => x.name)
  assert.ok(tools.includes('pocket_edit_metadata'))
  assert.ok(!tools.includes('pocket_organize_existing'))
  assert.ok(!tools.includes('pocket_organize_undo'))
  assert.ok(!tools.includes('pocket_attachment_read'))
  const denied = await client.callTool({
    name: 'pocket_capture_create',
    arguments: {
      request_id: 'inplace:rollback:0002', text: 'Should never write',
    },
  })
  assert.equal(denied.isError, true)
  assert.equal((await normal.store.list()).length, 1)
  assert.equal((await normal.store.get(itemId)).text, 'Preserve exactly across route downgrade')
})

test('in-place Owner can expose fileParams only behind independent flags', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-file-'))
  const mcpPath = privatePath()
  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n')
  let downloads = 0
  const bridge = await startBridge({
    dataDir, mcpPath, port: 0, host: '127.0.0.1',
    ...inPlaceFlags,
    enableMcpFileHostProbe: true,
    enableMcpFileIntake: true,
    mcpFileHosts: ['uploads.example.org'],
    mcpFileDownloader: async () => { downloads++; return bytes },
  })
  const client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const tools = (await client.listTools()).tools
  for (const name of ['pocket_file_host_probe', 'pocket_file_intake']) {
    const definition = tools.find(x => x.name === name)
    assert.ok(definition)
    assert.deepEqual(definition._meta?.['openai/fileParams'], ['file'])
  }
  const file = {
    file_id: 'file_disposable_sdk_v1',
    file_name: 'disposable.pdf',
    mime_type: 'application/pdf',
    download_url: 'https://uploads.example.org/private?token=fake',
  }
  const probe = await client.callTool({ name: 'pocket_file_host_probe', arguments: { file } })
  assert.equal(probe.isError, undefined)
  assert.equal(probe.structuredContent.hostname, 'uploads.example.org')
  assert.equal(downloads, 0)
  assert.equal((await bridge.store.list()).length, 0)
  const saved = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'inplace:file:0001', mode: 'new', title: 'Disposable bytes',
    file,
  } })
  assert.equal(saved.isError, undefined)
  assert.equal(downloads, 1)
  const record = await bridge.store.readAttachment(saved.structuredContent.attachmentId, bytes.length)
  assert.deepEqual(record.data, bytes)
  assert.equal(saved.structuredContent.sha256, createHash('sha256').update(bytes).digest('hex'))
})

test('Owner reads a disposable stored Markdown original without touching Pocket state', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-original-read-owner-'))
  const mcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1', mcpPath, ...inPlaceFlags,
  })
  const client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const bytes = Buffer.from('# 真正的 Markdown 原文\n\nAqi reads 🐆\n', 'utf8')
  const mediaName = randomUUID()
  const attachmentId = randomUUID()
  await writeFile(path.join(bridge.store.mediaDir, mediaName), bytes)
  const receipt = await bridge.store.saveMcpFileIntake({
    requestId: 'original-read:isolated:00001',
    requestHash: 'd'.repeat(64),
    mode: 'new',
    title: 'Disposable source document',
    text: 'Item description is not the source document.',
    fileId: 'disposable-test-id',
    attachment: {
      id: attachmentId, name: 'notes.md', mimeType: 'text/markdown',
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storageName: mediaName,
    },
  })
  const before = await bridge.store.get(receipt.itemId)
  const response = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: { item_id: receipt.itemId, attachment_id: attachmentId },
  })
  assert.equal(response.isError, undefined)
  assert.equal(response.structuredContent.text, bytes.toString('utf8'))
  assert.equal(response.structuredContent.format, 'md')
  assert.equal(response.structuredContent.sha256, before.attachments[0].sha256)
  assert.match(response.content[0].text, /UNTRUSTED ORIGINAL DOCUMENT CONTENT/)
  assert.equal(response.content[0].text.includes('Item description is not the source document.'), false)
  assert.equal(JSON.stringify(response).includes(mediaName), false)
  const wrong = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: { item_id: randomUUID(), attachment_id: attachmentId },
  })
  assert.equal(wrong.isError, true)
  assert.deepEqual(await bridge.store.get(receipt.itemId), before)
})

