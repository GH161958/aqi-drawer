import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isQuickActionKey,
  movedBeyondLongPressThreshold,
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
