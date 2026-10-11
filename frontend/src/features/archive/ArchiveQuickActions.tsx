import {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { createPortal } from 'react-dom'

import { cabinetDrawers } from '../cabinet/cabinet'

import type { PocketItemSummary } from '../../types/pocket'

import styles from './ArchiveQuickActions.module.css'

type QuickActionView =
  | 'main'
  | 'status'
  | 'collection'
  | 'trash'

interface ArchiveQuickActionsProps {
  item: PocketItemSummary
  collections: string[]
  onClose: () => void
}

export function ArchiveQuickActions({
  item,
  collections,
  onClose,
}: ArchiveQuickActionsProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLElement>(null)
  const [view, setView] = useState<QuickActionView>('main')

  useEffect(() => {
    panelRef.current
      ?.querySelector<HTMLElement>('button:not(:disabled)')
      ?.focus({ preventScroll: true })

    function onKeyDown(event: globalThis.KeyboardEvent) {
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
                  disabled={status === item.status}
                >
                  {label}
                  <span>{status === item.status ? '现在' : ''}</span>
                </button>
              ))}

            {view === 'collection'
              && [null, ...collections].map((collection) => (
                <button
                  key={collection ?? '__unfiled__'}
                  type="button"
                  disabled={collection === item.collection}
                >
                  {collection ?? '未分类'}
                  <span>{collection === item.collection ? '现在' : ''}</span>
                </button>
              ))}

            {view === 'trash' && (
              <p className={styles.copy}>
                确认后才会放进废纸槽，之后仍可恢复。
              </p>
            )}

            <button
              type="button"
              className={styles.back}
              onClick={() => setView('main')}
            >
              返回
            </button>
          </div>
        )}

        <button type="button" className={styles.close} onClick={onClose}>
          收起
        </button>
      </section>
    </div>,
    document.body,
  )
}
