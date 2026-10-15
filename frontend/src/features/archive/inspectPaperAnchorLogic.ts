export interface PaperAnchorRect {
  right: number
  bottom: number
}

export const INSPECT_PAPER_TAB_RIGHT_INSET =
  12

export const INSPECT_PAPER_TAB_EXPOSURE =
  18

export const INSPECT_PAPER_TAB_VISIBLE_TRANSLATE =
  1

export function inspectPaperAnchorOffsets(
  row: PaperAnchorRect,
  paper: PaperAnchorRect,
) {
  return {
    right:
      row.right
      - paper.right
      + INSPECT_PAPER_TAB_RIGHT_INSET,
    bottom:
      row.bottom
      - paper.bottom
      - (
        INSPECT_PAPER_TAB_EXPOSURE
        - INSPECT_PAPER_TAB_VISIBLE_TRANSLATE
      ),
  }
}
