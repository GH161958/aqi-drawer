import { randomBytes, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createMcpFileOperation } from './mcp-file-operation.js'
import { canonicalXhsUrl, storedXhsNoteId, xhsItemVersion } from './xhs-canonical-url.js'

const fail = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra })
export function createXhsCanonicalRecovery({ store, adapter, ttlMs = 120_000, budgetMs = 30_000, capacity = 32 }) {
  const tickets = new Map(); const preparing = new Map(); const committing = new Map(); const operations = new Set()
  const drop = (key, entry) => { clearTimeout(entry.timer); entry.xhs = null; tickets.delete(key) }
  const live = entry => entry && performance.now() < entry.until
  const operation = duration => { const op = createMcpFileOperation({ budgetMs: Math.min(budgetMs, duration) }); operations.add(op); return op }
  const release = op => { op.dispose(); operations.delete(op) }
  const selected = async id => {
    const item = await store.get(id)
    if (!item) throw fail(404, 'XHS_ITEM_MISSING', '原收藏不存在，请返回抽屉检查。')
    if (item.sourceData?.provider !== 'xiaohongshu' || !['failed', 'partial'].includes(item.sourceData.parseStatus)) throw fail(409, 'XHS_ITEM_STATE', '仅支持待补全的小红书收藏。')
    return item
  }
  const collision = async (id, noteId) => {
    const other = await store.findXhsIdentityConflict(id, noteId)
    if (other) throw fail(409, 'XHS_IDENTITY_CONFLICT', '这篇笔记已属于另一张纸；未合并或修改，请人工检查。', { candidate: other })
  }
  async function prepare({ id, url, owner }) {
    if (!owner) throw fail(401, 'XHS_OWNER_REQUIRED', '需要抽屉所有者授权。')
    const source = canonicalXhsUrl(url)
    const hash = createHash('sha256').update(source.url).digest('hex')
    const key = `${owner}:${id}:${hash}`
    if (preparing.has(key)) return preparing.get(key)
    if (preparing.size >= 8 || tickets.size >= capacity) throw fail(429, 'XHS_PREVIEW_BUSY', '预览暂时繁忙，请稍后再试。')
    const op = operation(budgetMs)
    const promise = op.wait((async () => {
      const item = await selected(id)
      op.check()
      const known = storedXhsNoteId(item)
      if (known && known !== source.noteId) throw fail(409, 'XHS_NOTE_MISMATCH', '正式链接与这张纸已知的笔记身份不同。')
      const xhs = structuredClone(await op.wait(adapter.parse(source.url, { signal: op.signal, httpsOnly: true })))
      const final = new URL(xhs.canonicalUrl); final.search = ''; final.hash = ''
      if (xhs.provider !== 'xiaohongshu' || xhs.parseStatus !== 'complete' || xhs.noteId !== source.noteId || canonicalXhsUrl(final.href).noteId !== source.noteId) throw fail(409, 'XHS_NOTE_MISMATCH', '解析结果与粘贴链接的笔记身份不一致。')
      await collision(id, source.noteId)
      if (xhsItemVersion(await selected(id)) !== xhsItemVersion(item)) throw fail(409, 'XHS_STALE_PREVIEW', '这张纸已改变，请重新预览。')
      op.check()
      if (tickets.size >= capacity) throw fail(429, 'XHS_PREVIEW_BUSY', '预览暂时繁忙，请稍后再试。')
      const token = randomBytes(32).toString('base64url')
      const entry = { id, owner, hash, version: xhsItemVersion(item), originalUrl: item.sourceData.originalUrl || item.sourceUrl, xhs, recoveryUrl: final.href, until: performance.now() + ttlMs, expiresAt: Date.now() + ttlMs }
      entry.timer = setTimeout(() => drop(token, entry), ttlMs); entry.timer.unref?.()
      tickets.set(token, entry)
      return { ticket: token, expiresAt: entry.expiresAt, item: { id, title: item.title }, note: { title: String(xhs.title || '小红书笔记').slice(0, 160), noteIdHint: `${source.noteId.slice(0, 4)}…${source.noteId.slice(-4)}`, imageCount: Math.min(xhs.images?.length || 0, 30) } }
    })()).finally(() => { release(op); preparing.delete(key) })
    preparing.set(key, promise)
    return promise
  }
  function entryFor({ id, ticket, owner }) {
    const entry = typeof ticket === 'string' && ticket.length === 43 ? tickets.get(ticket) : null
    if (!owner || !live(entry) || entry.id !== id || entry.owner !== owner) throw fail(410, 'XHS_PREVIEW_EXPIRED', '预览已失效，请重新粘贴正式链接。')
    return entry
  }
  function confirm(args) {
    const entry = entryFor(args)
    if (entry.result) return store.get(entry.id).then(item => {
      if (!item) throw fail(410, 'XHS_PREVIEW_EXPIRED', '原收藏已不存在，未恢复已删除内容。')
      return { item }
    })
    if (entry.promise) return entry.promise
    if (entry.used) throw fail(410, 'XHS_PREVIEW_USED', '确认已结束，请重新预览。')
    if (committing.has(entry.id)) throw fail(409, 'XHS_COMMIT_BUSY', '这张纸正在补全，请等待后重新预览。')
    entry.used = true
    const remaining = entry.until - performance.now()
    if (!(remaining > 0)) throw fail(410, 'XHS_PREVIEW_EXPIRED', '预览已失效，请重新粘贴正式链接。')
    const op = operation(remaining)
    const checkIntent = () => { if (!live(entry)) op.cancel(); op.check() }
    const authorization = {
      check: checkIntent,
      publish(write) { checkIntent(); return op.publish(write) },
      get accepted() { return op.accepted },
    }
    const xhs = entry.xhs
    const promise = op.wait(store.upsertXhs({ sourceUrl: entry.originalUrl, xhs }, {
      targetItemId: entry.id, expectedSourceUrl: entry.originalUrl, expectedItemVersion: entry.version,
      recoveryUrl: entry.recoveryUrl, authorization,
      loadImage: url => op.wait(adapter.loadImage(url, { signal: op.signal, httpsOnly: true })),
    })).then(item => { entry.result = true; return { item } }).finally(() => {
      entry.xhs = null; entry.promise = null; committing.delete(entry.id); release(op)
    })
    entry.promise = promise; committing.set(entry.id, promise)
    return promise
  }
  function cancel(args) {
    const entry = entryFor(args)
    if (entry.used) throw fail(409, 'XHS_COMMIT_BUSY', '确认已经开始，不能取消已开始的保存。')
    drop(args.ticket, entry)
    return { cancelled: true }
  }
  return { prepare, confirm, cancel, close() { for (const op of operations) op.cancel(); for (const [key, entry] of tickets) drop(key, entry) } }
}
