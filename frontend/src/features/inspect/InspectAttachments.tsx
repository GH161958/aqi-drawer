import { useState } from 'react'

import type {
  PocketAttachmentSummary,
  PocketItemSummary,
} from '../../types/pocket'

import {
  useRemoveAttachment,
} from './useRemoveAttachment'

import styles from './InspectAttachments.module.css'

interface InspectAttachmentsProps {
  item: PocketItemSummary
}

function attachmentKind(
  attachment: PocketAttachmentSummary,
): string {
  const mime =
    attachment.mimeType.toLowerCase()

  if (mime.startsWith('image/')) return '图片'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.includes('wordprocessingml')) return 'DOCX'
  if (mime.startsWith('text/')) return 'TXT'
  if (mime.startsWith('video/')) return '视频'
  if (mime.startsWith('audio/')) return '音频'

  const extension =
    attachment.name
      .split('.')
      .pop()
      ?.trim()
      .toUpperCase()

  return extension || '文件'
}

function formatSize(
  size: number | undefined,
): string {
  if (!size || size < 0) return ''
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KiB`
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

export function InspectAttachments({
  item,
}: InspectAttachmentsProps) {
  const [confirmingId, setConfirmingId] =
    useState<string | null>(null)

  const remove =
    useRemoveAttachment(item.id)

  if (item.attachments.length === 0) {
    return null
  }

  function confirmRemoval(
    attachmentId: string,
  ) {
    if (remove.isPending) return

    remove.mutate(
      attachmentId,
      {
        onSuccess: () => {
          setConfirmingId(null)
        },
      },
    )
  }

  return (
    <section
      className={styles.attachments}
      aria-labelledby={`attachment-title-${item.id}`}
    >
      <h2 id={`attachment-title-${item.id}`}>
        附件 · {item.attachments.length}
      </h2>

      <ul>
        {item.attachments.map((attachment) => {
          const confirming =
            confirmingId === attachment.id

          const size =
            formatSize(attachment.size)

          return (
            <li key={attachment.id}>
              <div className={styles.identity}>
                <span className={styles.name}>
                  {attachment.name}
                </span>

                <span className={styles.meta}>
                  {attachmentKind(attachment)}
                  {size ? ` · ${size}` : ''}
                </span>
              </div>

              {!confirming ? (
                <div className={styles.actions}>
                  {attachment.url && (
                    <>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开
                      </a>

                      <a
                        href={attachment.url}
                        download={attachment.name}
                      >
                        下载
                      </a>
                    </>
                  )}

                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.reset()
                      setConfirmingId(attachment.id)
                    }}
                  >
                    移除
                  </button>
                </div>
              ) : (
                <div
                  className={styles.confirmation}
                  role="group"
                  aria-label={`确认移除 ${attachment.name}`}
                >
                  <span>
                    只移除这个附件？
                  </span>

                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() =>
                      confirmRemoval(attachment.id)
                    }
                  >
                    {remove.isPending
                      ? '正在移除…'
                      : '确认移除'}
                  </button>

                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() =>
                      setConfirmingId(null)
                    }
                  >
                    取消
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {remove.isError && (
        <p
          className={styles.feedback}
          aria-live="polite"
        >
          {remove.error.message
            || '这个附件暂时没有移除。'}
        </p>
      )}
    </section>
  )
}
