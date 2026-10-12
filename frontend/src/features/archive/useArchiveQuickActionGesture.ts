import {
  useEffect,
  useRef,
} from 'react'

import type {
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from 'react'

import {
  isQuickActionKey,
  movedBeyondLongPressThreshold,
} from './archiveQuickActionLogic'

const LONG_PRESS_DELAY = 500
const MOVE_THRESHOLD = 10

interface GestureOptions {
  onOpen: (
    trigger: HTMLButtonElement,
  ) => void
}

export function useArchiveQuickActionGesture({
  onOpen,
}: GestureOptions) {
  const timerRef =
    useRef<number | null>(null)
  const originRef = useRef({ x: 0, y: 0 })
  const suppressClickRef = useRef(false)

  function clearTimer() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => clearTimer, [])

  function onPointerDown(
    event: PointerEvent<HTMLButtonElement>,
  ) {
    if (
      event.button !== 0
      || event.pointerType === 'mouse'
    ) {
      return
    }

    clearTimer()
    suppressClickRef.current = false
    originRef.current = {
      x: event.clientX,
      y: event.clientY,
    }

    const trigger = event.currentTarget
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      suppressClickRef.current = true
      onOpen(trigger)
    }, LONG_PRESS_DELAY)
  }

  function onPointerMove(
    event: PointerEvent<HTMLButtonElement>,
  ) {
    if (timerRef.current === null) {
      return
    }

    if (movedBeyondLongPressThreshold(
      originRef.current.x,
      originRef.current.y,
      event.clientX,
      event.clientY,
      MOVE_THRESHOLD,
    )) {
      clearTimer()
    }
  }

  function consumeSuppressedClick() {
    if (!suppressClickRef.current) {
      return false
    }

    suppressClickRef.current = false
    return true
  }

  function onContextMenu(
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault()
    clearTimer()

    if (suppressClickRef.current) {
      return
    }

    if (event.button !== 2) {
      suppressClickRef.current = true
    }

    onOpen(event.currentTarget)
  }

  function onKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    if (isQuickActionKey(event.key, event.shiftKey)) {
      event.preventDefault()
      onOpen(event.currentTarget)
    }
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: clearTimer,
    onPointerCancel: clearTimer,
    consumeSuppressedClick,
    onContextMenu,
    onKeyDown,
  }
}
