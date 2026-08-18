import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startBridge } from './index.js'
import { fetchSafeResource, isPrivateAddress } from './safe-fetch.js'

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aqi-drawer-'))
const authDataDir = await mkdtemp(path.join(os.tmpdir(), 'aqi-drawer-auth-'))
let bridge
let authBridge
let fixture
try {
  for (const address of [
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '0:0:0:0:0:0:0:1', '::ffff:7f00:1',
    '::ffff:0:7f00:1', '64:ff9b::7f00:1', '64:ff9b:1::7f00:1', '2002:7f00:1::', 'fec0::1',
  ]) {
    assert.equal(isPrivateAddress(address), true, `${address} must be blocked`)
  }
  for (const address of ['8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, `${address} should remain publicly reachable`)
  }
  fixture = await startContentFixture()
  await assert.rejects(
    fetchSafeResource(`${fixture.baseUrl}/article`),
    /Private, loopback, and reserved network addresses are blocked/,
  )
  await assert.rejects(
    fetchSafeResource(`${fixture.baseUrl}/slow`, { allowPrivateHosts: true, timeoutMs: 250, maxBytes: 1024 }),
    /timed out/,
  )
  const dropSecret = 'smoke-test-drop-secret-1234567890'
  bridge = await startBridge({
    dataDir,
    port: 0,
    host: '127.0.0.1',
    dropSecret,
    contentReaderOptions: {
      allowPrivateHosts: true,
      ffmpegPath: 'missing-smoke-ffmpeg',
      ffprobePath: 'missing-smoke-ffprobe',
    },
  })
  const baseUrl = `http://127.0.0.1:${bridge.address.port}`
  const source = {
    id: 'smoke-item',
    title: '给阿栖看',
    text: '一条不会丢的测试消息',
    sourceUrl: `${fixture.baseUrl}/article`,
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

  await bridge.store.upsert({
    id: 'legacy-item',
    text: 'legacy compatibility fixture',
    status: 'archived',
    createdAt: '2020-01-01T00:00:00.000Z',
    updatedAt: '2020-01-01T00:00:00.000Z',
  })
  const storePath = path.join(dataDir, 'pocket-store.json')
  const legacyState = JSON.parse(await readFile(storePath, 'utf8'))
  const legacyStored = legacyState.items.find((item) => item.id === 'legacy-item')
  delete legacyStored.collection
  delete legacyStored.tags
  delete legacyStored.activity
  await writeFile(storePath, JSON.stringify(legacyState, null, 2), 'utf8')
  const legacyPublic = await bridge.store.get('legacy-item')
  assert.equal(legacyPublic.collection, null)
  assert.deepEqual(legacyPublic.tags, [])
  assert.deepEqual(legacyPublic.activity, [])

  const client = new Client({ name: 'aqi-drawer-smoke', version: '1.0.0' })
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
    'pocket_edit_metadata',
    'pocket_list',
    'pocket_read_content',
    'pocket_reply',
    'pocket_review',
    'pocket_start_context',
    'pocket_turn_open',
    'vault_list',
    'vault_read',
    'vault_update',
  ].sort())
  assert.equal(names.some((name) => /ledger|training|health_room/.test(name)), false)

  const vaultListed = await client.callTool({ name: 'vault_list', arguments: {} })
  assert.equal(vaultListed.isError, undefined)
  assert.equal(vaultListed.structuredContent.paths.includes('10_IDENTITY/Aqi_Seed.md'), true)
  assert.equal(vaultListed.structuredContent.paths.includes('20_VOICE/Aqi_Voice.md'), true)
  assert.equal(vaultListed.structuredContent.paths.includes('40_WORK/Aqi_Engineering_Handoff.md'), true)
  assert.equal('token' in vaultListed.structuredContent, false)

  const listed = await client.callTool({ name: 'pocket_list', arguments: { limit: 10 } })
  assert.equal(listed.isError, undefined)
  assert.equal(listed.structuredContent.items[0].id, source.id)
  assert.equal(listed.structuredContent.items[0].collection, null)
  assert.deepEqual(listed.structuredContent.items[0].tags, [])
  assert.deepEqual(listed.structuredContent.items[0].activity.map((entry) => entry.type), ['received'])

  const activityBeforeReads = listed.structuredContent.items[0].activity.length
  await client.callTool({ name: 'pocket_get', arguments: { id: source.id } })
  await client.callTool({ name: 'pocket_list', arguments: { limit: 10 } })
  assert.equal((await bridge.store.get(source.id)).activity.length, activityBeforeReads)

  const metadataRest = await fetch(`${baseUrl}/api/pocket/items/${source.id}/metadata`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collection: '记忆研究', tagsAdd: ['Ombre', 'evidence'] }),
  }).then(checkJson)
  assert.equal(metadataRest.changed, true)
  assert.equal(metadataRest.item.collection, '记忆研究')
  assert.deepEqual(metadataRest.item.tags, ['Ombre', 'evidence'])
  const metadataActivityCount = metadataRest.item.activity.length
  const collectionsAfterMetadata = await fetch(
    `${baseUrl}/api/pocket/collections`,
  ).then(checkJson)

  assert.equal(
    collectionsAfterMetadata.collections.includes('记忆研究'),
    true,
  )

  const emptyCollection = await fetch(
    `${baseUrl}/api/pocket/collections`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        collection: '空抽屉',
      }),
    },
  ).then(checkJson)

  assert.equal(emptyCollection.collection, '空抽屉')

  const collectionsWithEmpty = await fetch(
    `${baseUrl}/api/pocket/collections`,
  ).then(checkJson)

  assert.equal(
    collectionsWithEmpty.collections.includes('空抽屉'),
    true,
  )

  const removedEmptyCollection = await fetch(
    `${baseUrl}/api/pocket/collections/${encodeURIComponent('空抽屉')}`,
    {
      method: 'DELETE',
    },
  ).then(checkJson)

  assert.equal(
    removedEmptyCollection.collection,
    '空抽屉',
  )

  const metadataNoop = await fetch(`${baseUrl}/api/pocket/items/${source.id}/metadata`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ collection: '记忆研究', tagsAdd: ['Ombre'] }),
  }).then(checkJson)
  assert.equal(metadataNoop.changed, false)
  assert.equal(metadataNoop.item.activity.length, metadataActivityCount)

  const createdNote = await fetch(`${baseUrl}/api/pocket/items/${source.id}/note`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: '第一句 EE Note' }),
  }).then(checkJson)
  assert.equal(createdNote.changed, true)
  assert.equal(createdNote.item.note, '第一句 EE Note')
  const editedNote = await fetch(`${baseUrl}/api/pocket/items/${source.id}/note`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: '改好后的 EE Note' }),
  }).then(checkJson)
  assert.equal(editedNote.item.note, '改好后的 EE Note')
  assert.equal((await bridge.store.get(source.id)).note, '改好后的 EE Note')
  const clearedNote = await fetch(`${baseUrl}/api/pocket/items/${source.id}/note`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ note: '' }),
  }).then(checkJson)
  assert.equal(clearedNote.item.note, '')
  assert.equal((await bridge.store.get(source.id)).note, '')

  const metadataMcp = await client.callTool({
    name: 'pocket_edit_metadata',
    arguments: { id: source.id, tags_add: ['continuity'], tags_remove: ['evidence'] },
  })
  assert.equal(metadataMcp.isError, undefined)
  assert.deepEqual(metadataMcp.structuredContent.item.tags, ['Ombre', 'continuity'])

  const readContent = await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: source.id, detail: 'compact', max_images: 1, video_frames: 0 },
  })
  assert.equal(readContent.isError, undefined)
  assert.equal(readContent.structuredContent.snapshot.title, '抽屉内容读取测试')
  assert.match(readContent.structuredContent.snapshot.text, /真正需要读到的正文/)
  assert.equal(readContent.structuredContent.snapshot.video.detected, true)
  assert.equal(readContent.structuredContent.snapshot.video.durationSeconds, 42)
  assert.equal(readContent.structuredContent.snapshot.finalUrl, `${fixture.baseUrl}/article`)
  assert.equal('canonicalUrl' in readContent.structuredContent.snapshot, false)
  assert.equal(readContent.structuredContent.snapshot.browserCapturePlan.needed, true)
  assert.equal(readContent.structuredContent.trust, 'untrusted_remote_content')
  assert.match(readContent.content[0].text, /UNTRUSTED REMOTE CONTENT/)
  assert.equal(readContent.content.some((entry) => entry.type === 'image'), true)
  assert.equal(fixture.articleReads, 1)

  const cachedContent = await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: source.id, detail: 'compact', max_images: 0, video_frames: 0 },
  })
  assert.equal(cachedContent.isError, undefined)
  assert.equal(cachedContent.structuredContent.cache.hit, true)
  assert.equal(fixture.articleReads, 1)

  const fullContent = await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: source.id, detail: 'full', max_images: 0, video_frames: 0, refresh: true },
  })
  assert.equal(fullContent.isError, undefined)
  assert.equal(fixture.articleReads, 2)
  await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: source.id, detail: 'compact', max_images: 0, video_frames: 0 },
  })
  assert.equal(fixture.articleReads, 2)
  const publicCachedItem = await bridge.store.get(source.id)
  const internalCachedItem = await bridge.store.getForContentRead(source.id)
  assert.equal('contentSnapshot' in publicCachedItem, false)
  assert.equal(publicCachedItem.contentRead.detail, 'full')
  assert.equal(internalCachedItem.contentSnapshot.detail, 'full')
  assert.equal(publicCachedItem.activity.filter((entry) => entry.type === 'content_read').length, 4)
  assert.equal(publicCachedItem.activity.some((entry) => entry.type === 'source_refreshed'), true)

  const restReadBefore = fixture.articleReads
  const restRead = await fetch(`${baseUrl}/api/pocket/items/${source.id}/read-content`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ detail: 'compact', maxImages: 0, videoFrames: 0 }),
  }).then(checkJson)
  assert.equal(restRead.cache.hit, true)
  assert.equal(fixture.articleReads, restReadBefore)

  await bridge.store.setContentSnapshot(source.id, {
    ...internalCachedItem.contentSnapshot,
    detail: 'full',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  })
  const staleFull = await bridge.store.getForContentRead(source.id)
  assert.equal(staleFull.contentSnapshot.fetchedAt, '2026-01-01T00:00:00.000Z')
  await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: source.id, detail: 'compact', max_images: 0, video_frames: 0 },
  })
  const refreshedExpiredCache = await bridge.store.getForContentRead(source.id)
  assert.equal(refreshedExpiredCache.contentSnapshot.detail, 'compact')
  assert.notEqual(refreshedExpiredCache.contentSnapshot.fetchedAt, '2026-01-01T00:00:00.000Z')

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
  assert.equal(dropped[0].message, '阿栖收到了：这个桌面灯')
  assert.equal(dropped[1].receipt.status, 'merged')
  assert.equal(dropped[1].message, '阿栖又收到一次，已经合并好了：这个桌面灯')
  assert.deepEqual(dropped[1].item.activity.filter((entry) => entry.type === 'received').map((entry) => entry.detail.count), [1, 2])

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
    arguments: { input: '阿栖我来啦', sourceApp: 'smoke', threadId: 'smoke-thread', turnId: 'smoke-turn' },
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
  const afterOpenRecord = await bridge.store.get(source.id)
  assert.equal(afterOpenRecord.activity.filter((entry) => entry.type === 'seen_by_aqi').length, 1)

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
      arguments: { id: source.id, text: '阿栖看见了。', reply_id: 'same-reply' },
    })
  }
  const afterReply = await bridge.store.get(source.id)
  assert.equal(afterReply.replies.length, 1)
  assert.equal(afterReply.activity.filter((entry) => entry.type === 'reply_added').length, 1)
  const activityCountBeforeReplyHide = afterReply.activity.length
  const hiddenReply = await fetch(`${baseUrl}/api/pocket/items/${source.id}/replies/same-reply`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hidden: true }),
  }).then(checkJson)
  assert.equal(hiddenReply.changed, true)
  assert.deepEqual(hiddenReply.item.replies, [])
  const afterReplyHide = await bridge.store.get(source.id)
  assert.deepEqual(afterReplyHide.replies, [])
  assert.equal(afterReplyHide.activity.length, activityCountBeforeReplyHide)

  const staged = await client.callTool({
    name: 'pocket_review',
    arguments: { id: source.id, action: 'memory_candidate' },
  })
  assert.equal(staged.isError, undefined)
  const afterStage = await bridge.store.get(source.id)
  assert.equal(afterStage.memoryCandidate.status, 'pending_sync')
  assert.equal(afterStage.memoryCandidate.candidateIds.length, 0)
  assert.equal(afterStage.activity.filter((entry) => entry.type === 'status_changed').length, 1)
  const activityBeforeSameStatus = afterStage.activity.length
  await client.callTool({ name: 'pocket_review', arguments: { id: source.id, action: 'memory_candidate' } })
  assert.equal((await bridge.store.get(source.id)).activity.length, activityBeforeSameStatus)

  const clearedMetadata = await fetch(`${baseUrl}/api/pocket/items/${source.id}/metadata`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clearCollection: true, tagsRemove: ['Ombre', 'continuity'] }),
  }).then(checkJson)
  assert.equal(clearedMetadata.item.collection, null)
  assert.deepEqual(clearedMetadata.item.tags, [])
  const serializedActivity = JSON.stringify(clearedMetadata.item.activity)
  assert.equal(serializedActivity.includes(dropSecret), false)
  assert.equal(serializedActivity.includes('真正需要读到的正文'), false)

  /* TRASH LIFECYCLE SMOKE V1 BEGIN */

  const trashCreated =
    await fetch(
      `${baseUrl}/api/pocket/items`,
      {
        method: 'POST',
        headers: {
          'content-type':
            'application/json',
        },
        body: JSON.stringify({
          text:
            'Trash lifecycle smoke item',
          sourceApp:
            'Trash Smoke',
        }),
      },
    ).then(checkJson)

  const trashId =
    trashCreated.item.id

  const firstTrash =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}/trash`,
      { method: 'POST' },
    ).then(checkJson)

  assert.equal(
    firstTrash.changed,
    true,
  )

  assert.ok(
    firstTrash.item.deletedAt,
  )

  const secondTrash =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}/trash`,
      { method: 'POST' },
    ).then(checkJson)

  assert.equal(
    secondTrash.changed,
    false,
  )

  const hiddenFromNormal =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}`,
    )

  assert.equal(
    hiddenFromNormal.status,
    404,
  )

  const trashListing =
    await fetch(
      `${baseUrl}/api/pocket/trash`,
    ).then(checkJson)

  assert.equal(
    trashListing.items.some(
      (item) => item.id === trashId,
    ),
    true,
  )

  const restored =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}/restore`,
      { method: 'POST' },
    ).then(checkJson)

  assert.equal(
    restored.changed,
    true,
  )

  assert.equal(
    restored.item.deletedAt,
    null,
  )

  const restoredAgain =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}/restore`,
      { method: 'POST' },
    ).then(checkJson)

  assert.equal(
    restoredAgain.changed,
    false,
  )

  const activePermanentDelete =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}`,
      { method: 'DELETE' },
    )

  assert.equal(
    activePermanentDelete.status,
    409,
  )

  await fetch(
    `${baseUrl}/api/pocket/items/${trashId}/trash`,
    { method: 'POST' },
  ).then(checkJson)

  const permanentlyDeleted =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}`,
      { method: 'DELETE' },
    ).then(checkJson)

  assert.equal(
    permanentlyDeleted.deleted,
    true,
  )

  const trashAfterPermanentDelete =
    await fetch(
      `${baseUrl}/api/pocket/trash`,
    ).then(checkJson)

  assert.equal(
    trashAfterPermanentDelete.items.some(
      (item) => item.id === trashId,
    ),
    false,
  )

  const restoreGone =
    await fetch(
      `${baseUrl}/api/pocket/items/${trashId}/restore`,
      { method: 'POST' },
    )

  assert.equal(
    restoreGone.status,
    404,
  )


  /*
    Real media cleanup smoke test.

    Inject one stored attachment into a dedicated
    test item, then verify permanent deletion
    removes the actual media file.
  */

  const mediaStorageName =
    `trash-smoke-${Date.now()}.bin`

  const mediaItem =
    await bridge.store.upsert({
      text:
        'Trash media cleanup smoke item',
      sourceApp:
        'Trash Smoke',
    })

  const mediaPath =
    path.join(
      dataDir,
      'media',
      mediaStorageName,
    )

  await writeFile(
    mediaPath,
    Buffer.from(
      'trash-media-smoke',
      'utf8',
    ),
  )

  const mediaState =
    JSON.parse(
      await readFile(
        storePath,
        'utf8',
      ),
    )

  const mediaStoredItem =
    mediaState.items.find(
      (item) => item.id === mediaItem.id,
    )

  assert.ok(mediaStoredItem)

  mediaStoredItem.attachments = [{
    id:
      `trash-attachment-${Date.now()}`,
    name:
      'trash-smoke.bin',
    mimeType:
      'application/octet-stream',
    size:
      Buffer.byteLength(
        'trash-media-smoke',
      ),
    storageName:
      mediaStorageName,
  }]

  await writeFile(
    storePath,
    JSON.stringify(
      mediaState,
      null,
      2,
    ),
    'utf8',
  )

  await bridge.store.trash(
    mediaItem.id,
    { actor: 'EE' },
  )

  const mediaDeletion =
    await bridge.store.permanentlyDelete(
      mediaItem.id,
    )

  assert.equal(
    mediaDeletion.mediaCleanupFailed.length,
    0,
  )

  assert.equal(
    mediaDeletion.mediaDeleted,
    1,
  )

  await assert.rejects(
    readFile(mediaPath),
    (error) =>
      error?.code === 'ENOENT',
  )

  /* TRASH LIFECYCLE SMOKE V1 END */

  await client.close()

  const publicDrawerSource = await readFile(path.join(process.cwd(), 'public', 'drawer.js'), 'utf8')
  assert.equal(/https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/api\//i.test(publicDrawerSource), false)
  assert.match(publicDrawerSource, /\/api\/pocket/)

  const bridgeToken = 'bridge-token-abcdefghijklmnopqrstuvwxyz-123456'
  const drawerSecret = 'drawer-secret-abcdefghijklmnopqrstuvwxyz-123456'
  authBridge = await startBridge({
    dataDir: authDataDir,
    port: 0,
    host: '127.0.0.1',
    bridgeToken,
    drawerSecret,
    dropSecret: 'auth-smoke-drop-secret-abcdefghijklmnopqrstuvwxyz-123456',
  })
  const authBaseUrl = `http://127.0.0.1:${authBridge.address.port}`
  const remoteHeaders = { 'x-forwarded-for': '203.0.113.9' }
  await authBridge.store.upsert({ id: 'browser-auth-item', text: 'browser auth metadata test' })

  const unauthorizedBrowser = await fetch(`${authBaseUrl}/api/pocket/items`, { headers: remoteHeaders })
  assert.equal(unauthorizedBrowser.status, 401)
  const unauthorizedMcp = await fetch(`${authBaseUrl}/mcp`, { headers: remoteHeaders })
  assert.equal(unauthorizedMcp.status, 401)
  const bearerRead = await fetch(`${authBaseUrl}/api/pocket/items`, {
    headers: { ...remoteHeaders, authorization: `Bearer ${bridgeToken}` },
  })
  assert.equal(bearerRead.status, 200)

  const wrongOriginLogin = await fetch(`${authBaseUrl}/drawer/session`, {
    method: 'POST',
    headers: { ...remoteHeaders, origin: 'https://not-the-drawer.example', 'content-type': 'application/json' },
    body: JSON.stringify({ secret: drawerSecret }),
  })
  assert.equal(wrongOriginLogin.status, 403)
  const browserLogin = await fetch(`${authBaseUrl}/drawer/session`, {
    method: 'POST',
    headers: { ...remoteHeaders, origin: authBaseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ secret: drawerSecret }),
  })
  assert.equal(browserLogin.status, 200)
  const sessionCookie = browserLogin.headers.get('set-cookie')?.split(';')[0]
  assert.match(sessionCookie || '', /^aqi_drawer_session=/)
  assert.match(browserLogin.headers.get('set-cookie') || '', /HttpOnly/i)
  assert.match(browserLogin.headers.get('set-cookie') || '', /SameSite=Strict/i)

  const browserRead = await fetch(`${authBaseUrl}/api/pocket/items`, {
    headers: { ...remoteHeaders, cookie: sessionCookie },
  }).then(checkJson)
  assert.equal(browserRead.items[0].id, 'browser-auth-item')

  const missingOriginWrite = await fetch(`${authBaseUrl}/api/pocket/items/browser-auth-item/metadata`, {
    method: 'PATCH',
    headers: { ...remoteHeaders, cookie: sessionCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ collection: 'Core Loop', tagsAdd: ['Ombre'] }),
  })
  assert.equal(missingOriginWrite.status, 401)
  const browserMetadata = await fetch(`${authBaseUrl}/api/pocket/items/browser-auth-item/metadata`, {
    method: 'PATCH',
    headers: { ...remoteHeaders, cookie: sessionCookie, origin: authBaseUrl, 'content-type': 'application/json' },
    body: JSON.stringify({ collection: 'Core Loop', tagsAdd: ['Ombre'] }),
  }).then(checkJson)
  assert.equal(browserMetadata.item.collection, 'Core Loop')
  assert.deepEqual(browserMetadata.item.tags, ['Ombre'])
  const refreshedBrowserItem = await fetch(`${authBaseUrl}/api/pocket/items/browser-auth-item`, {
    headers: { ...remoteHeaders, cookie: sessionCookie },
  }).then(checkJson)
  assert.equal(refreshedBrowserItem.item.collection, 'Core Loop')
  assert.deepEqual(refreshedBrowserItem.item.tags, ['Ombre'])

  console.log('Aqi Drawer MCP smoke test passed.')
} finally {
  if (authBridge) await authBridge.stop()
  if (bridge) await bridge.stop()
  if (fixture) await fixture.stop()
  await rm(dataDir, { recursive: true, force: true })
  await rm(authDataDir, { recursive: true, force: true })
}

