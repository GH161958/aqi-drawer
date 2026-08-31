import {
  useEffect,
  useState,
} from 'react'

import { TrashAction } from '../trash/TrashAction'

import {
  OriginalPaper,
} from './OriginalPaper'

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

import type {
  CabinetSlot,
  PocketItemSummary,
} from '../../types/pocket'

import styles from './InspectStage.module.css'

interface InspectStageProps {
  itemId: string
  originSlot: CabinetSlot
  onBack: () => void
}

type AttachedPaper =
  | 'record'
  | 'ee'
  | 'replies'
  | 'filing'

export function InspectStage({
  itemId,
  originSlot,
  onBack,
}: InspectStageProps) {
  const query =
    useInspectItem(itemId)

  const [
    activePaper,
    setActivePaper,
  ] =
    useState<AttachedPaper | null>(
      null,
    )

  useEffect(
    () => {
      setActivePaper(null)
    },
    [
      itemId,
    ],
  )

  function handleFiled(
    item: PocketItemSummary,
  ) {
    if (
      originSlot !== 'all'
      && originSlot !== item.status
    ) {
      onBack()
    }
  }

  function toggleAttachedPaper(
    paper: AttachedPaper,
  ) {
    setActivePaper(
      (current) =>
        current === paper
          ? null
          : paper,
    )
  }

  return (
    <section
      className={styles.stage}
      aria-label="Inspect Drawer item"
    >
      <div className={styles.toolbar}>
        <button
          className={styles.returnAction}
          type="button"
          onClick={onBack}
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
            onClick={onBack}
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
          >
            <button
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
              <OriginalPaper
                item={query.data}
              />
            </div>

            {activePaper && (
              <section
                className={
                  styles.pulledLayer
                }
                aria-label="抽出的附页"
              >
                <button
                  type="button"
                  className={
                    styles.paperReturn
                  }
                  onClick={() =>
                    setActivePaper(null)
                  }
                >
                  放回这张
                </button>

                <div
                  className={
                    styles.pulledPaper
                  }
                >
                  {activePaper
                    === 'record' && (
                    <RecordPaper
                      item={query.data}
                    />
                  )}

                  {activePaper
                    === 'ee' && (
                    <EeNotePaper
                      item={query.data}
                    />
                  )}

                  {activePaper
                    === 'replies' && (
                    <ReplyStack
                      item={query.data}
                    />
                  )}

                  {activePaper
                    === 'filing' && (
                    <FilingSlip
                      item={query.data}
                      onFiled={
                        handleFiled
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
              onTrashed={onBack}
            />
          </div>
        </>
      )}
    </section>
  )
}
