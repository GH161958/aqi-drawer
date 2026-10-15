export type InspectPreviewState =
  | 'idle'
  | 'preparing'
  | 'failed'

export const INSPECT_TAB_DELAY_MS = 260

export function inspectPaperTabView(
  state: InspectPreviewState,
  delayElapsed: boolean,
) {
  const failed = state === 'failed'

  return {
    visible:
      failed
      || (
        state === 'preparing'
        && delayElapsed
      ),
    label:
      failed
        ? '失败 · 重试'
        : '取纸中…',
  }
}

interface InspectPreviewStateInput {
  itemId: string
  activeItemId: string | null
  presentedItemId: string | null
  failedItemId: string | null
}

export function inspectPreviewState({
  itemId,
  activeItemId,
  presentedItemId,
  failedItemId,
}: InspectPreviewStateInput): InspectPreviewState {
  if (
    itemId !== activeItemId
    || presentedItemId === itemId
  ) {
    return 'idle'
  }

  return failedItemId === itemId
    ? 'failed'
    : 'preparing'
}

export function isCurrentInspectItem(
  activeItemId: string | null,
  resultItemId: string,
) {
  return activeItemId === resultItemId
}
