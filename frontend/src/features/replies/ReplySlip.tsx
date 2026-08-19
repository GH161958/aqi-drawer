import {
  useEffect,
  useState,
} from 'react'

import type {
  PocketReplySummary,
} from '../../types/pocket'

import styles from './ReplySlip.module.css'

interface ReplySlipProps {
  reply: PocketReplySummary

  pending: boolean

  onHide:
    (replyId: string) => void
}

function formatReplyDate(
  value?: string,
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
    'en-GB',
    {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    },
  )
    .format(date)
    .toUpperCase()
}

function sourceLabel(
  value?: string,
): string {
  if (!value) {
    return ''
  }

  if (value === 'chatgpt') {
    return 'CHATGPT'
  }

  if (value === 'aqi-drawer') {
    return 'AQI DRAWER'
  }

  if (value === 'shortcut') {
    return 'SHORTCUT'
  }

  return value.toUpperCase()
}

export function ReplySlip({
  reply,
  pending,
  onHide,
}: ReplySlipProps) {
  const [
    confirming,
    setConfirming,
  ] = useState(false)

  useEffect(() => {
    if (!pending) {
      return
    }

    setConfirming(false)
  }, [pending])

  const text =
    reply.text
    || reply.content
    || ''

  const author =
    reply.author === 'EE'
      ? 'EE 留了一张回条'
      : 'AQI LEFT A NOTE'

  const annotations = [
    formatReplyDate(
      reply.createdAt,
    ),

    sourceLabel(
      reply.source,
    ),
  ].filter(Boolean)

  return (
    <article
      className={styles.slip}
      data-author={
        reply.author === 'EE'
          ? 'ee'
          : 'aqi'
      }
    >
      <header
        className={styles.header}
      >
        <p
          className={styles.kicker}
        >
          {author}
        </p>

        {reply.id && !confirming && (
          <button
            type="button"
            className={
              styles.hideAction
            }
            disabled={pending}
            onClick={() =>
              setConfirming(true)
            }
          >
            {pending
              ? '正在收起…'
              : '收起这张'}
          </button>
        )}
      </header>

      <p className={styles.text}>
        {text}
      </p>

      {annotations.length > 0 && (
        <p
          className={
            styles.annotation
          }
        >
          {annotations.join(
            ' · ',
          )}
        </p>
      )}

      {reply.id && confirming && (
        <div
          className={
            styles.confirmation
          }
        >
          <p
            className={
              styles.confirmText
            }
          >
            收起后，这张回条不会再显示。
          </p>

          <div
            className={
              styles.confirmActions
            }
          >
            <button
              type="button"
              className={
                styles.confirmHide
              }
              disabled={pending}
              onClick={() =>
                onHide(reply.id!)
              }
            >
              {pending
                ? '正在收起…'
                : '确认收起'}
            </button>

            <button
              type="button"
              className={
                styles.cancelHide
              }
              disabled={pending}
              onClick={() =>
                setConfirming(false)
              }
            >
              算了
            </button>
          </div>
        </div>
      )}
    </article>
  )
}
