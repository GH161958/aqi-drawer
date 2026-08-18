import {
  cabinetDrawers,
  cabinetSlotLabels,
} from '../cabinet/cabinet'

import type {
  PocketItemSummary,
  PocketStatus,
} from '../../types/pocket'

import {
  useUpdateItemStatus,
} from './useUpdateItemStatus'

import styles from './RecordPaper.module.css'

interface RecordPaperProps {
  item: PocketItemSummary

  onStatusChanged:
    (item: PocketItemSummary) => void
}

function formatRecordDate(
  value: string,
): string {
  if (!value) return '—'

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '—'
  }

  return new Intl.DateTimeFormat(
    'zh-CN',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    },
  ).format(date)
}

export function RecordPaper({
  item,
  onStatusChanged,
}: RecordPaperProps) {
  const mutation =
    useUpdateItemStatus(
      item.id,
    )

  function chooseStatus(
    status: PocketStatus,
  ) {
    if (
      status === item.status
      || status ===
        'memory_candidate'
      || mutation.isPending
    ) {
      return
    }

    mutation.mutate(
      status,
      {
        onSuccess:
          onStatusChanged,
      },
    )
  }

  const pendingStatus =
    mutation.variables

  return (
    <details className={styles.paper}>
      <summary className={styles.summary}>
        <span className={styles.index}>
          RECORD
        </span>

        <span className={styles.summaryTitle}>
          登记这张
        </span>

        <span
          className={styles.disclosure}
          aria-hidden="true"
        >
          +
        </span>
      </summary>

      <div className={styles.body}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>
            DRAWER REGISTRATION
          </p>

          <p className={styles.number}>
            {item.id.slice(0, 8)}
          </p>
        </div>

        <dl className={styles.fields}>
          <div className={styles.field}>
            <dt>STATUS</dt>

            <dd>
              {
                cabinetSlotLabels[
                  item.status
                ]
              }
            </dd>
          </div>

          <div className={styles.field}>
            <dt>TYPE</dt>

            <dd>
              {item.kind.toUpperCase()}
            </dd>
          </div>

          <div className={styles.field}>
            <dt>SOURCE</dt>

            <dd>
              {item.sourceApp || '—'}
            </dd>
          </div>

          <div className={styles.field}>
            <dt>RECEIVED</dt>

            <dd>
              {formatRecordDate(
                item.lastReceivedAt
                || item.createdAt,
              )}
            </dd>
          </div>

          <div className={styles.field}>
            <dt>COLLECTION</dt>

            <dd>
              {item.collection
                || '未归档'}
            </dd>
          </div>

          <div className={styles.field}>
            <dt>ATTACHMENTS</dt>

            <dd>
              {String(
                item.attachments.length,
              ).padStart(2, '0')}
            </dd>
          </div>
        </dl>

        <section
          className={
            styles.statusSection
          }
          aria-labelledby={
            `record-status-${item.id}`
          }
        >
          <div
            className={
              styles.sectionHeading
            }
          >
            <p
              id={
                `record-status-${item.id}`
              }
              className={
                styles.tagLabel
              }
            >
              整理到
            </p>

            <span
              className={
                styles.liveMark
              }
            >
              LIVE
            </span>
          </div>

          <div
            className={
              styles.statusChoices
            }
          >
            {cabinetDrawers.map(
              ({
                status,
                label,
              }) => {
                const current =
                  status
                  === item.status

                const requiresMemoryConfirm =
                  status
                  === 'memory_candidate'
                  && !current

                return (
                  <button
                    key={status}
                    className={
                      styles.statusChoice
                    }
                    data-current={
                      current
                        ? 'true'
                        : undefined
                    }
                    type="button"
                    disabled={
                      current
                      || requiresMemoryConfirm
                      || mutation.isPending
                    }
                    onClick={() =>
                      chooseStatus(
                        status,
                      )
                    }
                  >
                    <span
                      className={
                        styles.statusMarker
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

                    {current && (
                      <span
                        className={
                          styles.statusAside
                        }
                      >
                        现在
                      </span>
                    )}

                    {requiresMemoryConfirm && (
                      <span
                        className={
                          styles.statusAside
                        }
                      >
                        需确认
                      </span>
                    )}
                  </button>
                )
              },
            )}
          </div>

          <p
            className={
              styles.statusFeedback
            }
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
                  : '“想留住”保留原来的确认步骤，下一箱再接。'}
          </p>
        </section>

        <div className={styles.tagSection}>
          <p className={styles.tagLabel}>
            TAGS
          </p>

          {item.tags.length > 0 ? (
            <ul className={styles.tags}>
              {item.tags.map(
                (tag) => (
                  <li key={tag}>
                    {tag}
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p className={styles.empty}>
              暂无索引词
            </p>
          )}
        </div>

        <p className={styles.readOnly}>
          STATUS IS LIVE · OTHER FIELDS NEXT
        </p>
      </div>
    </details>
  )
}
