import {
  useState,
} from 'react'

import type {
  PocketContentSnapshot,
  PocketItemSummary,
} from '../../types/pocket'

import {
  useReadSource,
} from './useReadSource'

import styles from './SourceReadPanel.module.css'

interface SourceReadPanelProps {
  item: PocketItemSummary
}

function formatOptionalDate(
  value?: string,
): string {
  if (!value) {
    return ''
  }

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

function safeHttpUrl(
  value?: string,
): string {
  if (!value) {
    return ''
  }

  try {
    const url =
      new URL(value)

    return (
      url.protocol === 'http:'
      || url.protocol === 'https:'
    )
      ? url.href
      : ''
  } catch {
    return ''
  }
}

export function SourceReadPanel({
  item,
}: SourceReadPanelProps) {
  const [
    snapshot,
    setSnapshot,
  ] =
    useState<PocketContentSnapshot | null>(
      null,
    )

  const [
    cacheHit,
    setCacheHit,
  ] =
    useState(false)

  const read =
    useReadSource(
      item.id,
    )

  function requestRead(
    detail:
      | 'compact'
      | 'full',

    videoFrames = 0,
  ) {
    read.mutate(
      {
        detail,
        videoFrames,
      },
      {
        onSuccess:
          (result) => {
            setSnapshot(
              result.snapshot,
            )

            setCacheHit(
              result.cache.hit
              === true,
            )
          },
      },
    )
  }

  if (!snapshot) {
    return (
      <section
        className={styles.shell}
        aria-label="来源内容"
      >
        <button
          type="button"
          className={
            styles.readButton
          }
          disabled={read.isPending}
          onClick={() =>
            requestRead(
              'compact',
            )
          }
        >
          {read.isPending
            ? '正在展开这张剪报……'
            : '展开来源'}
        </button>

        {read.isError && (
          <p
            className={
              styles.error
            }
            aria-live="polite"
          >
            {read.error.message
              || '这张剪报暂时没能展开。'}
          </p>
        )}
      </section>
    )
  }

  const byline = [
    snapshot.author,
    formatOptionalDate(
      snapshot.publishedAt,
    ),
  ].filter(Boolean)

  const finalUrl =
    safeHttpUrl(
      snapshot.canonicalUrl,
    )
    || safeHttpUrl(
      snapshot.finalUrl,
    )
    || safeHttpUrl(
      item.sourceUrl,
    )

  const images =
    snapshot.images
      .filter(
        (image) =>
          Boolean(
            safeHttpUrl(
              image.url,
            ),
          ),
      )
      .slice(0, 2)

  const canReadFull =
    snapshot.detail !== 'full'
    && Boolean(
      snapshot.textTruncated
      || snapshot.text,
    )

  const videoDetected =
    snapshot.video?.detected
    === true

  const frameRequested =
    snapshot.frameExtraction
      ?.requested
    ?? 0

  const frameExtracted =
    snapshot.frameExtraction
      ?.extracted
    ?? 0

  return (
    <section
      className={styles.shell}
      aria-label="来源内容"
    >
      <article
        className={styles.snapshot}
      >
        <header
          className={styles.header}
        >
          {snapshot.siteName && (
            <p
              className={styles.site}
            >
              {snapshot.siteName}
            </p>
          )}

          <h2
            className={styles.title}
          >
            {snapshot.title
              || item.title
              || '来源内容'}
          </h2>

          {byline.length > 0 && (
            <p
              className={styles.byline}
            >
              {byline.join(
                ' · ',
              )}
            </p>
          )}
        </header>

        {snapshot.description && (
          <p
            className={
              styles.description
            }
          >
            {snapshot.description}
          </p>
        )}

        {snapshot.text && (
          <div
            className={styles.text}
          >
            {snapshot.text
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

        {images.length > 0 && (
          <div
            className={styles.images}
          >
            {images.map(
              (
                image,
                index,
              ) => (
                <img
                  key={
                    `${image.url}-${index}`
                  }
                  src={image.url}
                  alt={
                    image.alt
                    || `${
                      snapshot.title
                      || item.title
                      || '网页'
                    } 图片 ${
                      index + 1
                    }`
                  }
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
              ),
            )}
          </div>
        )}

        {snapshot.browserCapturePlan
          ?.needed && (
          <p
            className={
              styles.captureNote
            }
          >
            这个页面需要另外打开才能完整看。
          </p>
        )}

        {frameRequested > 0 && (
          <p
            className={
              styles.frameNote
            }
          >
            {frameExtracted > 0
              ? `已经取到 ${frameExtracted} 帧画面。`
              : '暂时没有取到可看的画面。'}
          </p>
        )}

        <div
          className={styles.actions}
        >
          {canReadFull && (
            <button
              type="button"
              disabled={read.isPending}
              onClick={() =>
                requestRead(
                  'full',
                  0,
                )
              }
            >
              再读完整一点
            </button>
          )}

          {videoDetected
            && frameRequested === 0 && (
            <button
              type="button"
              disabled={
                read.isPending
              }
              onClick={() =>
                requestRead(
                  snapshot.detail
                    || 'compact',
                  2,
                )
              }
            >
              看看画面
            </button>
          )}

          {finalUrl && (
            <a
              href={finalUrl}
              target="_blank"
              rel="noreferrer"
            >
              打开最终来源 ↗
            </a>
          )}
        </div>

        <p
          className={styles.readMeta}
        >
          {read.isPending
            ? '正在继续读……'
            : cacheHit
              ? 'FROM SAVED SOURCE SNAPSHOT'
              : 'SOURCE READ'}
        </p>

        {read.isError && (
          <p
            className={
              styles.error
            }
            aria-live="polite"
          >
            {read.error.message
              || '来源暂时没有读好。'}
          </p>
        )}
      </article>
    </section>
  )
}
