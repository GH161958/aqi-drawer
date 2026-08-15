import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { XhsAdapter, extractXhsUrl, parseXhsInitialState } from './adapters/xhs.js'
import { PocketContentReader } from './content-reader.js'
import { startBridge } from './index.js'
import { inferSourceApp } from './share-normalizer.js'
import { PocketStore } from './store.js'

const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlS8AAAAASUVORK5CYII=', 'base64')
const NOTE_ID = '6a7fa962000000000502ad54'
const SHORT_URL = 'https://xhslink.cn/o/test-note'
const FINAL_URL = `https://www.xiaohongshu.com/discovery/item/${NOTE_ID}`
const IMAGE_URLS = ['https://ci.xhscdn.com/test/one.jpg?token=first', 'https://ci.xhscdn.com/test/two.jpg?token=first']

assert.equal(extractXhsUrl(`美神 skill 降临!! ${SHORT_URL} 複製後開啟小紅書查看筆記`), SHORT_URL)
assert.equal(extractXhsUrl(SHORT_URL), SHORT_URL)
assert.equal(extractXhsUrl('https://xhslink.com/a/test-note'), 'https://xhslink.com/a/test-note')
assert.equal(extractXhsUrl(FINAL_URL), FINAL_URL)
assert.equal(extractXhsUrl('https://example.com/not-xhs'), '')
assert.equal(inferSourceApp(SHORT_URL), '小红书')

const parsed = parseXhsInitialState(xhsHtml(), { originalUrl: SHORT_URL, finalUrl: FINAL_URL })
assert.equal(parsed.noteId, NOTE_ID)
assert.equal(parsed.title, '一篇多图测试笔记')
assert.equal(parsed.author.name, '测试作者')
assert.equal(parsed.desc, '完整正文第一段\n完整正文第二段')
assert.deepEqual(parsed.tags, ['测试标签', '第二标签'])
assert.equal(parsed.images.length, 2)
assert.equal(parsed.comments.length, 1)
assert.equal(parsed.comments[0].replies.length, 1)
assert.equal(parsed.comments[0].replies[0].user.isAuthor, true)
assert.equal(parsed.commentsComplete, false)
assert.equal(parsed.interactions.likedCount, '12')

const fallback = parseXhsInitialState(`<script>window.__INITIAL_STATE__=${JSON.stringify({
  noteData: {
    normalNotePreloadData: {
      noteId: 'fallback-note-id',
      title: 'fallback note',
      desc: 'fallback body',
      user: { userId: 'fallback-author', nickname: 'fallback author' },
      imagesList: [{ urlSizeLarge: IMAGE_URLS[0], width: 800, height: 1200 }],
    },
  },
})};</script>`, { originalUrl: SHORT_URL, finalUrl: 'https://www.xiaohongshu.com/explore/fallback-note-id' })
assert.equal(fallback.noteId, 'fallback-note-id')
assert.equal(fallback.images.length, 1)

let pageRequests = 0
let imageRequests = 0
const adapter = new XhsAdapter({
  fetchImpl: async (url) => {
    pageRequests += 1
    if (url.href === SHORT_URL) return response('', { status: 302, headers: { location: FINAL_URL }, url: SHORT_URL })
    if (url.href === FINAL_URL) return response(xhsHtml(), { headers: { 'content-type': 'text/html' }, url: FINAL_URL })
    if (String(url).startsWith('https://ci.xhscdn.com/')) {
      imageRequests += 1
      return response(PIXEL, { headers: { 'content-type': 'image/png' }, url: String(url) })
    }
    throw new Error('Unexpected fixture URL.')
  },
})
const fetched = await adapter.parse(`分享文字 ${SHORT_URL}`)
assert.equal(fetched.noteId, NOTE_ID)
assert.equal(pageRequests, 2)
const loadedImage = await adapter.loadImage(IMAGE_URLS[0])
assert.equal(loadedImage.mimeType, 'image/png')
assert.equal(imageRequests, 1)
await assert.rejects(adapter.loadImage('https://example.com/not-allowed.jpg'), /host was not allowed/)

