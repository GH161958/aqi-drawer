import {
  useState,
} from 'react'

import {
  cabinetDrawers,
  cabinetSlotLabels,
} from '../cabinet/cabinet'

import {
  useFileItem,
} from './useFileItem'

import type {
  PocketItemSummary,
  PocketStatus,
} from '../../types/pocket'

import styles from './FilingSlip.module.css'

interface FilingSlipProps {
  item: PocketItemSummary

  onFiled:
    (item: PocketItemSummary) => void
}

export function FilingSlip({
  item,
  onFiled,
}: FilingSlipProps) {
  const mutation =
    useFileItem(item.id)

  const [
    confirmMemory,
    setConfirmMemory,
  ] = useState(false)

  function commit(
    status: PocketStatus,
  ) {
    if (
      mutation.isPending
      || status === item.status
    ) {
      return
    }

    mutation.mutate(
      status,
      {
        onSuccess:
          (updatedItem) => {
            setConfirmMemory(false)
            onFiled(updatedItem)
          },
      },
    )
  }

  function choose(
    status: PocketStatus,
  ) {
    if (
      status === item.status
      || mutation.isPending
    ) {
      return
    }

    if (
      status === 'memory_candidate'
    ) {
      setConfirmMemory(true)
      return
    }

    setConfirmMemory(false)
    commit(status)
  }

  const pendingStatus =
    mutation.variables

  return (
    <section
      className={styles.slip}
      aria-labelledby={
        `filing-title-${item.id}`
      }
    >
      <header className={styles.header}>
        <p className={styles.kicker}>
          FILING
        </p>

        <h2
          id={`filing-title-${item.id}`}
          className={styles.title}
        >
          看完放哪儿？
        </h2>
      </header>

      <div
        className={styles.choices}
      >
        {cabinetDrawers.map(
          ({
            status,
            label,
          }) => {
            const current =
              status === item.status

            const pending =
              mutation.isPending
              && pendingStatus === status

            return (
              <button
                key={status}
                className={
                  styles.choice
                }
                data-current={
                  current
                    ? 'true'
                    : undefined
                }
                type="button"
                disabled={
                  current
                  || mutation.isPending
                }
                onClick={() =>
                  choose(status)
                }
              >
                <span
                  className={
                    styles.marker
                  }
                  aria-hidden="true"
                >
                  {current
                    ? '●'
                    : '○'}
                </span>

                <span>
                  {label}
                </span>

                <span
                  className={
                    styles.aside
                  }
                >
                  {current
                    ? '现在'
                    : pending
                      ? '正在放…'
                      : status
                          === 'memory_candidate'
                        ? '需确认'
                        : ''}
                </span>
              </button>
            )
          },
        )}
      </div>

      {confirmMemory && (
        <div
          className={
            styles.confirmSlip
          }
          role="alertdialog"
          aria-labelledby={
            `memory-confirm-title-${item.id}`
          }
        >
          <p
            id={
              `memory-confirm-title-${item.id}`
            }
            className={
              styles.confirmTitle
            }
          >
            想把这张留进记忆候选吗？
          </p>

          <p
            className={
              styles.confirmCopy
            }
          >
            这一步会沿用原来的
            Memory candidate 流程。
          </p>

          <div
            className={
              styles.confirmActions
            }
          >
            <button
              type="button"
              disabled={
                mutation.isPending
              }
              onClick={() =>
                setConfirmMemory(false)
              }
            >
              先不放
            </button>

            <button
              type="button"
              disabled={
                mutation.isPending
              }
              onClick={() =>
                commit(
                  'memory_candidate',
                )
              }
            >
              想留住
            </button>
          </div>
        </div>
      )}

      <p
        className={styles.feedback}
        aria-live="polite"
      >
        {mutation.isPending
          && pendingStatus
          ? `正在放进「${
              cabinetSlotLabels[
                pendingStatus
              ]
            }」……`
          : mutation.isError
            ? mutation.error.message
            : mutation.isSuccess
              ? `已经放进「${
                  cabinetSlotLabels[
                    mutation.data.status
                  ]
                }」。`
              : ''}
      </p>
    </section>
  )
}
