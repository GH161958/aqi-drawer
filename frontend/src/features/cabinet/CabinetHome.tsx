import type {
  CabinetSlot,
} from '../../types/pocket'

import {
  cabinetDrawers,
  formatCabinetCount,
} from './cabinet'

import {
  useCabinetData,
} from './useCabinetData'

import styles from './CabinetHome.module.css'

interface CabinetHomeProps {
  activeSlot: CabinetSlot | null

  onOpen:
    (slot: CabinetSlot) => void
}

export function CabinetHome({
  activeSlot,
  onOpen,
}: CabinetHomeProps) {
  const {
    counts,
    isLoading,
    isError,
  } = useCabinetData()

  return (
    <section
      className={styles.home}
      aria-labelledby="cabinet-title"
    >
      <h2
        id="cabinet-title"
        className="visually-hidden"
      >
        选择一格抽屉
      </h2>

      <div className={styles.cabinet}>
        <button
          className={styles.plaque}
          type="button"
          aria-pressed={
            activeSlot === 'all'
          }
          onClick={() =>
            onOpen('all')
          }
        >
          <span>都在这里</span>

          <span
            className={styles.plaqueCount}
          >
            {isLoading
              ? '—'
              : formatCabinetCount(
                  counts.all,
                )}
          </span>
        </button>

        <div className={styles.drawers}>
          {cabinetDrawers.map(
            ({ status, label }) => {
              const count =
                counts[status]

              const hasContents =
                count > 0

              return (
                <button
                  key={status}
                  className={styles.drawer}
                  data-has-contents={
                    hasContents
                      ? 'true'
                      : undefined
                  }
                  type="button"
                  aria-pressed={
                    activeSlot === status
                  }
                  onClick={() =>
                    onOpen(status)
                  }
                >
                  {hasContents && (
                    <span
                      className={
                        styles.paperEdge
                      }
                      aria-hidden="true"
                    />
                  )}

                  <span
                    className={
                      styles.drawerLabel
                    }
                  >
                    <span>
                      {label}
                    </span>

                    <span
                      className={
                        styles.drawerCount
                      }
                    >
                      {count
                        ? formatCabinetCount(
                            count,
                          )
                        : ''}
                    </span>
                  </span>

                  <span
                    className={
                      styles.drawerPull
                    }
                    aria-hidden="true"
                  />
                </button>
              )
            },
          )}
        </div>

        <button
          className={styles.discardTray}
          data-has-contents={
            counts.trash > 0
              ? 'true'
              : undefined
          }
          type="button"
          aria-pressed={
            activeSlot === 'trash'
          }
          onClick={() =>
            onOpen('trash')
          }
        >
          <span
            className={
              styles.discardPapers
            }
            aria-hidden="true"
          />

          <span>
            DISCARDED
          </span>

          <span
            className={
              styles.discardCount
            }
          >
            {counts.trash
              ? formatCabinetCount(
                  counts.trash,
                )
              : ''}
          </span>
        </button>

        <div
          className={styles.base}
          aria-hidden="true"
        />
      </div>

      <p
        className={styles.status}
        aria-live="polite"
      >
        {isError
          ? '暂时没能核对每一格。'
          : isLoading
            ? '正在核对每一格里的东西……'
            : '柜子已经接到原来的 Drawer。'}
      </p>
    </section>
  )
}
