import { TrashDrawer } from '../trash/TrashDrawer'
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

  onInspect:
    (itemId: string) => void
}

export function ArchiveDrawer({
  slot,
  onBack,
  onInspect,
}: ArchiveDrawerProps) {

  const {
    items,
    isPending,
    isError,
  } = useArchiveItems(slot)

  if (slot === 'trash') {
    return (
      <TrashDrawer
        onBack={onBack}
      />
    )
  }

  const label =
    cabinetSlotLabels[slot]

  function openPreview(
    item: PocketItemSummary,
  ) {
    onInspect(item.id)
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

    </section>
  )
}
