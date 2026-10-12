import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import { createPortal } from 'react-dom'

import { cabinetDrawers } from '../cabinet/cabinet'

import { useCollections } from '../collection/useCollections'
import { useUpdateCollection } from '../collection/useUpdateCollection'
import { useFileItem } from '../filing/useFileItem'
import { useTrashItem } from '../trash/useTrashMutations'

import type {
  PocketItemSummary,
  PocketStatus,
} from '../../types/pocket'

import type {
  ArchiveQuickActionResult,
  QuickActionDismissal,
  QuickActionView,
} from './archiveQuickActionLogic'

import {
  canQuickActionPanelScroll,
  resolveQuickActionDismissal,
} from './archiveQuickActionLogic'

import styles from './ArchiveQuickActions.module.css'

interface ArchiveQuickActionsProps {
  item: PocketItemSummary
  onClose: () => void
  onComplete:
    (result: ArchiveQuickActionResult) => void
}

function isTouchAppleWebKit() {
  return (
    navigator.maxTouchPoints > 0
    && /AppleWebKit/u.test(navigator.userAgent)
    && /(iPad|iPhone|iPod|Macintosh)/u.test(
      navigator.userAgent,
    )
  )
}

export function ArchiveQuickActions({
  item,
  onClose,
  onComplete,
}: ArchiveQuickActionsProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const confirmationRef = useRef<HTMLDivElement>(null)
  const focusedLayerRef = useRef('')
  const closeRef = useRef(onClose)
  const completionRef = useRef(false)
  const pendingRef = useRef(false)
  const viewRef = useRef<QuickActionView>('main')
  const confirmMemoryRef = useRef(false)
  const [view, setView] = useState<QuickActionView>('main')
  const [confirmMemory, setConfirmMemory] = useState(false)

  const statusMutation = useFileItem(item.id)
  const collectionMutation = useUpdateCollection(item.id)
  const trashMutation = useTrashItem(item.id)
  const collectionsQuery = useCollections()

  const pending =
    statusMutation.isPending
    || collectionMutation.isPending
    || trashMutation.isPending

  closeRef.current = onClose
  pendingRef.current = pending
  viewRef.current = view
  confirmMemoryRef.current = confirmMemory

  const error =
    statusMutation.error
    || collectionMutation.error
    || trashMutation.error

  function completeOnce(
    result: ArchiveQuickActionResult,
  ) {
    if (completionRef.current) {
      return
    }

    completionRef.current = true
    onComplete(result)
  }

  function commitStatus(status: PocketStatus) {
    if (pending || status === item.status) {
      return
    }

    statusMutation.mutate(status, {
      onSuccess: () => {
        setConfirmMemory(false)
        completeOnce({ type: 'status', status })
      },
    })
  }

  function chooseStatus(status: PocketStatus) {
    if (status === 'memory_candidate') {
      setConfirmMemory(true)
      return
    }

    setConfirmMemory(false)
    commitStatus(status)
  }

  function chooseCollection(collection: string | null) {
    if (pending || collection === item.collection) {
      return
    }

    collectionMutation.mutate(collection, {
      onSuccess: () =>
        completeOnce({ type: 'collection', collection }),
    })
  }

  function confirmTrash() {
    if (pending) {
      return
    }

    trashMutation.mutate(undefined, {
      onSuccess: () => completeOnce({ type: 'trash' }),
    })
  }

  function applyDismissal(
    dismissal: QuickActionDismissal,
  ) {
    if (dismissal === 'blocked') {
      return
    }

    if (dismissal === 'cancel-memory') {
      setConfirmMemory(false)
      return
    }

    if (dismissal === 'main') {
      setConfirmMemory(false)
      setView('main')
      return
    }

    closeRef.current()
  }

  function returnToMain() {
    if (pending) {
      return
    }

    setConfirmMemory(false)
    setView('main')
  }

  useLayoutEffect(() => {
    const scrollY = window.scrollY
    const touchAppleWebKit =
      isTouchAppleWebKit()
    let lastTouchY: number | null = null

    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    }

    document.body.style.position = 'fixed'
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = '100%'
    document.body.style.overflow = 'hidden'

    if (touchAppleWebKit) {
      function rememberTouch(
        event: TouchEvent,
      ) {
        lastTouchY =
          event.touches.length === 1
            ? event.touches[0].clientY
            : null
      }

      function guardBackgroundTouch(
        event: TouchEvent,
      ) {
        const target = event.target
        const panel = panelRef.current
        const currentTouch =
          event.touches.length === 1
            ? event.touches[0]
            : null

        if (!currentTouch) {
          lastTouchY = null
          return
        }

        const touchDeltaY =
          lastTouchY === null
            ? 0
            : currentTouch.clientY
              - lastTouchY

        lastTouchY = currentTouch.clientY

        if (
          target instanceof Node
          && panel?.contains(target)
          && canQuickActionPanelScroll({
            scrollTop: panel.scrollTop,
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight,
            touchDeltaY,
          })
        ) {
          return
        }

        event.preventDefault()
      }

      document.addEventListener(
        'touchstart',
        rememberTouch,
        { passive: true },
      )
      document.addEventListener(
        'touchmove',
        guardBackgroundTouch,
        { passive: false },
      )
      document.addEventListener(
        'touchend',
        rememberTouch,
        { passive: true },
      )
      document.addEventListener(
        'touchcancel',
        rememberTouch,
        { passive: true },
      )

      return () => {
        document.removeEventListener(
          'touchstart',
          rememberTouch,
        )
        document.removeEventListener(
          'touchmove',
          guardBackgroundTouch,
        )
        document.removeEventListener(
          'touchend',
          rememberTouch,
        )
        document.removeEventListener(
          'touchcancel',
          rememberTouch,
        )

        document.body.style.position = previous.position
        document.body.style.top = previous.top
        document.body.style.width = previous.width
        document.body.style.overflow = previous.overflow
        window.scrollTo(0, scrollY)
      }
    }

    return () => {
      document.body.style.position = previous.position
      document.body.style.top = previous.top
      document.body.style.width = previous.width
      document.body.style.overflow = previous.overflow
      window.scrollTo(0, scrollY)
    }
  }, [])

  useEffect(() => {
    const focusKey = `${view}:${confirmMemory ? 'confirm' : 'base'}`

    if (focusedLayerRef.current === focusKey) {
      return
    }

    focusedLayerRef.current = focusKey

    const focusOwner = confirmMemory
      ? confirmationRef.current
      : panelRef.current

    focusOwner
      ?.querySelector<HTMLElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true })
  }, [confirmMemory, view])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const panel = panelRef.current

      if (event.key === 'Tab') {
        const focusOwner = confirmMemoryRef.current
          ? confirmationRef.current
          : panel

        const focusable = Array.from(
          focusOwner?.querySelectorAll<HTMLElement>(
            'button:not(:disabled)',
          ) ?? [],
        )

        if (focusable.length === 0) {
          event.preventDefault()
          return
        }

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (
          event.shiftKey
          && document.activeElement === first
        ) {
          event.preventDefault()
          last.focus({ preventScroll: true })
        } else if (
          !event.shiftKey
          && document.activeElement === last
        ) {
          event.preventDefault()
          first.focus({ preventScroll: true })
        }

        return
      }

      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      applyDismissal(
        resolveQuickActionDismissal({
          pending: pendingRef.current,
          source: 'escape',
          view: viewRef.current,
          confirmMemory:
            confirmMemoryRef.current,
        }),
      )
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const heading =
    view === 'main'
      ? '整理这张纸'
      : view === 'status'
        ? '放进哪一格'
        : view === 'collection'
          ? '放进 Collection'
          : '放进废纸槽'

  return createPortal(
    <div
      className={styles.backdrop}
      aria-busy={pending}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          applyDismissal(
            resolveQuickActionDismissal({
              pending,
              source: 'backdrop',
              view,
              confirmMemory,
            }),
          )
        }
      }}
    >
      <section
        ref={panelRef}
        className={styles.slip}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className={styles.header}>
          <p className={styles.kicker}>ARCHIVE · FILE</p>
          <h2 id={titleId} className={styles.title}>{heading}</h2>
          <p className={styles.itemTitle}>
            {item.title || '没有标题的纸'}
          </p>
        </header>

        {view === 'main' ? (
          <div className={styles.choices}>
            <button type="button" onClick={() => setView('status')}>
              放进哪一格 <span aria-hidden="true">→</span>
            </button>
            <button type="button" onClick={() => setView('collection')}>
              放进 Collection <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className={styles.trashAction}
              onClick={() => setView('trash')}
            >
              放进废纸槽 <span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <div className={styles.choices}>
            {view === 'status'
              && cabinetDrawers.map(({ status, label }) => (
                <button
                  key={status}
                  type="button"
                  disabled={pending || status === item.status}
                  onClick={() => chooseStatus(status)}
                >
                  {label}
                  <span>
                    {status === item.status
                      ? '现在'
                      : statusMutation.isPending
                          && statusMutation.variables === status
                        ? '正在放…'
                        : status === 'memory_candidate'
                          ? '需确认'
                          : ''}
                  </span>
                </button>
              ))}

            {view === 'collection'
              && [null, ...(collectionsQuery.data ?? [])].map((collection) => (
                <button
                  key={collection ?? '__unfiled__'}
                  type="button"
                  disabled={pending || collection === item.collection}
                  onClick={() => chooseCollection(collection)}
                >
                  {collection ?? '未分类'}
                  <span>{collection === item.collection ? '现在' : ''}</span>
                </button>
              ))}

            {view === 'trash' && (
              <>
                <p className={styles.copy}>
                  要把这张纸放进废纸槽吗？之后还可以恢复。
                </p>
                <button
                  type="button"
                  className={styles.trashAction}
                  disabled={pending}
                  onClick={confirmTrash}
                >
                  {trashMutation.isPending ? '正在放进去…' : '确认放进去'}
                </button>
              </>
            )}

            <button
              type="button"
              className={styles.back}
              disabled={pending}
              onClick={returnToMain}
            >
              返回
            </button>
          </div>
        )}

        {confirmMemory && (
          <div
            ref={confirmationRef}
            className={styles.confirmation}
            role="alertdialog"
            aria-labelledby={`${titleId}-memory`}
          >
            <p id={`${titleId}-memory`} className={styles.confirmTitle}>
              想把这张留进记忆候选吗？
            </p>
            <p className={styles.copy}>
              这一步会沿用原来的 Memory candidate 流程。
            </p>
            <div className={styles.confirmActions}>
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmMemory(false)}
              >
                先不放
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => commitStatus('memory_candidate')}
              >
                {statusMutation.isPending ? '正在放…' : '想留住'}
              </button>
            </div>
          </div>
        )}

        <p className={styles.feedback} aria-live="polite">
          {collectionsQuery.isError
            ? 'Collection 暂时没有读出来。'
            : error
              ? error.message || '这张纸暂时没有整理好。'
              : ''}
        </p>

        <button
          type="button"
          className={styles.close}
          disabled={pending}
          onClick={() =>
            closeRef.current()
          }
        >
          收起
        </button>
      </section>
    </div>,
    document.body,
  )
}
