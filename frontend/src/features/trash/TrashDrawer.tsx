import {
  useState,
} from 'react'

import {
  useQuery,
} from '@tanstack/react-query'

import {
  listTrashItems,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  usePermanentlyDeleteItem,
  useRestoreItem,
} from './useTrashMutations'

import styles from './TrashDrawer.module.css'

interface TrashDrawerProps {
  onBack: () => void
}

function formatDiscardedAt(
  value: string | null,
): string {
  if (!value) {
    return ''
  }

  const date =
    new Date(value)

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return ''
  }

  return new Intl.DateTimeFormat(
    'zh-CN',
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    },
  ).format(date)
}

interface TrashPaperProps {
  item: PocketItemSummary
}

function TrashPaper({
  item,
}: TrashPaperProps) {
  const [
    confirmingDelete,
    setConfirmingDelete,
  ] = useState(false)

  const restore =
    useRestoreItem(
      item.id,
    )

  const permanentDelete =
    usePermanentlyDeleteItem(
      item.id,
    )

  const busy =
    restore.isPending
    || permanentDelete.isPending

  return (
    <article
      className={styles.paper}
    >
      <p
        className={styles.kicker}
      >
        DISCARDED
      </p>

      <h2
        className={styles.title}
      >
        {item.title
          || '没有标题的一张纸'}
      </h2>

      {item.text && (
        <p
          className={styles.preview}
        >
          {item.text}
        </p>
      )}

      <p
        className={styles.meta}
      >
        {[
          item.sourceApp,
          formatDiscardedAt(
            item.deletedAt,
          ),
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>

      {!confirmingDelete ? (
        <div
          className={styles.actions}
        >
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              restore.mutate()
            }
          >
            {restore.isPending
              ? '正在捡回来…'
              : '放回抽屉'}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setConfirmingDelete(
                true,
              )
            }
          >
            永久删除
          </button>
        </div>
      ) : (
        <div
          className={
            styles.dangerBox
          }
        >
          <p>
            永久删除后不能恢复，
            相关的孤立附件也可能被清理。
          </p>

          <div
            className={styles.actions}
          >
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                permanentDelete.mutate()
              }
            >
              {permanentDelete.isPending
                ? '正在永久删除…'
                : '确认永久删除'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() =>
                setConfirmingDelete(
                  false,
                )
              }
            >
              算了
            </button>
          </div>
        </div>
      )}

      {(restore.isError
        || permanentDelete.isError) && (
        <p
          className={
            styles.feedback
          }
          aria-live="polite"
        >
          {restore.error?.message
            || permanentDelete.error?.message
            || '这张纸暂时没有整理好。'}
        </p>
      )}
    </article>
  )
}

export function TrashDrawer({
  onBack,
}: TrashDrawerProps) {
  const query =
    useQuery({
      queryKey:
        pocketQueryKeys.trash(),

      queryFn:
        () =>
          listTrashItems(500),
    })

  const items =
    query.data ?? []

  return (
    <section
      className={styles.view}
      aria-labelledby="trash-title"
    >
      <div
        className={styles.toolbar}
      >
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
        >
          放回柜子
        </button>

        <p
          id="trash-title"
          className={styles.label}
        >
          DISCARDED

          {!query.isPending && (
            <>
              {' · '}
              {String(
                items.length,
              ).padStart(2, '0')}
            </>
          )}
        </p>
      </div>

      {query.isPending && (
        <div
          className={styles.state}
        >
          正在看看废纸槽……
        </div>
      )}

      {query.isError && (
        <div
          className={styles.state}
        >
          废纸槽暂时没有打开。
        </div>
      )}

      {!query.isPending
        && !query.isError
        && items.length === 0 && (
          <div
            className={
              styles.emptyPaper
            }
          >
            <p>
              这里现在没有废纸。
            </p>

            <p>
              被放进来的纸，
              之后还可以从这里捡回来。
            </p>
          </div>
        )}

      {items.length > 0 && (
        <div
          className={styles.list}
        >
          {items.map(
            (item) => (
              <TrashPaper
                key={item.id}
                item={item}
              />
            ),
          )}
        </div>
      )}
    </section>
  )
}
