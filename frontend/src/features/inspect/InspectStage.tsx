import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  CSSProperties,
} from 'react'

import { TrashAction } from '../trash/TrashAction'

import {
  InspectOriginalPaper,
} from './InspectOriginalPaper'

import {
  useInspectItem,
} from './useInspectItem'

import {
  RecordPaper,
} from '../record/RecordPaper'

import {
  FilingSlip,
} from '../filing/FilingSlip'

import {
  EeNotePaper,
} from '../notes/EeNotePaper'

import {
  ReplyStack,
} from '../replies/ReplyStack'

import {
  cabinetSlotLabels,
} from '../cabinet/cabinet'

import styles from './InspectStage.module.css'

interface InspectStageProps {
  itemId: string
  presented: boolean
  onPresentationReady: (
    itemId: string,
  ) => void
  onBack: () => void
}

type AttachedPaper =
  | 'record'
  | 'ee'
  | 'replies'
  | 'filing'

type InspectPhase =
  | 'resting'
  | 'returning'

const RETURN_FALLBACK_MS = 240

function isTouchAppleWebKit() {
  return (
    navigator.maxTouchPoints > 0
    && /AppleWebKit/u.test(
      navigator.userAgent,
    )
    && /(iPad|iPhone|iPod|Macintosh)/u.test(
      navigator.userAgent,
    )
  )
}

