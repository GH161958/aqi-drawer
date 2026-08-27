import {
  useState,
} from 'react'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  useCollections,
} from './useCollections'

import {
  useCreateCollection,
} from './useCreateCollection'

import {
  useDeleteCollection,
} from './useDeleteCollection'

import {
  useUpdateCollection,
} from './useUpdateCollection'

import styles from './CollectionEditor.module.css'

interface CollectionEditorProps {
  item: PocketItemSummary
}

export function CollectionEditor({
  item,
}: CollectionEditorProps) {
  const [
    editing,
    setEditing,
  ] = useState(false)

  const [
    newName,
    setNewName,
  ] = useState('')

  const [
    deleteTarget,
    setDeleteTarget,
  ] = useState<string | null>(
    null,
  )

  const collections =
    useCollections()

  const update =
    useUpdateCollection(
      item.id,
    )

  const create =
    useCreateCollection()

  const remove =
    useDeleteCollection()

  const busy =
    update.isPending
    || create.isPending
    || remove.isPending

  function choose(
    collection: string | null,
  ) {
    if (
      busy
      || collection ===
        item.collection
    ) {
      return
    }

    update.mutate(collection)
  }

  function createNew() {
    const value =
      newName.trim()

    if (!value || busy) {
      return
    }

    create.mutate(
      value,
      {
        onSuccess: () => {
          setNewName('')
        },
      },
    )
  }

  function confirmDelete() {
    if (
      !deleteTarget
      || busy
    ) {
      return
    }

    remove.mutate(
      deleteTarget,
      {
        onSuccess: () => {
          setDeleteTarget(null)
        },
      },
    )
  }

  return (
    <div
      className={styles.field}
      data-busy={
        busy
          ? 'true'
          : undefined
      }
    >
      <div className={styles.label}>
        COLLECTION
      </div>

      <div className={styles.content}>
        <div className={styles.current}>
          <span>
            {item.collection
              || '未归档'}
          </span>

          <button
            type="button"
            className={styles.editToggle}
            aria-expanded={editing}
            onClick={() =>
              setEditing(
                (value) =>
                  !value,
              )
            }
          >
            {editing
              ? '完成'
              : '整理'}
          </button>
        </div>

        {editing && (
          <div className={styles.editor}>
            <p className={styles.caption}>
              归到
            </p>

            <div
              className={styles.options}
            >
              <button
                type="button"
                data-current={
                  item.collection
                    ? undefined
                    : 'true'
                }
                disabled={
                  busy
                  || !item.collection
                }
                onClick={() =>
                  choose(null)
                }
              >
                未归档
              </button>

              {collections.data?.map(
                (collection) => (
                  <button
                    key={collection}
                    type="button"
                    data-current={
                      item.collection
                        === collection
                        ? 'true'
                        : undefined
                    }
                    disabled={
                      busy
                      || item.collection
                        === collection
                    }
                    onClick={() =>
                      choose(
                        collection,
                      )
                    }
                  >
                    {collection}
                  </button>
                ),
              )}
            </div>

            {collections.isPending && (
              <p className={styles.feedback}>
                正在翻分类索引……
              </p>
            )}

            {collections.isError && (
              <p className={styles.feedback}>
                暂时没能读取分类索引。
              </p>
            )}

            <div className={styles.newSection}>
              <label
                className={styles.caption}
                htmlFor={
                  `new-collection-${item.id}`
                }
              >
                NEW COLLECTION
              </label>

              <div className={styles.newRow}>
                <input
                  id={
                    `new-collection-${item.id}`
                  }
                  className={styles.newInput}
                  value={newName}
                  disabled={busy}
                  placeholder="新的分类"
                  onChange={
                    (event) =>
                      setNewName(
                        event.target.value,
                      )
                  }
                  onKeyDown={
                    (event) => {
                      if (
                        event.key
                        === 'Enter'
                      ) {
                        event.preventDefault()
                        createNew()
                      }
                    }
                  }
                />

                <button
                  type="button"
                  className={
                    styles.createAction
                  }
                  disabled={
                    busy
                    || !newName.trim()
                  }
                  onClick={createNew}
                >
                  建立
                </button>
              </div>

              <p className={styles.hint}>
                建立后会留在分类索引里，
                即使暂时没有物件归进去。
              </p>
            </div>

            {collections.data
              && collections.data.length
                > 0 && (
                <div
                  className={
                    styles.manageSection
                  }
                >
                  <p className={styles.caption}>
                    管理分类
                  </p>

                  <div
                    className={
                      styles.manager
                    }
                  >
                    {collections.data.map(
                      (collection) => (
                        <div
                          key={collection}
                          className={
                            styles.managerRow
                          }
                        >
                          <span>
                            {collection}
                          </span>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDeleteTarget(
                                collection,
                              )
                            }
                          >
                            删除
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </div>
              )}

            <p
              className={
                styles.feedback
              }
              aria-live="polite"
            >
              {update.isPending
                || create.isPending
                || remove.isPending
                ? '正在记下……'
                : update.isError
                  ? update.error.message
                  : create.isError
                    ? create.error.message
                    : remove.isError
                      ? remove.error.message
                      : '\u00A0'}
            </p>
          </div>
        )}

        {deleteTarget && (
          <div
            className={styles.confirm}
            role="alertdialog"
            aria-labelledby={
              `delete-collection-${item.id}`
            }
          >
            <p
              id={
                `delete-collection-${item.id}`
              }
              className={
                styles.confirmTitle
              }
            >
              删除整个分类？
            </p>

            <p className={styles.confirmCopy}>
              「{deleteTarget}」会从整个
              Drawer 删除，其中的物件会回到未分类。
            </p>

            <div
              className={
                styles.confirmActions
              }
            >
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setDeleteTarget(null)
                }
              >
                先留着
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={
                  confirmDelete
                }
              >
                删除分类
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
