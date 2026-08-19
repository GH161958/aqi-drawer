import {
  useState,
} from 'react'

import type {
  ArchiveIndexOptions,
} from './archiveIndexLogic'

import styles from './ArchiveIndex.module.css'

type ManagedKind =
  | 'collection'
  | 'tag'

interface DeleteTarget {
  kind: ManagedKind
  value: string
}

interface ArchiveIndexProps {
  options: ArchiveIndexOptions

  collection: string
  tag: string
  source: string

  onCollectionChange:
    (value: string) => void

  onTagChange:
    (value: string) => void

  onSourceChange:
    (value: string) => void

  onDeleteCollection:
    (value: string) => void

  onDeleteTag:
    (value: string) => void

  deletingCollection:
    boolean

  deletingTag:
    boolean

  deleteCollectionError:
    string

  deleteTagError:
    string
}

interface IndexLineProps {
  ariaLabel: string

  values: string[]

  allLabel: string

  selected: string

  onChange:
    (value: string) => void
}

interface ManagedIndexLineProps
  extends IndexLineProps {
  kind: ManagedKind

  managing: boolean

  onRequestDelete:
    (
      target: DeleteTarget,
    ) => void
}

function IndexLine({
  ariaLabel,
  values,
  allLabel,
  selected,
  onChange,
}: IndexLineProps) {
  return (
    <div
      className={styles.line}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className={styles.entry}
        data-current={
          selected === ''
            ? 'true'
            : undefined
        }
        aria-pressed={
          selected === ''
        }
        onClick={() =>
          onChange('')
        }
      >
        {allLabel}
      </button>

      {values.map(
        (value) => (
          <button
            key={value}
            type="button"
            className={
              styles.entry
            }
            data-current={
              selected === value
                ? 'true'
                : undefined
            }
            aria-pressed={
              selected === value
            }
            onClick={() =>
              onChange(value)
            }
          >
            {value}
          </button>
        ),
      )}
    </div>
  )
}

function ManagedIndexLine({
  ariaLabel,
  values,
  allLabel,
  selected,
  onChange,
  kind,
  managing,
  onRequestDelete,
}: ManagedIndexLineProps) {
  return (
    <div
      className={styles.line}
      aria-label={ariaLabel}
    >
      <button
        type="button"
        className={styles.entry}
        data-current={
          selected === ''
            ? 'true'
            : undefined
        }
        aria-pressed={
          selected === ''
        }
        onClick={() =>
          onChange('')
        }
      >
        {allLabel}
      </button>

      {values.map(
        (value) => (
          <span
            key={value}
            className={
              styles.managedEntry
            }
          >
            <button
              type="button"
              className={
                styles.entry
              }
              data-current={
                selected === value
                  ? 'true'
                  : undefined
              }
              aria-pressed={
                selected === value
              }
              onClick={() =>
                onChange(value)
              }
            >
              {value}
            </button>

            {managing && (
              <button
                type="button"
                className={
                  styles.removeButton
                }
                aria-label={
                  kind === 'collection'
                    ? `删除分类「${value}」`
                    : `删除标签「${value}」`
                }
                onClick={() =>
                  onRequestDelete({
                    kind,
                    value,
                  })
                }
              >
                ×
              </button>
            )}
          </span>
        ),
      )}
    </div>
  )
}

export function ArchiveIndex({
  options,
  collection,
  tag,
  source,
  onCollectionChange,
  onTagChange,
  onSourceChange,
  onDeleteCollection,
  onDeleteTag,
  deletingCollection,
  deletingTag,
  deleteCollectionError,
  deleteTagError,
}: ArchiveIndexProps) {
  const [
    managing,
    setManaging,
  ] = useState(false)

  const [
    deleteTarget,
    setDeleteTarget,
  ] =
    useState<DeleteTarget | null>(
      null,
    )

  const deleting =
    deletingCollection
    || deletingTag

  function closeManaging() {
    setManaging(false)
    setDeleteTarget(null)
  }

  function confirmDelete() {
    if (!deleteTarget) {
      return
    }

    if (
      deleteTarget.kind
      === 'collection'
    ) {
      onDeleteCollection(
        deleteTarget.value,
      )
    } else {
      onDeleteTag(
        deleteTarget.value,
      )
    }

    setDeleteTarget(null)
  }

  const confirmationCopy =
    deleteTarget?.kind
      === 'collection'
      ? `删除「${deleteTarget.value}」？纸条会保留，只取消这个 Collection。`
      : deleteTarget?.kind
        === 'tag'
        ? `删除「${deleteTarget.value}」？这个 Tag 会从所有纸条上一起移除。`
        : ''

  return (
    <section
      className={styles.index}
      aria-label="抽屉目录"
    >
      <div
        className={
          styles.topRow
        }
      >
        <ManagedIndexLine
          ariaLabel="按分类查看"
          values={
            options.collections
          }
          allLabel="全部分类"
          selected={collection}
          onChange={
            onCollectionChange
          }
          kind="collection"
          managing={managing}
          onRequestDelete={
            setDeleteTarget
          }
        />

        {(
          options.collections.length > 0
          || options.tags.length > 0
        ) && (
          <button
            type="button"
            className={
              styles.manageButton
            }
            aria-pressed={
              managing
            }
            onClick={() => {
              if (managing) {
                closeManaging()
              } else {
                setManaging(true)
              }
            }}
          >
            {managing
              ? '完成'
              : '整理'}
          </button>
        )}
      </div>

      <ManagedIndexLine
        ariaLabel="按标签查看"
        values={options.tags}
        allLabel="全部标签"
        selected={tag}
        onChange={
          onTagChange
        }
        kind="tag"
        managing={managing}
        onRequestDelete={
          setDeleteTarget
        }
      />

      <IndexLine
        ariaLabel="按来源查看"
        values={options.sources}
        allLabel="全部来源"
        selected={source}
        onChange={
          onSourceChange
        }
      />

      {deleteTarget && (
        <div
          className={
            styles.confirmSlip
          }
          role="group"
          aria-label="确认删除"
        >
          <p>
            {confirmationCopy}
          </p>

          <div
            className={
              styles.confirmActions
            }
          >
            <button
              type="button"
              disabled={deleting}
              onClick={
                confirmDelete
              }
            >
              {deleting
                ? '正在删除…'
                : '确认删除'}
            </button>

            <button
              type="button"
              disabled={deleting}
              onClick={() =>
                setDeleteTarget(
                  null,
                )
              }
            >
              算了
            </button>
          </div>
        </div>
      )}

      {(deleteCollectionError
        || deleteTagError) && (
        <p
          className={styles.error}
          aria-live="polite"
        >
          {deleteCollectionError
            || deleteTagError}
        </p>
      )}
    </section>
  )
}
