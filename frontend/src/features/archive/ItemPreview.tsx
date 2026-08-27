import {
  classifyPresentation,
  presentationKindLabels,
} from '../../presentation/classifyPresentation'

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

  return clean.length > 150
    ? `${clean.slice(0, 150)}…`
    : clean
}

function formatDate(
  value: string,
): string {
  if (!value) {
    return ''
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
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

function sourceDomain(
  value: string,
): string {
  if (!value) {
    return ''
  }

  try {
    return new URL(value)
      .hostname
      .replace(/^www\./u, '')
  } catch {
    return ''
  }
}

function documentType(
  mimeType: string,
): string {
  const mime =
    mimeType
      .trim()
      .toLowerCase()

  if (mime === 'application/pdf') {
    return 'PDF'
  }

  if (
    mime.includes('word')
    || mime.includes(
      'wordprocessingml',
    )
  ) {
    return 'DOC'
  }

  if (
    mime.includes('spreadsheet')
    || mime.includes('excel')
  ) {
    return 'SHEET'
  }

  if (
    mime.includes('presentation')
    || mime.includes('powerpoint')
  ) {
    return 'SLIDES'
  }

  return 'FILE'
}

export function ItemPreview({
  item,
  onOpen,
}: ItemPreviewProps) {
  const image =
    firstPreviewImage(item)

  const presentation =
    classifyPresentation(item)

  const hasEeNote =
    Boolean(item.note.trim())

  const hasAqiReply =
    item.replies.length > 0

  const isDocument =
    presentation.kind === 'document'

  const isArticle =
    presentation.kind === 'article'

  const attachment =
    item.attachments[0]

  const date =
    formatDate(
      item.lastReceivedAt
      || item.createdAt,
    )

  return (
    <li className={styles.row}>
      <button
        className={
          isDocument
            ? `${styles.paper} ${styles.documentCarrier}`
            : isArticle
              ? `${styles.paper} ${styles.articleCarrier}`
              : styles.paper
        }
        data-kind={item.kind}
        data-presentation-kind={
          presentation.kind
        }
        data-source-flavor={
          presentation.sourceFlavor
        }
        type="button"
        onClick={() =>
          onOpen(item)
        }
      >
        {isDocument ? (
          <div
            className={
              styles.documentFolder
            }
          >
            <div
              className={
                styles.documentBack
              }
              aria-hidden="true"
            />

            <div
              className={
                styles.documentTab
              }
            >
              <span>
                FILES
              </span>

              {date && (
                <time>
                  {date}
                </time>
              )}
            </div>

            <article
              className={
                styles.documentInnerSheet
              }
            >
              <p
                className={
                  styles.documentType
                }
              >
                {documentType(
                  attachment
                    ?.mimeType
                    ?? '',
                )}
              </p>

              <h2
                className={
                  styles.documentTitle
                }
              >
                {item.title
                  || attachment?.name
                  || '收进来的文件'}
              </h2>

              {item.text.trim() && (
                <p
                  className={
                    styles.documentPreview
                  }
                >
                  {previewText(item)}
                </p>
              )}
            </article>

            <div
              className={
                styles.documentFront
              }
            >
              <span
                className={
                  styles.documentFilename
                }
              >
                {attachment?.name
                  || item.title
                  || 'Untitled file'}
              </span>

              <span
                className={
                  styles.documentSource
                }
              >
                {item.sourceApp
                  || 'Aqi Drawer'}
              </span>
            </div>
          </div>
        ) : isArticle ? (
          <div
            className={
              styles.articleObject
            }
          >
            <span
              className={
                styles.articleTape
              }
              aria-hidden="true"
            />

            <div
              className={
                styles.articleMount
              }
              aria-hidden="true"
            />

            <article
              className={
                styles.articleClipping
              }
            >
              <header
                className={
                  styles.articleMasthead
                }
              >
                <span
                  className={
                    styles.articleSource
                  }
                >
                  {item.sourceApp
                    || sourceDomain(
                      item.sourceUrl,
                    )
                    || 'WEB'}
                </span>

                {date && (
                  <time
                    className={
                      styles.articleDate
                    }
                  >
                    {date}
                  </time>
                )}
              </header>

              <h2
                className={
                  styles.articleTitle
                }
              >
                {item.title
                  || '收进来的一页网页'}
              </h2>

              {item.text.trim() && (
                <p
                  className={
                    styles.articleExcerpt
                  }
                >
                  {previewText(item)}
                </p>
              )}

              <footer
                className={
                  styles.articleFooter
                }
              >
                <span>
                  {sourceDomain(
                    item.sourceUrl,
                  )}
                </span>

                {item.collection && (
                  <span>
                    {item.collection}
                  </span>
                )}
              </footer>
            </article>
          </div>
        ) : (
          <>
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

            <div
              className={styles.meta}
            >
              <span>
                {item.sourceApp}
              </span>

              <span>
                {
                  presentationKindLabels[
                    presentation.kind
                  ]
                }
              </span>
            </div>

            <h2
              className={styles.title}
            >
              {item.title}
            </h2>

            {!image && (
              <p
                className={
                  styles.preview
                }
              >
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
          </>
        )}
      </button>

      {(hasEeNote
        || hasAqiReply) && (
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
