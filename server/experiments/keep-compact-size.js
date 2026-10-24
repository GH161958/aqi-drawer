// Experimental ONLY. Not loaded by the One-Click Keep resource or production.
// Pass a connected MCP Apps App's app.sendSizeChanged as the notification function.
// MCP Apps ui/notifications/size-changed is sent AFTER ui/initialize; do not
// post arbitrary JSON-RPC before the handshake or alter the frozen CSS.
//
// The real inline Host may choose a FIXED width. In that case this probe
// intentionally does not ask the Host to shrink the width.
function measureAxis(content, gutter, viewport, maximum) {
  if (!Number.isFinite(content) || content < 0) return undefined
  const physical = Math.ceil(content + Math.max(0, gutter))
  const limits = [physical]
  if (Number.isFinite(viewport) && viewport > 0) limits.push(Math.floor(viewport))
  if (Number.isFinite(maximum) && maximum > 0) limits.push(Math.floor(maximum))
  return Math.max(1, Math.min(...limits))
}

export function compactSizeSuggestion({
  cardWidth, cardHeight, horizontalGutter = 14, verticalGutter = 14,
  viewportWidth, containerDimensions = {},
}) {
  const dimensions = {}
  if (!Number.isFinite(containerDimensions.width)) {
    const width = measureAxis(cardWidth, horizontalGutter, viewportWidth,
      containerDimensions.maxWidth)
    if (width !== undefined) dimensions.width = width
  }
  if (!Number.isFinite(containerDimensions.height)) {
    const height = measureAxis(cardHeight, verticalGutter, undefined,
      containerDimensions.maxHeight)
    if (height !== undefined) dimensions.height = height
  }
  return dimensions
}

export function startCompactSizeProbe({
  card, sendSizeChanged, getHostContext, getViewportWidth,
  ResizeObserverClass,
}) {
  if (!card || typeof card.getBoundingClientRect !== 'function') {
    throw new TypeError('A card element with getBoundingClientRect is required')
  }
  if (typeof sendSizeChanged !== 'function'
    || typeof getHostContext !== 'function'
    || typeof ResizeObserverClass !== 'function') {
    throw new TypeError('Requires connected MCP Apps bridge, host context and ResizeObserver')
  }
  let previous = null
  let active = true
  const report = () => {
    if (!active) return
    const rect = card.getBoundingClientRect()
    const sizes = compactSizeSuggestion({
      cardWidth: rect.width, cardHeight: rect.height,
      horizontalGutter: 14, verticalGutter: 14,
      viewportWidth: getViewportWidth?.(),
      containerDimensions: getHostContext()?.containerDimensions ?? {},
    })
    const serialized = JSON.stringify(sizes)
    if (serialized === '{}' || serialized === previous) return
    previous = serialized
    // Dimensions only. No file, bearer, source host, URL or receipt is sent.
    sendSizeChanged(sizes)
  }
  const observer = new ResizeObserverClass(report)
  observer.observe(card)
  report()
  return {
    report,
    disconnect: () => { active = false; observer.disconnect() },
  }
}
