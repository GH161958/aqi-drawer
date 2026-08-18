import {
  OriginalPaper,
} from './OriginalPaper'

import {
  useInspectItem,
} from './useInspectItem'

import {
  RecordPaper,
} from '../record/RecordPaper'

import styles from './InspectStage.module.css'

interface InspectStageProps {
  itemId: string
  onBack: () => void
}

export function InspectStage({
  itemId,
  onBack,
}: InspectStageProps) {
  const query =
    useInspectItem(itemId)

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
        <div className={styles.workspace}>
          <div className={styles.recordLayer}>
            <RecordPaper
              item={query.data}
            />
          </div>

          <div className={styles.originalLayer}>
            <OriginalPaper
              item={query.data}
            />
          </div>
        </div>
      )}
    </section>
  )
}
