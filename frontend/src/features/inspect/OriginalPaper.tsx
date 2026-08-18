import type {
  PocketItemSummary,
} from '../../types/pocket'

import styles from './OriginalPaper.module.css'

interface OriginalPaperProps {
  item: PocketItemSummary
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

export function OriginalPaper({
  item,
}: OriginalPaperProps) {
  const images =
    item.attachments.filter(
      (attachment) =>
        attachment.url
        && attachment.mimeType
          .startsWith('image/'),
    )

  return (
    <article className={styles.paper}>
      <header className={styles.header}>
        <div className={styles.meta}>
          <span>
            {item.sourceApp}
          </span>

          <span>
            {formatDate(
              item.lastReceivedAt
              || item.createdAt,
            )}
          </span>
        </div>

        <h1 className={styles.title}>
          {item.title}
        </h1>
      </header>

      {images.length > 0 && (
        <div className={styles.images}>
          {images
            .slice(0, 4)
            .map(
              (
                attachment,
                index,
              ) => (
                <figure
                  key={attachment.id}
                  className={
                    styles.imageSheet
                  }
                >
                  <img
                    src={attachment.url}
                    alt={
                      index === 0
                        ? item.title
                        : ''
                    }
                    loading="lazy"
                  />

                  {images.length > 1 && (
                    <figcaption>
                      {String(
                        index + 1,
                      ).padStart(
                        2,
                        '0',
                      )}
                      {' / '}
                      {String(
                        images.length,
                      ).padStart(
                        2,
                        '0',
                      )}
                    </figcaption>
                  )}
                </figure>
              ),
            )}
        </div>
      )}

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

      <footer className={styles.footer}>
        <span>
          {item.kind.toUpperCase()}
        </span>

        {item.collection && (
          <span>
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
