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
