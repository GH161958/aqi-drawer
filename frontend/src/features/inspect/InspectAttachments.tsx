import { useRef, useState } from 'react'

import type {
  PocketAttachmentSummary,
  PocketItemSummary,
} from '../../types/pocket'

import {
  pocketAttachmentDownloadUrl,
} from '../../api/pocket'

import {
  useRemoveAttachment,
} from './useRemoveAttachment'

import {
  useAppendAttachments,
} from './useAppendAttachments'

import {
  attachmentRemovalMessage,
  isImageAttachment,
} from './inspectAttachmentLogic'

import styles from './InspectAttachments.module.css'

interface InspectAttachmentsProps {
  item: PocketItemSummary
}

function createAttachmentRequestId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

function selectedFileMeta(file: File): string {
  const type = file.type
    ? file.type.split('/').at(-1)?.toUpperCase()
    : file.name.split('.').pop()?.toUpperCase()
  const size = formatSize(file.size)

  return [type || '文件', size]
    .filter(Boolean)
    .join(' · ')
}

export function InspectAttachments({
  item,
}: InspectAttachmentsProps) {
  const [confirmingId, setConfirmingId] =
    useState<string | null>(null)

  const [expanded, setExpanded] =
    useState(false)

  const [removalNotice, setRemovalNotice] =
    useState('')

  const [adding, setAdding] = useState(false)
  const [selectedFiles, setSelectedFiles] =
    useState<File[]>([])
  const [uploadNotice, setUploadNotice] =
    useState('')
  const [requestId, setRequestId] =
    useState('')
  const fileInputRef =
    useRef<HTMLInputElement | null>(null)

  const remove =
    useRemoveAttachment(item.id)

  const append =
    useAppendAttachments(item.id)

  const attachments =
    item.attachments.filter(
      (attachment) =>
        !isImageAttachment(attachment),
    )

  const visibleAttachments =
    expanded
      ? attachments
      : attachments.slice(0, 3)

  const hiddenCount =
    Math.max(
      0,
      attachments.length
        - visibleAttachments.length,
    )

  function confirmRemoval(
    attachmentId: string,
  ) {
    if (remove.isPending) return

    remove.mutate(
      attachmentId,
      {
        onSuccess: (result) => {
          setConfirmingId(null)
          setRemovalNotice(
            attachmentRemovalMessage(
              result.cleanupStatus,
            ),
          )
        },
      },
    )
  }

  return (
    <section
      className={styles.attachments}
      {...(
        attachments.length > 0
          ? {
              'aria-labelledby':
                `attachment-title-${item.id}`,
            }
          : { 'aria-label': '附件' }
      )}
    >
      <div className={styles.sectionHead}>
        {attachments.length > 0 && (
          <h2 id={`attachment-title-${item.id}`}>
            其他附件 · {attachments.length}
          </h2>
        )}

        <button
          type="button"
          className={styles.addToggle}
          aria-expanded={adding}
          disabled={append.isPending}
          onClick={() => {
            append.reset()
            setUploadNotice('')
            setAdding((current) => !current)
          }}
        >
          补充附件
        </button>
      </div>

      {adding && (
        <div className={styles.uploader}>
          <input
            ref={fileInputRef}
            id={`attachment-input-${item.id}`}
            className={styles.fileInput}
            type="file"
            multiple
            aria-label="选择要补充的附件"
            disabled={append.isPending}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? [])
              append.reset()
              setUploadNotice('')
              if (files.length > 5) {
                setSelectedFiles([])
                setUploadNotice('一次最多补充 5 个附件。')
                return
              }
              setSelectedFiles(files)
              setRequestId(createAttachmentRequestId())
            }}
          />

          <label
            className={styles.filePicker}
            htmlFor={`attachment-input-${item.id}`}
            aria-disabled={append.isPending}
          >
            ＋ 选择附件
          </label>

          {selectedFiles.length > 0 && (
            <div className={styles.selection}>
              <p className={styles.selectionCount}>
                已选择 {selectedFiles.length} 个附件
              </p>

              <ul className={styles.selectedFiles}>
                {selectedFiles.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                    <span className={styles.selectedIdentity}>
                      <span className={styles.selectedName}>
                        {file.name}
                      </span>
                      <span className={styles.selectedMeta}>
                        {selectedFileMeta(file)}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={append.isPending}
                      onClick={() => {
                        setSelectedFiles((current) =>
                          current.filter((_, fileIndex) => fileIndex !== index),
                        )
                        setRequestId(createAttachmentRequestId())
                        if (fileInputRef.current) {
                          fileInputRef.current.value = ''
                        }
                      }}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedFiles.length > 0 && (
            <button
              type="button"
              className={styles.uploadAction}
              disabled={append.isPending}
              onClick={() => {
                append.mutate(
                  { files: selectedFiles, requestId },
                  {
                    onSuccess: () => {
                      setSelectedFiles([])
                      setUploadNotice('附件已补充。')
                      setAdding(false)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    },
                  },
                )
              }}
            >
              {append.isPending
                ? '正在补充…'
                : `确认添加 · ${selectedFiles.length}`}
            </button>
          )}
        </div>
      )}

      {attachments.length > 0 && <ul>
        {visibleAttachments.map((attachment) => {
          const confirming =
            confirmingId === attachment.id

          const size =
            formatSize(attachment.size)

          const storedAttachment =
            attachment.url?.startsWith(
              '/api/pocket/',
            ) === true

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

                      {storedAttachment && (
                        <a
                          href={
                            pocketAttachmentDownloadUrl(
                              item.id,
                              attachment.id,
                            )
                          }
                        >
                          下载
                        </a>
                      )}
                    </>
                  )}

                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      remove.reset()
                      setRemovalNotice('')
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
      </ul>}

      {(hiddenCount > 0 || expanded) && (
        <button
          type="button"
          className={styles.disclosure}
          aria-expanded={expanded}
          onClick={() =>
            setExpanded((current) => !current)
          }
        >
          {expanded
            ? '收起附件'
            : `展开另外 ${hiddenCount} 个`}
        </button>
      )}

      {remove.isError && (
        <p
          className={styles.feedback}
          aria-live="polite"
        >
          {remove.error.message
            || '这个附件暂时没有移除。'}
        </p>
      )}

      {append.isError && (
        <p className={styles.feedback} role="alert">
          {append.error.message || '附件暂时没有补充。'}
        </p>
      )}

      {uploadNotice && (
        <p className={styles.feedback} role="status">
          {uploadNotice}
        </p>
      )}

      {removalNotice && (
        <p
          className={styles.feedback}
          role="status"
        >
          {removalNotice}
        </p>
      )}
    </section>
  )
}
