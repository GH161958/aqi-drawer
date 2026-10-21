import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { KEEP_WIDGET_HTML } from './one-click-keep-widget.js'

const script = KEEP_WIDGET_HTML.match(/<script type="module">([\s\S]*?)<\/script>/u)?.[1]
assert.ok(script, 'Self-contained Widget must include its in-iframe controller.')

function mount({ token, scopeId = 'scope-current', output, callTool } = {}) {
  const elements = Object.fromEntries(['item', 'origin', 'status', 'save', 'cancel'].map(id =>
    [id, { textContent: '', disabled: id === 'save', onclick: null }]))
  const calls = []
  const actualTool = callTool ?? (async (name, args) => {
    calls.push({ name, args })
    if (name === 'pocket_file_keep_cancel') return { structuredContent: { cancelled: true } }
    return { structuredContent: {
      itemId: 'item-from-store', attachmentId: 'attachment-from-store',
      bytes: 34, sha256: 'a'.repeat(64),
    } }
  })
  const openai = {
    toolOutput: output ?? {
      status: 'one_click_approval_required', scopeId, title: 'One synthetic PDF',
      hostname: 'unreviewed.example.net',
    },
    toolResponseMetadata: {
      status: 'success', call_tool_result: {},
      mcp_tool_result: { _meta: token
        ? { aqiOneClickKeep: { scopeId, capability: token } } : {} },
    },
    callTool: actualTool,
  }
  const parent = {}
  const listeners = {}
  const window = { parent, openai,
    addEventListener: (type, cb) => { listeners[type] = cb } }
  const document = { getElementById: id => elements[id] }
  runInNewContext(script, { document, window })
  return { elements, calls, window, parent, listeners }
}

test('ChatGPT snapshot: no auto-call, private metadata gates a real Save click', async () => {
  const token = 'a'.repeat(64)
  const widget = mount({ token })
  assert.deepEqual(widget.calls, [])
  assert.equal(widget.elements.save.disabled, false)
  assert.match(widget.elements.item.textContent, /synthetic PDF/u)
  assert.ok(!JSON.stringify(widget.elements).includes(token))
  await widget.elements.save.onclick()
  assert.deepEqual(JSON.parse(JSON.stringify(widget.calls)), [{ name: 'pocket_file_keep_redeem', args: { capability: token } }])
  assert.match(widget.elements.status.textContent, /已入柜/u)
  assert.equal(widget.elements.save.disabled, true)
  assert.equal(widget.elements.cancel.disabled, true)
})
test('Host with no private _meta fails closed without downloading anything', async () => {
  const widget = mount()
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
  assert.match(widget.elements.status.textContent, /没有提供私有授权能力/u)
})
test('cancel button revokes server bearer instead of simply hiding its UI', async () => {
  const token = 'b'.repeat(64)
  const widget = mount({ token })
  await widget.elements.cancel.onclick()
  assert.deepEqual(JSON.parse(JSON.stringify(widget.calls)), [{ name: 'pocket_file_keep_cancel', args: { capability: token } }])
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.equal(widget.calls.length, 1)
  assert.match(widget.elements.status.textContent, /服务器已撤销/u)
})
test('MCP Apps tool-result notification updates widget without calling redemption', () => {
  const widget = mount()
  const token = 'c'.repeat(64)
  widget.listeners.message({ source: widget.parent, data: {
    jsonrpc: '2.0', method: 'ui/notifications/tool-result',
    params: { structuredContent: {
      status: 'one_click_approval_required', scopeId: 'scope-updated', title: 'Updated original',
      hostname: 'another.example.net',
    }, _meta: { aqiOneClickKeep: { scopeId: 'scope-updated', capability: token } } },
  } })
  assert.equal(widget.elements.save.disabled, false)
  assert.match(widget.elements.item.textContent, /Updated original/u)
  assert.deepEqual(widget.calls, [])
})


test('a newer file event without its own private metadata must not reuse the old bearer', async () => {
  const widget = mount({ token: 'd'.repeat(64) })
  assert.equal(widget.elements.save.disabled, false)
  widget.listeners.message({ source: widget.parent, data: {
    jsonrpc: '2.0', method: 'ui/notifications/tool-result',
    params: { structuredContent: {
      status: 'one_click_approval_required', title: 'A different file',
      hostname: 'different.example.net',
    } },
  } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
  assert.match(widget.elements.status.textContent, /没有提供私有授权能力/u)
})
test('a completed card displays receipt recovery rather than asking for another save', async () => {
  const widget = mount({ token: 'e'.repeat(64), output: {
    status: 'one_click_receipt_available', saved: true, scopeId: 'scope-current',
    title: 'Previously saved PDF', hostname: 'unreviewed.example.net',
  } })
  assert.equal(widget.elements.save.textContent, '查看已保存回执')
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.equal(widget.calls.length, 1)
  assert.match(widget.elements.status.textContent, /已入柜/u)
})

test('ChatGPT globals update hydrates paired visible file and private capability', async () => {
  const widget = mount()
  const token = 'f'.repeat(64)
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolOutput: { status: 'one_click_approval_required', scopeId: 'new-scope',
      title: 'Newly selected PDF', hostname: 'host.example.net' },
    toolResponseMetadata: { mcp_tool_result: { _meta: {
      aqiOneClickKeep: { scopeId: 'new-scope', capability: token },
    } } },
  } } })
  assert.equal(widget.elements.save.disabled, false)
  assert.match(widget.elements.item.textContent, /Newly selected PDF/u)
  await widget.elements.save.onclick()
  assert.equal(widget.calls[0].args.capability, token)
})
test('mismatched hidden capability cannot authorize a different visible file', async () => {
  const widget = mount({ token: 'a'.repeat(64) })
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolOutput: { status: 'one_click_approval_required', scopeId: 'different-file',
      title: 'A different PDF', hostname: 'host.example.net' },
    toolResponseMetadata: { mcp_tool_result: { _meta: {
      aqiOneClickKeep: { scopeId: 'old-file', capability: 'b'.repeat(64) },
    } } },
  } } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
})
test('ChatGPT globals file update without metadata refuses an old private token', async () => {
  const widget = mount({ token: 'a'.repeat(64) })
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolOutput: { status: 'one_click_approval_required', scopeId: 'new-file',
      title: 'Another PDF', hostname: 'host.example.net' },
  } } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
})
