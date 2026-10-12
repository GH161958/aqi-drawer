import {
  useEffect,
  useRef,
  useState,
} from 'react'

import type {
  KeyboardEvent,
  PointerEvent,
} from 'react'

import {
  createPortal,
} from 'react-dom'

import type {
  PocketAttachmentSummary,
} from '../../types/pocket'

import {
  pocketAttachmentDownloadUrl,
} from '../../api/pocket'

import {
  useRemoveAttachment,
} from './useRemoveAttachment'

import {
  isImageAttachment,
  photoIndexAfterRemoval,
} from './inspectAttachmentLogic'

import styles from './InspectMedia.module.css'

interface InspectMediaProps {
  itemId: string
  attachments: PocketAttachmentSummary[]
  title: string
  onInitialReady: () => void
  onCleanupWarning: () => void
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
  itemId,
  attachments,
  title,
  onInitialReady,
  onCleanupWarning,
}: InspectMediaProps) {
  const remove =
    useRemoveAttachment(itemId)

  const images =
    attachments.filter(
      (attachment) =>
        Boolean(attachment.url)
        && isImageAttachment(attachment),
    )

  const imageIdentity =
    images
      .map((image) => image.id)
      .join('\u0000')

  const initialReadinessIdentity =
    images
      .slice(
        0,
        Math.min(3, images.length),
      )
      .map((image) => image.id)
      .join('\u0000')

  const [
    requestedIndex,
    setRequestedIndex,
  ] = useState(0)

  const selectedImageId =
    images[
      Math.min(
        requestedIndex,
        Math.max(0, images.length - 1),
      )
    ]?.id

  const [
    viewerOpen,
    setViewerOpen,
  ] = useState(false)

  const [viewerMenuOpen, setViewerMenuOpen] =
    useState(false)

  const [confirmingRemoval, setConfirmingRemoval] =
    useState(false)

  const [cleanupWarning, setCleanupWarning] =
    useState(false)

  const viewerRef =
    useRef<HTMLElement | null>(null)

  const viewerCloseRef =
    useRef<HTMLButtonElement | null>(null)

  const viewerTriggerRef =
    useRef<HTMLButtonElement | null>(null)

  const restoreFrameRef =
    useRef<number | null>(null)

  const viewerFocusFrameRef =
    useRef<number | null>(null)

  const stageScrollRef =
    useRef<{
      node: HTMLElement
      scrollTop: number
    } | null>(null)

  const swipeStartRef =
    useRef<{
      pointerId: number
      x: number
      y: number
    } | null>(null)

  const initialImageRefs =
    useRef(
      new Map<
        string,
        HTMLImageElement
      >(),
    )

  const readinessGenerationRef =
    useRef(0)

  const readinessFrameRef =
    useRef<number | null>(null)

  useEffect(
    () => {
      const generation =
        readinessGenerationRef.current + 1

      readinessGenerationRef.current =
        generation

      if (readinessFrameRef.current) {
        window.cancelAnimationFrame(
          readinessFrameRef.current,
        )
        readinessFrameRef.current = null
      }

      let cancelled = false
      let completed = false
      const loadHandledIds =
        new Set<string>()
      const terminalIds =
        new Set<string>()
      const listeners: Array<{
        image: HTMLImageElement
        handleLoad: () => void
        handleError: () => void
      }> = []

      const requiredImageIds =
        initialReadinessIdentity
          ? initialReadinessIdentity.split(
              '\u0000',
            )
          : []

      const reportReady = () => {
        if (
          cancelled
          || completed
          || readinessGenerationRef.current
            !== generation
        ) {
          return
        }

        completed = true
        readinessFrameRef.current =
          window.requestAnimationFrame(
            () => {
              readinessFrameRef.current =
                null

              if (
                cancelled
                || readinessGenerationRef.current
                  !== generation
              ) {
                return
              }

              onInitialReady()
            },
          )
      }

      if (requiredImageIds.length === 0) {
        reportReady()

        return () => {
          cancelled = true

          if (readinessFrameRef.current) {
            window.cancelAnimationFrame(
              readinessFrameRef.current,
            )
            readinessFrameRef.current =
              null
          }
        }
      }

      const settleImage = (id: string) => {
        if (
          cancelled
          || readinessGenerationRef.current
            !== generation
          || terminalIds.has(id)
        ) {
          return
        }

        terminalIds.add(id)
        if (
          terminalIds.size
          === requiredImageIds.length
        ) {
          reportReady()
        }
      }

      for (
        const attachmentId
        of requiredImageIds
      ) {
        const image =
          initialImageRefs.current.get(
            attachmentId,
          )

        if (!image) continue

        const handleError = () => {
          settleImage(
            attachmentId,
          )
        }

        const handleLoad = () => {
          if (
            loadHandledIds.has(
              attachmentId,
            )
          ) {
            return
          }

          loadHandledIds.add(
            attachmentId,
          )

          if (
            typeof image.decode
            !== 'function'
          ) {
            settleImage(
              attachmentId,
            )
            return
          }

          image.decode().then(
            () => settleImage(
              attachmentId,
            ),
            () => settleImage(
              attachmentId,
            ),
          )
        }

        listeners.push({
          image,
          handleLoad,
          handleError,
        })
        image.addEventListener(
          'load',
          handleLoad,
        )
        image.addEventListener(
          'error',
          handleError,
        )

        if (image.complete) {
          if (image.naturalWidth > 0) {
            handleLoad()
          } else {
            handleError()
          }
        }
      }

      return () => {
        cancelled = true

        for (const listener of listeners) {
          listener.image.removeEventListener(
            'load',
            listener.handleLoad,
          )
          listener.image.removeEventListener(
            'error',
            listener.handleError,
          )
        }

        if (readinessFrameRef.current) {
          window.cancelAnimationFrame(
            readinessFrameRef.current,
          )
          readinessFrameRef.current =
            null
        }
      }
    },
    [
      images.length,
      initialReadinessIdentity,
      onInitialReady,
    ],
  )

  useEffect(() => {
    setRequestedIndex((current) =>
      Math.max(
        0,
        Math.min(
          Math.max(0, images.length - 1),
          current,
        ),
      ),
    )

    if (images.length === 0) {
      setViewerOpen(false)
    }
  }, [imageIdentity, images.length])

  useEffect(() => {
    setViewerMenuOpen(false)
    setConfirmingRemoval(false)
    setCleanupWarning(false)
  }, [selectedImageId])

  useEffect(
    () => {
      if (!viewerOpen) return

      const trigger =
        viewerTriggerRef.current

      const stage =
        stageScrollRef.current

      const previousInert =
        stage?.node.inert

      if (stage) {
        stage.node.inert = true
      }

      viewerFocusFrameRef.current =
        window.requestAnimationFrame(
          () => {
            viewerCloseRef.current?.focus({
              preventScroll: true,
            })
          },
        )

      return () => {
        if (viewerFocusFrameRef.current) {
          window.cancelAnimationFrame(
            viewerFocusFrameRef.current,
          )
        }

        if (stage) {
          stage.node.inert =
            previousInert ?? false

          stage.node.scrollTop =
            stage.scrollTop
        }

        restoreFrameRef.current =
          window.requestAnimationFrame(
            () => {
              if (trigger?.isConnected) {
                trigger.focus({
                  preventScroll: true,
                })
              } else {
                stage?.node
                  .querySelector<HTMLElement>(
                    'button:not(:disabled)',
                  )
                  ?.focus({
                    preventScroll: true,
                  })
              }
            },
          )
      }
    },
    [viewerOpen],
  )

  useEffect(
    () => () => {
      if (restoreFrameRef.current) {
        window.cancelAnimationFrame(
          restoreFrameRef.current,
        )
      }

      if (viewerFocusFrameRef.current) {
        window.cancelAnimationFrame(
          viewerFocusFrameRef.current,
        )
      }
    },
    [],
  )

  if (images.length === 0) {
    return null
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

  function openViewer(
    trigger: HTMLButtonElement,
  ) {
    if (restoreFrameRef.current) {
      window.cancelAnimationFrame(
        restoreFrameRef.current,
      )
    }

    viewerTriggerRef.current = trigger

    const stage =
      trigger.closest<HTMLElement>(
        '[role="dialog"][aria-label="Inspect Drawer item"]',
      )

    stageScrollRef.current =
      stage
        ? {
            node: stage,
            scrollTop: stage.scrollTop,
          }
        : null

    setViewerOpen(true)
    setViewerMenuOpen(false)
    setConfirmingRemoval(false)
  }

  function closeViewer() {
    setViewerOpen(false)
    setViewerMenuOpen(false)
    setConfirmingRemoval(false)
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

  function handleViewerKeyDown(
    event: KeyboardEvent<HTMLElement>,
  ) {
    event.stopPropagation()

    if (
      event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeViewer()
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      move(-1)
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      move(1)
      return
    }

    if (event.key !== 'Tab') return

    const viewer = viewerRef.current

    if (!viewer) return

    const controls =
      Array.from(
        viewer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href]',
        ),
      )

    if (controls.length === 0) return

    const first = controls[0]
    const last =
      controls[controls.length - 1]

    if (
      event.shiftKey
      && document.activeElement === first
    ) {
      event.preventDefault()
      last.focus()
      return
    }

    if (
      !event.shiftKey
      && document.activeElement === last
    ) {
      event.preventDefault()
      first.focus()
    }
  }

  function removeActivePhoto() {
    if (remove.isPending) return

    const nextIndex =
      photoIndexAfterRemoval(
        activeIndex,
        images.length,
      )

    remove.mutate(
      activeImage.id,
      {
        onSuccess: (result) => {
          setCleanupWarning(
            result.cleanupStatus === 'failed',
          )
          if (result.cleanupStatus === 'failed') {
            onCleanupWarning()
          }
          setConfirmingRemoval(false)
          setViewerMenuOpen(false)

          if (nextIndex === null) {
            closeViewer()
            return
          }

          setRequestedIndex(nextIndex)
        },
      },
    )
  }

  function handlePointerDown(
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (event.pointerType === 'mouse') {
      return
    }

    swipeStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }

  function handlePointerUp(
    event: PointerEvent<HTMLDivElement>,
  ) {
    const start = swipeStartRef.current

    swipeStartRef.current = null

    if (
      !start
      || start.pointerId !== event.pointerId
    ) {
      return
    }

    const deltaX =
      event.clientX - start.x

    const deltaY =
      event.clientY - start.y

    if (
      Math.abs(deltaX) < 52
      || Math.abs(deltaX)
        <= Math.abs(deltaY) * 1.25
    ) {
      return
    }

    move(deltaX > 0 ? -1 : 1)
  }

  const viewer =
    viewerOpen
    && typeof document !== 'undefined'
      ? createPortal(
          <div
            className={styles.viewerBackdrop}
            onClick={(event) => {
              event.stopPropagation()

              if (
                event.target
                === event.currentTarget
              ) {
                closeViewer()
              }
            }}
          >
            <section
              ref={viewerRef}
              className={styles.viewer}
              role="dialog"
              aria-modal="true"
              aria-label="查看完整照片"
              onKeyDown={handleViewerKeyDown}
            >
              <div className={styles.viewerToolbar}>
                <div className={styles.viewerTopControls}>
                  <div className={styles.viewerMenuSlot}>
                    <button
                      type="button"
                      className={styles.viewerMenuButton}
                      aria-label="照片操作"
                      aria-expanded={viewerMenuOpen}
                      onClick={() => {
                        setConfirmingRemoval(false)
                        setCleanupWarning(false)
                        remove.reset()
                        setViewerMenuOpen(
                          (current) => !current,
                        )
                      }}
                    >
                      ···
                    </button>

                    {viewerMenuOpen && (
                      <div className={styles.viewerMenu}>
                      <a
                        href={
                          activeImage.url?.startsWith(
                            '/api/pocket/',
                          )
                            ? pocketAttachmentDownloadUrl(
                                itemId,
                                activeImage.id,
                              )
                            : activeImage.url
                        }
                        {...(
                          activeImage.url?.startsWith(
                            '/api/pocket/',
                          )
                            ? {}
                            : {
                                target: '_blank',
                                rel: 'noreferrer',
                              }
                        )}
                      >
                        保存原图
                      </a>

                      {!confirmingRemoval ? (
                        <button
                          type="button"
                          className={styles.viewerRemove}
                          onClick={() =>
                            setConfirmingRemoval(true)
                          }
                        >
                          移除这张照片
                        </button>
                      ) : (
                        <div className={styles.viewerConfirmation}>
                          <span>只移除当前照片？</span>
                          <button
                            type="button"
                            disabled={remove.isPending}
                            onClick={removeActivePhoto}
                          >
                            {remove.isPending
                              ? '正在移除…'
                              : '确认移除'}
                          </button>
                          <button
                            type="button"
                            disabled={remove.isPending}
                            onClick={() =>
                              setConfirmingRemoval(false)
                            }
                          >
                            取消
                          </button>
                        </div>
                      )}

                      {remove.isError && (
                        <p role="status">
                          {remove.error.message
                            || '这张照片暂时没有移除。'}
                        </p>
                      )}

                      {cleanupWarning && (
                        <p role="status">
                          照片已移除，但原文件清理没有完成。系统已留下排查记录。
                        </p>
                      )}
                      </div>
                    )}
                  </div>

                  <button
                    ref={viewerCloseRef}
                    type="button"
                    className={styles.viewerClose}
                    aria-label="关闭完整照片"
                    onClick={closeViewer}
                  >
                    ×
                  </button>
                </div>
              </div>

              <div
                className={
                  styles.viewerImageFrame
                }
                onPointerDown={
                  handlePointerDown
                }
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  swipeStartRef.current = null
                }}
              >
                <img
                  key={activeImage.id}
                  src={activeImage.url}
                  alt={imageAlt(
                    activeImage,
                    title,
                    activeIndex,
                  )}
                />
              </div>

              <div
                className={
                  styles.viewerControls
                }
              >
                {images.length > 1 && (
                  <button
                    type="button"
                    aria-label={`上一张照片，当前第 ${activeIndex + 1} 张`}
                    disabled={activeIndex === 0}
                    onClick={() => move(-1)}
                  >
                    ←
                  </button>
                )}

                <span
                  className={
                    styles.viewerCounter
                  }
                  aria-live="polite"
                >
                  {formatCounter(
                    activeIndex + 1,
                  )}
                  {' / '}
                  {formatCounter(images.length)}
                </span>

                {images.length > 1 && (
                  <button
                    type="button"
                    aria-label={`下一张照片，当前第 ${activeIndex + 1} 张`}
                    disabled={
                      activeIndex
                      === images.length - 1
                    }
                    onClick={() => move(1)}
                  >
                    →
                  </button>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {images.length === 1
        ? (
          <figure
            className={styles.single}
          >
            <button
              type="button"
              className={styles.singleButton}
              aria-label="打开完整照片"
              onClick={(event) =>
                openViewer(
                  event.currentTarget,
                )
              }
            >
              <img
                ref={(node) => {
                  if (node) {
                    initialImageRefs.current.set(
                      activeImage.id,
                      node,
                    )
                  } else {
                    initialImageRefs.current.delete(
                      activeImage.id,
                    )
                  }
                }}
                src={activeImage.url}
                alt={imageAlt(
                  activeImage,
                  title,
                  0,
                )}
                loading="eager"
              />
            </button>
          </figure>
        )
        : (
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
                      ref={(node) => {
                        if (node) {
                          initialImageRefs.current.set(
                            image.id,
                            node,
                          )
                        } else {
                          initialImageRefs.current.delete(
                            image.id,
                          )
                        }
                      }}
                      src={image.url}
                      alt=""
                      loading="eager"
                    />
                  </div>
                ),
              )}

              <button
                type="button"
                className={styles.active}
                aria-label={`打开第 ${activeIndex + 1} 张完整照片`}
                onClick={(event) =>
                  openViewer(
                    event.currentTarget,
                  )
                }
              >
                <img
                  ref={(node) => {
                    if (node) {
                      initialImageRefs.current.set(
                        activeImage.id,
                        node,
                      )
                    } else {
                      initialImageRefs.current.delete(
                        activeImage.id,
                      )
                    }
                  }}
                  key={activeImage.id}
                  src={activeImage.url}
                  alt={imageAlt(
                    activeImage,
                    title,
                    activeIndex,
                  )}
                  loading="eager"
                />
              </button>
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
                {formatCounter(
                  activeIndex + 1,
                )}
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
        )}

      {viewer}
    </>
  )
}
