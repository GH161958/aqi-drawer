import type {
  PocketItemSummary,
} from '../../types/pocket'

import styles from './RecordPaper.module.css'

interface RecordPaperProps {
  item: PocketItemSummary
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

function humanizeStatus(
  status: PocketItemSummary['status'],
): string {
  const labels:
    Record<
      PocketItemSummary['status'],
      string
    > = {
      inbox: '刚放进来',
      tonight: '今晚看看',
      discussed: '聊过了',
      deferred: '晚点再看',
      memory_candidate: '想留住',
      archived: '收好了',
    }

  return labels[status]
}

export function RecordPaper({
  item,
}: RecordPaperProps) {
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
              {humanizeStatus(
                item.status,
              )}
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
              {item.collection || '未归档'}
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
          READ ONLY · EDITING MOVES NEXT
        </p>
      </div>
    </details>
  )
}
