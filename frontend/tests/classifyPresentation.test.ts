import assert from 'node:assert/strict'
import test from 'node:test'

import {
  classifyPresentation,
  isClipboardTextAttachment,
} from '../src/presentation/classifyPresentation.ts'

import type {
  PocketAttachmentSummary,
  PocketItemSummary,
} from '../src/types/pocket.ts'

import {
  isImageAttachment,
  photoIndexAfterRemoval,
} from '../src/features/inspect/inspectAttachmentLogic.ts'

function attachment(
  name: string,
  mimeType: string,
): PocketAttachmentSummary {
  return {
    id: `${name}-${mimeType}`,
    name,
    mimeType,
    url: `/media/${encodeURIComponent(name)}`,
  }
}

function item(
  attachments: PocketAttachmentSummary[],
  sourceApp = '小红书',
  sourceUrl = 'https://www.xiaohongshu.com/explore/test',
): PocketItemSummary {
  return {
    id: 'presentation-test',
    title: 'Presentation test',
    text: '',
    sourceApp,
    sourceUrl,
    kind: attachments.length ? 'mixed' : 'text',
    status: 'inbox',
    deletedAt: null,
    note: '',
    attachments,
    replies: [],
    hiddenReplies: [],
    hiddenReplyCount: 0,
    collection: null,
    tags: [],
    sourceTags: [],
    activity: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastReceivedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('recognizes only the known Clipboard text filename shape', () => {
  assert.equal(
    isClipboardTextAttachment(
      attachment(
        'Clipboard 2026-10-10 at 10.20.30.txt',
        'text/plain',
      ),
    ),
    true,
  )
  assert.equal(
    isClipboardTextAttachment(
      attachment('notes.txt', 'text/plain'),
    ),
    false,
  )
  assert.equal(
    isClipboardTextAttachment(
      attachment('Clipboard 2026.txt', 'application/pdf'),
    ),
    false,
  )
})

test('keeps XHS photos primary when Clipboard text is auxiliary', () => {
  const result = classifyPresentation(
    item([
      attachment('Clipboard 2026.txt', 'text/plain'),
      attachment('01.jpeg', 'image/jpeg'),
      attachment('02.jpeg', 'image/jpeg'),
    ]),
  )

  assert.equal(result.kind, 'photo')
})

test('preserves genuinely mixed XHS attachments', () => {
  const result = classifyPresentation(
    item([
      attachment('01.jpeg', 'image/jpeg'),
      attachment('brief.pdf', 'application/pdf'),
    ]),
  )

  assert.equal(result.kind, 'mixed')
})

test('does not special-case Clipboard files without photos or outside XHS', () => {
  assert.equal(
    classifyPresentation(
      item([
        attachment('Clipboard 2026.txt', 'text/plain'),
      ]),
    ).kind,
    'document',
  )

  assert.equal(
    classifyPresentation(
      item(
        [
          attachment('Clipboard 2026.txt', 'text/plain'),
          attachment('01.jpeg', 'image/jpeg'),
        ],
        'Generic Share',
        'https://example.com/article',
      ),
    ).kind,
    'mixed',
  )

  assert.equal(
    classifyPresentation(
      item([], '', ''),
    ).kind,
    'text',
  )

  const staleMixedWithoutAttachments =
    item([], '', '')
  staleMixedWithoutAttachments.kind = 'mixed'
  staleMixedWithoutAttachments.text =
    'The final attachment was removed.'
  assert.equal(
    classifyPresentation(
      staleMixedWithoutAttachments,
    ).kind,
    'text',
  )
})

test('keeps image and non-image attachment ownership separate', () => {
  assert.equal(
    isImageAttachment(
      attachment('photo.jpeg', 'image/jpeg'),
    ),
    true,
  )
  assert.equal(
    isImageAttachment(
      attachment('active.svg', 'image/svg+xml'),
    ),
    false,
  )
  assert.equal(
    isImageAttachment(
      attachment('notes.txt', 'text/plain'),
    ),
    false,
  )
})

test('selects the nearest surviving photo and closes after the last removal', () => {
  assert.equal(photoIndexAfterRemoval(0, 1), null)
  assert.equal(photoIndexAfterRemoval(0, 3), 0)
  assert.equal(photoIndexAfterRemoval(1, 3), 1)
  assert.equal(photoIndexAfterRemoval(2, 3), 1)
})
