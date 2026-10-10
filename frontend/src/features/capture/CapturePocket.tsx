import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type MouseEvent,
} from 'react'

import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  capturePocketItem,
  DrawerIntakeError,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketIntakeReceipt,
} from '../../types/pocket'

import {
  appendCaptureFiles,
  MAX_CAPTURE_FILES,
} from './captureDraft'

import styles from './CapturePocket.module.css'

export function CapturePocket() {
  const queryClient = useQueryClient()
  const triggerRef =
    useRef<HTMLButtonElement | null>(null)
  const folioRef =
    useRef<HTMLElement | null>(null)
  const fileInput =
    useRef<HTMLInputElement | null>(null)
  const titleRef =
    useRef<HTMLInputElement | null>(null)
  const textareaRef =
    useRef<HTMLTextAreaElement | null>(null)
  const returnTimer =
    useRef<number | null>(null)
  const labelTimer =
    useRef<number | null>(null)
  const [expanded, setExpanded] =
    useState(false)
  const [returning, setReturning] =
    useState(false)
  const [motionEnabled, setMotionEnabled] =
    useState(true)
  const [savedLabel, setSavedLabel] =
    useState('')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [files, setFiles] =
    useState<File[]>([])
  const [receipt, setReceipt] =
    useState<PocketIntakeReceipt | null>(null)
  const [localError, setLocalError] =
    useState('')
  const [isDragging, setIsDragging] =
    useState(false)

  const intake = useMutation({
    mutationFn: capturePocketItem,
    onSuccess: (result) => {
      setReceipt(result.receipt)
      setTitle('')
      setText('')
      setFiles([])
      setLocalError('')
      if (fileInput.current) {
        fileInput.current.value = ''
      }
      void queryClient.invalidateQueries({
        queryKey: pocketQueryKeys.all,
      })

      retractFolio(() => {
        setSavedLabel('已收好')

        labelTimer.current =
          window.setTimeout(() => {
            setSavedLabel('')
          }, 1800)
      })
    },
  })

  const draftFrozen =
    intake.isPending

  const addFiles = (
    incoming: Iterable<File>,
  ) => {
    if (draftFrozen) return

    const next =
      appendCaptureFiles(files, incoming)

    setFiles(next.files)
    setReceipt(null)
    intake.reset()
    setLocalError(
      next.rejectedCount > 0
        ? `一次最多收 ${MAX_CAPTURE_FILES} 个文件，另有 ${next.rejectedCount} 个没有加入。`
        : '',
    )
  }

  const handleFileChange = (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    addFiles(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
  }

  const handleDrop = (
    event: DragEvent<HTMLDivElement>,
  ) => {
    event.preventDefault()
    setIsDragging(false)
    if (draftFrozen) return

    addFiles(event.dataTransfer.files)
  }

  const removeFile = (index: number) => {
    if (draftFrozen) return

    setFiles((current) =>
      current.filter(
        (_, currentIndex) =>
          currentIndex !== index,
      ),
    )
    setReceipt(null)
    setLocalError('')
    intake.reset()
  }

  const handleSubmit = (
    event: FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault()
    if (draftFrozen) return

    setReceipt(null)
    setLocalError('')
    intake.mutate({ title, text, files })
  }

  const mutationError =
    intake.error instanceof Error
      ? intake.error
      : null

  const errorDetails =
    mutationError instanceof DrawerIntakeError
      ? [
          mutationError.code,
          mutationError.field
            ? `field: ${mutationError.field}`
            : '',
          mutationError.expectedFileCount
            !== undefined
            ? `expected: ${mutationError.expectedFileCount}`
            : '',
          mutationError.receivedFileCount
            !== undefined
            ? `received: ${mutationError.receivedFileCount}`
            : '',
        ].filter(Boolean).join(' · ')
      : ''

  const hasDraft =
    Boolean(title.trim())
    || Boolean(text.trim())
    || files.length > 0

  useEffect(() => {
    return () => {
      if (returnTimer.current) {
        window.clearTimeout(
          returnTimer.current,
        )
      }

      if (labelTimer.current) {
        window.clearTimeout(
          labelTimer.current,
        )
      }
    }
  }, [])

  useEffect(() => {
    if (!expanded) return

    function handleEscape(
      event: KeyboardEvent,
    ) {
      if (
        event.key !== 'Escape'
        || draftFrozen
      ) {
        return
      }

      event.preventDefault()
      setExpanded(false)
      triggerRef.current?.focus({
        preventScroll: true,
      })
    }

    window.addEventListener(
      'keydown',
      handleEscape,
    )

    return () => {
      window.removeEventListener(
        'keydown',
        handleEscape,
      )
    }
  }, [draftFrozen, expanded])

  const openCapture = (
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (expanded || returning) return

    setMotionEnabled(event.detail !== 0)
    setSavedLabel('')
    setExpanded(true)

    window.requestAnimationFrame(() => {
      titleRef.current?.focus({
        preventScroll: true,
      })
      folioRef.current?.scrollIntoView({
        block: 'nearest',
        behavior: 'auto',
      })
    })
  }

  function retractFolio(
    onReturned?: () => void,
  ) {
    setReturning(true)

    if (returnTimer.current) {
      window.clearTimeout(returnTimer.current)
    }

    returnTimer.current =
      window.setTimeout(() => {
        setExpanded(false)
        setReturning(false)
        triggerRef.current?.focus({
          preventScroll: true,
        })
        onReturned?.()
      }, motionEnabled ? 220 : 0)
  }

  function closeCapture() {
    if (draftFrozen) return

    retractFolio()
  }

  return (
    <div className={styles.capture}>
      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-label={savedLabel || '留给阿栖'}
        aria-controls="incoming-folio"
        aria-expanded={expanded}
        onClick={openCapture}
      />

      <span
        className={styles.indexTab}
        aria-hidden="true"
      >
        {savedLabel || '留给阿栖'}
      </span>

      <div className={styles.folioClip}>
        <article
          ref={folioRef}
          id="incoming-folio"
          className={styles.folio}
          data-expanded={expanded || undefined}
          data-returning={returning || undefined}
          data-motion={
            motionEnabled ? 'true' : undefined
          }
          aria-labelledby="capture-title"
          aria-hidden={!expanded}
          hidden={!expanded && !returning}
          aria-busy={draftFrozen}
        >
          <header className={styles.heading}>
            <h2 id="capture-title">
              INCOMING / 01
            </h2>

            <button
              className={styles.closeAction}
              type="button"
              disabled={draftFrozen}
              aria-label="放回收件夹"
              onClick={closeCapture}
            >
              放回
            </button>
          </header>

          <form onSubmit={handleSubmit}>
            <div className={styles.editorFields}>
              <label className={styles.titleLabel}>
                <span className={styles.fieldLabel}>
                  标题 · 选填
                </span>
                <span className={styles.titleViewport}>
                  <input
                    ref={titleRef}
                    type="text"
                    value={title}
                    disabled={draftFrozen}
                    placeholder="给这张纸起个名字……"
                    onChange={(event) => {
                      setTitle(event.currentTarget.value)
                      setReceipt(null)
                      intake.reset()
                    }}
                  />
                </span>
              </label>

              <label className={styles.textLabel}>
                <span className={styles.fieldLabel}>
                  正文／链接
                </span>
                <span className={styles.textViewport}>
                  <textarea
                    ref={textareaRef}
                    value={text}
                    rows={3}
                    disabled={draftFrozen}
                    placeholder="粘贴一个链接，或留下一段文字……"
                    onChange={(event) => {
                      setText(event.currentTarget.value)
                      setReceipt(null)
                      intake.reset()
                    }}
                  />
                </span>
              </label>
            </div>

            <div
              className={styles.attachmentRow}
              aria-disabled={draftFrozen}
              data-dragging={
                isDragging ? 'true' : undefined
              }
              onDragEnter={(event) => {
                event.preventDefault()
                if (draftFrozen) return

                setIsDragging(true)
              }}
              onDragOver={(event) => {
                event.preventDefault()
                if (draftFrozen) return

                setIsDragging(true)
              }}
              onDragLeave={(event) => {
                if (draftFrozen) return

                if (
                  event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                ) {
                  return
                }
                setIsDragging(false)
              }}
              onDrop={handleDrop}
            >
              <input
                ref={fileInput}
                className="visually-hidden"
                type="file"
                multiple
                disabled={draftFrozen}
                onChange={handleFileChange}
              />

              <button
                type="button"
                className={styles.chooseAction}
                disabled={draftFrozen}
                onClick={() => {
                  if (draftFrozen) return
                  fileInput.current?.click()
                }}
              >
                夹入文件
              </button>

              <span className={styles.dropHint}>
                或拖到这里
              </span>

              <span className={styles.count}>
                {files.length} / {MAX_CAPTURE_FILES}
              </span>
            </div>

            {files.length > 0 && (
              <ol className={styles.fileList}>
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  >
                    <span>
                      <strong>{file.name}</strong>
                      <small>
                        {formatFileMeta(file)}
                      </small>
                    </span>
                    <button
                      type="button"
                      disabled={draftFrozen}
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        removeFile(index)
                      }
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ol>
            )}

            {(localError || mutationError) && (
              <div
                className={styles.error}
                role="alert"
              >
                <p>
                  这张还没收进去
                </p>
                <small>
                  {localError
                    || mutationError?.message}
                </small>
                {errorDetails && (
                  <small>{errorDetails}</small>
                )}
              </div>
            )}

            {receipt && (
              <div
                className={styles.receipt}
              >
                <span>
                  {receipt.status === 'merged'
                    ? 'MERGED'
                    : 'RECEIVED'}
                </span>
                <p>{receipt.message}</p>
              </div>
            )}

            <button
              className={styles.submitAction}
              type="submit"
              disabled={
                intake.isPending
                || !hasDraft
              }
            >
              {intake.isPending
                ? '正在收进去……'
                : intake.isError
                  ? '再试一次 →'
                  : '收好 →'}
            </button>
          </form>
        </article>
      </div>

      <p
        className="visually-hidden"
        role="status"
        aria-live="polite"
      >
        {receipt?.message ?? ''}
      </p>
    </div>
  )
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`
  }
  return `${(
    bytes / (1024 * 1024)
  ).toFixed(1)} MB`
}

function formatFileMeta(file: File) {
  const mimeType = (() => {
    if (file.type === 'application/pdf') {
      return 'PDF'
    }

    if (
      file.type
      === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      return 'DOCX'
    }

    if (file.type === 'image/jpeg') {
      return 'JPEG'
    }

    return file.type || '文件'
  })()

  return `${mimeType} · ${formatFileSize(file.size)}`
}
