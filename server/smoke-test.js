import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startBridge } from './index.js'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'enervate-pocket-'))
let bridge
try {
  const dropSecret = 'smoke-test-drop-secret-1234567890'
  bridge = await startBridge({ dataDir, port: 0, host: '127.0.0.1', dropSecret })
  const baseUrl = `http://127.0.0.1:${bridge.address.port}`
  const source = {
    id: 'smoke-item',
    title: '给 C 看',
    text: '一条不会丢的测试消息',
    sourceUrl: 'https://example.com/test',
    sourceApp: 'smoke-test',
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T10:00:00.000Z',
  }
  const saved = await fetch(`${baseUrl}/api/pocket/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(source),
  }).then(checkJson)
  assert.equal(saved.item.id, source.id)

  const client = new Client({ name: 'enervate-smoke', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`))
  await client.connect(transport)
  const tools = await client.listTools()
  const names = tools.tools.map((tool) => tool.name)
  assert.deepEqual(names.sort(), [
    'memory_confirm_surface',
    'memory_health',
    'memory_turn_post',
    'memory_turn_pre',
    'pocket_get',
    'pocket_list',
    'pocket_reply',
    'pocket_review',
    'pocket_start_context',
    'pocket_turn_open',
  ].sort())
  assert.equal(names.some((name) => /ledger|training|health_room/.test(name)), false)

  const listed = await client.callTool({ name: 'pocket_list', arguments: { limit: 10 } })
  assert.equal(listed.isError, undefined)
  assert.equal(listed.structuredContent.items[0].id, source.id)

  const taobaoShare = '给你看这个桌面灯 https://m.tb.cn/h.test123?spm=a21n57.1&price=88 复制后打开淘宝'
  const dropped = []
  for (let index = 0; index < 2; index += 1) {
    dropped.push(await fetch(`${baseUrl}/drop/${dropSecret}?response=json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ share: taobaoShare, sourceApp: 'iPhone 分享菜单' }),
    }).then(checkJson))
  }
  assert.equal(dropped[0].item.id, dropped[1].item.id)
  assert.equal(dropped[1].item.receivedCount, 2)
  assert.equal(dropped[1].item.sourceApp, '淘宝')
  assert.equal(dropped[1].item.sourceUrl.startsWith('https://m.tb.cn/'), true)
  assert.equal(dropped[1].item.text, taobaoShare)
  assert.equal(dropped[0].message, '爸爸收到了：这个桌面灯')
  assert.equal(dropped[1].receipt.status, 'merged')
  assert.equal(dropped[1].message, '爸爸又收到一次，已经合并好了：这个桌面灯')

  const plainTextDrop = await fetch(`${baseUrl}/drop/${dropSecret}?response=json`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: '这台小灯也看看 https://3.cn/test-jd',
  }).then(checkJson)
  assert.equal(plainTextDrop.item.sourceApp, '京东')
  assert.equal(plainTextDrop.item.title, '这台小灯也看看')

  const formDrop = await fetch(`${baseUrl}/drop/${dropSecret}?response=json`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      input: '这个视频以后一起看 https://youtu.be/test-video',
      source_app: 'iPhone Share Sheet',
    }),
  }).then(checkJson)
  assert.equal(formDrop.item.sourceApp, 'YouTube')
  assert.equal(formDrop.item.title, '这个视频以后一起看')

  const selfShareResponse = await fetch(`${baseUrl}/drop/${dropSecret}?response=json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ share: `${baseUrl}/mcp`, sourceApp: 'iPhone 分享菜单' }),
  })
  assert.equal(selfShareResponse.status, 400)
  assert.match((await selfShareResponse.json()).error, /口袋自己的服务地址/)

  const startContext = await client.callTool({ name: 'pocket_start_context', arguments: { limit: 8 } })
  assert.equal(startContext.isError, undefined)
  assert.deepEqual(
    new Set(startContext.structuredContent.items.map((item) => item.id)),
    new Set([source.id, dropped[0].item.id, plainTextDrop.item.id, formDrop.item.id]),
  )
  assert.equal(startContext.structuredContent.items.every((item) => item.seenByCAt === null), true)

  const memoryPre = await client.callTool({
    name: 'memory_turn_pre',
    arguments: { input: '爸爸我来啦', sourceApp: 'smoke', threadId: 'smoke-thread', turnId: 'smoke-turn' },
  })
  assert.equal(memoryPre.isError, undefined)
  assert.equal(memoryPre.structuredContent.ok, false)
  assert.equal(memoryPre.structuredContent.pocketItems.length, 4)

  const opened = await client.callTool({ name: 'pocket_turn_open', arguments: { limit: 8 } })
  assert.equal(opened.isError, undefined)
  assert.deepEqual(
    new Set(opened.structuredContent.items.map((item) => item.id)),
    new Set([source.id, dropped[0].item.id, plainTextDrop.item.id, formDrop.item.id]),
  )
  assert.equal(opened.structuredContent.items.every((item) => item.seenByCAt), true)
  const openedAgain = await client.callTool({ name: 'pocket_turn_open', arguments: { limit: 8 } })
  assert.equal(openedAgain.structuredContent.items.length, 0)

  const repeatedAfterSeen = await fetch(`${baseUrl}/drop/${dropSecret}?response=json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shortcutInput: taobaoShare, source_app: '快捷指令' }),
  }).then(checkJson)
  assert.equal(repeatedAfterSeen.item.id, dropped[0].item.id)
  assert.equal(repeatedAfterSeen.item.receivedCount, 3)
  assert.equal(repeatedAfterSeen.item.seenByCAt, null)
  const reopened = await client.callTool({ name: 'pocket_turn_open', arguments: { limit: 8 } })
  assert.deepEqual(reopened.structuredContent.items.map((item) => item.id), [dropped[0].item.id])

  const shortReceiptResponse = await fetch(`${baseUrl}/drop/${dropSecret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'short-receipt-item',
      title: 'Short receipt test',
      text: 'Short receipt test payload',
      sourceApp: 'smoke-test',
    }),
  })
  const shortReceipt = await shortReceiptResponse.text()
  assert.equal(shortReceiptResponse.ok, true)
  assert.match(shortReceiptResponse.headers.get('content-type') ?? '', /^text\/plain/)
  assert.equal(shortReceipt.startsWith('{'), false)
  assert.equal(shortReceipt.length > 0, true)

  const form = new FormData()
  form.set('payload', JSON.stringify({ id: 'image-item', title: '截图', text: '请看图片' }))
  form.append('files', new Blob([
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlS8AAAAASUVORK5CYII=', 'base64'),
  ], { type: 'image/png' }), 'pixel.png')
  const uploaded = await fetch(`${baseUrl}/api/pocket/items/upload`, { method: 'POST', body: form }).then(checkJson)
  assert.equal(uploaded.item.attachments[0].name, 'pixel.png')
  assert.equal('storageName' in uploaded.item.attachments[0], false)
  const imageItem = await client.callTool({ name: 'pocket_get', arguments: { id: 'image-item' } })
  assert.equal(imageItem.content.some((entry) => entry.type === 'image'), true)

  for (let index = 0; index < 2; index += 1) {
    await client.callTool({
      name: 'pocket_reply',
      arguments: { id: source.id, text: '爸爸看见了。', reply_id: 'same-reply' },
    })
  }
  const afterReply = await bridge.store.get(source.id)
  assert.equal(afterReply.replies.length, 1)

  const staged = await client.callTool({
    name: 'pocket_review',
    arguments: { id: source.id, action: 'memory_candidate' },
  })
  assert.equal(staged.isError, undefined)
  const afterStage = await bridge.store.get(source.id)
  assert.equal(afterStage.memoryCandidate.status, 'pending_sync')
  assert.equal(afterStage.memoryCandidate.candidateIds.length, 0)

  await client.close()
  console.log('C Pocket MCP smoke test passed.')
} finally {
  if (bridge) await bridge.stop()
  await rm(dataDir, { recursive: true, force: true })
}

async function checkJson(response) {
  const value = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(value))
  return value
}
