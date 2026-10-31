import { createMcpFileOperation } from './mcp-file-operation.js'
import { extractXhsUrl } from './adapters/xhs.js'

// One bounded job per persisted object. No client-supplied source URL is accepted.
export function createXhsRecovery({ store, adapter, budgetMs = 30_000 }) {
  const active = new Map()
  return async function retry(id) {
    if (active.has(id)) return active.get(id)
    if (active.size >= 8) throw Object.assign(new Error('来源重试繁忙，请稍后再试。'), { status: 429 })
    const operation = createMcpFileOperation({ budgetMs })
    const work = (async () => {
      const item = await store.get(id)
      if (!item || item.deletedAt) throw Object.assign(new Error('收藏不存在。'), { status: 404 })
      const originalUrl = item.sourceData?.originalUrl || item.sourceUrl
      if (item.sourceData?.provider !== 'xiaohongshu' || extractXhsUrl(originalUrl) !== originalUrl) {
        throw Object.assign(new Error('仅支持已保存的小红书来源。'), { status: 422 })
      }
      if (item.sourceData.parseStatus === 'complete') return item
      const xhs = await operation.wait(adapter.parse(originalUrl, { signal: operation.signal }))
      operation.check()
      return store.upsertXhs({ sourceUrl: originalUrl, xhs }, {
        targetItemId: id, expectedSourceUrl: originalUrl, authorization: operation,
        loadImage: url => operation.wait(adapter.loadImage(url, { signal: operation.signal })),
      })
    })()
    const result = operation.wait(work).finally(() => {
      operation.dispose()
      if (active.get(id) === result) active.delete(id)
    })
    active.set(id, result)
    return result
  }
}
