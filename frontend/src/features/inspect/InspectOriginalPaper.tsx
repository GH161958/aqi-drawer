import {
  classifyPresentation,
} from '../../presentation/classifyPresentation'

import {
  cabinetSlotLabels,
} from '../cabinet/cabinet'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  SourceReadPanel,
} from '../source-reading/SourceReadPanel'

import {
  InspectMedia,
} from './InspectMedia'

import {
  InspectAttachments,
} from './InspectAttachments'

import { useState } from 'react'

import styles from './OriginalPaper.module.css'

interface InspectOriginalPaperProps {
  item: PocketItemSummary
  onInitialMediaReady: () => void
}

function formatDate(
  value: string,
): string {
  if (!value) return ''

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return ''
  }

  return new Intl.DateTimeFormat(
    'zh-CN',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).format(date)
}

export function InspectOriginalPaper({
  item,
  onInitialMediaReady,
}: InspectOriginalPaperProps) {
  const [cleanupWarningItemId, setCleanupWarningItemId] =
    useState<string | null>(null)

  const presentation =
    classifyPresentation(item)

  return (
    <article
      className={styles.paper}
      data-presentation-kind={
        presentation.kind
      }
      data-source-flavor={
        presentation.sourceFlavor
      }
    >
      <header className={styles.header}>
        <h1 className={styles.title}>
          {item.title}
        </h1>
      </header>

      {item.text.trim() && (
        <div className={styles.body}>
          {item.text
            .split(/\n+/u)
            .filter(Boolean)
            .map(
              (
                paragraph,
                index,
              ) => (
                <p key={index}>
                  {paragraph}
                </p>
              ),
            )}
        </div>
      )}

      <InspectMedia
        key={item.id}
        itemId={item.id}
        attachments={item.attachments}
        title={item.title}
        onInitialReady={
          onInitialMediaReady
        }
        onCleanupWarning={() =>
          setCleanupWarningItemId(item.id)
        }
      />

      {cleanupWarningItemId === item.id && (
        <p
          className={styles.attachmentFeedback}
          role="status"
        >
          附件已从这张纸移除，但原文件清理没有完成。系统已留下排查记录。
        </p>
      )}

      <InspectAttachments
        key={item.id}
        item={item}
      />

      {item.sourceUrl && (
        <SourceReadPanel
          item={item}
        />
      )}

      <footer className={styles.footer}>
        <span className={styles.status}>
          {cabinetSlotLabels[item.status]}
        </span>

        <div className={styles.archiveLine}>
          <span>
            {item.sourceApp
              || 'Aqi Drawer'}
          </span>

          <span aria-hidden="true">
            ·
          </span>

          <time
            dateTime={
              item.lastReceivedAt
              || item.createdAt
            }
          >
            {formatDate(
              item.lastReceivedAt
              || item.createdAt,
            )}
          </time>
        </div>

        {item.collection && (
          <span className={styles.collection}>
            FILED · {item.collection}
          </span>
        )}

        {item.sourceUrl && (
          <a
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            打开来源
          </a>
        )}
      </footer>
    </article>
  )
}
