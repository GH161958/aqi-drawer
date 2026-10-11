import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canQuickActionPanelScroll,
  isQuickActionKey,
  movedBeyondLongPressThreshold,
  resolveQuickActionDismissal,
  shouldFocusArchiveFallback,
} from '../src/features/archive/archiveQuickActionLogic.ts'

test('quick action keyboard equivalents are explicit', () => {
  assert.equal(isQuickActionKey('ContextMenu', false), true)
  assert.equal(isQuickActionKey('F10', true), true)
  assert.equal(isQuickActionKey('F10', false), false)
})

test('long press movement threshold permits a tap wobble and cancels scroll movement', () => {
  assert.equal(movedBeyondLongPressThreshold(0, 0, 6, 7), false)
  assert.equal(movedBeyondLongPressThreshold(0, 0, 8, 8), true)
})

test('status actions use the stable Archive fallback only when the current drawer loses the item', () => {
  assert.equal(shouldFocusArchiveFallback({
    result: { type: 'status', status: 'archived' },
    slot: 'all',
    collectionFilter: '',
  }), false)

  assert.equal(shouldFocusArchiveFallback({
    result: { type: 'status', status: 'archived' },
    slot: 'inbox',
    collectionFilter: '',
  }), true)
})

test('collection-filter and trash actions restore focus safely', () => {
  assert.equal(shouldFocusArchiveFallback({
    result: { type: 'collection', collection: 'Tokyo' },
    slot: 'all',
    collectionFilter: 'Tokyo',
  }), false)

  assert.equal(shouldFocusArchiveFallback({
    result: { type: 'collection', collection: null },
    slot: 'all',
    collectionFilter: 'Tokyo',
  }), true)

  assert.equal(shouldFocusArchiveFallback({
    result: { type: 'trash' },
    slot: 'all',
    collectionFilter: '',
  }), true)
})

test('pending quick actions cannot be dismissed by Escape or the backdrop', () => {
  for (const source of ['escape', 'backdrop'] as const) {
    assert.equal(resolveQuickActionDismissal({
      pending: true,
      source,
      view: 'trash',
      confirmMemory: false,
    }), 'blocked')
  }
})

test('Memory confirmation is cleared before Escape navigates or closes', () => {
  assert.equal(resolveQuickActionDismissal({
    pending: false,
    source: 'escape',
    view: 'status',
    confirmMemory: true,
  }), 'cancel-memory')

  assert.equal(resolveQuickActionDismissal({
    pending: false,
    source: 'escape',
    view: 'status',
    confirmMemory: false,
  }), 'main')
})

test('a non-pending backdrop dismissal closes from every layer', () => {
  assert.equal(resolveQuickActionDismissal({
    pending: false,
    source: 'backdrop',
    view: 'collection',
    confirmMemory: false,
  }), 'close')
})

test('a short quick-action slip never chains touch scrolling', () => {
  assert.equal(canQuickActionPanelScroll({
    scrollTop: 0,
    scrollHeight: 420,
    clientHeight: 420,
    touchDeltaY: -12,
  }), false)
})

test('a long quick-action slip scrolls only away from its boundaries', () => {
  const dimensions = {
    scrollHeight: 900,
    clientHeight: 400,
  }

  assert.equal(canQuickActionPanelScroll({
    ...dimensions,
    scrollTop: 0,
    touchDeltaY: 12,
  }), false)

  assert.equal(canQuickActionPanelScroll({
    ...dimensions,
    scrollTop: 0,
    touchDeltaY: -12,
  }), true)

  assert.equal(canQuickActionPanelScroll({
    ...dimensions,
    scrollTop: 500,
    touchDeltaY: -12,
  }), false)

  assert.equal(canQuickActionPanelScroll({
    ...dimensions,
    scrollTop: 500,
    touchDeltaY: 12,
  }), true)
})
