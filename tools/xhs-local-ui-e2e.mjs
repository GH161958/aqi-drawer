// Optional local acceptance runner: build React with --base=/drawer-next/ into react-dist first.
// Playwright is a local development tool, not a runtime application dependency.
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { startBridge } from '../server/index.js'
const { chromium } = await import(process.env.XHS_PLAYWRIGHT_MODULE || 'playwright')
const output = await mkdtemp(path.join(tmpdir(), 'xhs-local-ui-evidence-'))
const dataDir = await mkdtemp(path.join(tmpdir(), 'xhs-local-ui-store-'))
let browser
let bridge
try {
  browser = await chromium.launch({ headless: true, ...(process.env.XHS_BROWSER_EXECUTABLE ? { executablePath: process.env.XHS_BROWSER_EXECUTABLE } : {}) })
  const art = await browser.newPage({ viewport: { width: 600, height: 800 } })
  await art.setContent('<html style="background:#e8d9c6;color:#564638;font:32px sans-serif"><body style="padding:80px">SYNTHETIC XHS<br><br>原位恢复<br><br>NO PERSONAL CONTENT</body></html>')
  const buffer = await art.screenshot(); await art.close()
  const short = 'https://xhslink.cn/o/synthetic-local-click'
  let mode = 'failed'
  let parses = 0
  bridge = await startBridge({ dataDir, host: '127.0.0.1', port: 0, xhsAdapter: {
    canHandle: () => true,
    parse: async () => {
      parses++
      if (mode === 'failed') throw Object.assign(new Error('synthetic timeout'), { code: 'XHS_TIMEOUT', stage: 'request' })
      return { provider: 'xiaohongshu', parseStatus: 'complete', noteId: 'abcdef123456789012345678', originalUrl: short, canonicalUrl: 'https://www.xiaohongshu.com/explore/abcdef123456789012345678', title: '合成小红书点击验收', desc: '仅合成内容，无私人文件。', images: [{ index: 1, url: 'https://ci.xhscdn.com/synthetic.png' }] }
    },
    loadImage: async () => ({ buffer, mimeType: 'image/png' }),
  } })
  const base = `http://127.0.0.1:${bridge.address.port}`
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await page.goto(`${base}/drawer-next/`)
  await page.getByRole('button', { name: '留给阿栖', exact: true }).click()
  await page.getByPlaceholder('给这张纸起个名字……').fill('合成小红书点击验收')
  await page.getByPlaceholder('粘贴一个链接，或留下一段文字……').fill(`完整中文分享文字 ${short}，複製後開啟小紅書查看筆記。`)
  await page.screenshot({ path: path.join(output, '01-paste.png'), fullPage: true })
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/pocket/items/upload') && response.request().method() === 'POST')
  await page.getByRole('button', { name: '收好 →', exact: true }).click()
  const captured = await (await savedResponse).json()
  const id = captured.item.id
  assert.equal(captured.item.sourceData.parseStatus, 'failed')
  await page.getByText('都在这里', { exact: true }).click()
  await page.getByText('小红书 · 待补全', { exact: true }).first().waitFor()
  await page.screenshot({ path: path.join(output, '02-fallback.png'), fullPage: true })
  await page.getByText('合成小红书点击验收', { exact: true }).first().click()
  const retry = page.getByRole('button', { name: '重新读取来源', exact: true })
  await retry.click()
  await page.getByRole('alert').filter({ hasText: '超时' }).waitFor()
  await page.screenshot({ path: path.join(output, '03-retry-error.png'), fullPage: true })
  assert.equal((await bridge.store.list()).length, 1)
  mode = 'ready'
  await retry.click(); await retry.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '← 放回', exact: true }).click()
  await page.locator('button[data-presentation-kind=photo]').waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(output, '04-recovered.png'), fullPage: true })
  const item = await bridge.store.get(id)
  assert.equal(item.id, id); assert.equal(item.sourceData.parseStatus, 'complete'); assert.equal(item.attachments.length, 1)
  assert.equal((await bridge.store.list()).length, 1); assert.equal(item.receivedCount, 1)
  assert.deepEqual((await bridge.store.readAttachment(item.attachments[0].id)).data, buffer)
  const receipt = { viewport: 375, sameItemId: true, items: 1, attachments: 1, parseCalls: parses, sha256: createHash('sha256').update(buffer).digest('hex'), result: 'PASS' }
  await writeFile(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify({ ...receipt, evidenceDirectory: output }))
} finally {
  await browser?.close(); await bridge?.stop(); await rm(dataDir, { recursive: true, force: true })
}
