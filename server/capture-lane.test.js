import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createBridgeApp, startBridge } from './index.js'
import { createPocketMcpServer } from './mcp-server.js'

const privatePath = () => '/mcp/' + randomBytes(32).toString('base64url')

const WRITER_TOOLS = [
  'pocket_capture_create',
  'pocket_get',
  'pocket_list',
  'pocket_search',
  'pocket_taxonomy',
]

async function assertToolUnavailable(client, name, args) {
  let rejected
  try {
    const response = await client.callTool({ name, arguments: args })
    rejected = response.isError === true
  } catch {
    rejected = true
  }
  assert.equal(rejected, true, `Tool ${name} must not be executable on the Capture lane.`)
}

test('MCP tool registry rejects contradictory lane privileges', () => {
  assert.throws(
    () => createPocketMcpServer({ lane: 'unrecognized' }),
    /Unknown MCP tool lane/,
  )
  assert.throws(
    () => createPocketMcpServer({ lane: 'capture', enableMcpCapture: false }),
    /Capture lane cannot register tools/,
  )
  assert.throws(
    () => createPocketMcpServer({ lane: 'standard', enableMcpCapture: true }),
    /Standard MCP lane cannot enable Capture/,
  )
})


test('MCP write lane fails closed without a distinct long capability path', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-lane-config-'))
  t.after(async () => rm(dataDir, { recursive: true, force: true }))
  await assert.rejects(createBridgeApp({
    dataDir, enableMcpCapture: true, mcpPath: '/mcp',
    captureMcpPath: '',
  }), /C_POCKET_MCP_CAPTURE_PATH is required/)
  await assert.rejects(createBridgeApp({
    dataDir, enableMcpCapture: true, mcpPath: '/mcp',
    captureMcpPath: '/mcp/too-short',
  }), /C_POCKET_MCP_PATH must be \/mcp/)
  const same = privatePath()
  await assert.rejects(createBridgeApp({
    dataDir, enableMcpCapture: true, mcpPath: same, captureMcpPath: same,
  }), /distinct.*43\+/)
  await assert.rejects(createBridgeApp({
    dataDir, enableMcpCapture: true, temporaryPublicMcp: true,
    captureMcpPath: privatePath(),
  }), /temporary-public-MCP/)
})