async function checkJson(response) {
  const value = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(value))
  return value
}

async function startContentFixture() {
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlS8AAAAASUVORK5CYII=',
    'base64',
  )
  const state = { articleReads: 0 }
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      const timer = setInterval(() => res.write('.'), 100)
      res.once('close', () => clearInterval(timer))
      return
    }
    if (req.url === '/pixel.png') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': pixel.length })
      res.end(pixel)
      return
    }
    if (req.url === '/article') {
      state.articleReads += 1
      const origin = `http://${req.headers.host}`
      const html = `<!doctype html>
<html lang="zh-CN"><head>
<title>抽屉内容读取测试</title>
<link rel="canonical" href="http://169.254.169.254/latest/meta-data/">
<meta property="og:title" content="抽屉内容读取测试">
<meta property="og:description" content="短摘要，只保留有用信息。">
<meta property="og:site_name" content="Aqi Drawer Fixture">
<meta property="og:image" content="${origin}/pixel.png">
<meta property="og:type" content="video.other">
<script type="application/ld+json">{"@type":"Article","headline":"抽屉内容读取测试","author":{"name":"EE & Aqi"},"articleBody":"这是真正需要读到的正文，伊伊分享后阿栖可以按需看见。第二段用于确认多份 JSON-LD 不会漏掉正文。"}</script>
<script type="application/ld+json">{"@type":"VideoObject","name":"42 秒测试视频","description":"用于验证视频降级。","duration":"PT42S","thumbnailUrl":"${origin}/pixel.png"}</script>
</head><body><nav>不应进入正文的导航</nav><article><h1>抽屉内容读取测试</h1><p>这是真正需要读到的正文，伊伊分享后阿栖可以按需看见。</p><p>第二段用于确认正文提取没有只读标题。</p></article></body></html>`
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }
    res.writeHead(404).end('not found')
  })
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve)
    server.once('error', reject)
  })
  const address = server.address()
  return {
    get articleReads() { return state.articleReads },
    baseUrl: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}
