import {
  useEffect,
  useState,
} from 'react'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  useUpdateEeNote,
} from './useUpdateEeNote'

import styles from './EeNotePaper.module.css'

interface EeNotePaperProps {
  item: PocketItemSummary
}

export function EeNotePaper({
  item,
}: EeNotePaperProps) {
  const [
    draft,
    setDraft,
  ] = useState(
    item.note || '',
  )

  const update =
    useUpdateEeNote(
      item.id,
    )

  useEffect(
    () => {
      setDraft(
        item.note || '',
      )
    },
    [
      item.id,
      item.note,
    ],
  )

  function save() {
    if (update.isPending) {
      return
    }

    update.mutate(
      draft,
      {
        onSuccess:
          (updatedItem) => {
            setDraft(
              updatedItem.note
              || '',
            )
          },
      },
    )
  }

  function remove() {
    if (
      update.isPending
      || !item.note
    ) {
      return
    }

    update.mutate(
      '',
      {
        onSuccess:
          (updatedItem) => {
            setDraft(
              updatedItem.note
              || '',
            )
          },
      },
    )
  }

  const hasNote =
    Boolean(
      item.note
      && item.note.trim(),
    )

  return (
    <aside
      className={styles.paper}
      aria-labelledby={
        `ee-note-title-${item.id}`
      }
    >
      <p
        id={`ee-note-title-${item.id}`}
        className={styles.kicker}
      >
        {hasNote
          ? '伊伊留的一句'
          : '留一句给阿栖'}
      </p>

      <form
        className={styles.form}
        onSubmit={
          (event) => {
            event.preventDefault()
            save()
          }
        }
      >
        <label
          className={styles.visuallyHidden}
          htmlFor={
            `ee-note-${item.id}`
          }
        >
          EE Note
        </label>

        <textarea
          id={`ee-note-${item.id}`}
          name="note"
          className={styles.input}
          value={draft}
          rows={4}
          disabled={
            update.isPending
          }
          placeholder="在这里留一句……"
          onChange={
            (event) => {
              setDraft(
                event.target.value,
              )

              if (
                update.isSuccess
                || update.isError
              ) {
                update.reset()
              }
            }
          }
        />

        <div
          className={styles.actions}
        >
          {hasNote && (
            <button
              type="button"
              className={
                styles.removeAction
              }
              disabled={
                update.isPending
              }
              onClick={remove}
            >
              移除这句
            </button>
          )}

          <button
            type="submit"
            className={
              styles.saveAction
            }
            disabled={
              update.isPending
            }
          >
            {hasNote
              ? '改好这句'
              : '夹进抽屉'}
          </button>
        </div>
      </form>

      <p
        className={styles.feedback}
        aria-live="polite"
      >
        {update.isPending
          ? '正在夹好……'
          : update.isError
            ? (
              update.error.message
              || '这句暂时没有夹好。'
            )
            : update.isSuccess
              ? (
                update.data.note
                  ? '夹好了。'
                  : '已经移除。'
              )
              : ''}
      </p>
    </aside>
  )
}
