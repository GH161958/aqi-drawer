import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { startBridge } from '../server/index.js'
import { XhsAdapter } from '../server/adapters/xhs.js'
// Optional local Playwright module; not an application dependency. All content is synthetic.
const { chromium } = await import(process.env.XHS_PLAYWRIGHT_MODULE || 'playwright')
const dataDir = await mkdtemp(path.join(tmpdir(), 'xhs-canonical-ui-store-'))
const output = await mkdtemp(path.join(tmpdir(), 'xhs-canonical-ui-evidence-'))
let browser; let bridge
try {
  browser = await chromium.launch({ headless: true, ...(process.env.XHS_BROWSER_EXECUTABLE ? { executablePath: process.env.XHS_BROWSER_EXECUTABLE } : {}) })
  const art = await browser.newPage({ viewport: { width: 600, height: 800 } })
  await art.setContent('<html style="background:#e8d9c6;font:32px sans-serif;color:#564638"><body style="padding:80px">SYNTHETIC XHS<br><br>正式链接补全<br><br>NO PERSONAL CONTENT</body></html>')
  const image = await art.screenshot(); await art.close()
  const noteId = 'abcdef123456789012345678'; const wrongId = '1234567890abcdef12345678'
  const token = 'synthetic-ui-token-only'
  const canonical = id => `https://www.xiaohongshu.com/explore/${id}?xsec_token=${token}&xsec_source=app_share`
  let downloads = 0
  const adapter = new XhsAdapter({ fetchImpl: async url => {
    if (url.hostname === 'xhslink.cn') throw new DOMException('synthetic timeout', 'TimeoutError')
    if (url.hostname === 'ci.xhscdn.com') { downloads++; return new Response(image, { headers: { 'content-type': 'image/png' } }) }
    if (url.pathname.startsWith('/explore/')) return new Response('', { status: 302, headers: { location: url.href.replace('/explore/', '/discovery/item/') } })
    const id = url.pathname.split('/').at(-1)
    const html = `<script>window.__INITIAL_STATE__=${JSON.stringify({ noteData: { data: { noteData: { noteId: id, title: id === wrongId ? '另一篇合成笔记 · 请勿确认' : '正式来源 · 合成预览标题', desc: '合成正文已真实提取，不是热链接图片。', imageList: [{ url: `https://ci.xhscdn.com/synthetic.png?xsec_token=${token}` }] } } } })};</script>`
    const result = new Response(html); Object.defineProperty(result, 'url', { value: url.href }); return result
  } })
  bridge = await startBridge({ dataDir, host: '127.0.0.1', port: 0, xhsAdapter: adapter })
  const other = await bridge.store.upsert({ title: '另一张未解析纸', text: '其他原始分享', sourceUrl: 'https://xhslink.cn/o/synthetic-other', sourceData: { provider: 'xiaohongshu', parseStatus: 'failed', originalUrl: 'https://xhslink.cn/o/synthetic-other' } })
  const short = 'https://xhslink.cn/o/synthetic-selected'
  const sharedText = `完整中文分享 ${short}，複製後開啟小紅書查看筆記。`
  const base = `http://127.0.0.1:${bridge.address.port}`
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
  await page.goto(`${base}/drawer-next/`)
  await page.getByRole('button', { name: '留给阿栖', exact: true }).click()
  await page.getByPlaceholder('给这张纸起个名字……').fill('合成待补全 XHS 原纸')
  await page.getByPlaceholder('粘贴一个链接，或留下一段文字……').fill(sharedText)
  const saved = page.waitForResponse(r => r.url().endsWith('/api/pocket/items/upload') && r.request().method() === 'POST')
  await page.getByRole('button', { name: '收好 →', exact: true }).click()
  const first = (await (await saved).json()).item
  await page.getByText('都在这里', { exact: true }).click()
  await page.getByText('合成待补全 XHS 原纸', { exact: true }).first().click()
  await page.getByRole('button', { name: '用正式链接补全这张纸', exact: true }).click()
  const field = page.getByPlaceholder('粘贴 www.xiaohongshu.com 的正式笔记链接')
  await field.fill(canonical(wrongId)); await page.getByRole('button', { name: '解析并预览', exact: true }).click()
  await page.getByText('预览：另一篇合成笔记 · 请勿确认', { exact: true }).waitFor()
  assert.equal(downloads, 0)
  await page.screenshot({ path: path.join(output, '01-wrong-note-preview.png'), fullPage: true })
  await page.getByRole('button', { name: '取消补全', exact: true }).click()
  assert.deepEqual(await bridge.store.get(first.id), first)
  await page.getByRole('button', { name: '用正式链接补全这张纸', exact: true }).click()
  await field.fill(canonical(noteId)); await page.getByRole('button', { name: '解析并预览', exact: true }).click()
  await page.getByText('预览：正式来源 · 合成预览标题', { exact: true }).waitFor()
  assert.equal(downloads, 0); assert.ok(!(await page.locator('body').innerText()).includes(token))
  await page.screenshot({ path: path.join(output, '02-confirm-preview.png'), fullPage: true })
  const confirmedResponse = page.waitForResponse(r => r.url().endsWith('/xhs-canonical/confirm'))
  await page.getByRole('button', { name: '确认是同一篇，补全原收藏', exact: true }).click()
  assert.equal((await confirmedResponse).status(), 200)
  await page.getByRole('button', { name: '确认是同一篇，补全原收藏', exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '← 放回', exact: true }).click()
  await page.locator('button[data-presentation-kind=photo]').waitFor(); await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(output, '03-same-item-photo.png'), fullPage: true })
  const item = await bridge.store.get(first.id)
  assert.equal(item.id, first.id); assert.equal(item.receivedCount, first.receivedCount); assert.equal(item.sourceData.originalUrl, short); assert.equal(item.sourceData.sharedText, sharedText)
  assert.equal(item.attachments.length, 1); assert.equal(item.attachments[0].sha256, createHash('sha256').update(image).digest('hex'))
  assert.deepEqual((await bridge.store.readAttachment(item.attachments[0].id)).data, image)
  assert.equal((await bridge.store.list()).length, 2); assert.equal(downloads, 1)
  await page.getByText('另一张未解析纸', { exact: true }).first().click()
  await page.getByRole('button', { name: '用正式链接补全这张纸', exact: true }).click()
  await field.fill(canonical(noteId)); await page.getByRole('button', { name: '解析并预览', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '另一张纸' }).waitFor()
  await page.screenshot({ path: path.join(output, '04-collision.png'), fullPage: true })
  assert.deepEqual(await bridge.store.get(other.id), other); assert.equal(downloads, 1)
  const serialized = await readFile(path.join(dataDir, 'pocket-store.json'), 'utf8')
  assert.ok(!serialized.includes(token)); assert.ok(!serialized.includes('xsec_token'))
  const receipt = { result: 'PASS', viewport: 375, sameItemId: true, items: 2, untouchedOtherAlias: true, receivedCountUnchanged: true, downloads, sha256: item.attachments[0].sha256, wrongNoteCancelled: true, collisionRejected: true, newCanonicalTokenPersisted: false }
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ ...receipt, evidenceDirectory: output }))
} finally {
  await browser?.close(); await bridge?.stop(); await rm(dataDir, { recursive: true, force: true })
}
