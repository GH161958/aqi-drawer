import type {
  PocketItemSummary,
} from '../../types/pocket'

import styles from './ItemPreview.module.css'

interface ItemPreviewProps {
  item: PocketItemSummary

  onOpen:
    (item: PocketItemSummary) => void
}

function firstPreviewImage(
  item: PocketItemSummary,
): string | null {
  const image =
    item.attachments.find(
      (attachment) =>
        attachment.url
        && attachment.mimeType
          .startsWith('image/'),
    )

  return image?.url ?? null
}

function previewText(
  item: PocketItemSummary,
): string {
  const clean =
    item.text
      .replace(/\s+/gu, ' ')
      .trim()

  if (!clean) {
    return '这张纸暂时没有文字摘要。'
  }

  return (
    clean.length > 150
      ? `${clean.slice(0, 150)}…`
      : clean
  )
}

export function ItemPreview({
  item,
  onOpen,
}: ItemPreviewProps) {
  const image =
    firstPreviewImage(item)

  const hasEeNote =
    Boolean(item.note.trim())

  const hasAqiReply =
    item.replies.length > 0

  return (
    <li className={styles.row}>
      <button
        className={styles.paper}
        data-kind={item.kind}
        type="button"
        onClick={() =>
          onOpen(item)
        }
      >
        {image && (
          <div
            className={
              styles.imageFrame
            }
          >
            <img
              src={image}
              alt=""
              loading="lazy"
            />
          </div>
        )}

        <div className={styles.meta}>
          <span>
            {item.sourceApp}
          </span>

          <span>
            {item.kind.toUpperCase()}
          </span>
        </div>

        <h2 className={styles.title}>
          {item.title}
        </h2>

        {!image && (
          <p className={styles.preview}>
            {previewText(item)}
          </p>
        )}

        {item.collection && (
          <p
            className={
              styles.collection
            }
          >
            FILED · {item.collection}
          </p>
        )}
      </button>

      {(hasEeNote || hasAqiReply) && (
        <div
          className={styles.edgeTabs}
          aria-label="这张纸还有附页"
        >
          {hasEeNote && (
            <span
              className={
                styles.eeTab
              }
            >
              EE
            </span>
          )}

          {hasAqiReply && (
            <span
              className={
                styles.aqiTab
              }
            >
              Aqi
            </span>
          )}
        </div>
      )}
    </li>
  )
}
