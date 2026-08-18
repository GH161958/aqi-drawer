import {
  useState,
} from 'react'

import {
  cabinetSlotLabels,
  formatCabinetCount,
} from '../cabinet/cabinet'

import type {
  CabinetSlot,
  PocketItemSummary,
} from '../../types/pocket'

import {
  useArchiveItems,
} from './useArchiveItems'

import {
  ItemPreview,
} from './ItemPreview'

import styles from './ArchiveDrawer.module.css'

interface ArchiveDrawerProps {
  slot: CabinetSlot
  onBack: () => void
}

export function ArchiveDrawer({
  slot,
  onBack,
}: ArchiveDrawerProps) {
  const [
    inspectedTitle,
    setInspectedTitle,
  ] = useState<string | null>(
    null,
  )

  const {
    items,
    isPending,
    isError,
  } = useArchiveItems(slot)

  if (slot === 'trash') {
    return (
      <section className={styles.view}>
        <div className={styles.toolbar}>
          <button
            type="button"
            className={styles.back}
            onClick={onBack}
          >
            放回柜子
          </button>

          <p className={styles.label}>
            DISCARDED
          </p>
        </div>

        <div className={styles.emptyPaper}>
          <p>
            废纸已经在后端住好了。
          </p>

          <p>
            Trash 的 React 房间稍后单独搬。
          </p>
        </div>
      </section>
    )
  }

  const label =
    cabinetSlotLabels[slot]

  function openPreview(
    item: PocketItemSummary,
  ) {
    setInspectedTitle(item.title)
  }

  return (
    <section
      className={styles.view}
      aria-labelledby="archive-title"
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
        >
          放回柜子
        </button>

        <p
          id="archive-title"
          className={styles.label}
        >
          {label}

          {!isPending && (
            <>
              {' · '}
              {formatCabinetCount(
                items.length,
              )}
            </>
          )}
        </p>
      </div>

      {isPending && (
        <div className={styles.state}>
          正在轻轻拉开抽屉……
        </div>
      )}

      {isError && (
        <div className={styles.state}>
          抽屉暂时没有打开。
        </div>
      )}

      {!isPending
        && !isError
        && items.length === 0 && (
          <div
            className={
              styles.emptyPaper
            }
          >
            这一格还是空的。
          </div>
        )}

      {!isPending
        && !isError
        && items.length > 0 && (
          <ol className={styles.list}>
            {items.map((item) => (
              <ItemPreview
                key={item.id}
                item={item}
                onOpen={openPreview}
              />
            ))}
          </ol>
        )}

      {inspectedTitle && (
        <p className={styles.inspectHint}>
          「{inspectedTitle}」已经找到。
          下一箱搬 Inspect。
        </p>
      )}
    </section>
  )
}
