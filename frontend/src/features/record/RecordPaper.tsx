import type {
  PocketActivityEntry,
  PocketItemSummary,
} from '../../types/pocket'

import {
  cabinetSlotLabels,
} from '../cabinet/cabinet'

import {
  CollectionEditor,
} from '../collection/CollectionEditor'

import styles from './RecordPaper.module.css'

interface RecordPaperProps {
  item: PocketItemSummary
}

function archiveNumber(
  value: number,
): string {
  return String(
    Math.max(
      0,
      value,
    ),
  ).padStart(2, '0')
}

function formatActivityTime(
  value: string,
): string {
  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '时间未记下'
  }

  return new Intl.DateTimeFormat(
    'en-GB',
    {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    },
  )
    .format(date)
    .toUpperCase()
}

function actorLabel(
  actor: string,
): string {
  if (actor === 'EE') {
    return 'EE'
  }

  if (actor === 'Aqi') {
    return 'AQI'
  }

  return 'SYSTEM'
}

function activityLabel(
  entry: PocketActivityEntry,
): string {
  const actor =
    actorLabel(entry.actor)

  if (
    entry.type === 'received'
  ) {
    const count =
      typeof entry.detail.count === 'number'
        ? entry.detail.count
        : 0

    return (
      `${actor} LEFT THIS HERE`
      + (
        count > 1
          ? ` · ${count}`
          : ''
      )
    )
  }

  if (
    entry.type === 'seen_by_aqi'
  ) {
    return 'AQI SAW THIS'
  }

  if (
    entry.type === 'content_read'
  ) {
    const mode =
      typeof entry.detail.mode === 'string'
        ? entry.detail.mode
        : 'compact'

    return (
      `${actor} READ SOURCE · `
      + mode.toUpperCase()
    )
  }

  if (
    entry.type === 'reply_added'
  ) {
    return `${actor} LEFT A NOTE`
  }

  if (
    entry.type === 'status_changed'
  ) {
    const status =
      typeof entry.detail.to === 'string'
        ? entry.detail.to
        : ''

    const label =
      status in cabinetSlotLabels
        ? cabinetSlotLabels[
            status as keyof typeof cabinetSlotLabels
          ]
        : status

    return (
      `${actor} MOVED IT`
      + (
        label
          ? ` · ${label}`
          : ''
      )
    )
  }

  if (
    entry.type === 'metadata_changed'
  ) {
    return `${actor} UPDATED THE INDEX`
  }

  if (
    entry.type === 'source_refreshed'
  ) {
    return 'SOURCE REFRESHED'
  }

  return entry.type
}

function IndexField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.field}>
      <dt>{label}</dt>

      <dd>{children}</dd>
    </div>
  )
}

export function RecordPaper({
  item,
}: RecordPaperProps) {
  const activity =
    [...item.activity].sort(
      (a, b) =>
        a.at.localeCompare(b.at),
    )

  return (
    <details className={styles.paper}>
      <summary className={styles.summary}>
        <span className={styles.receiptLabel}>
          RECEIPT
        </span>

        {activity.length > 0 && (
          <span className={styles.receiptCount}>
            {archiveNumber(
              activity.length,
            )}
          </span>
        )}

        <span
          className={styles.disclosure}
          aria-hidden="true"
        >
          +
        </span>
      </summary>

      <div className={styles.sheet}>
        <header className={styles.heading}>
          <p className={styles.kicker}>
            AQI DRAWER
          </p>

          <div className={styles.titleRow}>
            <h2 className={styles.title}>
              ITEM RECORD
            </h2>

            {activity.length > 0 && (
              <span className={styles.count}>
                {archiveNumber(
                  activity.length,
                )}
              </span>
            )}
          </div>
        </header>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            CURRENT INDEX
          </h3>

          <dl className={styles.fields}>
            <IndexField label="SOURCE">
              {item.sourceApp || '—'}
            </IndexField>

            <CollectionEditor
              item={item}
            />

            <IndexField label="TAGS">
              {item.tags.length
                ? item.tags
                    .map(
                      (tag) =>
                        `#${tag}`,
                    )
                    .join('  ')
                : '—'}
            </IndexField>

            {item.sourceTags.length > 0 && (
              <IndexField label="SOURCE TAGS">
                {item.sourceTags
                  .map(
                    (tag) =>
                      `#${tag}`,
                  )
                  .join('  ')}
              </IndexField>
            )}
          </dl>

          <p className={styles.indexNote}>
            INDEX EDITING MOVES NEXT
          </p>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>
            LIVING RECORD
          </h3>

          {activity.length === 0 ? (
            <p className={styles.empty}>
              还没有留下可记录的动作。
            </p>
          ) : (
            <ol className={styles.activityList}>
              {activity.map(
                (
                  entry,
                  index,
                ) => (
                  <li
                    key={
                      `${entry.at}-${entry.type}-${index}`
                    }
                    className={
                      styles.activityRow
                    }
                  >
                    <time>
                      {formatActivityTime(
                        entry.at,
                      )}
                    </time>

                    <span>
                      {activityLabel(
                        entry,
                      )}
                    </span>
                  </li>
                ),
              )}
            </ol>
          )}
        </section>
      </div>
    </details>
  )
}
