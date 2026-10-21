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
let submitting = false
function findPrivate(envelope) {
  const sources = [
    envelope?._meta, envelope?.mcp_tool_result?._meta,
    envelope?.call_tool_result?._meta, envelope?.mcpToolResult?._meta,
    envelope?.callToolResult?._meta, envelope?.result?._meta,
  ]
  for (const m of sources) if (typeof m?.aqiOneClickKeep?.capability === 'string') return m.aqiOneClickKeep.capability
  return null
}
function hydrate(out, envelope) {
  const visible = out?.structuredContent ?? out ?? {}
  if (visible.status !== 'one_click_approval_required') return
  capability = findPrivate(envelope)
  item.textContent = '文件：' + (visible.title || 'File')
  origin.textContent = '本次下载来源：' + (visible.hostname || '未知') + ' · 只授权这一份原件'
  status.textContent = capability
    ? '确认后由 Drawer 安全下载，并核对原件大小与 SHA-256。'
    : '当前 ChatGPT Widget 没有提供私有授权能力；不会尝试保存。'
  save.disabled = !capability
}
hydrate(window.openai?.toolOutput, window.openai?.toolResponseMetadata)
window.addEventListener('message', event => {
  if (event.source !== window.parent) return
  const msg = event.data
  if (msg?.method === 'ui/notifications/tool-result') hydrate(msg.params, msg.params)
}, { passive: true })
save.onclick = async () => {
  if (submitting || !capability) return
  if (typeof window.openai?.callTool !== 'function') {
    status.textContent = '此 Host 不支持组件内工具调用；未保存。'
    return
  }
  submitting = true
  save.disabled = true
  cancel.disabled = true
  status.textContent = '正在安全保存原件…'
  try {
    // The only redemption is in this explicit button handler.
    const out = await window.openai.callTool('pocket_file_keep_redeem', { capability })
    if (out?.isError || !out?.structuredContent?.attachmentId) {
      status.textContent = '保存失败或授权已过期，请重新发起这一份文件的保存。'
      return
    }
    const r = out.structuredContent
    status.textContent = '已入柜 · 原件 ' + r.bytes + ' bytes · SHA-256 ' + r.sha256
    origin.textContent = 'Item ' + r.itemId + ' · Attachment ' + r.attachmentId
    capability = null
    cancel.disabled = true
  } catch {
    status.textContent = '保存未完成；如需重试，请重新打开本次保存请求。'
  } finally { submitting = false }
}
cancel.onclick = async () => {
  if (submitting) return
  const token = capability
  capability = null
  save.disabled = true
  cancel.disabled = true
  if (token && typeof window.openai?.callTool === 'function') {
    try {
      const out = await window.openai.callTool('pocket_file_keep_cancel', { capability: token })
      status.textContent = out?.structuredContent?.cancelled
        ? '已取消；服务器已撤销本次授权，未下载。'
        : '已退出卡片；授权可能已失效或已处理，请检查抽屉回执。'
      return
    } catch {}
  }
  status.textContent = '已退出卡片；服务器授权将在两分钟内过期。没有由此按钮发起下载。'
}
</script>
</body></html>
`
