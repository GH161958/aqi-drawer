import assert from 'node:assert/strict'
import test from 'node:test'

import {
  drawerHistoryKey,
  isArchiveOutsideTap,
  readDrawerHistoryEntry,
  withDrawerHistoryEntry,
} from '../src/app/drawerNavigation.ts'

test('drawer history preserves unrelated host state', () => {
  const entry = {
    version: 1 as const,
    view: 'archive' as const,
    slot: 'all' as const,
    collection: 'Reading',
    source: '',
    tag: 'later',
    scrollY: 418,
  }

  const state = withDrawerHistoryEntry(
    {
      hostOwned: 'keep',
    },
    entry,
  )

  assert.equal(state.hostOwned, 'keep')
  assert.deepEqual(
    state[drawerHistoryKey],
    entry,
  )
  assert.deepEqual(
    readDrawerHistoryEntry(state),
    entry,
  )
})

test('drawer history rejects invalid views and slots', () => {
  assert.equal(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'archive',
        slot: 'unknown',
      },
    }),
    null,
  )

  assert.equal(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'inspect',
        slot: 'all',
        itemId: '',
      },
    }),
    null,
  )
})

test('drawer history restores inspect snapshot safely', () => {
  assert.deepEqual(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'inspect',
        slot: 'inbox',
        itemId: 'item-1',
        collection: 'Inbox',
        source: 'Safari',
        tag: 'read',
        scrollY: 215,
      },
    }),
    {
      version: 1,
      view: 'inspect',
      slot: 'inbox',
      itemId: 'item-1',
      collection: 'Inbox',
      source: 'Safari',
      tag: 'read',
      scrollY: 215,
    },
  )
})

const boundary = {
  left: 100,
  right: 300,
  top: 80,
  bottom: 600,
}

function outsideTap(
  overrides: Partial<Parameters<
    typeof isArchiveOutsideTap
  >[0]> = {},
) {
  return isArchiveOutsideTap({
    startX: 50,
    startY: 200,
    endX: 52,
    endY: 202,
    elapsedMs: 120,
    boundary,
    edgeGuard: 8,
    movementLimit: 10,
    selectionActive: false,
    interactiveTarget: false,
    ...overrides,
  })
}

test('a deliberate tap outside the drawer dismisses it', () => {
  assert.equal(outsideTap(), true)
})

test('drawer edge taps and interactions do not dismiss', () => {
  assert.equal(
    outsideTap({
      startX: 95,
      endX: 95,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      interactiveTarget: true,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      selectionActive: true,
    }),
    false,
  )
})

test('scroll, drag, and long press do not dismiss', () => {
  assert.equal(
    outsideTap({
      endY: 240,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      elapsedMs: 900,
    }),
    false,
  )
})
