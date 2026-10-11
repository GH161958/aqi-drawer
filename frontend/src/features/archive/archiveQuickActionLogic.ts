import type {
  CabinetSlot,
  PocketStatus,
} from '../../types/pocket'

export type ArchiveQuickActionResult =
  | {
      type: 'status'
      status: PocketStatus
    }
  | {
      type: 'collection'
      collection: string | null
    }
  | {
      type: 'trash'
    }

interface FocusFallbackOptions {
  result: ArchiveQuickActionResult
  slot: CabinetSlot
  collectionFilter: string
}

export function shouldFocusArchiveFallback({
  result,
  slot,
  collectionFilter,
}: FocusFallbackOptions): boolean {
  if (result.type === 'trash') {
    return true
  }

  if (
    result.type === 'status'
    && slot !== 'all'
  ) {
    return result.status !== slot
  }

  if (
    result.type === 'collection'
    && collectionFilter
  ) {
    return result.collection !== collectionFilter
  }

  return false
}

export function isQuickActionKey(
  key: string,
  shiftKey: boolean,
): boolean {
  return key === 'ContextMenu'
    || (shiftKey && key === 'F10')
}

export function movedBeyondLongPressThreshold(
  originX: number,
  originY: number,
  currentX: number,
  currentY: number,
  threshold = 10,
): boolean {
  return Math.hypot(
    currentX - originX,
    currentY - originY,
  ) > threshold
}
