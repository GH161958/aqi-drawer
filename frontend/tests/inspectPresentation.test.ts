import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

test('Inspect paper media and attachment siblings have distinct stable keys', () => {
  // Guard against duplicate sibling keys that can leave stale DOM nodes.
  const source = readFileSync(
    new URL('../src/features/inspect/InspectOriginalPaper.tsx', import.meta.url),
    'utf8',
  )
  const componentKeys = [...source.matchAll(
    /<(InspectMedia|InspectAttachments)\s+key=\{`([^`]+)`\}/gu,
  )].map((match) => ({
    component: match[1],
    key: match[2],
  }))

  assert.deepEqual(componentKeys, [
    {
      component: 'InspectAttachments',
      key: 'inspect-attachments-primary:${item.id}',
    },
    {
      component: 'InspectMedia',
      key: 'inspect-media:${item.id}',
    },
    {
      component: 'InspectAttachments',
      key: 'inspect-attachments-secondary:${item.id}',
    },
  ])
  assert.equal(new Set(componentKeys.map((value) => value.key)).size, 3)
})
