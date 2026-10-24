import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import { KEEP_WIDGET_HTML } from './one-click-keep-widget.js'

const script = KEEP_WIDGET_HTML.match(/<script type="module">([\s\S]*?)<\/script>/u)?.[1]
assert.ok(script, 'Self-contained Widget must include its in-iframe controller.')

function mount({ token, scopeId = 'scope-current', output, callTool } = {}) {
  const elements = Object.fromEntries(['item', 'origin', 'status', 'save', 'cancel',
    'receipt-details', 'receipt-item', 'receipt-sha'].map(id =>
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
  const document = { documentElement: { dataset: {} }, getElementById: id => elements[id] }
  runInNewContext(script, { document, window })
  return { elements, calls, window, parent, listeners, document }
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


test('append card shows exact target before the click and never silently creates another item', async () => {
  const widget = mount({ token: 'f'.repeat(64), output: {
    status: 'one_click_approval_required', scopeId: 'scope-current',
    mode: 'append', itemId: 'existing-item-123',
    title: 'Synthetic attachment', hostname: 'unreviewed.example.net',
  } })
  assert.match(widget.elements.item.textContent, /追加到现有条目：existing-item-123/u)
  assert.equal(widget.elements.save.disabled, false)
})
test('append card without a target remains disabled even if hidden capability is present', async () => {
  const widget = mount({ token: 'f'.repeat(64), output: {
    status: 'one_click_approval_required', scopeId: 'scope-current',
    mode: 'append', itemId: null,
    title: 'Synthetic attachment', hostname: 'unreviewed.example.net',
  } })
  assert.match(widget.elements.item.textContent, /目标条目缺失/u)
  assert.equal(widget.elements.save.disabled, true)
})


test('private metadata arriving after public output enables only the matching current file', async () => {
  const widget = mount()
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-current',
      mode: 'new', title: 'Second PDF', hostname: 'unreviewed.example.net' },
  } } })
  assert.equal(widget.elements.save.disabled, true)
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolResponseMetadata: { mcp_tool_result: { _meta: {
      aqiOneClickKeep: { scopeId: 'scope-current', capability: '1'.repeat(64) },
    } } },
  } } })
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.equal(widget.calls[0].args.capability, '1'.repeat(64))
})
test('late private metadata for another file does not activate the new card', async () => {
  const widget = mount()
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolOutput: { status: 'one_click_approval_required', scopeId: 'new',
      mode: 'new', title: 'New file', hostname: 'unreviewed.example.net' },
  } } })
  widget.listeners['openai:set_globals']({ detail: { globals: {
    toolResponseMetadata: { mcp_tool_result: { _meta: {
      aqiOneClickKeep: { scopeId: 'previous', capability: '2'.repeat(64) },
    } } },
  } } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
})


function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => { resolve = a; reject = b })
  return { promise, resolve, reject }
}
function globals(widget, changes) {
  widget.listeners['openai:set_globals']({ detail: { globals: changes } })
}
function show(widget, scopeId, token, mode = 'new') {
  globals(widget, {
    toolOutput: { status: 'one_click_approval_required', scopeId,
      title: 'File ' + scopeId, hostname: 'unreviewed.example.net',
      mode, itemId: mode === 'append' ? 'target-B' : null },
    toolResponseMetadata: { mcp_tool_result: { _meta: {
      aqiOneClickKeep: { scopeId, capability: token },
    } } },
  })
}
function receipt(name) {
  return { structuredContent: { itemId: 'item-' + name, attachmentId: 'attachment-' + name,
    bytes: 99, sha256: '9'.repeat(64) } }
}

