import type {
  PocketAttachmentSummary,
} from '../../types/pocket'

const viewerImageTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function isImageAttachment(
  attachment: PocketAttachmentSummary,
): boolean {
  return viewerImageTypes.has(
    attachment.mimeType
    .trim()
    .toLowerCase(),
  )
}

export function photoIndexAfterRemoval(
  removedIndex: number,
  imageCount: number,
): number | null {
  const remainingCount =
    Math.max(0, imageCount - 1)

  if (remainingCount === 0) return null

  return Math.min(
    Math.max(0, removedIndex),
    remainingCount - 1,
  )
}
