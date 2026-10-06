import {
  useEffect,
  useState,
} from 'react'

import type {
  KeyboardEvent,
} from 'react'

import type {
  PocketAttachmentSummary,
} from '../../types/pocket'

import styles from './InspectMedia.module.css'

interface InspectMediaProps {
  attachments: PocketAttachmentSummary[]
  title: string
}

function imageAlt(
  attachment: PocketAttachmentSummary,
  title: string,
  index: number,
): string {
  const name =
    attachment.name.trim()

  if (name) return name

  if (index === 0) return title

  return `${title} · 第 ${index + 1} 张`
}

function formatCounter(
  value: number,
): string {
  return String(value).padStart(2, '0')
}

function getBackingImages(
  images: PocketAttachmentSummary[],
  activeIndex: number,
) {
  const candidates = [
    ...images.slice(activeIndex + 1),
    ...images
      .slice(0, activeIndex)
      .reverse(),
  ]

  return candidates.slice(
    0,
    Math.min(2, images.length - 1),
  )
}

export function InspectMedia({
  attachments,
  title,
}: InspectMediaProps) {
  const images =
    attachments.filter(
      (attachment) =>
        Boolean(attachment.url)
        && attachment.mimeType
          .startsWith('image/'),
    )

  const imageIdentity =
    images
      .map((image) => image.id)
      .join('\u0000')

  const [
    requestedIndex,
    setRequestedIndex,
  ] = useState(0)

  useEffect(() => {
    setRequestedIndex(0)
  }, [imageIdentity])

  if (images.length === 0) {
    return null
  }

  if (images.length === 1) {
    const image = images[0]

    return (
      <figure className={styles.single}>
        <img
          src={image.url}
          alt={imageAlt(image, title, 0)}
          loading="lazy"
        />
      </figure>
    )
  }

  const activeIndex =
    Math.min(
      requestedIndex,
      images.length - 1,
    )

  const activeImage =
    images[activeIndex]

  const backingImages =
    getBackingImages(
      images,
      activeIndex,
    )

  function move(
    direction: -1 | 1,
  ) {
    setRequestedIndex(
      (current) =>
        Math.max(
          0,
          Math.min(
            images.length - 1,
            current + direction,
          ),
        ),
    )
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLElement>,
  ) {
    if (
      event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
    }
  }

  return (
    <section
      className={styles.stack}
      aria-label={`${images.length} 张照片`}
      onKeyDown={handleKeyDown}
    >
      <div className={styles.stackStage}>
        {backingImages.map(
          (image, index) => (
            <div
              key={image.id}
              className={styles.backing}
              data-layer={index + 1}
              aria-hidden="true"
            >
              <img
                src={image.url}
                alt=""
                loading="lazy"
              />
            </div>
          ),
        )}

        <figure className={styles.active}>
          <img
            key={activeImage.id}
            src={activeImage.url}
            alt={imageAlt(
              activeImage,
              title,
              activeIndex,
            )}
            loading="lazy"
          />
        </figure>
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          aria-label="上一张照片"
          disabled={activeIndex === 0}
          onClick={() => move(-1)}
        >
          ←
        </button>

        <span
          className={styles.counter}
          aria-live="polite"
        >
          {formatCounter(activeIndex + 1)}
          {' / '}
          {formatCounter(images.length)}
        </span>

        <button
          type="button"
          aria-label="下一张照片"
          disabled={
            activeIndex
            === images.length - 1
          }
          onClick={() => move(1)}
        >
          →
        </button>
      </div>
    </section>
  )
}