test('R1: delayed A Save success must not claim B append was saved or clear B bearer', async () => {
  const gate = deferred(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64)
  const calls = []
  const widget = mount({ token: tokenA, callTool: async (name, args) => {
    calls.push(args.capability)
    return args.capability === tokenA ? gate.promise : receipt('B')
  } })
  const savingA = widget.elements.save.onclick()
  show(widget, 'scope-B', tokenB, 'append')
  assert.match(widget.elements.item.textContent, /target-B/u)
  assert.equal(widget.elements.save.disabled, false)
  gate.resolve(receipt('A'))
  await savingA
  assert.doesNotMatch(widget.elements.status.textContent, /已入柜/u)
  assert.doesNotMatch(widget.elements.origin.textContent, /attachment-A/u)
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.match(widget.elements.origin.textContent, /attachment-B/u)
  assert.deepEqual(calls, [tokenA, tokenB])
})
test('R1: A Save rejection and finally cannot overwrite B busy Save', async () => {
  const a = deferred(), b = deferred(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64)
  const widget = mount({ token: tokenA,
    callTool: (_, args) => args.capability === tokenA ? a.promise : b.promise })
  const saveA = widget.elements.save.onclick()
  show(widget, 'scope-B', tokenB)
  const saveB = widget.elements.save.onclick()
  a.reject(new Error('A failed'))
  await saveA
  assert.match(widget.elements.status.textContent, /正在安全保存/u)
  assert.equal(widget.elements.cancel.disabled, true)
  b.resolve(receipt('B'))
  await saveB
  assert.match(widget.elements.origin.textContent, /attachment-B/u)
})
test('R1: delayed A Cancel success must not mark B cancelled or disable B', async () => {
  const gate = deferred(), tokenA = 'c'.repeat(64), tokenB = 'd'.repeat(64)
  const calls = []
  const widget = mount({ token: tokenA, callTool: async (name, args) => {
    calls.push(args.capability)
    return name === 'pocket_file_keep_cancel' ? gate.promise : receipt('B')
  } })
  const cancellingA = widget.elements.cancel.onclick()
  show(widget, 'scope-B', tokenB, 'append')
  gate.resolve({ structuredContent: { cancelled: true } })
  await cancellingA
  assert.match(widget.elements.item.textContent, /target-B/u)
  assert.doesNotMatch(widget.elements.status.textContent, /已取消/u)
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.match(widget.elements.origin.textContent, /attachment-B/u)
  assert.deepEqual(calls, [tokenA, tokenB])
})
test('R1: rejected A Cancel cannot alter B', async () => {
  const gate = deferred()
  const widget = mount({ token: 'a'.repeat(64), callTool: () => gate.promise })
  const cancellingA = widget.elements.cancel.onclick()
  show(widget, 'scope-B', 'b'.repeat(64))
  gate.reject(new Error('timeout'))
  await cancellingA
  assert.equal(widget.elements.save.disabled, false)
  assert.doesNotMatch(widget.elements.status.textContent, /取消结果未确认/u)
})
test('R1: same-scope event never re-enables buttons during busy Save or after receipt', async () => {
  const gate = deferred()
  let calls = 0
  const widget = mount({ token: 'a'.repeat(64), callTool: () => {
    calls++
    return gate.promise
  } })
  const saving = widget.elements.save.onclick()
  show(widget, 'scope-current', 'a'.repeat(64))
  assert.equal(widget.elements.save.disabled, true)
  assert.equal(widget.elements.cancel.disabled, true)
  await widget.elements.save.onclick()
  await widget.elements.cancel.onclick()
  assert.equal(calls, 1)
  gate.resolve(receipt('A'))
  await saving
  assert.match(widget.elements.status.textContent, /已入柜/u)
  show(widget, 'scope-current', 'a'.repeat(64))
  assert.equal(widget.elements.save.disabled, true)
  assert.match(widget.elements.status.textContent, /已入柜/u)
})
test('R1: same-scope event cannot re-enable Save during or after Cancel', async () => {
  const gate = deferred()
  const widget = mount({ token: 'a'.repeat(64), callTool: () => gate.promise })
  const cancelling = widget.elements.cancel.onclick()
  show(widget, 'scope-current', 'a'.repeat(64))
  assert.equal(widget.elements.save.disabled, true)
  assert.equal(widget.elements.cancel.disabled, true)
  gate.resolve({ structuredContent: { cancelled: true } })
  await cancelling
  assert.match(widget.elements.status.textContent, /服务器已撤销/u)
  show(widget, 'scope-current', 'a'.repeat(64))
  assert.equal(widget.elements.save.disabled, true)
})
test('R2: private B first then public B enables matched append without auto-call', async () => {
  const tokenB = 'b'.repeat(64), widget = mount({ token: 'a'.repeat(64) })
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'scope-B', capability: tokenB },
  } } } })
  assert.deepEqual(widget.calls, [])
  globals(widget, { toolOutput: { status: 'one_click_approval_required',
    scopeId: 'scope-B', mode: 'append', itemId: 'target-B',
    title: 'B', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, false)
  assert.match(widget.elements.item.textContent, /target-B/u)
  await widget.elements.save.onclick()
  assert.equal(widget.calls[0].args.capability, tokenB)
})
test('R2: late private from an unmatched scope cannot enable B', () => {
  const widget = mount({ token: 'a'.repeat(64) })
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'old-A', capability: 'c'.repeat(64) },
  } } } })
  globals(widget, { toolOutput: { status: 'one_click_approval_required',
    scopeId: 'scope-B', title: 'B', mode: 'new', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, true)
  assert.deepEqual(widget.calls, [])
})


