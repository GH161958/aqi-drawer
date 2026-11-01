import { createHash } from 'node:crypto'

export const xhsItemVersion = item => createHash('sha256').update(JSON.stringify(item)).digest('hex')
export function canonicalXhsUrl(value) {
  const invalid = () => Object.assign(new Error('请粘贴 www.xiaohongshu.com 的 HTTPS 正式笔记链接，仅支持 xsec_token / xsec_source 参数。'), { status: 422, code: 'XHS_CANONICAL_URL' })
  if (typeof value !== 'string' || value.length > 8192) throw invalid()
  let url
  try { url = new URL(value.trim()) } catch { throw invalid() }
  const match = url.pathname.match(/^\/(?:explore|discovery\/item)\/([a-fA-F0-9]{24})$/u)
  if (url.protocol !== 'https:' || url.hostname !== 'www.xiaohongshu.com' || url.username || url.password || url.port || url.hash || !match) throw invalid()
  const seen = new Set()
  for (const [key, entry] of url.searchParams) {
    if (!['xsec_token', 'xsec_source'].includes(key) || seen.has(key) || !/^[A-Za-z0-9._~+/=-]{1,4096}$/u.test(entry)) throw invalid()
    seen.add(key)
  }
  const safe = new URL(url); safe.search = ''
  return { url: url.href, safeUrl: safe.href, noteId: match[1] }
}

// Only technical URL fields are sanitized; never rewrite note prose or EE's text.
export function stripXhsTechnicalTokens(value) {
  try {
    const url = new URL(value)
    url.searchParams.delete('xsec_token'); url.searchParams.delete('xsec_source')
    return url.href
  } catch { return value }
}
export function sanitizeXhsTechnicalData(value) {
  if (Array.isArray(value)) return value.map(sanitizeXhsTechnicalData)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key,
    ['url', 'avatar', 'canonicalUrl', 'originalUrl', 'remoteUrl'].includes(key) && typeof entry === 'string'
      ? stripXhsTechnicalTokens(entry) : sanitizeXhsTechnicalData(entry),
  ]))
}

export function storedXhsNoteId(item) {
  if (item?.sourceIdentity?.provider === 'xiaohongshu' && item.sourceIdentity.externalId) return item.sourceIdentity.externalId
  if (item?.sourceData?.provider !== 'xiaohongshu') return ''
  if (item.sourceData.noteId) return item.sourceData.noteId
  for (const value of [item.sourceUrl, item.sourceData.canonicalUrl, item.sourceData.originalUrl]) {
    try {
      const url = new URL(value); url.search = ''; url.hash = ''
      return canonicalXhsUrl(url.href).noteId
    } catch { /* Legacy metadata may contain only an unresolved short URL. */ }
  }
  return ''
}
