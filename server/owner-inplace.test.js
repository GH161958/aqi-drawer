import assert from 'node:assert/strict'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
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
  await assert.rejects(createBridgeApp({ dataDir, enableOwnerTaxonomyCreate: true }),
    /requires unified Owner and Capture/)
  // Shared unknown environment flags do not implicitly expose Owner.
  const plain = await createBridgeApp({ dataDir, mcpPath })
  await plain.close()
})

test('same private URL upgrades in place to Owner, preserves reads, bounded writes and exact routing', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-owner-'))
  const mcpPath = privatePath()
  const bridge = await startBridge({
    dataDir, port: 0, host: '127.0.0.1', mcpPath, ...inPlaceFlags,
    enableOwnerTaxonomyCreate: true,
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
    'pocket_organize_existing', 'pocket_organize_undo', 'pocket_taxonomy_create',
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
  // The new global label is registered separately, with exact-label EE
  // approval reflected in the tool arguments; no item is organized yet.
  const registered = await client.callTool({
    name: 'pocket_taxonomy_create',
    arguments: {
      request_id: 'inplace:taxonomy:tag:001', kind: 'tag',
      name: 'Research', approved_name: 'Research',
    },
  })
  assert.equal(registered.isError, undefined)
  assert.equal(registered.structuredContent.changed, true)
  assert.deepEqual((await bridge.store.get(itemId)).tags, [])
  const repeatedTaxonomy = await client.callTool({
    name: 'pocket_taxonomy_create',
    arguments: {
      request_id: 'inplace:taxonomy:tag:001', kind: 'tag',
      name: 'Research', approved_name: 'Research',
    },
  })
  assert.equal(repeatedTaxonomy.structuredContent.duplicate, true)
  const wrongApproval = await client.callTool({
    name: 'pocket_taxonomy_create',
    arguments: {
      request_id: 'inplace:taxonomy:tag:002', kind: 'tag',
      name: 'Unexpected', approved_name: 'Not approved',
    },
  })
  assert.equal(wrongApproval.isError, true)
  assert.equal((await bridge.store.listTags()).includes('Unexpected'), false)
  const registeredCollection = await client.callTool({
    name: 'pocket_taxonomy_create',
    arguments: {
      request_id: 'inplace:taxonomy:col:001', kind: 'collection',
      name: 'Reading', approved_name: 'Reading',
    },
  })
  assert.equal(registeredCollection.isError, undefined)
  assert.equal(registeredCollection.structuredContent.changed, true)
  const changed = await client.callTool({
    name: 'pocket_organize_existing',
    arguments: {
      id: itemId, request_id: 'inplace:organize:00002',
      expected_updated_at: revision, tags_add: ['research'], collection: 'Reading',
    },
  })
  assert.equal(changed.isError, undefined)
  assert.deepEqual(changed.structuredContent.tagsAdded, ['Research'])
  assert.equal(changed.structuredContent.after.collection, 'Reading')
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
  assert.ok(!tools.includes('pocket_taxonomy_create'))
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
  const item = await bridge.store.get(saved.structuredContent.itemId)
  assert.equal(item.sourceData?.provider, 'chatgpt')
  assert.equal(Object.hasOwn(item.sourceData, 'openaiFileId'), false)

  const repeated = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'inplace:file:0001', mode: 'new', title: 'Disposable bytes', file,
  } })
  assert.equal(repeated.isError, undefined)
  assert.equal(repeated.structuredContent.duplicate, true)
  assert.equal(repeated.structuredContent.itemId, saved.structuredContent.itemId)
  assert.equal(repeated.structuredContent.attachmentId, saved.structuredContent.attachmentId)
  assert.equal(downloads, 1)
  assert.equal((await bridge.store.list()).length, 1)

  const blocked = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'inplace:file:blocked-host', mode: 'new', title: 'Blocked host',
    file: { ...file, file_id: 'file_disposable_sdk_blocked',
      download_url: 'https://not-allowlisted.example.org/file?token=untrusted' },
  } })
  assert.equal(blocked.isError, true)
  assert.equal(downloads, 1)
  assert.equal((await bridge.store.list()).length, 1)
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



