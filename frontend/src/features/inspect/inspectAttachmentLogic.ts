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

export function attachmentRemovalMessage(
  cleanupStatus: 'ok' | 'missing' | 'failed',
): string {
  if (cleanupStatus === 'failed') {
    return '附件已从这张纸移除，但原文件清理没有完成。系统已留下排查记录。'
  }

  if (cleanupStatus === 'missing') {
    return '附件已从这张纸移除；原文件此前已不存在。'
  }

  return '附件已移除。'
}
