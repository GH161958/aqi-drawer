const GENERIC_SOURCE_APPS = new Set([
  '',
  'enervate house',
  'iphone分享菜单',
  'iphone 分享菜单',
  'iphone share sheet',
  'ios shortcut',
  'shortcut',
  '快捷指令',
  '分享菜单',
])

const SOURCE_RULES = [
  { name: '淘宝', domains: ['taobao.com', 'tmall.com', 'm.tb.cn', 'tb.cn'] },
  { name: '京东', domains: ['jd.com', '3.cn'] },
  { name: '拼多多', domains: ['pinduoduo.com', 'yangkeduo.com'] },
  { name: '小红书', domains: ['xiaohongshu.com', 'xhslink.com'] },
  { name: '哔哩哔哩', domains: ['bilibili.com', 'b23.tv'] },
  { name: '抖音', domains: ['douyin.com', 'iesdouyin.com'] },
  { name: '微信', domains: ['weixin.qq.com', 'mp.weixin.qq.com'] },
  { name: '微博', domains: ['weibo.com', 'weibo.cn'] },
  { name: '知乎', domains: ['zhihu.com'] },
  { name: '豆瓣', domains: ['douban.com'] },
  { name: 'YouTube', domains: ['youtube.com', 'youtu.be'] },
  { name: 'Instagram', domains: ['instagram.com'] },
  { name: 'TikTok', domains: ['tiktok.com'] },
  { name: 'X', domains: ['x.com', 'twitter.com'] },
  { name: 'Spotify', domains: ['spotify.com'] },
  { name: 'Apple Music', domains: ['music.apple.com'] },
  { name: 'GitHub', domains: ['github.com'] },
]

const SHARE_KEYS = ['share', 'shortcutInput', 'shortcut_input', 'input', 'content', 'shared', 'sharedText']
const URL_KEYS = ['sourceUrl', 'source_url', 'url', 'sharedUrl', 'shared_url', 'link']
const APP_KEYS = ['sourceApp', 'source_app', 'app', 'application']

const TRACKING_KEYS = new Set([
  'abbucket',
  'scm',
  'share_from',
  'share_medium',
  'share_source',
  'source',
  'spm',
  'xsec_source',
  'xsec_token',
])

export function normalizeIncomingShare(input = {}) {
  const payload = toPayload(input)
  const shared = firstValue(payload, SHARE_KEYS)
  const directUrl = firstValue(payload, URL_KEYS)
  const directText = clean(payload.text)
  const directSourceApp = firstValue(payload, APP_KEYS)
  const directTitle = clean(payload.title) || clean(payload.name)
  const directNote = clean(payload.note) || clean(payload.comment)

  if (directUrl) payload.sourceUrl = extractFirstUrl(directUrl) || directUrl
  if (directSourceApp) payload.sourceApp = directSourceApp
  if (directTitle) payload.title = directTitle
  if (directNote) payload.note = directNote

  if (shared && !clean(payload.text)) {
    const sourceUrl = clean(payload.sourceUrl) || extractFirstUrl(shared)
    if (sourceUrl) payload.sourceUrl = sourceUrl
    if (!sourceUrl || stripUrl(shared, sourceUrl)) payload.text = shared
  }
  if (!clean(payload.text) && directText) payload.text = directText
  if (!clean(payload.title) && shared) payload.title = deriveShareTitle(shared, payload.sourceUrl)
  for (const key of [...SHARE_KEYS, ...URL_KEYS, ...APP_KEYS]) {
    if (!['sourceUrl', 'sourceApp'].includes(key)) delete payload[key]
  }

  const sourceUrl = clean(payload.sourceUrl) || extractFirstUrl(payload.text)
  if (sourceUrl) payload.sourceUrl = sourceUrl
  if (sourceUrl && isGenericSourceApp(payload.sourceApp)) {
    payload.sourceApp = inferSourceApp(sourceUrl) || clean(payload.sourceApp) || 'iPhone 分享菜单'
  }
  return payload
}

export function extractFirstUrl(value) {
  const match = clean(value).match(/https?:\/\/[^\s<>"'，。！？、；：）】》]+/iu)
  return match ? trimTrailingPunctuation(match[0]) : ''
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(clean(value))
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || TRACKING_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key)
      }
    }
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return ''
  }
}

export function inferSourceApp(value) {
  try {
    const hostname = new URL(clean(value)).hostname.toLowerCase().replace(/^www\./, '')
    return SOURCE_RULES.find((rule) => rule.domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`)))?.name || ''
  } catch {
    return ''
  }
}

export function isGenericSourceApp(value) {
  return GENERIC_SOURCE_APPS.has(clean(value).toLowerCase())
}

export function deriveShareTitle(value, sourceUrl = '') {
  const raw = clean(value)
  if (!raw) return ''
  const withoutUrl = clean(sourceUrl) ? raw.replace(sourceUrl, ' ') : raw
  return withoutUrl
    .replace(/^(?:#|【|\[)?\s*(?:分享|推荐|看看|给你看|转发)\s*[：:]?\s*/iu, '')
    .replace(/(?:复制|打开)(?:后|链接)?(?:进入|打开)?(?:淘宝|天猫|京东|拼多多|小红书|抖音|App|APP|应用).*$/iu, '')
    .replace(/\s+/g, ' ')
    .replace(/^[，。！？、；：\-—|]+|[，。！？、；：\-—|]+$/gu, '')
    .trim()
    .slice(0, 60)
}

function stripUrl(text, url) {
  return clean(text).replace(url, '').trim()
}

function trimTrailingPunctuation(value) {
  return value.replace(/[.,!?;:，。！？、；：）】》]+$/u, '')
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toPayload(input) {
  if (typeof input === 'string') return { share: input }
  if (Array.isArray(input)) return { share: input.map(stringifySharePart).filter(Boolean).join('\n') }
  return input && typeof input === 'object' ? { ...input } : {}
}

function firstValue(payload, keys) {
  for (const key of keys) {
    const value = stringifySharePart(payload[key])
    if (value) return value
  }
  return ''
}

function stringifySharePart(value) {
  if (typeof value === 'string') return value.trim()
  if (value instanceof URL) return value.toString()
  if (Array.isArray(value)) return value.map(stringifySharePart).filter(Boolean).join('\n')
  if (value && typeof value === 'object') {
    return firstValue(value, ['url', 'sourceUrl', 'text', 'title', 'name'])
  }
  return ''
}
