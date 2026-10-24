// Isolated contract tests, NOT real ChatGPT Host verification.
import test from 'node:test'
import assert from 'node:assert/strict'
import { compactSizeSuggestion, startCompactSizeProbe } from './keep-compact-size.js'

test('flexible outer iframe can request card width plus breathing room', () => {
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322.14, viewportWidth: 1100,
    containerDimensions: { maxWidth: 900, maxHeight: 700 },
  }), { width: 454, height: 337 })
})

test('Host fixed width is never overridden by compact width suggestion', () => {
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322.14, viewportWidth: 1100,
    containerDimensions: { width: 1100, maxHeight: 700 },
  }), { height: 337 })
})

test('fixed height is also respected', () => {
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322.14, viewportWidth: 1100,
    containerDimensions: { maxWidth: 900, height: 500 },
  }), { width: 454 })
})

test('narrow Host and maxWidth bounds are respected', () => {
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 312, cardHeight: 384.28,
    horizontalGutter: 8, verticalGutter: 8,
    viewportWidth: 320, containerDimensions: { maxWidth: 320 },
  }), { width: 320, height: 393 })
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322,
    viewportWidth: 1100, containerDimensions: { maxWidth: 400 },
  }), { width: 400, height: 336 })
})

test('fully fixed Host yields no size notification', () => {
  assert.deepEqual(compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322,
    containerDimensions: { width: 1100, height: 600 },
  }), {})
})

test('connected bridge sends size only on changes and stops on teardown', () => {
  let dims = { width: 440, height: 322 }
  let callback
  let observed = false
  let disconnected = false
  const notifications = []
  class FakeResizeObserver {
    constructor(cb) { callback = cb }
    observe() { observed = true }
    disconnect() { disconnected = true }
  }
  const probe = startCompactSizeProbe({
    card: { getBoundingClientRect: () => dims },
    sendSizeChanged: size => notifications.push(size),
    getHostContext: () => ({ containerDimensions: { maxWidth: 900 } }),
    getViewportWidth: () => 1000, ResizeObserverClass: FakeResizeObserver,
  })
  assert.equal(observed, true)
  assert.deepEqual(notifications, [{ width: 454, height: 336 }])
  callback()
  assert.equal(notifications.length, 1)
  dims = { width: 440, height: 400 }
  callback()
  assert.deepEqual(notifications.at(-1), { width: 454, height: 414 })
  probe.disconnect()
  assert.equal(disconnected, true)
  callback()
  assert.equal(notifications.length, 2)
})

test('no source URLs, bearer values or file content enter notification', () => {
  const values = compactSizeSuggestion({
    cardWidth: 440, cardHeight: 322, viewportWidth: 1000,
    containerDimensions: { maxWidth: 500 },
  })
  assert.deepEqual(Object.keys(values).sort(), ['height', 'width'])
  assert.deepEqual(values, { width: 454, height: 336 })
})
