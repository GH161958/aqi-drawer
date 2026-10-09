import {
  useRef,
  type MouseEvent,
} from 'react'

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

import {
  TypeCabinet,
} from '../type-cabinet/TypeCabinet'

import {
  CapturePocket,
} from '../capture/CapturePocket'

import {
  animateCabinetDrawerPull,
  cancelCabinetDrawerMotion,
} from './cabinetMotion'

import styles from './CabinetHome.module.css'

interface CabinetHomeProps {
  activeSlot: CabinetSlot | null

  onOpen:
    (
      slot: CabinetSlot,
      animateEnter?: boolean,
    ) => void
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

  const motionSequence =
    useRef(0)

  const activeMotionTrigger =
    useRef<HTMLButtonElement | null>(
      null,
    )

  const openPhysicalDrawer =
    async (
      event:
        MouseEvent<HTMLButtonElement>,
      slot: CabinetSlot,
      hasContents: boolean,
    ) => {
      /*
        Keyboard and assistive-tech
        synthetic clicks report detail=0.

        Do not impose visual motion
        on keyboard navigation.
      */
      if (event.detail === 0) {
        onOpen(
          slot,
          false,
        )

        return
      }

      const trigger =
        event.currentTarget

      const sequence =
        motionSequence.current + 1

      motionSequence.current =
        sequence

      if (
        activeMotionTrigger.current
      ) {
        cancelCabinetDrawerMotion(
          activeMotionTrigger.current,
        )
      }

      activeMotionTrigger.current =
        trigger

      const completed =
        await animateCabinetDrawerPull(
          trigger,
          hasContents,
        )

      if (
        !completed
        || sequence
          !== motionSequence.current
      ) {
        return
      }

      onOpen(
        slot,
        true,
      )
    }

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
        <CapturePocket />

        <div
          className={styles.topRail}
          aria-hidden="true"
        />

        <TypeCabinet />
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
                  onClick={(event) => {
                    void openPhysicalDrawer(
                      event,
                      status,
                      hasContents,
                    )
                  }}
                >
                  {hasContents && (
                    <>
                      <span
                        className={
                          styles.drawerCavity
                        }
                        aria-hidden="true"
                      />

                      <span
                        className={
                          styles.paperEdge
                        }
                        data-drawer-paper
                        aria-hidden="true"
                      />

                      <span
                        className={
                          styles.drawerFront
                        }
                        data-drawer-front
                        aria-hidden="true"
                      />
                    </>
                  )}

                  <span
                    className={
                      styles.drawerLabel
                    }
                    data-drawer-label
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
                    data-drawer-pull
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
