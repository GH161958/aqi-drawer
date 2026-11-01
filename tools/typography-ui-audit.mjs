import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { startBridge } from '../server/index.js'
const { chromium } = await import(process.env.XHS_PLAYWRIGHT_MODULE || 'playwright')
const phase = process.env.TYPOGRAPHY_PHASE || 'after'
assert.ok(['before', 'after'].includes(phase), 'Use before or after capture mode')
const output = process.env.TYPOGRAPHY_OUTPUT || await mkdtemp(path.join(tmpdir(), 'drawer-typography-evidence-'))
await mkdir(output, { recursive: true })
const baseline = phase === 'after' ? await readFile(path.join(output, 'before-metrics.json'), 'utf8').then(JSON.parse).catch(() => []) : []
const dataDir = await mkdtemp(path.join(tmpdir(), 'drawer-typography-store-'))
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WlS8AAAAASUVORK5CYII=', 'base64')
const records = []; let bridge; let browser; let sequence = 0; let mode = ''; let release
const reading = '原有正文：这张纸记录 Typography consistency，中英文 mixed text 与标点应保持安静、清晰。'
const longTitle = '合成预览 Preview · 一个很长的中英文标题用于检查窄屏换行与文字层级一致性'
try {
  bridge = await startBridge({ dataDir, host: '127.0.0.1', port: 0, xhsAdapter: {
    async parse(source) {
      if (mode === 'retry') await new Promise(resolve => { release = resolve })
      const id = new URL(source).pathname.split('/').at(-1)
      return { provider: 'xiaohongshu', parseStatus: 'complete', noteId: id, originalUrl: source, canonicalUrl: source, title: longTitle, desc: reading, images: [{ index: 1, url: 'https://ci.xhscdn.com/synthetic-1.png' }, { index: 2, url: 'https://ci.xhscdn.com/synthetic-2.png' }] }
    },
    async loadImage(source) {
      if (mode === 'confirming' && source.includes('-1')) await new Promise(resolve => { release = resolve })
      if (mode === 'partial' && source.includes('-2')) throw new Error('synthetic image failure')
      return { buffer: image, mimeType: 'image/png' }
    },
  } })
  browser = await chromium.launch({ headless: true, ...(process.env.XHS_BROWSER_EXECUTABLE ? { executablePath: process.env.XHS_BROWSER_EXECUTABLE } : {}) })
  const base = `http://127.0.0.1:${bridge.address.port}`
  for (const width of [375, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 1050 }, deviceScaleFactor: 1 })
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort())
    for (const state of ['collapsed', 'input', 'preview', 'confirming', 'partial', 'error', 'success', 'retry']) {
      mode = state; release = null
      const number = ++sequence; const noteId = number.toString(16).padStart(24, '0')
      const title = `合成 Typography ${number}`
      const item = await bridge.store.upsert({ title, text: reading, sourceUrl: `https://xhslink.cn/o/synthetic-typography-${number}`, sourceData: { provider: 'xiaohongshu', parseStatus: 'failed' } })
      await page.goto(`${base}/drawer-next/`)
      await page.getByText('都在这里', { exact: true }).click()
      await page.getByText(title, { exact: true }).first().click()
      const panel = page.getByRole('region', { name: '小红书来源恢复', exact: true })
      await panel.waitFor()
      if (state === 'retry') {
        await page.getByRole('button', { name: '重新读取来源', exact: true }).click()
        await page.getByRole('button', { name: '正在重新读取来源…', exact: true }).waitFor()
      } else if (state !== 'collapsed') {
        await page.getByRole('button', { name: '用正式链接补全这张纸', exact: true }).click()
        await page.getByPlaceholder('粘贴 www.xiaohongshu.com 的正式笔记链接').fill(state === 'error' ? 'https://example.com/not-a-note' : `https://www.xiaohongshu.com/explore/${noteId}?xsec_token=synthetic-only`)
        if (state !== 'input') {
          await page.getByRole('button', { name: '解析并预览', exact: true }).click()
          if (state === 'error') await page.getByRole('alert').waitFor()
          else {
            await page.getByText(`预览：${longTitle}`, { exact: true }).waitFor()
            if (['confirming', 'partial', 'success'].includes(state)) {
              await page.getByRole('button', { name: '确认是同一篇，补全原收藏', exact: true }).click()
              if (state === 'confirming') await page.getByRole('button', { name: '正在保存原件（最多约 30 秒）…', exact: true }).waitFor()
              else if (state === 'partial') await page.getByText('图片：已保存 1 / 失败 1 / 共 2 张。可重新读取来源，仅补齐缺失原件。', { exact: true }).waitFor()
              else await panel.waitFor({ state: 'detached' })
            }
          }
        }
      }
      const article = page.locator('article[data-presentation-kind]').last()
      if (state !== 'success') await panel.scrollIntoViewIfNeeded()
      await page.screenshot({ path: path.join(output, `${phase}-${width}-${state}.png`) })
      const sample = await article.evaluate(root => {
        const type = element => {
          if (!element) return null
          const style = getComputedStyle(element)
          return Object.fromEntries(['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'].map(key => [key, style[key]]))
        }
        const body = root.querySelector('div[class*="body"] > p')
        const shell = root.querySelector('section[aria-label="小红书来源恢复"]')
        const field = root.querySelector('textarea')
        const placeholder = field ? getComputedStyle(field, '::placeholder') : null
        return { body: type(body), status: type(shell?.querySelector(':scope > p')), action: type(shell?.querySelector('button')), referenceAction: type(root.querySelector('footer a')), label: type(root.querySelector('label')), input: type(field), placeholder: placeholder ? { fontSize: placeholder.fontSize, fontFamily: placeholder.fontFamily } : null, error: type(root.querySelector('[role="alert"]')), identity: type(root.querySelector('p[class*="canonicalIdentity"]')), overflow: root.scrollWidth > root.clientWidth + 1 }
      })
      if (phase === 'after') {
        const original = baseline.find(record => record.width === width && record.state === state)
        if (original) { assert.deepEqual(sample.body, original.body, 'Original body must stay unchanged'); assert.deepEqual(sample.referenceAction, original.referenceAction, 'Original action must stay unchanged') }
        assert.equal(sample.overflow, false, `${width}/${state} horizontal overflow`)
        if (sample.status) assert.deepEqual(sample.status, sample.body, `${width}/${state} body inheritance`)
        if (sample.action) assert.deepEqual(sample.action, sample.referenceAction, `${width}/${state} action inheritance`)
        if (sample.input) { assert.equal(sample.input.fontSize, '16px'); assert.equal(sample.placeholder.fontSize, sample.input.fontSize); assert.equal(sample.placeholder.fontFamily, sample.input.fontFamily) }
        if (['collapsed', 'input', 'error'].includes(state)) {
          const custom = await article.evaluate(root => {
            root.style.setProperty('--inspect-original-font-reading', 'Georgia, serif')
            root.style.setProperty('--inspect-original-font-ui', 'Arial, sans-serif')
            const family = selector => getComputedStyle(root.querySelector(selector)).fontFamily
            const result = { body: family('div[class*="body"] > p'), status: family('section[aria-label="小红书来源恢复"] > p'), action: family('section[aria-label="小红书来源恢复"] button'), reference: family('footer a'), input: root.querySelector('textarea') ? family('textarea') : null, error: root.querySelector('[role="alert"]') ? family('[role="alert"]') : null }
            root.style.removeProperty('--inspect-original-font-reading'); root.style.removeProperty('--inspect-original-font-ui')
            return result
          })
          assert.equal(custom.body, custom.status); assert.equal(custom.action, custom.reference)
          assert.ok(custom.body.includes('Georgia')); assert.ok(custom.action.includes('Arial'))
          if (custom.input) assert.equal(custom.input, custom.body)
          if (custom.error) assert.equal(custom.error, custom.body)
        }
      }
      records.push({ width, state, ...sample })
      // Complete pending fixture work before moving on; no real network is involved.
      mode = ''
      for (let i = 0; i < 100 && !release && ['confirming', 'retry'].includes(state); i++) await new Promise(resolve => setTimeout(resolve, 5))
      release?.(); release = null
      if (['confirming', 'retry'].includes(state)) await panel.waitFor({ state: 'detached' })
      if (state === 'success') assert.equal((await bridge.store.get(item.id)).sourceData.parseStatus, 'complete')
    }
    await page.close()
  }
  await writeFile(path.join(output, `${phase}-metrics.json`), JSON.stringify(records, null, 2))
  console.log(JSON.stringify({ phase, output, scenarios: records.length, result: 'PASS', syntheticOnly: true }))
} finally {
  release?.(); await browser?.close(); await bridge?.stop(); await rm(dataDir, { recursive: true, force: true })
}