test('existing MCP path cannot capture, distinct writer path can, sessions cannot cross lanes', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-lane-'))
  const captureMcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1',
    mcpPath: '/mcp', captureMcpPath, enableMcpCapture: true,
  })
  const base = 'http://127.0.0.1:' + bridge.address.port
  const readerTransport = new StreamableHTTPClientTransport(new URL(base + '/mcp'))
  const writerTransport = new StreamableHTTPClientTransport(new URL(base + captureMcpPath))
  const reader = new Client({ name: 'capture-reader', version: '1' })
  const writer = new Client({ name: 'capture-writer', version: '1' })
  t.after(async () => {
    await Promise.allSettled([reader.close(), writer.close()])
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })
  await reader.connect(readerTransport)
  await writer.connect(writerTransport)

  // The write-capability URL exposes only the five approved tools, no other
  // Store mutation, Memory or canonical Vault tools.
  const readerNames = (await reader.listTools()).tools.map((entry) => entry.name)
  const writerNames = (await writer.listTools()).tools.map((entry) => entry.name)
  assert.deepEqual([...writerNames].sort(), WRITER_TOOLS)
  for (const legacyTool of [
    'pocket_capture_create', 'pocket_edit_metadata', 'pocket_reply',
    'pocket_review', 'memory_confirm_surface', 'memory_turn_post',
    'vault_update', 'pocket_start_context',
  ]) {
    assert.ok(readerNames.includes(legacyTool), `Legacy tool missing: ${legacyTool}`)
  }
  for (const excludedTool of [
    'pocket_edit_metadata', 'pocket_reply', 'pocket_review',
    'memory_confirm_surface', 'memory_turn_post', 'vault_update',
    'pocket_turn_open', 'pocket_read_content',
  ]) {
    assert.equal(writerNames.includes(excludedTool), false)
  }

  const config = await fetch(base + '/local/config').then((res) => res.json())
  assert.equal(config.mcpPath, '/mcp')
  assert.equal(JSON.stringify(config).includes(captureMcpPath), false)

  const args = {
    request_id: 'lane:isolated:capture:0001',
    title: 'Owner-approved capture fixture',
    text: 'A single durable text item for this test',
    tags: ['capture-test'],
    collection: 'Examples',
  }
  const denied = await reader.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(denied.isError, true)
  assert.equal((await bridge.store.list()).length, 0)

  const first = await writer.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(first.isError, undefined)
  assert.equal(first.structuredContent.duplicate, false)
  assert.equal(first.structuredContent.item.title, args.title)
  assert.equal((await bridge.store.list()).length, 1)
  const repeat = await writer.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(repeat.isError, undefined)
  assert.equal(repeat.structuredContent.duplicate, true)
  assert.equal(repeat.structuredContent.id, first.structuredContent.id)
  assert.equal((await bridge.store.list()).length, 1)

  // All of these arguments would cause a real mutation on the standard lane.
  // Calling them on the scoped writer must fail without changing the fixture.
  const snapshot = await bridge.store.get(first.structuredContent.id)
  await assertToolUnavailable(writer, 'pocket_edit_metadata', {
    id: first.structuredContent.id, tags_add: ['unapproved-tag'],
  })
  await assertToolUnavailable(writer, 'pocket_reply', {
    id: first.structuredContent.id, text: 'Unapproved reply',
  })
  await assertToolUnavailable(writer, 'pocket_review', {
    id: first.structuredContent.id, action: 'archived',
  })
  await assertToolUnavailable(writer, 'vault_update', {
    path: '00_HOME/Current.md', content: '# unapproved',
    expectedSha: '1234567', approved: true,
  })
  assert.deepEqual(await bridge.store.get(first.structuredContent.id), snapshot)

  // Read-only lookup and taxonomy remain available on the writer lane.
  const writerSearch = await writer.callTool({ name: 'pocket_search', arguments: { query: 'fixture' } })
  assert.equal(writerSearch.structuredContent.matches[0].id, first.structuredContent.id)
  const taxonomy = await writer.callTool({ name: 'pocket_taxonomy', arguments: {} })
  assert.ok(taxonomy.structuredContent.tags.includes('capture-test'))
  assert.ok(taxonomy.structuredContent.collections.includes('Examples'))
  const writerGet = await writer.callTool({ name: 'pocket_get', arguments: { id: first.structuredContent.id } })
  assert.equal(writerGet.structuredContent.item.id, first.structuredContent.id)

  const matched = await reader.callTool({ name: 'pocket_search', arguments: { query: 'fixture' } })
  assert.equal(matched.structuredContent.matches[0].id, first.structuredContent.id)

  // Session initialized on the read endpoint must never authorize tools/call at the writer endpoint.
  assert.ok(readerTransport.sessionId)
  const cross = await fetch(base + captureMcpPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': readerTransport.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 19, method: 'tools/call',
      params: { name: 'pocket_capture_create', arguments: { ...args, request_id: 'lane:cross:0002' } },
    }),
  })
  assert.equal(cross.status, 400)
  assert.equal((await bridge.store.list()).length, 1)
})

test('unified owner cutover is explicit and fails closed', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-owner-config-'))
  t.after(async () => rm(dataDir, { recursive: true, force: true }))
  await assert.rejects(createBridgeApp({
    dataDir, enableUnifiedOwner: true, enableMcpCapture: false,
  }), /requires Capture to be explicitly enabled/)
  await assert.rejects(createBridgeApp({
    dataDir, enableLegacyMcp: false, enableUnifiedOwner: false,
  }), /Cannot disable legacy MCP/)
  await assert.rejects(createBridgeApp({
    dataDir, enableUnifiedOwner: true, enableMcpCapture: true,
    captureMcpPath: '',
  }), /C_POCKET_MCP_CAPTURE_PATH is required/)
})