test('V2 two-step fileParams pins one host with V1 intake OFF and saves only after exact approval', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-inplace-pinned-v2-'))
  const mcpPath = privatePath()
  const host = 'oaisdmntprjapaneast.blob.core.windows.net'
  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n')
  let downloads = 0
  const bridge = await startBridge({
    dataDir, mcpPath, port: 0, host: '127.0.0.1',
    ...inPlaceFlags, enableMcpFileTransferV2: true,
    mcpFileHosts: [],
    mcpFileDownloader: async (file, opts) => {
      assert.equal(new URL(file.download_url).hostname, host)
      assert.deepEqual(opts.allowedHosts, [host])
      downloads++
      return bytes
    },
  })
  const client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const tools = (await client.listTools()).tools
  const prepareDefinition = tools.find(x => x.name === 'pocket_file_transfer_prepare')
  assert.ok(prepareDefinition)
  assert.deepEqual(prepareDefinition._meta?.['openai/fileParams'], ['file'])
  assert.ok(tools.find(x => x.name === 'pocket_file_transfer_commit'))
  assert.ok(!tools.find(x => x.name === 'pocket_file_intake'))
  assert.ok(!tools.find(x => x.name === 'pocket_file_host_probe'))

  const file = {
    file_id: 'opaque-host-issued-qa',
    download_url: 'https://' + host + '/original?token=NEVER-ECHO',
    file_name: 'pinned.pdf', mime_type: 'application/pdf',
  }
  const prepared = await client.callTool({
    name: 'pocket_file_transfer_prepare',
    arguments: { request_id: 'qa:pinned:mcp:0001', mode: 'new', title: 'Pinned original',
      text: 'Keep the exact source bytes.', file },
  })
  assert.equal(prepared.isError, undefined)
  const preview = prepared.structuredContent
  assert.equal(preview.hostname, host)
  assert.equal(preview.title, 'Pinned original')
  assert.ok(!JSON.stringify(preview).includes('NEVER-ECHO'))
  assert.equal(downloads, 0)
  assert.equal((await bridge.store.list()).length, 0)

  const wrong = await client.callTool({
    name: 'pocket_file_transfer_commit',
    arguments: { ticket_id: preview.ticketId, approved_hostname: 'wrong.example.org',
      approved_title: preview.title },
  })
  assert.equal(wrong.isError, true)
  assert.equal(downloads, 0)

  const saved = await client.callTool({
    name: 'pocket_file_transfer_commit',
    arguments: { ticket_id: preview.ticketId, approved_hostname: preview.hostname,
      approved_title: preview.title },
  })
  assert.equal(saved.isError, undefined)
  assert.equal(downloads, 1)
  assert.equal(saved.structuredContent.bytes, bytes.length)
  assert.equal(saved.structuredContent.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.equal((await bridge.store.list()).length, 1)
  assert.deepEqual((await bridge.store.readAttachment(saved.structuredContent.attachmentId)).data, bytes)
})


test('V3 opt-in single entry saves approved hosts and prepares unknown hosts without downloading', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-v3-one-entry-'))
  const mcpPath = privatePath()
  const bytes = Buffer.from('%PDF-1.4\n%%EOF\n')
  const observed = []
  const bridge = await startBridge({
    dataDir, mcpPath, port: 0, host: '127.0.0.1',
    ...inPlaceFlags,
    enableMcpFileIntake: true,
    enableMcpFileTransferV2: true,
    enableMcpFileSmartRouteV3: true,
    mcpFileHosts: ['uploads.example.org'],
    mcpFileDownloader: async (_file, options) => {
      observed.push(options.allowedHosts)
      return bytes
    },
  })
  const client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const present = (await client.listTools()).tools.map((entry) => entry.name)
  assert.ok(present.includes('pocket_file_intake'))
  assert.ok(present.includes('pocket_file_transfer_commit'))
  const trusted = {
    file_id: 'v3-trusted-opaque', file_name: 'trusted.pdf',
    mime_type: 'application/pdf',
    download_url: 'https://uploads.example.org/file?token=SECRET',
  }
  const saved = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'v3-one-entry-trusted-0001', mode: 'new', title: 'Trusted PDF', file: trusted,
  } })
  assert.equal(saved.isError, undefined)
  assert.equal(saved.structuredContent.duplicate, false)
  assert.deepEqual(observed, [['uploads.example.org']])
  assert.equal((await bridge.store.list()).length, 1)

  const unknown = {
    ...trusted, file_id: 'v3-unknown-opaque', file_name: 'unknown.pdf',
    download_url: 'https://other-region.example.net/file?token=DO-NOT-LEAK',
  }
  const pending = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'v3-one-entry-unknown-0001', mode: 'new', title: 'Unknown PDF', file: unknown,
  } })
  assert.equal(pending.isError, undefined)
  assert.equal(pending.structuredContent.status, 'approval_required')
  assert.equal(pending.structuredContent.hostname, 'other-region.example.net')
  assert.equal(pending.structuredContent.title, 'Unknown PDF')
  assert.equal(pending.structuredContent.stored, false)
  assert.equal(pending.structuredContent.downloaded, false)
  assert.equal(typeof pending.structuredContent.ticketId, 'string')
  assert.ok(!JSON.stringify(pending).includes('DO-NOT-LEAK'))
  assert.ok(!JSON.stringify(pending).includes('v3-unknown-opaque'))
  assert.deepEqual(observed, [['uploads.example.org']])
  assert.equal((await bridge.store.list()).length, 1)

  const wrong = await client.callTool({ name: 'pocket_file_transfer_commit', arguments: {
    ticket_id: pending.structuredContent.ticketId,
    approved_hostname: 'wrong.example.net', approved_title: 'Unknown PDF',
  } })
  assert.equal(wrong.isError, true)
  assert.equal(observed.length, 1)
  assert.equal((await bridge.store.list()).length, 1)
  const committed = await client.callTool({ name: 'pocket_file_transfer_commit', arguments: {
    ticket_id: pending.structuredContent.ticketId,
    approved_hostname: 'other-region.example.net', approved_title: 'Unknown PDF',
  } })
  assert.equal(committed.isError, undefined)
  assert.equal(committed.structuredContent.sha256, createHash('sha256').update(bytes).digest('hex'))
  assert.deepEqual(observed, [['uploads.example.org'], ['other-region.example.net']])
  const item = await bridge.store.get(committed.structuredContent.itemId)
  assert.equal(item.title, 'Unknown PDF')
  assert.equal(Object.hasOwn(item.sourceData, 'openaiFileId'), false)
  assert.deepEqual((await bridge.store.readAttachment(committed.structuredContent.attachmentId)).data, bytes)
  assert.equal((await bridge.store.list()).length, 2)

  const unsafe = await client.callTool({ name: 'pocket_file_intake', arguments: {
    request_id: 'v3-one-entry-unsafe-0001', mode: 'new', title: 'Unsafe PDF',
    file: { ...unknown, download_url: 'https://127.0.0.1/private' },
  } })
  assert.equal(unsafe.isError, true)
  assert.equal(observed.length, 2)
  assert.equal((await bridge.store.list()).length, 2)
})

