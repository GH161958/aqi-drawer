import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  ReplySlip,
} from './ReplySlip'

import {
  useHideReply,
} from './useHideReply'

import styles from './ReplyStack.module.css'

interface ReplyStackProps {
  item: PocketItemSummary
}

export function ReplyStack({
  item,
}: ReplyStackProps) {
  const hide =
    useHideReply(
      item.id,
    )

  const replies =
    Array.isArray(
      item.replies,
    )
      ? item.replies
      : []

  if (!replies.length) {
    return null
  }

  const pendingReplyId =
    hide.isPending
      ? hide.variables?.replyId
      : undefined

  return (
    <section
      className={styles.stack}
      aria-labelledby={
        `reply-stack-${item.id}`
      }
    >
      <header
        className={
          styles.stackHeader
        }
      >
        <p
          id={
            `reply-stack-${item.id}`
          }
          className={
            styles.stackTitle
          }
        >
          REPLY SLIPS
        </p>

        <span
          className={
            styles.count
          }
        >
          {String(
            replies.length,
          ).padStart(2, '0')}
        </span>
      </header>

      <div
        className={
          styles.papers
        }
      >
        {replies.map(
          (
            reply,
            index,
          ) => (
            <ReplySlip
              key={
                reply.id
                || `${index}-${
                  reply.createdAt
                  || ''
                }`
              }
              reply={reply}
              pending={
                Boolean(
                  reply.id
                  && pendingReplyId
                    === reply.id,
                )
              }
              onHide={
                (replyId) =>
                  hide.mutate({
                    replyId,
                  })
              }
            />
          ),
        )}
      </div>

      <p
        className={
          styles.feedback
        }
        aria-live="polite"
      >
        {hide.isError
          ? (
            hide.error.message
            || '这张暂时收不起来。'
          )
          : ''}
      </p>
    </section>
  )
}