test('D1: explicitly null private metadata revokes current Save while absent delta preserves private-first', async () => {
  const widget = mount({ token: 'a'.repeat(64) })
  assert.equal(widget.elements.save.disabled, false)
  globals(widget, { toolResponseMetadata: null })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls, [])
  // Public-only replays must not recover explicitly cleared authorization.
  globals(widget, { toolOutput: {
    status: 'one_click_approval_required', scopeId: 'scope-current',
    title: 'Original A', mode: 'new', hostname: 'unreviewed.example.net',
  } })
  assert.equal(widget.elements.save.disabled, true)
})
test('D1: explicitly empty private snapshot revokes and a new matching snapshot may reauthorize', () => {
  const widget = mount({ token: 'a'.repeat(64) })
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {} } } })
  assert.equal(widget.elements.save.disabled, true)
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'scope-current', capability: 'b'.repeat(64) },
  } } } })
  assert.equal(widget.elements.save.disabled, false)
})
test('D1: cancel A then public-only A→B→A never resurrects cancelled A', async () => {
  const token = 'a'.repeat(64)
  const widget = mount({ token })
  await widget.elements.cancel.onclick()
  assert.match(widget.elements.status.textContent, /已取消/u)
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-B',
    title: 'B', mode: 'new', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, true)
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-current',
    title: 'A replay', mode: 'new', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls.map(c => c.name), ['pocket_file_keep_cancel'])
  // Even an old private A snapshot replay cannot revive a retired scope.
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'scope-current', capability: token },
  } } } })
  assert.equal(widget.elements.save.disabled, true)
})
test('D1: saved A then public-only A→B→A cannot revert to another Save button', async () => {
  const token = 'a'.repeat(64)
  const widget = mount({ token })
  await widget.elements.save.onclick()
  assert.match(widget.elements.status.textContent, /已入柜/u)
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-B',
    title: 'B', mode: 'new', hostname: 'unreviewed.example.net' } })
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-current',
    title: 'A replay', mode: 'new', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, true)
  await widget.elements.save.onclick()
  assert.deepEqual(widget.calls.map(c => c.name), ['pocket_file_keep_redeem'])
})
test('D1: Save A completing after private-first B must not erase B candidate', async () => {
  const gate = deferred(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64)
  const calls = []
  const widget = mount({ token: tokenA, callTool: async (name, args) => {
    calls.push(args.capability)
    return args.capability === tokenA ? gate.promise : receipt('B')
  } })
  const savingA = widget.elements.save.onclick()
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'scope-B', capability: tokenB },
  } } } })
  gate.resolve(receipt('A'))
  await savingA
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-B',
    title: 'B append', mode: 'append', itemId: 'target-B',
    hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.deepEqual(calls, [tokenA, tokenB])
  assert.match(widget.elements.origin.textContent, /attachment-B/u)
})
test('D1: Cancel A completion cannot erase private-first B', async () => {
  const gate = deferred(), tokenA = 'a'.repeat(64), tokenB = 'b'.repeat(64)
  const calls = []
  const widget = mount({ token: tokenA, callTool: async (name, args) => {
    calls.push(args.capability)
    return args.capability === tokenA ? gate.promise : receipt('B')
  } })
  const cancellingA = widget.elements.cancel.onclick()
  globals(widget, { toolResponseMetadata: { mcp_tool_result: { _meta: {
    aqiOneClickKeep: { scopeId: 'scope-B', capability: tokenB },
  } } } })
  gate.resolve({ structuredContent: { cancelled: true } })
  await cancellingA
  globals(widget, { toolOutput: { status: 'one_click_approval_required', scopeId: 'scope-B',
    title: 'B', mode: 'new', hostname: 'unreviewed.example.net' } })
  assert.equal(widget.elements.save.disabled, false)
  await widget.elements.save.onclick()
  assert.deepEqual(calls, [tokenA, tokenB])
})


test('visual polish: successful card shows a readable receipt and folds technical IDs/hash', async () => {
  const widget = mount({ token: 'e'.repeat(64) })
  assert.equal(widget.document.documentElement.dataset.keepState, 'ready')
  await widget.elements.save.onclick()
  assert.equal(widget.document.documentElement.dataset.keepState, 'saved')
  assert.match(widget.elements.status.textContent, /已入柜.*SHA-256 已核对/u)
  assert.doesNotMatch(widget.elements.status.textContent, /a{64}/u)
  assert.equal(widget.elements['receipt-details'].hidden, false)
  assert.match(widget.elements['receipt-item'].textContent, /attachment-from-store/u)
  assert.match(widget.elements['receipt-sha'].textContent, /a{64}/u)
  assert.equal(widget.elements.save.disabled, true)
  assert.equal(widget.elements.cancel.disabled, true)
  assert.match(KEEP_WIDGET_HTML, /data-keep-state="saved".*\.actions/u)
})
test('visual polish: cancelled card hides receipt and keeps controls disabled', async () => {
  const widget = mount({ token: 'e'.repeat(64) })
  await widget.elements.cancel.onclick()
  assert.equal(widget.document.documentElement.dataset.keepState, 'closed')
  assert.equal(widget.elements['receipt-details'].hidden, true)
  assert.match(widget.elements.status.textContent, /已取消/u)
})
test('visual polish: static CSS is self-contained, responsive, keyboard-visible and dark-safe', () => {
  assert.match(KEEP_WIDGET_HTML, /--paper: #faf7f1/u)
  assert.match(KEEP_WIDGET_HTML, /prefers-color-scheme: dark/u)
  assert.match(KEEP_WIDGET_HTML, /max-width: 390px/u)
  assert.match(KEEP_WIDGET_HTML, /focus-visible/u)
  assert.match(KEEP_WIDGET_HTML, /prefers-reduced-motion: reduce/u)
  assert.ok(!/<script[^>]*src=/u.test(KEEP_WIDGET_HTML))
})