export function InspectStage({
  itemId,
  presented,
  onPresentationReady,
  onBack,
}: InspectStageProps) {
  const query =
    useInspectItem(itemId)

  const inspectedItemId =
    query.data?.id

  const stableViewportUnit =
    useMemo(
      () => ({
        itemId,
        unit:
          document.documentElement
            .clientHeight / 100,
      }),
      [itemId],
    ).unit

  const stageStyle = {
    '--inspect-vh':
      `${stableViewportUnit}px`,
  } as CSSProperties

  const [mediaReadyItemId, setMediaReadyItemId] =
    useState<string | null>(null)

  const presentationReady =
    Boolean(query.data)
    && mediaReadyItemId
      === inspectedItemId

  const [
    activePaper,
    setActivePaper,
  ] =
    useState<AttachedPaper | null>(
      null,
    )

  const [phase, setPhase] =
    useState<InspectPhase>(
      'resting',
    )

  const phaseRef =
    useRef<InspectPhase>('resting')

  const returnTimerRef =
    useRef<number | null>(null)

  const returnedRef =
    useRef(false)

  const returnButtonRef =
    useRef<HTMLButtonElement | null>(
      null,
    )

  const stageRef =
    useRef<HTMLElement | null>(null)

  const attachedPaperFrameRef =
    useRef<number | null>(null)

  const attachedPaperRef =
    useRef<HTMLElement | null>(null)

  const filingPulledPaperRef =
    useRef<HTMLDivElement | null>(null)

  const filingScrollTopRef =
    useRef<number | null>(null)

  const filingRevealFrameRef =
    useRef<number | null>(null)

  const filingRevealGenerationRef =
    useRef(0)

  const paperTriggerRefs =
    useRef<
      Partial<
        Record<
          AttachedPaper,
          HTMLButtonElement | null
        >
      >
    >({})

  const readyNotificationRef =
    useRef<string | null>(null)

  const cancelFilingReveal =
    useCallback(() => {
      filingRevealGenerationRef.current += 1

      if (filingRevealFrameRef.current) {
        window.cancelAnimationFrame(
          filingRevealFrameRef.current,
        )
        filingRevealFrameRef.current = null
      }
    }, [])

  const clearFilingInteraction =
    useCallback((restoreScroll: boolean) => {
      cancelFilingReveal()

      const savedScrollTop =
        filingScrollTopRef.current

      filingScrollTopRef.current = null

      if (
        !restoreScroll
        || savedScrollTop === null
        || !stageRef.current
      ) {
        return
      }

      const stage = stageRef.current
      const maxScrollTop =
        Math.max(
          0,
          stage.scrollHeight - stage.clientHeight,
        )

      stage.scrollTo({
        top: Math.min(
          maxScrollTop,
          Math.max(0, savedScrollTop),
        ),
        behavior: 'auto',
      })
    }, [cancelFilingReveal])

  const closeAttachedPaper =
    useCallback(() => {
      const previousPaper = activePaper

      if (previousPaper === 'filing') {
        clearFilingInteraction(true)
      }

      setActivePaper(null)

      if (!previousPaper) return

      if (attachedPaperFrameRef.current) {
        window.cancelAnimationFrame(
          attachedPaperFrameRef.current,
        )
      }

      attachedPaperFrameRef.current =
        window.requestAnimationFrame(
          () => {
            attachedPaperFrameRef.current = null

            paperTriggerRefs.current[
              previousPaper
            ]?.focus({
              preventScroll: true,
            })
          },
        )
    }, [activePaper, clearFilingInteraction])

  useEffect(
    () => {
      if (!presented) return

      returnButtonRef.current?.focus({
        preventScroll: true,
      })
    },
    [presented],
  )

  const handleInitialMediaReady =
    useCallback(() => {
      if (!inspectedItemId) return

      setMediaReadyItemId(
        inspectedItemId,
      )
    }, [inspectedItemId])

  useEffect(
    () => {
      const readyItemId =
        query.isError
          ? itemId
          : inspectedItemId

      if (
        !readyItemId
        || (
          !query.isError
          && !presentationReady
        )
        || readyNotificationRef.current
          === readyItemId
      ) {
        return
      }

      readyNotificationRef.current =
        readyItemId
      onPresentationReady(readyItemId)
    },
    [
      inspectedItemId,
      itemId,
      onPresentationReady,
      presentationReady,
      query.isError,
    ],
  )

  useLayoutEffect(
    () => {
      if (!presented) return

      const scrollY =
        window.scrollY

      if (isTouchAppleWebKit()) {
        const handleTouchMove = (
          event: TouchEvent,
        ) => {
          const target = event.target

          if (!(target instanceof Node)) {
            event.preventDefault()
            return
          }

          const viewer =
            document.querySelector<HTMLElement>(
              '[role="dialog"][aria-label="查看完整照片"]',
            )

          if (
            stageRef.current?.contains(target)
            || viewer?.parentElement
              ?.contains(target)
          ) {
            return
          }

          event.preventDefault()
        }

        document.addEventListener(
          'touchmove',
          handleTouchMove,
          { passive: false },
        )

        return () => {
          document.removeEventListener(
            'touchmove',
            handleTouchMove,
          )
        }
      }

      const previous = {
        position:
          document.body.style.position,
        top: document.body.style.top,
        width:
          document.body.style.width,
        overflow:
          document.body.style.overflow,
      }

      document.body.style.position =
        'fixed'
      document.body.style.top =
        `-${scrollY}px`
      document.body.style.width =
        '100%'
      document.body.style.overflow =
        'hidden'

      return () => {
        document.body.style.position =
          previous.position
        document.body.style.top =
          previous.top
        document.body.style.width =
          previous.width
        document.body.style.overflow =
          previous.overflow

        window.scrollTo(0, scrollY)
      }
    },
    [itemId, presented],
  )

  useEffect(
    () => () => {
      if (returnTimerRef.current) {
        window.clearTimeout(
          returnTimerRef.current,
        )
        returnTimerRef.current = null
      }

      if (attachedPaperFrameRef.current) {
        window.cancelAnimationFrame(
          attachedPaperFrameRef.current,
        )

        attachedPaperFrameRef.current = null
      }
      cancelFilingReveal()
      filingScrollTopRef.current = null
    },
    [cancelFilingReveal, itemId],
  )

  useLayoutEffect(
    () => {
      if (activePaper !== 'filing') return

      cancelFilingReveal()

      const generation =
        filingRevealGenerationRef.current

      filingRevealFrameRef.current =
        window.requestAnimationFrame(
          () => {
            if (
              generation
                !== filingRevealGenerationRef.current
            ) {
              return
            }

            filingRevealFrameRef.current = null

            const stage = stageRef.current
            const filingPaper =
              filingPulledPaperRef.current

            if (!stage || !filingPaper) return

            const stageRect =
              stage.getBoundingClientRect()
            const filingRect =
              filingPaper.getBoundingClientRect()
            const stageStyles =
              window.getComputedStyle(stage)
            const paddingTop =
              Number.parseFloat(
                stageStyles.paddingTop,
              ) || 0
            const paddingBottom =
              Number.parseFloat(
                stageStyles.paddingBottom,
              ) || 0
            const visibleTop =
              stageRect.top + paddingTop
            const visibleBottom =
              stageRect.bottom - paddingBottom
            const visibleHeight =
              visibleBottom - visibleTop

            let delta = 0

            if (
              filingRect.height > visibleHeight
              || filingRect.top < visibleTop
            ) {
              delta = filingRect.top - visibleTop
            } else if (
              filingRect.bottom > visibleBottom
            ) {
              delta =
                filingRect.bottom - visibleBottom
            }

            if (delta === 0) return

            const maxScrollTop =
              Math.max(
                0,
                stage.scrollHeight
                  - stage.clientHeight,
              )
            const nextScrollTop =
              Math.min(
                maxScrollTop,
                Math.max(
                  0,
                  stage.scrollTop + delta,
                ),
              )

            stage.scrollTo({
              top: nextScrollTop,
              behavior: 'auto',
            })
          },
        )

      return () => {
        if (
          generation
          === filingRevealGenerationRef.current
        ) {
          cancelFilingReveal()
        }
      }
    },
    [activePaper, cancelFilingReveal, itemId],
  )

  const finishReturn =
    useCallback(() => {
      if (returnedRef.current) return

      returnedRef.current = true

      if (returnTimerRef.current) {
        window.clearTimeout(
          returnTimerRef.current,
        )
        returnTimerRef.current = null
      }

      onBack()
    }, [onBack])

  const requestReturn =
    useCallback(() => {
      if (
        phaseRef.current === 'returning'
      ) {
        return
      }

      clearFilingInteraction(false)
      setActivePaper(null)
      phaseRef.current = 'returning'
      setPhase('returning')

      if (returnTimerRef.current) {
        window.clearTimeout(
          returnTimerRef.current,
        )
        returnTimerRef.current = null
      }

      if (!presented) {
        finishReturn()
        return
      }

      if (
        window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches
      ) {
        window.requestAnimationFrame(
          () => finishReturn(),
        )
        return
      }

      returnTimerRef.current =
        window.setTimeout(
          finishReturn,
          RETURN_FALLBACK_MS,
        )
    }, [
      clearFilingInteraction,
      finishReturn,
      presented,
    ])

  useEffect(
    () => {
      function handleKeyDown(
        event: KeyboardEvent,
      ) {
        if (
          event.key === 'Escape'
          && phase !== 'returning'
        ) {
          event.preventDefault()

          if (activePaper === 'filing') {
            closeAttachedPaper()
          } else {
            requestReturn()
          }
        }
      }

      window.addEventListener(
        'keydown',
        handleKeyDown,
      )

      return () => {
        window.removeEventListener(
          'keydown',
          handleKeyDown,
        )
      }
    },
    [
      activePaper,
      closeAttachedPaper,
      phase,
      requestReturn,
    ],
  )

  function handleFiled() {
    requestReturn()
  }

  function toggleAttachedPaper(
    paper: AttachedPaper,
  ) {
    if (
      activePaper === paper
    ) {
      closeAttachedPaper()
      return
    }

    if (activePaper === 'filing') {
      clearFilingInteraction(true)
    }

    if (paper === 'filing') {
      filingScrollTopRef.current =
        stageRef.current?.scrollTop ?? 0
    }

    if (attachedPaperFrameRef.current) {
      window.cancelAnimationFrame(
        attachedPaperFrameRef.current,
      )
    }

    setActivePaper(paper)

    attachedPaperFrameRef.current =
      window.requestAnimationFrame(
        () => {
          attachedPaperRef.current?.focus({
            preventScroll: true,
          })
        },
      )
  }

  return (
    <section
      ref={stageRef}
      className={styles.stage}
      style={stageStyle}
      role="dialog"
      aria-modal="true"
      aria-label="Inspect Drawer item"
      aria-hidden={
        presented
          ? undefined
          : true
      }
      inert={
        presented
          ? undefined
          : true
      }
      data-presented={
        presented
          ? 'true'
          : 'false'
      }
      data-phase={phase}
      onClick={(event) => {
        const target = event.target

        if (
          !(target instanceof Element)
          || target.closest(
            [
              'button',
              'a',
              'input',
              'textarea',
              'select',
              'label',
              `.${styles.originalLayer}`,
              `.${styles.pulledLayer}`,
              `.${styles.filingPulledLayer}`,
            ].join(','),
          )
        ) {
          return
        }

        if (activePaper) {
          closeAttachedPaper()
        } else {
          requestReturn()
        }
      }}
    >
      <div className={styles.toolbar}>
        <button
          ref={returnButtonRef}
          className={styles.returnAction}
          type="button"
          disabled={phase === 'returning'}
          onClick={requestReturn}
        >
          ← 放回
        </button>
      </div>

      {query.isError && (
        <div className={styles.state}>
          <p>
            暂时没能拿出这张纸。
          </p>

          <button
            type="button"
            onClick={requestReturn}
          >
            放回抽屉
          </button>
        </div>
      )}

      {query.data && (
        <>
          <div
            className={styles.bundle}
            data-active-paper={
              activePaper ?? undefined
            }
            onTransitionEnd={
              (event) => {
                if (
                  phase === 'returning'
                  && event.target
                    === event.currentTarget
                  && event.propertyName
                    === 'transform'
                ) {
                  finishReturn()
                }
              }
            }
          >
            <button
              ref={(node) => {
                paperTriggerRefs.current
                  .record = node
              }}
              type="button"
              className={styles.receiptPeek}
              aria-label="查看收件记录"
              aria-pressed={
                activePaper === 'record'
              }
              onClick={() =>
                toggleAttachedPaper(
                  'record',
                )
              }
            >
              <span>
                RECEIPT · {
                  String(
                    query.data.activity.length,
                  ).padStart(2, '0')
                }
              </span>
            </button>

            <div
              className={styles.sideTabs}
              aria-label="附页"
            >
              <button
                ref={(node) => {
                  paperTriggerRefs.current
                    .ee = node
                }}
                type="button"
                className={`${styles.sideTab} ${styles.eePeek}`}
                aria-label="查看 EE 留下的附页"
                aria-pressed={
                  activePaper === 'ee'
                }
                onClick={() =>
                  toggleAttachedPaper(
                    'ee',
                  )
                }
              >
                EE
              </button>

              {(query.data.replies.length > 0
                || query.data.hiddenReplies.length > 0) && (
                <button
                  ref={(node) => {
                    paperTriggerRefs.current
                      .replies = node
                  }}
                  type="button"
                  className={`${styles.sideTab} ${styles.replyPeek}`}
                  aria-label="查看 Aqi 回条"
                  aria-pressed={
                    activePaper === 'replies'
                  }
                  onClick={() =>
                    toggleAttachedPaper(
                      'replies',
                    )
                  }
                >
                  Aqi
                </button>
              )}
            </div>

            <div
              className={styles.filingSlot}
            >
              <button
                ref={(node) => {
                  paperTriggerRefs.current
                    .filing = node
                }}
                type="button"
                className={styles.filingPeek}
                aria-label="查看归档附页"
                aria-pressed={
                  activePaper === 'filing'
                }
                onClick={() =>
                  toggleAttachedPaper(
                    'filing',
                  )
                }
              >
                <span>
                  FILING · {
                    cabinetSlotLabels[
                      query.data.status
                    ]
                  }
                </span>

                <span>
                  看完放哪儿？
                </span>
              </button>

              {activePaper === 'filing' && (
                <section
                  ref={attachedPaperRef}
                  className={
                    styles.filingPulledLayer
                  }
                  aria-label="抽出的附页"
                  tabIndex={-1}
                  data-paper="filing"
                >
                  <div
                    ref={filingPulledPaperRef}
                    className={
                      styles.pulledPaper
                    }
                  >
                    <FilingSlip
                      item={query.data}
                      onFiled={handleFiled}
                      onClose={
                        closeAttachedPaper
                      }
                    />
                  </div>
                </section>
              )}
            </div>

            <div
              className={
                styles.originalLayer
              }
            >
              <InspectOriginalPaper
                item={query.data}
                onInitialMediaReady={
                  handleInitialMediaReady
                }
              />
            </div>

            {activePaper
              && activePaper !== 'filing' && (
              <section
                ref={attachedPaperRef}
                className={
                  styles.pulledLayer
                }
                aria-label="抽出的附页"
                tabIndex={-1}
                data-paper={activePaper}
              >
                <div
                  className={
                    styles.pulledPaper
                  }
                >
                  {activePaper
                    === 'record' && (
                    <RecordPaper
                      item={query.data}
                      onClose={
                        closeAttachedPaper
                      }
                    />
                  )}

                  {activePaper
                    === 'ee' && (
                    <EeNotePaper
                      item={query.data}
                      onClose={
                        closeAttachedPaper
                      }
                    />
                  )}

                  {activePaper
                    === 'replies' && (
                    <ReplyStack
                      item={query.data}
                      onClose={
                        closeAttachedPaper
                      }
                    />
                  )}
                </div>
              </section>
            )}
          </div>

          <div className={styles.trashOutside}>
            <TrashAction
              item={query.data}
              onTrashed={requestReturn}
            />
          </div>
        </>
      )}

    </section>
  )
}
