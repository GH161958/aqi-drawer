// Self-contained MCP Apps / ChatGPT inline widget. No external requests,
// cookies, localStorage, signed URLs, or model-readable bearer credentials.
export const KEEP_WIDGET_URI = 'ui://aqi-drawer/one-click-keep-v0.html'
export const KEEP_WIDGET_HTML = `
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {color-scheme:light dark; font-family:system-ui,-apple-system,sans-serif}
body {margin:0; padding:16px; color:var(--color-text-primary,inherit)}
.card {border:1px solid var(--color-border-default,#c2bbb3);border-radius:15px;padding:16px;max-width:440px}
h2 {margin:0 0 12px;font-size:17px} p{margin:8px 0;font-size:13px;line-height:1.5}
.small{opacity:.75;font-size:12px;overflow-wrap:anywhere}
button{margin-top:14px;padding:10px 16px;border:0;border-radius:10px;background:#747568;color:white;font:600 14px system-ui;cursor:pointer}
button:disabled{opacity:.45;cursor:default}
#cancel{margin-left:8px;background:transparent;color:inherit;border:1px solid #999}
</style>
</head>
<body>
<section class="card" aria-live="polite">
<h2>🐆 收进抽屉</h2>
<p id="item">正在读取文件保存请求…</p>
<p class="small" id="origin"></p>
<p class="small" id="status">只会保存这一份文件；不会信任整个网站。</p>
<button id="save" disabled>确认保存这份原件</button><button id="cancel">取消</button>
</section>
<script type="module">
const item = document.getElementById('item')
const origin = document.getElementById('origin')
const status = document.getElementById('status')
const save = document.getElementById('save')
const cancel = document.getElementById('cancel')
let capability = null
let currentVisible = null
let privateCandidate = null
// Bounded per-widget tombstones. A completed/cancelled scope cannot be
// resurrected by an old Host public/private snapshot replay.
const retiredScopes = new Set()
let viewEpoch = 0
let inFlight = null
let outcome = null

function findPrivate(envelope) {
  const sources = [
    envelope?._meta, envelope?.mcp_tool_result?._meta,
    envelope?.call_tool_result?._meta, envelope?.mcpToolResult?._meta,
    envelope?.callToolResult?._meta, envelope?.result?._meta,
  ]
  for (const m of sources) {
    const privateScope = m?.aqiOneClickKeep
    if (typeof privateScope?.scopeId === 'string'
      && /^[a-f0-9]{64}$/.test(privateScope?.capability || '')) return privateScope
  }
  return null
}

function retire(attempt) {
  if (typeof attempt.scopeId !== 'string') return
  retiredScopes.add(attempt.scopeId)
  while (retiredScopes.size > 16) retiredScopes.delete(retiredScopes.values().next().value)
  // An older A operation must not erase private B already received first.
  if (privateCandidate?.scopeId === attempt.scopeId
    && privateCandidate.capability === attempt.token) privateCandidate = null
}

function isCurrent(attempt) {
  return inFlight === attempt && viewEpoch === attempt.epoch
    && currentVisible?.scopeId === attempt.scopeId
}

function render() {
  const visible = currentVisible
  if (!visible) return
  const targetMissing = visible.mode === 'append' && !(typeof visible.itemId === 'string' && visible.itemId)
  const target = visible.mode === 'append'
    ? (targetMissing ? '目标条目缺失：不可保存' : '追加到现有条目：' + visible.itemId)
    : '创建新条目'
  item.textContent = '文件：' + (visible.title || 'File') + ' · ' + target
  origin.textContent = outcome?.origin
    ?? '本次下载来源：' + (visible.hostname || '未知') + ' · 只授权这一份原件'
  save.textContent = visible.status === 'one_click_receipt_available'
    ? '查看已保存回执' : '确认保存这份原件'
  const busy = inFlight?.epoch === viewEpoch
  status.textContent = busy
    ? (inFlight.action === 'save' ? '正在安全保存原件…' : '正在取消本次授权…')
    : outcome?.message ?? (capability
      ? '确认后由 Drawer 安全下载，并核对原件大小与 SHA-256。'
      : '当前 ChatGPT Widget 没有提供私有授权能力；不会尝试保存。')
  save.disabled = busy || !capability || targetMissing || !!outcome?.terminal
  cancel.disabled = busy || !!outcome?.terminal
}

function hydrate(out, envelope, privateUpdated = false) {
  // A missing delta field preserves a private-first candidate; an explicit
  // null or empty private snapshot *revokes* it. This also revokes the active
  // UI's capability, without cancelling an operation already in flight.
  if (privateUpdated) {
    const incoming = findPrivate(envelope)
    privateCandidate = incoming && !retiredScopes.has(incoming.scopeId) ? incoming : null
    if (!privateCandidate) capability = null
  }
  const visible = out?.structuredContent ?? out ?? {}
  if (!['one_click_approval_required', 'one_click_receipt_available'].includes(visible.status)) return
  const switched = !currentVisible || currentVisible.scopeId !== visible.scopeId
  if (switched) {
    viewEpoch++
    inFlight = null // Old async operations may finish, but cannot touch this view.
    outcome = null
    capability = null
  }
  currentVisible = visible
  const matched = !retiredScopes.has(visible.scopeId)
    && privateCandidate?.scopeId === visible.scopeId ? privateCandidate : null
  if (outcome?.terminal || (inFlight?.epoch === viewEpoch && inFlight.action === 'cancel')) {
    capability = null
  } else {
    capability = matched?.capability ?? null
  }
  render()
}

hydrate(window.openai?.toolOutput, window.openai?.toolResponseMetadata,
  window.openai?.toolResponseMetadata !== undefined)
window.addEventListener('message', event => {
  if (event.source !== window.parent) return
  const msg = event.data
  if (msg?.method === 'ui/notifications/tool-result') {
    const params = msg.params
    const hasPrivate = params && ['_meta', 'mcp_tool_result', 'call_tool_result',
      'mcpToolResult', 'callToolResult'].some(key =>
      Object.prototype.hasOwnProperty.call(params, key))
    hydrate(params, params, !!hasPrivate)
  }
}, { passive: true })
window.addEventListener('openai:set_globals', event => {
  const changes = event.detail?.globals
  if (!changes) return
  const hasOutput = Object.prototype.hasOwnProperty.call(changes, 'toolOutput')
  const hasPrivate = Object.prototype.hasOwnProperty.call(changes, 'toolResponseMetadata')
  if (hasOutput || hasPrivate) {
    // Private-first and public-first are both supported. The candidate only
    // enables a file when scopeIds match, never merely due to event order.
    hydrate(hasOutput ? changes.toolOutput : currentVisible,
      hasPrivate ? changes.toolResponseMetadata : undefined, hasPrivate)
  }
}, { passive: true })

save.onclick = async () => {
  const token = capability
  if (!token || !currentVisible || (inFlight?.epoch === viewEpoch) || outcome?.terminal
    || save.disabled) return
  if (typeof window.openai?.callTool !== 'function') {
    outcome = { message: '此 Host 不支持组件内工具调用；未保存。' }
    render()
    return
  }
  const attempt = { scopeId: currentVisible.scopeId, epoch: viewEpoch,
    token, action: 'save' }
  inFlight = attempt
  outcome = null
  render()
  try {
    // Capture the exact private token at click time, not a mutable global.
    const out = await window.openai.callTool('pocket_file_keep_redeem', { capability: token })
    const saved = !out?.isError && !!out?.structuredContent?.attachmentId
    if (saved) retire(attempt)
    if (!isCurrent(attempt)) return
    if (!saved) {
      outcome = { message: '保存未获确认；可重试本次保存，或重新发起文件请求。' }
      return
    }
    const receipt = out.structuredContent
    capability = null
    outcome = { terminal: true,
      message: '已入柜 · 原件 ' + receipt.bytes + ' bytes · SHA-256 ' + receipt.sha256,
      origin: 'Item ' + receipt.itemId + ' · Attachment ' + receipt.attachmentId }
  } catch {
    if (isCurrent(attempt)) {
      outcome = { message: '保存未完成；可以重试本次保存。' }
    }
  } finally {
    if (isCurrent(attempt)) {
      inFlight = null
      render()
    }
  }
}

cancel.onclick = async () => {
  if (inFlight?.epoch === viewEpoch || outcome?.terminal || !currentVisible) return
  const token = capability
  const attempt = { scopeId: currentVisible.scopeId, epoch: viewEpoch,
    token, action: 'cancel' }
  inFlight = attempt
  capability = null // Never re-enable during an in-flight cancellation.
  outcome = null
  render()
  let message = '已退出卡片；服务器授权将在两分钟内过期。没有由此按钮发起下载。'
  if (token && typeof window.openai?.callTool === 'function') {
    try {
      const out = await window.openai.callTool('pocket_file_keep_cancel', { capability: token })
      message = out?.structuredContent?.cancelled
        ? '已取消；服务器已撤销本次授权，未下载。'
        : '已退出卡片；授权可能已失效或已处理，请检查抽屉回执。'
    } catch {
      message = '取消结果未确认；本次授权将在两分钟内过期。'
    }
  }
  retire(attempt)
  if (!isCurrent(attempt)) return
  outcome = { terminal: true, message }
  inFlight = null
  render()
}
</script>
</body></html>
`
