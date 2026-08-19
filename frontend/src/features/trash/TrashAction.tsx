import {
  useState,
} from 'react'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  useTrashItem,
} from './useTrashMutations'

import styles from './TrashAction.module.css'

interface TrashActionProps {
  item: PocketItemSummary
  onTrashed: () => void
}

export function TrashAction({
  item,
  onTrashed,
}: TrashActionProps) {
  const [
    confirming,
    setConfirming,
  ] = useState(false)

  const trash =
    useTrashItem(
      item.id,
    )

  function confirmTrash() {
    trash.mutate(
      undefined,
      {
        onSuccess:
          () => {
            onTrashed()
          },
      },
    )
  }

  return (
    <section
      className={styles.action}
      aria-label="Discard this Drawer item"
    >
      {!confirming ? (
        <button
          type="button"
          className={styles.open}
          onClick={() =>
            setConfirming(true)
          }
        >
          放进废纸槽
        </button>
      ) : (
        <div
          className={
            styles.confirmation
          }
        >
          <p>
            要把这张纸放进废纸槽吗？
            之后还可以恢复。
          </p>

          <div
            className={
              styles.actions
            }
          >
            <button
              type="button"
              disabled={
                trash.isPending
              }
              onClick={
                confirmTrash
              }
            >
              {trash.isPending
                ? '正在放进去…'
                : '放进去'}
            </button>

            <button
              type="button"
              disabled={
                trash.isPending
              }
              onClick={() =>
                setConfirming(false)
              }
            >
              算了
            </button>
          </div>
        </div>
      )}

      {trash.isError && (
        <p
          className={
            styles.feedback
          }
          aria-live="polite"
        >
          {trash.error.message
            || '这张暂时没有放进去。'}
        </p>
      )}
    </section>
  )
}
