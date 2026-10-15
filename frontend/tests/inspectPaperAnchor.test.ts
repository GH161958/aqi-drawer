import assert from 'node:assert/strict'
import test from 'node:test'

import {
  INSPECT_PAPER_TAB_EXPOSURE,
  INSPECT_PAPER_TAB_RIGHT_INSET,
  INSPECT_PAPER_TAB_VISIBLE_TRANSLATE,
  inspectPaperAnchorOffsets,
} from '../src/features/archive/inspectPaperAnchorLogic.ts'

const paperTypes = [
  'text',
  'xiaohongshu',
  'document',
  'article',
  'photo',
  'photo-set',
  'video',
  'audio',
  'product',
  'repository',
  'mixed',
] as const

test('anchors every paper type to its measured visible edge', () => {
  const row = {
    right: 420,
    bottom: 600,
  }

  paperTypes.forEach((kind, index) => {
    const paper = {
      right: 392 - index * 3.25,
      bottom: 582 - index * 2.5,
    }
    const offsets =
      inspectPaperAnchorOffsets(
        row,
        paper,
      )

    const tabRight =
      row.right - offsets.right
    const tabBottom =
      row.bottom
      - offsets.bottom
      + INSPECT_PAPER_TAB_VISIBLE_TRANSLATE

    assert.equal(
      tabRight,
      paper.right
      - INSPECT_PAPER_TAB_RIGHT_INSET,
      `${kind} right edge`,
    )
    assert.equal(
      tabBottom,
      paper.bottom
      + INSPECT_PAPER_TAB_EXPOSURE,
      `${kind} bottom exposure`,
    )
  })
})
