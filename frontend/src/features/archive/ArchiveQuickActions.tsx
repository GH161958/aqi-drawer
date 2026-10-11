import {
  useEffect,
  useId,
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
} from './archiveQuickActionLogic'

import styles from './ArchiveQuickActions.module.css'

type QuickActionView =
  | 'main'
  | 'status'
  | 'collection'
  | 'trash'

interface ArchiveQuickActionsProps {
  item: PocketItemSummary
  onClose: () => void
  onComplete:
    (result: ArchiveQuickActionResult) => void
}

export function ArchiveQuickActions({
  item,
  onClose,
  onComplete,
}: ArchiveQuickActionsProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
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

  const error =
    statusMutation.error
    || collectionMutation.error
    || trashMutation.error

  function commitStatus(status: PocketStatus) {
    if (pending || status === item.status) {
      return
    }

    statusMutation.mutate(status, {
      onSuccess: () => {
        setConfirmMemory(false)
        onComplete({ type: 'status', status })
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
        onComplete({ type: 'collection', collection }),
    })
  }

  function confirmTrash() {
    if (pending) {
      return
    }

    trashMutation.mutate(undefined, {
      onSuccess: () => onComplete({ type: 'trash' }),
    })
  }

  useEffect(() => {
    const panel = panelRef.current

    panel
      ?.querySelector<HTMLElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true })

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Tab') {
        const focusable = Array.from(
          panel?.querySelectorAll<HTMLElement>(
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
      if (view === 'main') {
        onClose()
      } else {
        setView('main')
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, view])

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
          onClose()
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
            <button type="button" onClick={() => setView('trash')}>
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
              onClick={() => setView('main')}
            >
              返回
            </button>
          </div>
        )}

        {confirmMemory && (
          <div
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

        <button type="button" className={styles.close} disabled={pending} onClick={onClose}>
          收起
        </button>
      </section>
    </div>,
    document.body,
  )
}
