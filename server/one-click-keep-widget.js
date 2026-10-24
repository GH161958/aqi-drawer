// Self-contained MCP Apps / ChatGPT inline widget. No external requests,
// cookies, localStorage, signed URLs, or model-readable bearer credentials.
export const KEEP_WIDGET_URI = 'ui://aqi-drawer/one-click-keep-v0.html'
export const KEEP_WIDGET_HTML = `
<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  --paper: #faf7f1; --paper-deep: #f4eee4; --ink: #40372e; --muted: #766d60;
  --rule: #e4d8c7; --sage: #697866; --sage-tint: #eef3eb;
  --brass: #ae9160; --button: #665347; --button-hover: #503e34; --focus: #997d52;
}
* { box-sizing: border-box }
body { margin: 0; padding: 7px; color: var(--ink); background: transparent }
.card {
  position: relative; width: 100%; max-width: 440px; overflow: hidden;
  background: var(--paper); border: 0; border-radius: 16px;
  padding: 21px 20px 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,.85);
}
.card::before {
  content: ""; position: absolute; inset: 0 auto auto 0;
  width: 100%; height: 3px;
  background: linear-gradient(90deg, var(--brass), #dbcbaa 38%, transparent 86%);
}
.header { display: flex; gap: 11px; align-items: center; margin-bottom: 19px }
.mark {
  display: grid; place-items: center; width: 42px; height: 42px; flex: 0 0 42px;
  border-radius: 13px; background: var(--paper-deep); border: 1px solid var(--rule);
  font-size: 22px;
}
.eyebrow { margin: 0 0 3px; color: var(--brass); font: 700 9px/1.2 system-ui,sans-serif; letter-spacing: .19em }
h2 { margin: 0; font-size: 19px; line-height: 1.3; letter-spacing: .015em; font-weight: 700 }
.file-slip {
  display: flex; gap: 12px; align-items: flex-start; border-radius: 12px;
  padding: 13px; background: rgba(255,255,255,.64); border: 1px solid var(--rule);
}
.file-symbol { flex: 0 0 30px; display: grid; place-items: center; width: 30px; height: 36px;
  color: var(--sage); border-radius: 6px; background: var(--sage-tint);
  font-size: 18px; font-weight: 500;
}
.file-meta { min-width: 0; flex: 1 }
.kicker { margin: 0 0 5px; font-size: 10px; letter-spacing: .09em; color: var(--muted) }
#item { margin: 0; font-size: 13px; font-weight: 650; line-height: 1.55; overflow-wrap: anywhere }
#origin { margin: 7px 0 0; color: var(--muted); font-size: 11px; line-height: 1.55;
  overflow-wrap: anywhere; word-break: break-word;
}
.status {
  margin: 13px 0 0; padding: 11px 12px; font-size: 12px; line-height: 1.6;
  color: var(--muted); background: var(--paper-deep); border-radius: 10px;
  overflow-wrap: anywhere; word-break: break-word;
}
[hidden] { display: none !important }
.receipt-details { margin-top: 12px; padding-top: 11px; border-top: 1px dashed var(--rule) }
.receipt-details summary { cursor: pointer; list-style: none; font-size: 11px; font-weight: 650;
  color: var(--muted); outline-offset: 3px;
}
.receipt-details summary::-webkit-details-marker { display: none }
.receipt-details summary::after { content: "＋"; float: right; color: var(--brass) }
.receipt-details[open] summary::after { content: "−" }
.receipt-details p { margin: 8px 0 0; color: var(--muted);
  font: 500 10.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere; word-break: break-word;
}
.actions { display: flex; flex-wrap: wrap; gap: 9px; margin-top: 15px }
button { min-height: 42px; margin: 0; padding: 11px 14px;
  font-family: inherit; font-size: 13px; font-weight: 650; line-height: 1.35;
  border: 1px solid transparent; border-radius: 10px; cursor: pointer;
  transition: background-color .16s ease, border-color .16s ease;
}
#save { color: #fffdfa; background: var(--button); flex: 1 1 auto }
#save:not(:disabled):hover { background: var(--button-hover) }
#cancel { color: var(--muted); background: transparent; border-color: var(--rule); flex: 0 0 auto }
#cancel:not(:disabled):hover { background: var(--paper-deep) }
button:disabled { opacity: .43; cursor: not-allowed }
button:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px }
.saved-note {
  display: none; margin: 13px 0 0; padding: 1px 0 0; color: var(--sage);
  font-size: 12px; font-weight: 650; letter-spacing: .02em;
}
html[data-keep-state="saved"] .status {
  color: var(--sage); background: var(--sage-tint);
  border-left: 3px solid var(--sage);
}
html[data-keep-state="saved"] .saved-note { display: block }
html[data-keep-state="saved"] #origin { display: none }
html[data-keep-state="saved"] .actions,
html[data-keep-state="closed"] .actions { display: none }
html[data-keep-state="saved"] .eyebrow::after { content: " · SAFELY KEPT" }
@media (max-width: 390px) {
  body { padding: 4px }
  .card { padding: 18px 15px 16px }
  .file-slip { padding: 11px; gap: 9px }
  .header { margin-bottom: 15px }
}
@media (prefers-reduced-motion: reduce) { button { transition: none } }
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark; --paper: #2d2b27; --paper-deep: #35322e; --ink: #f1ebe2;
    --muted: #c5bdb1; --rule: #524a40; --sage: #c0d0b7; --sage-tint: #394437;
    --brass: #d4b989; --button: #7a6653; --button-hover: #8b765f; --focus: #d6b17d;
  }
  .card { box-shadow: inset 0 1px 0 rgba(255,255,255,.05) }
  .file-slip { background: rgba(255,255,255,.035) }
}
</style>
</head>
<body>
<section class="card" aria-label="Aqi Drawer 文件保存">
<header class="header">
  <span class="mark" aria-hidden="true">🐆</span>
  <div><p class="eyebrow">AQI DRAWER</p><h2>收进抽屉</h2></div>
</header>
<div class="file-slip">
  <span class="file-symbol" aria-hidden="true">▤</span>
  <div class="file-meta">
    <p class="kicker">本次原件 · ONE FILE ONLY</p>
    <p id="item">正在读取文件保存请求…</p>
    <p id="origin"></p>
  </div>
</div>
<p id="status" class="status" role="status">只会保存这一份文件；不会信任整个网站。</p>
<details id="receipt-details" class="receipt-details" hidden>
  <summary>查看原件校验与保存回执</summary>
  <p id="receipt-item"></p>
  <p id="receipt-sha"></p>
</details>
<div class="actions">
  <button id="save" type="button" disabled>确认保存这份原件</button>
  <button id="cancel" type="button">取消</button>
</div>
<p class="saved-note">✓ 已妥善收好 · 原件留在抽屉里</p>
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
  // Presentation only: keep all capability, approval and replay rules unchanged.
  if (document.documentElement?.dataset) {
    document.documentElement.dataset.keepState = outcome?.terminal
      ? (outcome.origin ? 'saved' : 'closed') : busy ? 'working' : 'ready'
  }
  status.textContent = busy
    ? (inFlight.action === 'save' ? '正在安全保存原件…' : '正在取消本次授权…')
    : outcome?.message ?? (capability
      ? '确认后由 Drawer 安全下载，并核对原件大小与 SHA-256。'
      : '当前 ChatGPT Widget 没有提供私有授权能力；不会尝试保存。')
  save.disabled = busy || !capability || targetMissing || !!outcome?.terminal
  cancel.disabled = busy || !!outcome?.terminal
  // Read-only technical receipt lives in an optional disclosure instead of
  // monopolizing the success message with long UUIDs and a 64-char hash.
  const detail = document.getElementById('receipt-details')
  if (detail) {
    const hasReceipt = !!(outcome?.terminal && outcome.origin && outcome.sha256)
    detail.hidden = !hasReceipt
    if (hasReceipt) {
      document.getElementById('receipt-item').textContent = outcome.origin
      document.getElementById('receipt-sha').textContent = 'SHA-256 ' + outcome.sha256
    }
  }
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
      message: '已入柜 · 原件 ' + receipt.bytes + ' bytes · SHA-256 已核对',
      origin: 'Item ' + receipt.itemId + ' · Attachment ' + receipt.attachmentId,
      sha256: receipt.sha256 }
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
