import {
  useState,
} from 'react'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import {
  ReplySlip,
} from './ReplySlip'

import {
  useHideReply,
} from './useHideReply'

import {
  useRestoreReply,
} from './useRestoreReply'

import styles from './ReplyStack.module.css'

interface ReplyStackProps {
  item: PocketItemSummary
}

export function ReplyStack({
  item,
}: ReplyStackProps) {
  const [
    showHidden,
    setShowHidden,
  ] = useState(false)

  const hide =
    useHideReply(
      item.id,
    )

  const restore =
    useRestoreReply(
      item.id,
    )

  const replies =
    Array.isArray(
      item.replies,
    )
      ? item.replies
      : []

  const hiddenReplies =
    Array.isArray(
      item.hiddenReplies,
    )
      ? item.hiddenReplies
      : []

  if (
    !replies.length
    && !hiddenReplies.length
  ) {
    return null
  }

  const pendingReplyId =
    hide.isPending
      ? hide.variables?.replyId
      : undefined

  const restoringReplyId =
    restore.isPending
      ? restore.variables?.replyId
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

      {replies.length > 0 && (
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
      )}

      {hiddenReplies.length > 0 && (
        <div
          className={
            styles.hiddenSection
          }
        >
          <button
            type="button"
            className={
              styles.hiddenToggle
            }
            aria-expanded={
              showHidden
            }
            onClick={
              () =>
                setShowHidden(
                  (current) =>
                    !current,
                )
            }
          >
            <span>
              收起的回复 ·{' '}
              {String(
                hiddenReplies.length,
              ).padStart(2, '0')}
            </span>

            <span
              aria-hidden="true"
            >
              {showHidden
                ? '收好'
                : '看看'}
            </span>
          </button>

          {showHidden && (
            <div
              className={
                styles.hiddenTray
              }
            >
              {hiddenReplies.map(
                (
                  reply,
                  index,
                ) => {
                  const replyId =
                    reply.id

                  const text =
                    reply.text
                    || reply.content
                    || '没有正文的回条'

                  return (
                    <article
                      key={
                        replyId
                        || `hidden-${index}`
                      }
                      className={
                        styles.hiddenPaper
                      }
                    >
                      <div
                        className={
                          styles.hiddenMeta
                        }
                      >
                        <span>
                          {reply.author
                            || 'Aqi'}
                        </span>

                        {reply.createdAt && (
                          <time>
                            {new Date(
                              reply.createdAt,
                            ).toLocaleDateString()}
                          </time>
                        )}
                      </div>

                      <p
                        className={
                          styles.hiddenText
                        }
                      >
                        {text}
                      </p>

                      {replyId && (
                        <button
                          type="button"
                          className={
                            styles.restoreAction
                          }
                          disabled={
                            restore.isPending
                          }
                          onClick={
                            () =>
                              restore.mutate({
                                replyId,
                              })
                          }
                        >
                          {restoringReplyId
                            === replyId
                            ? '正在放回来…'
                            : '放回来'}
                        </button>
                      )}
                    </article>
                  )
                },
              )}
            </div>
          )}
        </div>
      )}

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
          : restore.isError
            ? (
              restore.error.message
              || '这张暂时放不回来。'
            )
            : ''}
      </p>
    </section>
  )
}
