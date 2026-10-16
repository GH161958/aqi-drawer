import {
  useEffect,
  useRef,
} from 'react'

import {
  isArchiveOutsideTap,
} from './drawerNavigation'

interface PointerStart {
  pointerId: number
  x: number
  y: number
  startedAt: number
  target: EventTarget | null
}

export function useArchiveOutsideDismiss(
  enabled: boolean,
  onDismiss: () => void,
) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!enabled) {
      return
    }

    let start: PointerStart | null = null

    const clear = () => {
      start = null
    }

    const onPointerDown = (
      event: PointerEvent,
    ) => {
      if (
        !event.isPrimary
        || event.button !== 0
      ) {
        clear()
        return
      }

      start = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startedAt: performance.now(),
        target: event.target,
      }
    }

    const onPointerUp = (
      event: PointerEvent,
    ) => {
      const gesture = start
      clear()

      if (
        !gesture
        || gesture.pointerId
          !== event.pointerId
      ) {
        return
      }

      const boundary =
        document.querySelector<HTMLElement>(
          '[data-archive-physical-boundary]',
        )

      if (!boundary) {
        return
      }

      const target =
        gesture.target instanceof Element
          ? gesture.target
          : null

      const interactiveTarget = Boolean(
        target?.closest(
          'button, a, input, select, textarea, [contenteditable="true"], [role="dialog"], [data-archive-dismiss-ignore]',
        ),
      )

      const selectionActive = Boolean(
        window.getSelection()?.toString(),
      )

      if (isArchiveOutsideTap({
        startX: gesture.x,
        startY: gesture.y,
        endX: event.clientX,
        endY: event.clientY,
        elapsedMs:
          performance.now()
          - gesture.startedAt,
        boundary:
          boundary.getBoundingClientRect(),
        edgeGuard: 8,
        movementLimit: 10,
        selectionActive,
        interactiveTarget,
      })) {
        dismissRef.current()
      }
    }

    document.addEventListener(
      'pointerdown',
      onPointerDown,
      true,
    )
    document.addEventListener(
      'pointerup',
      onPointerUp,
      true,
    )
    document.addEventListener(
      'pointercancel',
      clear,
      true,
    )

    return () => {
      document.removeEventListener(
        'pointerdown',
        onPointerDown,
        true,
      )
      document.removeEventListener(
        'pointerup',
        onPointerUp,
        true,
      )
      document.removeEventListener(
        'pointercancel',
        clear,
        true,
      )
    }
  }, [enabled])
}