test('V3 gate rejects unilateral activation and does not silently turn on V1 or V2', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-v3-gate-'))
  const mcpPath = privatePath()
  t.after(async () => rm(dataDir, { recursive: true, force: true }))
  for (const flags of [
    { enableMcpFileIntake: false, enableMcpFileTransferV2: true },
    { enableMcpFileIntake: true, enableMcpFileTransferV2: false, mcpFileHosts: ['uploads.example.org'] },
  ]) {
    await assert.rejects(createBridgeApp({
      dataDir, mcpPath, ...inPlaceFlags,
      ...flags, enableMcpFileSmartRouteV3: true,
    }), /requires File Intake V1 and pinned Transfer V2/)
  }
})

test('V3 preserves pending idempotency and distinguishes prior save from unverified hostname drift', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-v3-replay-'))
  const mcpPath = privatePath()
  const original = Buffer.from('%PDF-1.4\n%%EOF\n')
  let bytes = original
  let downloads = 0
  const bridge = await startBridge({
    dataDir, mcpPath, port: 0, host: '127.0.0.1', ...inPlaceFlags,
    enableMcpFileIntake: true, enableMcpFileTransferV2: true, enableMcpFileSmartRouteV3: true,
    mcpFileHosts: ['uploads.example.org'],
    mcpFileDownloader: async () => { downloads++; return bytes },
  })
  const client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const args = {
    request_id: 'v3-replay-original-0001', mode: 'new', title: 'Original PDF', text: 'Original notes',
    file: { file_id: 'PRIVATE-V3-REPLAY-ID', mime_type: 'application/pdf', download_url: 'https://uploads.example.org/file?sig=PRIVATE-SIGNATURE' },
  }
  const intake = (arguments_) => client.callTool({ name: 'pocket_file_intake', arguments: arguments_ })
  const commit = (ticket) => client.callTool({ name: 'pocket_file_transfer_commit', arguments: {
    ticket_id: ticket.ticketId, approved_hostname: ticket.hostname, approved_title: ticket.title,
  } })
  const saved = await intake(args)
  assert.equal(saved.isError, undefined)
  const before = await readFile(bridge.store.filePath, 'utf8')
  assert.equal((await intake(args)).structuredContent.attachmentId, saved.structuredContent.attachmentId)
  assert.equal(downloads, 1)
  const rotated = { ...args, file: { ...args.file, download_url: 'https://other.example.net/rotated?sig=PRIVATE-SIGNATURE' } }
  const pending = await intake(rotated)
  assert.equal(pending.structuredContent.status, 'verification_required')
  assert.equal(pending.structuredContent.priorSaveExists, true)
  assert.equal(pending.structuredContent.requestedFileVerified, false)
  assert.equal(Object.hasOwn(pending.structuredContent, 'stored'), false)
  assert.equal(Object.hasOwn(pending.structuredContent, 'attachmentId'), false)
  for (let i = 0; i < 16; i++) assert.deepEqual((await intake(rotated)).structuredContent, pending.structuredContent)
  assert.equal(downloads, 1)
  assert.equal(await readFile(bridge.store.filePath, 'utf8'), before)
  assert.equal((await readdir(bridge.store.mediaDir)).length, 1)
  for (const conflict of [{ title: 'Different' }, { text: 'Different' }, { mode: 'append', item_id: saved.structuredContent.itemId, title: '', text: '' }]) {
    assert.equal((await intake({ ...rotated, ...conflict })).isError, true)
  }
  const conflictingUrl = { ...rotated, file: { ...rotated.file, download_url: 'https://third.example.net/another' } }
  assert.equal((await intake(conflictingUrl)).isError, true)
  assert.equal(downloads, 1)
  bytes = Buffer.concat([original, Buffer.from('different original')])
  assert.equal((await commit(pending.structuredContent)).isError, true)
  assert.equal(await readFile(bridge.store.filePath, 'utf8'), before)
  bytes = original
  const verified = await commit(pending.structuredContent)
  assert.equal(verified.isError, undefined)
  assert.equal(verified.structuredContent.duplicate, true)
  assert.equal(verified.structuredContent.attachmentId, saved.structuredContent.attachmentId)
  assert.equal(downloads, 3)
  assert.deepEqual((await commit(pending.structuredContent)).structuredContent, verified.structuredContent)
  assert.deepEqual((await intake(rotated)).structuredContent, verified.structuredContent)
  assert.equal(downloads, 3)
  assert.equal(await readFile(bridge.store.filePath, 'utf8'), before)
  const serialized = JSON.stringify([saved, pending, verified, before])
  for (const secret of [args.file.file_id, args.file.download_url, rotated.file.download_url, 'PRIVATE-SIGNATURE']) assert.ok(!serialized.includes(secret))
})

