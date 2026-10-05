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
    (
      item: PocketItemSummary,
      trigger: HTMLButtonElement,
    ) => void
}

function previewPhotoAttachments(
  item: PocketItemSummary,
) {
  return item.attachments
    .filter(
      (attachment) =>
        attachment.url
        && attachment.mimeType
          .startsWith('image/'),
    )
    .slice(0, 3)
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

  const isXhsPhoto =
    presentation.kind === 'photo'
    && presentation.sourceFlavor === 'xiaohongshu'

  const isPhoto =
    presentation.kind === 'photo'
    && !isXhsPhoto

  const photoAttachments =
    previewPhotoAttachments(item)

  const attachment =
    item.attachments[0]

  const date =
    formatDate(
      item.lastReceivedAt
      || item.createdAt,
    )


  const mixedPhotoAttachment =
    presentation.kind === 'mixed'
      ? item.attachments.find(
          (candidate) =>
            candidate.mimeType
              .trim()
              .toLowerCase()
              .startsWith('image/'),
        )
      : undefined

  const mixedDocumentAttachment =
    presentation.kind === 'mixed'
      ? item.attachments.find(
          (candidate) =>
            !candidate.mimeType
              .trim()
              .toLowerCase()
              .startsWith('image/'),
        )
      : undefined

  const repositoryIdentity = (() => {
    if (
      presentation.kind
      !== 'repository'
    ) {
      return null
    }

    const rawUrl =
      item.sourceUrl || ''

    const githubMatch =
      rawUrl.match(
        /https?:\/\/(?:www\.)?github\.com\/([^/\s?#)\]]+)\/([^/\s?#)\]]+)/i,
      )

    if (githubMatch) {
      return {
        owner:
          githubMatch[1],
        name:
          githubMatch[2]
            .replace(
              /\.git$/i,
              '',
            ),
      }
    }

    const titleParts =
      (item.title || '')
        .split('/')
        .map(
          (part) =>
            part.trim(),
        )
        .filter(Boolean)

    if (
      titleParts.length
      >= 2
    ) {
      return {
        owner:
          titleParts[0],
        name:
          titleParts
            .slice(1)
            .join('/'),
      }
    }

    return {
      owner: '',
      name:
        item.title
        || 'Repository',
    }
  })()



  const attachedTabs =
    (hasEeNote
      || hasAqiReply) ? (
      <>
        <span
          className={styles.edgeTabs}
          aria-label="这张纸还有附页"
        >
          {hasEeNote && (
            <span
              className={
                styles.eeTab
              }
              aria-hidden="true"
            />
          )}

          {hasAqiReply && (
            <span
              className={
                styles.aqiTab
              }
              aria-hidden="true"
            />
          )}
        </span>

        <span
          className={
            styles.previewBundleCover
          }
          aria-hidden="true"
        />
      </>
    ) : null

  return (
    <li className={styles.row}>
      <button
        className={
          isDocument
            ? `${styles.paper} ${styles.documentCarrier}`
            : isArticle
              ? `${styles.paper} ${styles.articleCarrier}`
              : isXhsPhoto
                ? `${styles.paper} ${styles.xhsCarrier}`
                : isPhoto
                  ? `${styles.paper} ${styles.photoCarrier}`
                  : `${styles.paper} ${styles.previewPaperBundle}`
        }
        data-kind={item.kind}
        data-presentation-kind={
          presentation.kind
        }
        data-source-flavor={
          presentation.sourceFlavor
        }
        type="button"
        onClick={(event) =>
          onOpen(
            item,
            event.currentTarget,
          )
        }
      >
        {!isDocument
          && !isArticle
          && !isXhsPhoto
          && !isPhoto
          && presentation.kind !== 'mixed'
          && presentation.kind !== 'repository'
          && presentation.kind !== 'product'
          && attachedTabs}

        {isDocument ? (
          <div
            className={
              `${styles.documentFolder} ${styles.previewPaperBundle}`
            }
          >
            {attachedTabs}

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
              `${styles.articleObject} ${styles.previewPaperBundle}`
            }
          >
            {attachedTabs}

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
        ) : isXhsPhoto ? (
          <div
            className={
              `${styles.xhsStorageObject} ${styles.previewPaperBundle}`
            }
          >
            {attachedTabs}

            {photoAttachments.length > 0 && (
              <div>
                <div
                  className={
                    styles.xhsPhotoStack
                  }
                  data-photo-count={
                    photoAttachments.length
                  }
                >
                  {photoAttachments.map(
                    (
                      photo,
                      index,
                    ) => (
                      <img
                        key={
                          photo.id
                          || `${photo.name}-${index}`
                        }
                        src={photo.url}
                        alt={
                          index === 0
                            ? (
                              item.title
                              || photo.name
                              || '小红书收藏图片'
                            )
                            : ''
                        }
                        loading="lazy"
                      />
                    ),
                  )}
                </div>

              </div>
            )}

            <section
              className={
                styles.xhsSocialBand
              }
            >
              <span
                className={
                  styles.xhsBandTape
                }
                aria-hidden="true"
              />

              <div
                className={
                  styles.xhsBandMeta
                }
              >
                <span>
                  {item.sourceApp
                    || '小红书'}
                </span>

                {photoAttachments.length > 0 && (
                  <span>
                    {photoAttachments.length}
                    {' '}
                    张
                  </span>
                )}
              </div>

              <h2
                className={
                  styles.xhsBandTitle
                }
              >
                {item.title
                  || '收进来的一页'}
              </h2>

              <footer
                className={
                  styles.xhsBandFooter
                }
              >
                {date && (
                  <time>
                    {date}
                  </time>
                )}
              </footer>
            </section>
          </div>
        ) : isPhoto ? (
          <div
            className={
              styles.photoArchiveObject
            }
            data-photo-count={
              photoAttachments.length
            }
          >
            {photoAttachments.length === 1 ? (
              <div
                className={
                  `${styles.photoSleeve} ${styles.previewPaperBundle}`
                }
              >
                {attachedTabs}

                <div
                  className={
                    styles.photoSinglePrint
                  }
                >
                  <img
                    src={
                      photoAttachments[0].url
                    }
                    alt={
                      item.title
                      || photoAttachments[0].name
                      || '收藏照片'
                    }
                    loading="lazy"
                  />
                </div>

                <div
                  className={
                    styles.photoSleeveRecord
                  }
                >
                  <span>
                    PHOTO · 01
                  </span>

                  {date && (
                    <time>
                      {date}
                    </time>
                  )}
                </div>
              </div>
            ) : (
              <div
                className={
                  `${styles.photoSetSleeve} ${styles.previewPaperBundle}`
                }
              >
                {attachedTabs}

                <div
                  className={
                    styles.photoSetStack
                  }
                  data-photo-count={
                    photoAttachments.length
                  }
                >
                  {photoAttachments.map(
                    (
                      photo,
                      index,
                    ) => (
                      <img
                        key={
                          photo.id
                          || `${photo.name}-${index}`
                        }
                        src={photo.url}
                        alt={
                          index === 0
                            ? (
                              item.title
                              || photo.name
                              || '收藏照片'
                            )
                            : ''
                        }
                        loading="lazy"
                      />
                    ),
                  )}
                </div>

                <div
                  className={
                    styles.photoSetRecord
                  }
                >
                  <span>
                    PHOTO SET
                  </span>

                  <span>
                    {
                      photoAttachments.length
                    }
                    {' '}
                    PRINTS
                  </span>
                </div>
              </div>
            )}

            <div
              className={
                styles.photoArchiveLabel
              }
            >
              <h2>
                {item.title
                  || (
                    photoAttachments.length > 1
                      ? '收进来的一组照片'
                      : '收进来的一张照片'
                  )}
              </h2>

              <div>
                <span>
                  {item.sourceApp
                    || '照片'}
                </span>

                {photoAttachments.length > 1 && (
                  <span>
                    {photoAttachments.length}
                    {' '}
                    frames
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : presentation.kind === 'mixed' ? (
            <div
              className={
                `${styles.mixedObject} ${styles.previewPaperBundle}`
              }
            >
              {attachedTabs}

              <div
                className={
                  styles.mixedInsertStack
                }
              >
                {image
                  && mixedPhotoAttachment
                  && (
                  <figure
                    className={
                      styles.mixedPhotoInsert
                    }
                  >
                    <img
                      src={image}
                      alt={
                        mixedPhotoAttachment
                          .name
                        || item.title
                        || '一起收进来的照片'
                      }
                      loading="lazy"
                    />
                  </figure>
                )}

                {mixedDocumentAttachment && (
                  <div
                    className={
                      styles.mixedDocumentInsert
                    }
                  >
                    <span
                      className={
                        styles.mixedDocumentType
                      }
                    >
                      {
                        mixedDocumentAttachment
                          .mimeType
                          .trim()
                          .toLowerCase()
                        === 'application/pdf'
                          ? 'PDF'
                          : 'FILE'
                      }
                    </span>

                    <span
                      className={
                        styles.mixedDocumentName
                      }
                    >
                      {
                        mixedDocumentAttachment
                          .name
                        || 'Attached file'
                      }
                    </span>
                  </div>
                )}
              </div>

              <section
                  className={
                    styles.mixedPocket
                  }
                >
                <div
                  className={
                    styles.mixedPocketMeta
                  }
                >
                  <span>
                    {item.sourceApp
                      || 'Mixed'}
                  </span>

                  <span>
                    {item.attachments.length}
                    {' '}
                    ITEMS
                  </span>
                </div>

                <h2
                  className={
                    styles.mixedTitle
                  }
                >
                  {item.title
                    || '一起收进来的东西'}
                </h2>

                {item.text.trim() && (
                  <p
                    className={
                      styles.mixedDescription
                    }
                  >
                    {previewText(item)}
                  </p>
                )}

                <footer
                  className={
                    styles.mixedFooter
                  }
                >
                  <span>
                    {
                      presentationKindLabels[
                        presentation.kind
                      ]
                    }
                  </span>

                  {date && (
                    <time>
                      {date}
                    </time>
                  )}
                </footer>
              </section>
            </div>
          ) : presentation.kind === 'repository' ? (
            <div
              className={
                `${styles.repositoryObject} ${styles.previewPaperBundle}`
              }
            >
              {attachedTabs}

              <div
                className={
                  styles.repositoryBackCard
                }
                aria-hidden="true"
              />

              <article
                  className={
                    styles.repositoryCard
                  }
                >
                <div
                  className={
                    styles.repositoryMain
                  }
                >
                  <div
                    className={
                      styles.repositorySource
                    }
                  >
                    {item.sourceApp
                      || 'GitHub'}
                  </div>

                  <div
                    className={
                      styles.repositoryIdentity
                    }
                  >
                    {repositoryIdentity
                      ?.owner && (
                      <span
                        className={
                          styles.repositoryOwner
                        }
                      >
                        {
                          repositoryIdentity
                            .owner
                        }
                        {' /'}
                      </span>
                    )}

                    <h2
                      className={
                        styles.repositoryName
                      }
                    >
                      {repositoryIdentity
                        ?.name
                        || item.title
                        || 'Repository'}
                    </h2>
                  </div>

                  {item.text.trim() && (
                    <p
                      className={
                        styles.repositoryDescription
                      }
                    >
                      {previewText(item)}
                    </p>
                  )}
                </div>

                <footer
                  className={
                    styles.repositoryFooter
                  }
                >
                  <span>
                    {sourceDomain(
                      item.sourceUrl,
                    )
                      || item.sourceApp
                      || 'github.com'}
                  </span>

                  <span>
                    {
                      presentationKindLabels[
                        presentation.kind
                      ]
                    }
                  </span>

                  {date && (
                    <time>
                      {date}
                    </time>
                  )}
                </footer>
              </article>
            </div>
          ) : presentation.kind === 'product' ? (
            <div
            className={
              `${styles.productObject} ${styles.previewPaperBundle}`
            }
          >
              {attachedTabs}

              <div
                className={
                  styles.productMeta
                }
              >
                <span
                  className={
                    styles.productCatalog
                  }
                >
                  CATALOG
                </span>

                <span
                  className={
                    styles.productSource
                  }
                >
                  {item.sourceApp
                    || 'PRODUCT'}
                </span>

                <span
                  className={
                    styles.productKind
                  }
                >
                  {
                    presentationKindLabels[
                      presentation.kind
                    ]
                  }
                </span>
              </div>

              <h2
                className={
                  styles.productTitle
                }
              >
                {item.title
                  || '收进来的商品'}
              </h2>
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
                {
                  presentation.kind === 'video'
                    ? `SCREENING · ${
                      item.sourceApp
                      || 'VIDEO'
                    }`
                    : item.sourceApp
                }
              </span>

              <span>
                {
                  presentation.kind === 'video'
                    ? date
                    : presentationKindLabels[
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

    </li>
  )
}
