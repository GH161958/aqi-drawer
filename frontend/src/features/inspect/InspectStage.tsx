import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
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
  onBack: () => void
}

type AttachedPaper =
  | 'record'
  | 'ee'
  | 'replies'
  | 'filing'

type InspectPhase =
  | 'opening'
  | 'resting'
  | 'returning'

const RETURN_FALLBACK_MS = 240

export function InspectStage({
  itemId,
  onBack,
}: InspectStageProps) {
  const query =
    useInspectItem(itemId)

  const inspectedItemId =
    query.data?.id

  const [
    activePaper,
    setActivePaper,
  ] =
    useState<AttachedPaper | null>(
      null,
    )

  const [phase, setPhase] =
    useState<InspectPhase>(
      'opening',
    )

  const returnTimerRef =
    useRef<number | null>(null)

  const returnedRef =
    useRef(false)

  const openedItemRef =
    useRef<string | null>(null)

  const returnButtonRef =
    useRef<HTMLButtonElement | null>(
      null,
    )

  const attachedPaperFrameRef =
    useRef<number | null>(null)

  const attachedPaperRef =
    useRef<HTMLElement | null>(null)

  const paperTriggerRefs =
    useRef<
      Partial<
        Record<
          AttachedPaper,
          HTMLButtonElement | null
        >
      >
    >({})

  useEffect(
    () => {
      if (!inspectedItemId) return

      returnButtonRef.current?.focus({
        preventScroll: true,
      })
    },
    [inspectedItemId],
  )

  useLayoutEffect(
    () => {
      if (
        !inspectedItemId
        || openedItemRef.current
          === itemId
      ) {
        return
      }

      openedItemRef.current = itemId
      setActivePaper(null)
      setPhase('opening')
      returnedRef.current = false

      const frame =
        window.requestAnimationFrame(
          () => {
            setPhase('resting')
          },
        )

      return () => {
        window.cancelAnimationFrame(
          frame,
        )
      }
    },
    [
      itemId,
      inspectedItemId,
    ],
  )

  useEffect(
    () => {
      const scrollY =
        window.scrollY

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
    [],
  )

  useEffect(
    () => () => {
      if (returnTimerRef.current) {
        window.clearTimeout(
          returnTimerRef.current,
        )
      }

      if (attachedPaperFrameRef.current) {
        window.cancelAnimationFrame(
          attachedPaperFrameRef.current,
        )
      }
    },
    [],
  )

  const finishReturn =
    useCallback(() => {
      if (returnedRef.current) return

      returnedRef.current = true

      if (returnTimerRef.current) {
        window.clearTimeout(
          returnTimerRef.current,
        )
      }

      onBack()
    }, [onBack])

  const requestReturn =
    useCallback(() => {
      if (phase === 'returning') return

      setActivePaper(null)
      setPhase('returning')

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
    }, [finishReturn, phase])

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
          requestReturn()
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
    [phase, requestReturn],
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

  function closeAttachedPaper() {
    const previousPaper = activePaper

    setActivePaper(null)

    if (previousPaper) {
      window.requestAnimationFrame(
        () => {
          paperTriggerRefs.current[
            previousPaper
          ]?.focus({
            preventScroll: true,
          })
        },
      )
    }
  }

  return (
    <section
      className={styles.stage}
      role="dialog"
      aria-modal="true"
      aria-label="Inspect Drawer item"
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

      {query.isPending && (
        <div className={styles.state}>
          正在把这张纸拿近一点……
        </div>
      )}

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

            <div
              className={
                styles.originalLayer
              }
            >
              <InspectOriginalPaper
                item={query.data}
              />
            </div>

            {activePaper && (
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

                  {activePaper
                    === 'filing' && (
                    <FilingSlip
                      item={query.data}
                      onFiled={
                        handleFiled
                      }
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