test('unified owner MCP preserves legacy tools and adds Capture on one URL', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-owner-integration-'))
  const captureMcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1',
    mcpPath: '/mcp', captureMcpPath,
    enableMcpCapture: true, enableUnifiedOwner: true,
  })
  const base = 'http://127.0.0.1:' + bridge.address.port
  const oldClient = new Client({ name: 'legacy-read', version: '1' })
  const owner = new Client({ name: 'unified-owner', version: '1' })
  const legacyTransport = new StreamableHTTPClientTransport(new URL(base + '/mcp'))
  const ownerTransport = new StreamableHTTPClientTransport(new URL(base + captureMcpPath))
  t.after(async () => {
    await Promise.allSettled([oldClient.close(), owner.close()])
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })
  await oldClient.connect(legacyTransport)
  await owner.connect(ownerTransport)

  const names = (await owner.listTools()).tools.map((entry) => entry.name)
  for (const tool of [
    'pocket_capture_create', 'pocket_search', 'pocket_taxonomy',
    'pocket_list', 'pocket_get', 'pocket_start_context',
    'pocket_reply', 'pocket_review', 'pocket_read_content',
    'memory_turn_pre', 'memory_turn_post', 'vault_read', 'vault_update',
    'pocket_organize_existing', 'pocket_organize_undo',
  ]) assert.ok(names.includes(tool), `Unified owner tool missing: ${tool}`)
  assert.ok(!names.includes('pocket_edit_metadata'), 'Unsafe metadata edit must wait for PR B')
  const legacyNames = (await oldClient.listTools()).tools.map((entry) => entry.name)
  assert.ok(legacyNames.includes('pocket_edit_metadata'))
  assert.ok(legacyNames.includes('vault_update'))
  assert.ok(!legacyNames.includes('pocket_organize_existing'))
  assert.ok(!legacyNames.includes('pocket_organize_undo'))

  const args = {
    request_id: 'owner:one:00001',
    title: 'Single MCP trial',
    text: 'Safe content for a disposable test Store',
  }
  const legacyWrite = await oldClient.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(legacyWrite.isError, true)
  const created = await owner.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(created.isError, undefined)
  assert.equal(created.structuredContent.duplicate, false)
  assert.equal((await bridge.store.list({ limit: 20 })).length, 1)
  const repeated = await owner.callTool({ name: 'pocket_capture_create', arguments: args })
  assert.equal(repeated.structuredContent.duplicate, true)
  assert.equal((await bridge.store.list({ limit: 20 })).length, 1)
  const savedId = created.structuredContent.id
  const lookup = await owner.callTool({ name: 'pocket_get', arguments: { id: savedId } })
  assert.equal(lookup.structuredContent.item.id, savedId)
  const search = await owner.callTool({ name: 'pocket_search', arguments: { query: 'Single MCP' } })
  assert.equal(search.structuredContent.matches[0].id, savedId)

  const unknownTags = await owner.callTool({
    name: 'pocket_capture_create', arguments: {
      ...args, request_id: 'owner:tag:00002', tags: ['Unapproved Tag'],
    },
  })
  assert.equal(unknownTags.isError, true)
  const unknownCollection = await owner.callTool({
    name: 'pocket_capture_create', arguments: {
      ...args, request_id: 'owner:collection:00003', collection: 'Unknown Collection',
    },
  })
  assert.equal(unknownCollection.isError, true)
  assert.equal((await bridge.store.list({ limit: 20 })).length, 1)
  assert.deepEqual(await bridge.store.listTags(), [])
  assert.deepEqual(await bridge.store.listCollections(), [])

  // Owner organizer must fail closed before vocabulary registration.
  const deniedOrganize = await owner.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: savedId, request_id: 'owner:organize:00001', tags_add: ['New label'],
      reason: 'Proposal only',
    },
  })
  assert.equal(deniedOrganize.isError, true)
  assert.deepEqual((await bridge.store.get(savedId)).tags, [])

  // Fixture-only vocabulary registration simulates labels EE has approved.
  await bridge.store.createTag('Academic')
  await bridge.store.createTag('Reference')
  await bridge.store.createCollection('Research')
  const organized = await owner.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: savedId, request_id: 'owner:organize:00002',
      tags_add: ['academic', 'Reference'], collection: 'research',
      reason: 'Categorize the research note',
    },
  })
  assert.equal(organized.isError, undefined)
  assert.equal(organized.structuredContent.changed, true)
  assert.deepEqual(organized.structuredContent.tagsAdded, ['Academic', 'Reference'])
  assert.equal(organized.structuredContent.collectionTo, 'Research')
  const operationId = organized.structuredContent.operationId
  const replay = await owner.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: savedId, request_id: 'owner:organize:00002',
      tags_add: ['academic', 'Reference'], collection: 'research',
      reason: 'Categorize the research note',
    },
  })
  assert.equal(replay.structuredContent.duplicate, true)
  assert.equal(replay.structuredContent.operationId, operationId)
  const proposedNewCollection = await owner.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: savedId, request_id: 'owner:organize:00003',
      collection: 'Secretly created Collection',
    },
  })
  assert.equal(proposedNewCollection.isError, true)
  assert.deepEqual(await bridge.store.listCollections(), ['Research'])
  const undo = await owner.callTool({
    name: 'pocket_organize_undo',
    arguments: {
      id: savedId, operation_id: operationId,
      request_id: 'owner:undo:00001',
    },
  })
  assert.equal(undo.isError, undefined)
  assert.equal(undo.structuredContent.undone, true)
  assert.deepEqual((await bridge.store.get(savedId)).tags, [])
  assert.equal((await bridge.store.get(savedId)).collection, null)
  await assertToolUnavailable(oldClient, 'pocket_organize_existing', {
    id: savedId, request_id: 'legacy:organize:00001',
    tags_add: ['Academic'],
  })

  // Session created on the legacy path is not reusable on the owner path.
  assert.ok(legacyTransport.sessionId)
  const cross = await fetch(base + captureMcpPath, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-session-id': legacyTransport.sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 27, method: 'tools/call',
      params: { name: 'pocket_capture_create', arguments: {
        ...args, request_id: 'owner:cross:00004',
      } },
    }),
  })
  assert.equal(cross.status, 400)
  assert.equal((await bridge.store.list({ limit: 20 })).length, 1)
})