const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aqi-xhs-store-'))
try {
  let downloads = 0
  const store = new PocketStore(dataDir)
  await store.init()
  const loadImage = async () => {
    downloads += 1
    return { buffer: PIXEL, mimeType: 'image/png', width: 1, height: 1 }
  }
  const first = await store.upsertXhs({
    text: `分享文字 ${SHORT_URL}`,
    sourceUrl: SHORT_URL,
    sourceApp: '小红书',
    xhs: parsed,
  }, { loadImage })
  assert.equal(downloads, 2)
  assert.equal(first.attachments.length, 2)
  assert.equal(first.sourceIdentity.externalId, NOTE_ID)
  assert.equal(first.sourceData.comments[0].replies.length, 1)
  await store.reply(first.id, { text: '保留这条回复', author: 'Aqi', source: 'chatgpt' })
  await store.review(first.id, 'deferred')
  await store.takeUnseen({ limit: 8 })

  const refreshedXhs = {
    ...parsed,
    title: '刷新后的标题',
    interactions: { ...parsed.interactions, likedCount: '99', commentCount: '8' },
    images: parsed.images.map((image) => ({ ...image, url: image.url.replace('token=first', 'token=rotated') })),
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  const second = await store.upsertXhs({ text: `再次分享 ${FINAL_URL}`, sourceUrl: FINAL_URL, xhs: refreshedXhs }, { loadImage })
  assert.equal(second.id, first.id)
  assert.equal((await store.list()).length, 1)
  assert.equal(second.receivedCount, 2)
  assert.equal(second.status, 'deferred')
  assert.equal(second.replies.length, 1)
  assert.equal(second.seenByCAt, null)
  assert.equal(second.sourceData.interactions.likedCount, '99')
  assert.equal(downloads, 2, 'rotating query tokens must not redownload complete images')

  const missing = await store.getAttachmentFile(second.attachments[0].id)
  await rm(missing.filePath)
  const third = await store.upsertXhs({ text: `第三次分享 ${FINAL_URL}`, sourceUrl: FINAL_URL, xhs: refreshedXhs }, { loadImage })
  assert.equal(third.id, first.id)
  assert.equal(third.receivedCount, 3)
  assert.equal(downloads, 3, 'only the missing image should be retried')

  const withNewImage = {
    ...refreshedXhs,
    images: [...refreshedXhs.images, { index: 3, url: 'https://ci.xhscdn.com/test/three.jpg', width: 1080, height: 1440 }],
  }
  const fourth = await store.upsertXhs({ text: `第四次分享 ${FINAL_URL}`, sourceUrl: FINAL_URL, xhs: withNewImage }, { loadImage })
  assert.equal(fourth.attachments.length, 3)
  assert.equal(downloads, 4, 'only a newly added image should be downloaded')

  let failSecondImage = true
  let partialDownloads = 0
  const partialXhs = { ...parsed, noteId: 'partial-note-id', externalId: 'partial-note-id' }
  const partialLoader = async (url) => {
    partialDownloads += 1
    if (url.includes('/two.') && failSecondImage) throw new Error('fixture image failure')
    return { buffer: PIXEL, mimeType: 'image/png', width: 1, height: 1 }
  }
  const partial = await store.upsertXhs({ text: 'partial', sourceUrl: FINAL_URL, xhs: partialXhs }, { loadImage: partialLoader })
  assert.equal(partial.sourceData.parseStatus, 'partial')
  assert.equal(partial.attachments.length, 1)
  failSecondImage = false
  const repaired = await store.upsertXhs({ text: 'partial retry', sourceUrl: FINAL_URL, xhs: partialXhs }, { loadImage: partialLoader })
  assert.equal(repaired.sourceData.parseStatus, 'complete')
  assert.equal(repaired.attachments.length, 2)
  assert.equal(partialDownloads, 3, 'the ready image is reused and only the failed image is retried')

  const reader = new PocketContentReader({ store })
  const read = await reader.read(await store.getForContentRead(first.id), { detail: 'full', maxImages: 2, videoFrames: 0 })
  assert.equal(read.snapshot.extraction.source, 'stored_xhs_adapter')
  assert.equal(read.snapshot.sourceData.comments[0].replies.length, 1)
  assert.equal(read.media.length, 2)
  assert.equal(read.cache.hit, true)

  const restartedStore = new PocketStore(dataDir)
  await restartedStore.init()
  const persisted = await restartedStore.get(first.id)
  assert.equal(persisted.sourceData.noteId, NOTE_ID)
  assert.equal(persisted.attachments.length, 3)
  assert.equal((await restartedStore.readAttachment(persisted.attachments[0].id)).data.length, PIXEL.length)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}

const bridgeData = await mkdtemp(path.join(os.tmpdir(), 'aqi-xhs-drop-'))
const DROP_SECRET = 'xhs-test-drop'
let bridge
let client
try {
  let parseCount = 0
  let downloadCount = 0
  const fixtureAdapter = {
    canHandle: (value) => Boolean(extractXhsUrl(value)),
    parse: async (value) => {
      if (String(value).includes('fail-note')) throw new Error('fixture parse failure')
      parseCount += 1
      return { ...parsed, interactions: { ...parsed.interactions, likedCount: String(20 + parseCount) } }
    },
    loadImage: async () => {
      downloadCount += 1
      return { buffer: PIXEL, mimeType: 'image/png', width: 1, height: 1 }
    },
  }
  bridge = await startBridge({
    dataDir: bridgeData,
    port: 0,
    host: '127.0.0.1',
    dropSecret: DROP_SECRET,
    xhsAdapter: fixtureAdapter,
  })
  const baseUrl = `http://127.0.0.1:${bridge.address.port}`
  const share = `一篇分享文案 ${SHORT_URL} 複製後開啟小紅書查看筆記`
  const firstDrop = await fetch(`${baseUrl}/drop/${DROP_SECRET}?response=json`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ share, sourceApp: 'iPhone 分享菜单' }),
  }).then(checkJson)
  const secondDrop = await fetch(`${baseUrl}/drop/${DROP_SECRET}?response=json`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ share, sourceApp: 'iPhone 分享菜单' }),
  }).then(checkJson)
  assert.equal(firstDrop.item.id, secondDrop.item.id)
  assert.equal(secondDrop.item.receivedCount, 2)
  assert.equal(secondDrop.item.sourceData.provider, 'xiaohongshu')
  assert.equal(downloadCount, 2)
  assert.equal(parseCount, 2)

  const failedDrop = await fetch(`${baseUrl}/drop/${DROP_SECRET}?response=json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ share: '仍然要保存 https://xhslink.cn/o/fail-note', sourceApp: 'iPhone 分享菜单' }),
  }).then(checkJson)
  assert.equal(failedDrop.item.sourceData.provider, 'xiaohongshu')
  assert.equal(failedDrop.item.sourceData.parseStatus, 'failed')
  assert.match(failedDrop.item.text, /仍然要保存/)

  client = new Client({ name: 'aqi-xhs-mcp-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))
  const got = await client.callTool({ name: 'pocket_get', arguments: { id: firstDrop.item.id } })
  assert.equal(got.structuredContent.item.sourceData.noteId, NOTE_ID)
  assert.equal(got.content.filter((entry) => entry.type === 'image').length, 2)
  const deep = await client.callTool({
    name: 'pocket_read_content',
    arguments: { id: firstDrop.item.id, detail: 'full', max_images: 2, video_frames: 0 },
  })
  assert.equal(deep.structuredContent.snapshot.extraction.source, 'stored_xhs_adapter')
  assert.equal(deep.content.filter((entry) => entry.type === 'image').length, 2)
  assert.match(deep.content[0].text, /公开首屏评论/)
} finally {
  if (client) await client.close()
  if (bridge) await bridge.stop()
  await rm(bridgeData, { recursive: true, force: true })
}

console.log('Aqi Drawer XHS integration test passed.')

function xhsHtml() {
  const state = {
    noteData: {
      data: {
        noteData: {
          noteId: NOTE_ID,
          title: '一篇多图测试笔记',
          desc: '完整正文第一段\n完整正文第二段',
          user: { userId: 'author-1', nickName: '测试作者', avatar: 'https://ci.xhscdn.com/avatar/test.jpg' },
          imageList: IMAGE_URLS.map((url, index) => ({ url, width: 1080, height: 1440 + index })),
          tagList: [{ name: '测试标签' }, { name: '第二标签' }],
          interactInfo: { likedCount: '12', collectedCount: '7', commentCount: '3', shareCount: '2' },
        },
        commentData: {
          commentCount: '3',
          comments: [{
            id: 'comment-1',
            user: { userId: 'reader-1', nickname: '读者' },
            content: '首屏评论',
            likeViewCount: '1',
            ipLocation: '上海',
            createTime: 1_700_000_000,
            subComments: [{
              id: 'reply-1',
              user: { userId: 'author-1', nickname: '测试作者' },
              content: '作者回复',
              likeCount: 0,
              ipLocation: '北京',
              createTime: 1_700_000_100,
            }],
          }],
        },
      },
      ignored: '__UNDEFINED__',
      notANumber: '__NAN__',
      infinite: '__INFINITY__',
    },
  }
  const json = JSON.stringify(state)
    .replace('"__UNDEFINED__"', 'undefined')
    .replace('"__NAN__"', 'NaN')
    .replace('"__INFINITY__"', 'Infinity')
  return `<html><script>window.__INITIAL_STATE__=${json};</script></html>`
}

function response(body, { status = 200, headers = {}, url = '' } = {}) {
  const responseValue = new Response(body, { status, headers })
  Object.defineProperty(responseValue, 'url', { value: url })
  return responseValue
}

async function checkJson(responseValue) {
  const body = await responseValue.json()
  assert.equal(responseValue.ok, true, JSON.stringify(body))
  return body
}
