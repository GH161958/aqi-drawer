import {
  useMemo,
  useState,
} from 'react'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  useTagVocabulary,
} from './useTagVocabulary'

import {
  useUpdateTags,
} from './useUpdateTags'

import {
  useDeleteTagEverywhere,
} from './useDeleteTagEverywhere'

import styles from './TagEditor.module.css'

interface TagEditorProps {
  item: PocketItemSummary
}

export function TagEditor({
  item,
}: TagEditorProps) {
  const [
    editing,
    setEditing,
  ] = useState(false)

  const [
    newTag,
    setNewTag,
  ] = useState('')

  const [
    deleteTarget,
    setDeleteTarget,
  ] = useState<string | null>(
    null,
  )

  const vocabulary =
    useTagVocabulary()

  const update =
    useUpdateTags(
      item.id,
    )

  const removeEverywhere =
    useDeleteTagEverywhere()

  const currentTags =
    useMemo(
      () =>
        Array.isArray(item.tags)
          ? item.tags
          : [],
      [item.tags],
    )

  const availableTags =
    useMemo(
      () =>
        (
          vocabulary.data
          ?? []
        ).filter(
          (tag) =>
            !currentTags.includes(
              tag,
            ),
        ),
      [
        vocabulary.data,
        currentTags,
      ],
    )

  const busy =
    update.isPending
    || removeEverywhere.isPending

  function attach(
    tag: string,
  ) {
    const normalized =
      tag.trim()

    if (
      !normalized
      || busy
      || currentTags.includes(
        normalized,
      )
    ) {
      return
    }

    update.mutate(
      {
        tagsAdd:
          [normalized],
      },
      {
        onSuccess: () => {
          setNewTag('')
        },
      },
    )
  }

  function detach(
    tag: string,
  ) {
    if (busy) {
      return
    }

    update.mutate({
      tagsRemove: [tag],
    })
  }

  function confirmDelete() {
    if (
      !deleteTarget
      || busy
    ) {
      return
    }

    removeEverywhere.mutate(
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
        TAGS
      </div>

      <div className={styles.content}>
        <div className={styles.summary}>
          <div
            className={
              styles.currentTags
            }
          >
            {currentTags.length
              ? currentTags.map(
                  (tag) => (
                    <span
                      key={tag}
                      className={
                        styles.currentChip
                      }
                    >
                      <span>
                        #{tag}
                      </span>

                      {editing && (
                        <button
                          type="button"
                          aria-label={
                            `从这张移除标签 ${tag}`
                          }
                          disabled={busy}
                          onClick={() =>
                            detach(tag)
                          }
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ),
                )
              : (
                <span
                  className={
                    styles.empty
                  }
                >
                  暂无标签
                </span>
              )}
          </div>

          <button
            type="button"
            className={
              styles.editToggle
            }
            aria-expanded={
              editing
            }
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
            <section>
              <p className={styles.caption}>
                AVAILABLE TAGS
              </p>

              {vocabulary.isPending && (
                <p
                  className={
                    styles.feedback
                  }
                >
                  正在翻标签索引……
                </p>
              )}

              {vocabulary.isError && (
                <p
                  className={
                    styles.feedback
                  }
                >
                  暂时没能读取标签索引。
                </p>
              )}

              {!vocabulary.isPending
                && availableTags.length
                  === 0 && (
                  <p
                    className={
                      styles.empty
                    }
                  >
                    没有其他可贴的标签。
                  </p>
                )}

              {availableTags.length
                > 0 && (
                  <div
                    className={
                      styles.available
                    }
                  >
                    {availableTags.map(
                      (tag) => (
                        <button
                          key={tag}
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            attach(tag)
                          }
                        >
                          #{tag}
                          <span
                            aria-hidden="true"
                          >
                            ＋
                          </span>
                        </button>
                      ),
                    )}
                  </div>
                )}
            </section>

            <section
              className={
                styles.newSection
              }
            >
              <label
                className={
                  styles.caption
                }
                htmlFor={
                  `new-tag-${item.id}`
                }
              >
                NEW TAG
              </label>

              <div
                className={
                  styles.newRow
                }
              >
                <input
                  id={
                    `new-tag-${item.id}`
                  }
                  className={
                    styles.newInput
                  }
                  value={newTag}
                  disabled={busy}
                  placeholder="新的标签"
                  onChange={
                    (event) =>
                      setNewTag(
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
                        attach(newTag)
                      }
                    }
                  }
                />

                <button
                  type="button"
                  className={
                    styles.addAction
                  }
                  disabled={
                    busy
                    || !newTag.trim()
                  }
                  onClick={() =>
                    attach(newTag)
                  }
                >
                  贴上
                </button>
              </div>

              <p className={styles.hint}>
                新标签会先贴到这张纸上，
                之后才会出现在 Drawer
                的共享标签索引里。
              </p>
            </section>

            {vocabulary.data
              && vocabulary.data.length
                > 0 && (
                <section
                  className={
                    styles.manageSection
                  }
                >
                  <p
                    className={
                      styles.caption
                    }
                  >
                    MANAGE TAGS
                  </p>

                  <div
                    className={
                      styles.manager
                    }
                  >
                    {vocabulary.data.map(
                      (tag) => (
                        <div
                          key={tag}
                          className={
                            styles.managerRow
                          }
                        >
                          <span>
                            #{tag}
                          </span>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              setDeleteTarget(
                                tag,
                              )
                            }
                          >
                            删除整个标签
                          </button>
                        </div>
                      ),
                    )}
                  </div>
                </section>
              )}

            <p
              className={
                styles.feedback
              }
              aria-live="polite"
            >
              {update.isPending
                ? '正在记下标签……'
                : removeEverywhere.isPending
                  ? '正在从整个 Drawer 移除标签……'
                  : update.isError
                    ? update.error.message
                    : removeEverywhere.isError
                      ? removeEverywhere.error.message
                      : '\u00A0'}
            </p>
          </div>
        )}

        {deleteTarget && (
          <div
            className={
              styles.confirm
            }
            role="alertdialog"
            aria-labelledby={
              `delete-tag-${item.id}`
            }
          >
            <p
              id={
                `delete-tag-${item.id}`
              }
              className={
                styles.confirmTitle
              }
            >
              删除整个标签？
            </p>

            <p
              className={
                styles.confirmCopy
              }
            >
              「{deleteTarget}」会从所有
              使用它的物件上一起移除。
              这不是只从当前这张摘掉。
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
                删除标签
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