test('legacy MCP can be retired after owner cutover without disabling owner tools', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-owner-retire-'))
  const ownerMcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1',
    mcpPath: '/mcp', captureMcpPath: ownerMcpPath,
    enableMcpCapture: true, enableUnifiedOwner: true, enableLegacyMcp: false,
  })
  t.after(async () => {
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })
  const base = 'http://127.0.0.1:' + bridge.address.port
  assert.equal((await fetch(base + '/mcp', { method: 'GET' })).status, 404)
  const client = new Client({ name: 'retired-owner', version: '1' })
  t.after(async () => client.close())
  await client.connect(new StreamableHTTPClientTransport(new URL(base + ownerMcpPath)))
  const names = (await client.listTools()).tools.map((entry) => entry.name)
  assert.ok(names.includes('pocket_capture_create'))
  assert.ok(names.includes('pocket_search'))
  assert.ok(names.includes('vault_read'))
})

test('capture endpoint absent when feature remains disabled', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-lane-disabled-'))
  const captureMcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1',
    captureMcpPath, enableMcpCapture: false,
  })
  t.after(async () => {
    await bridge.stop()
    await rm(dataDir, { recursive: true, force: true })
  })
  const root = 'http://127.0.0.1:' + bridge.address.port
  const unavailable = await fetch(root + captureMcpPath, { method: 'GET' })
  assert.equal(unavailable.status, 404)
})
