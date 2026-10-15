import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INSPECT_TAB_DELAY_MS,
  inspectPaperTabView,
  inspectPreviewState,
  isCurrentInspectItem,
} from '../src/features/inspect/inspectPresentationLogic.ts'

test('the approved tab delay suppresses instant-success flicker', () => {
  assert.equal(
    INSPECT_TAB_DELAY_MS,
    260,
  )

  assert.deepEqual(
    inspectPaperTabView(
      'preparing',
      false,
    ),
    {
      visible: false,
      label: '取纸中…',
    },
  )

  assert.deepEqual(
    inspectPaperTabView(
      'preparing',
      true,
    ),
    {
      visible: true,
      label: '取纸中…',
    },
  )
})

test('failure reuses the same tab with retry wording', () => {
  assert.deepEqual(
    inspectPaperTabView(
      'failed',
      false,
    ),
    {
      visible: true,
      label: '失败 · 重试',
    },
  )
})

test('only the active unpresented item shows preparation', () => {
  assert.equal(
    inspectPreviewState({
      itemId: 'paper-a',
      activeItemId: 'paper-a',
      presentedItemId: null,
      failedItemId: null,
    }),
    'preparing',
  )

  assert.equal(
    inspectPreviewState({
      itemId: 'paper-b',
      activeItemId: 'paper-a',
      presentedItemId: null,
      failedItemId: null,
    }),
    'idle',
  )
})

test('failure stays on its paper until retry or selection changes', () => {
  assert.equal(
    inspectPreviewState({
      itemId: 'paper-a',
      activeItemId: 'paper-a',
      presentedItemId: null,
      failedItemId: 'paper-a',
    }),
    'failed',
  )

  assert.equal(
    inspectPreviewState({
      itemId: 'paper-a',
      activeItemId: 'paper-b',
      presentedItemId: null,
      failedItemId: null,
    }),
    'idle',
  )
})

test('presented items no longer expose Archive loading state', () => {
  assert.equal(
    inspectPreviewState({
      itemId: 'paper-a',
      activeItemId: 'paper-a',
      presentedItemId: 'paper-a',
      failedItemId: null,
    }),
    'idle',
  )
})

test('stale request results cannot target a newer active paper', () => {
  assert.equal(
    isCurrentInspectItem(
      'paper-b',
      'paper-a',
    ),
    false,
  )

  assert.equal(
    isCurrentInspectItem(
      'paper-b',
      'paper-b',
    ),
    true,
  )
})
