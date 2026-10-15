import {
  useLayoutEffect,
  useRef,
} from 'react'

import {
  inspectPaperAnchorOffsets,
} from './inspectPaperAnchorLogic'

interface UseInspectPaperAnchorOptions {
  enabled: boolean
  anchorKey: string
}

export function useInspectPaperAnchor({
  enabled,
  anchorKey,
}: UseInspectPaperAnchorOptions) {
  const rowRef =
    useRef<HTMLLIElement>(null)

  useLayoutEffect(() => {
    const row = rowRef.current

    if (!row || !enabled) {
      return
    }

    const paper =
      row.querySelector<HTMLElement>(
        '[data-visible-paper-anchor="true"]',
      )

    if (!paper) {
      return
    }

    let frame = 0

    const measure = () => {
      frame = 0

      const offsets =
        inspectPaperAnchorOffsets(
          row.getBoundingClientRect(),
          paper.getBoundingClientRect(),
        )

      row.style.setProperty(
        '--inspect-paper-anchor-right',
        `${offsets.right}px`,
      )
      row.style.setProperty(
        '--inspect-paper-anchor-bottom',
        `${offsets.bottom}px`,
      )
    }

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(
        measure,
      )
    }

    const observer =
      new ResizeObserver(scheduleMeasure)

    observer.observe(row)
    observer.observe(paper)
    row.addEventListener(
      'transitionend',
      scheduleMeasure,
    )
    row.addEventListener(
      'focusin',
      scheduleMeasure,
    )
    row.addEventListener(
      'focusout',
      scheduleMeasure,
    )
    window.addEventListener(
      'resize',
      scheduleMeasure,
    )
    measure()

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      row.removeEventListener(
        'transitionend',
        scheduleMeasure,
      )
      row.removeEventListener(
        'focusin',
        scheduleMeasure,
      )
      row.removeEventListener(
        'focusout',
        scheduleMeasure,
      )
      window.removeEventListener(
        'resize',
        scheduleMeasure,
      )
      row.style.removeProperty(
        '--inspect-paper-anchor-right',
      )
      row.style.removeProperty(
        '--inspect-paper-anchor-bottom',
      )
    }
  }, [
    enabled,
    anchorKey,
  ])

  return rowRef
}
