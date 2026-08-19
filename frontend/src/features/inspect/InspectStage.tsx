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

export function InspectStage({
  itemId,
  originSlot,
  onBack,
}: InspectStageProps) {
  const query =
    useInspectItem(itemId)

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
          放回这张
        </button>

        <span className={styles.kicker}>
          INSPECT
        </span>
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
          <div className={styles.workspace}>
            <div
              className={
                styles.recordLayer
              }
            >
              <RecordPaper
                item={query.data}
              />
            </div>

            <div
              className={
                styles.originalLayer
              }
            >
              <OriginalPaper
                item={query.data}
              />
            </div>
          </div>

          <EeNotePaper
            item={query.data}
          />

          <ReplyStack
            item={query.data}
          />

          <FilingSlip
            item={query.data}
            onFiled={
              handleFiled
            }
          />
        </>
      )}
    </section>
  )
}