test('V3 recovers V2 append receipts after process restart and never accepts a changed target', async (t) => {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-v3-restart-'))
  const mcpPath = privatePath()
  let downloads = 0
  const options = {
    dataDir, mcpPath, port: 0, host: '127.0.0.1', ...inPlaceFlags,
    enableMcpFileIntake: true, enableMcpFileTransferV2: true, enableMcpFileSmartRouteV3: true,
    mcpFileHosts: ['uploads.example.org'],
    mcpFileDownloader: async () => { downloads++; return Buffer.from('%PDF-1.4\n%%EOF\n') },
  }
  let bridge = await startBridge(options)
  let client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  t.after(async () => {
    await Promise.allSettled([client.close(), bridge.stop()])
    await rm(dataDir, { recursive: true, force: true })
  })
  const target = await bridge.store.upsert({ title: 'Existing', text: 'Keep notes', tags: ['Care'] })
  const args = {
    request_id: 'v3-v2-append-restart-0001', mode: 'append', item_id: target.id,
    file: { file_id: 'v3-append-private-id', file_name: '附录.pdf', mime_type: 'application/pdf', download_url: 'https://unknown.example.net/original?sig=PRIVATE' },
  }
  const pending = await client.callTool({ name: 'pocket_file_intake', arguments: args })
  assert.equal(pending.structuredContent.status, 'approval_required')
  const approval = { ticket_id: pending.structuredContent.ticketId, approved_hostname: pending.structuredContent.hostname, approved_title: '' }
  const saved = await client.callTool({ name: 'pocket_file_transfer_commit', arguments: approval })
  assert.equal(saved.isError, undefined)
  await client.close()
  await bridge.stop()
  bridge = await startBridge(options)
  client = await connect('http://127.0.0.1:' + bridge.address.port, mcpPath)
  assert.equal((await client.callTool({ name: 'pocket_file_transfer_commit', arguments: approval })).isError, true)
  const recovered = await client.callTool({ name: 'pocket_file_intake', arguments: args })
  assert.equal(recovered.isError, undefined)
  assert.equal(recovered.structuredContent.attachmentId, saved.structuredContent.attachmentId)
  assert.equal(recovered.structuredContent.duplicate, true)
  assert.equal(downloads, 1)
  const rotated = { ...args, file: { ...args.file, file_id: 'refreshed-private-id', download_url: 'https://new.example.net/rotated' } }
  const verification = await client.callTool({ name: 'pocket_file_intake', arguments: rotated })
  assert.equal(verification.structuredContent.status, 'verification_required')
  assert.equal(Object.hasOwn(verification.structuredContent, 'stored'), false)
  assert.equal(downloads, 1)
  const changedTarget = await client.callTool({ name: 'pocket_file_intake', arguments: { ...rotated, item_id: 'another-item' } })
  assert.equal(changedTarget.isError, true)
  assert.equal(downloads, 1)
  const item = await bridge.store.get(target.id)
  assert.equal(item.attachments.length, 1)
  assert.equal(item.attachments[0].name, '附录.pdf')
  assert.equal(item.title, target.title)
  assert.equal(item.text, target.text)
  assert.deepEqual(item.tags, target.tags)
})
