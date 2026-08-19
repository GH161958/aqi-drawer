import {
  type FormEvent,
  type PropsWithChildren,
  useEffect,
  useState,
} from 'react'

import {
  useQueryClient,
} from '@tanstack/react-query'

import {
  drawerAuthRequiredEvent,
} from './authEvents'

import {
  getDrawerSession,
  openDrawerSession,
} from './session'

import styles from './AuthGate.module.css'

type AuthState =
  | 'checking'
  | 'open'
  | 'locked'

export function AuthGate({
  children,
}: PropsWithChildren) {
  const queryClient =
    useQueryClient()

  const [
    authState,
    setAuthState,
  ] =
    useState<AuthState>(
      'checking',
    )

  const [
    secret,
    setSecret,
  ] =
    useState('')

  const [
    feedback,
    setFeedback,
  ] =
    useState('')

  const [
    submitting,
    setSubmitting,
  ] =
    useState(false)

  const [
    formVisible,
    setFormVisible,
  ] =
    useState(true)

  useEffect(() => {
    let active = true

    void getDrawerSession()
      .then(
        (authenticated) => {
          if (!active) {
            return
          }

          setAuthState(
            authenticated
              ? 'open'
              : 'locked',
          )

          setFormVisible(
            !authenticated,
          )
        },
      )
      .catch(() => {
        if (!active) {
          return
        }

        setAuthState(
          'locked',
        )

        setFormVisible(true)

        setFeedback(
          '暂时无法确认这只抽屉的身份。',
        )
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    function requireAuth() {
      setAuthState(
        'locked',
      )

      setFormVisible(true)

      setFeedback(
        '这只抽屉需要先确认身份。',
      )
    }

    window.addEventListener(
      drawerAuthRequiredEvent,
      requireAuth,
    )

    return () => {
      window.removeEventListener(
        drawerAuthRequiredEvent,
        requireAuth,
      )
    }
  }, [])

  async function submit(
    event: FormEvent,
  ) {
    event.preventDefault()

    if (
      !secret.trim()
      || submitting
    ) {
      return
    }

    setSubmitting(true)

    setFeedback(
      '正在打开……',
    )

    try {
      await openDrawerSession(
        secret,
      )

      setSecret('')
      setFeedback('')
      setFormVisible(false)

      setAuthState(
        'open',
      )

      await queryClient
        .invalidateQueries()
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : '暂时无法连接当前网站。',
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (
    authState === 'checking'
  ) {
    return (
      <main
        className={
          styles.checking
        }
      >
        <p>
          正在确认私人抽屉……
        </p>
      </main>
    )
  }

  if (
    authState === 'open'
  ) {
    return children
  }

  return (
    <main
      className={styles.locked}
    >
      <section
        className={
          styles.lockPaper
        }
        aria-labelledby="drawer-auth-title"
      >
        <p
          className={styles.kicker}
        >
          PRIVATE DRAWER
        </p>

        <h1
          id="drawer-auth-title"
          className={styles.title}
        >
          打开私人抽屉
        </h1>

        {formVisible ? (
          <form
            className={styles.form}
            onSubmit={submit}
          >
            <label
              className={styles.label}
            >
              <span>
                Drawer secret
              </span>

              <input
                type="password"
                value={secret}
                autoComplete="current-password"
                required
                disabled={
                  submitting
                }
                onChange={
                  (event) =>
                    setSecret(
                      event
                        .target
                        .value,
                    )
                }
              />
            </label>

            <div
              className={
                styles.actions
              }
            >
              <button
                type="submit"
                disabled={
                  submitting
                  || !secret.trim()
                }
              >
                {submitting
                  ? '正在打开……'
                  : '打开'}
              </button>

              <button
                type="button"
                disabled={
                  submitting
                }
                onClick={() => {
                  setFormVisible(
                    false,
                  )

                  setFeedback('')
                }}
              >
                稍后
              </button>
            </div>

            {feedback && (
              <p
                className={
                  styles.feedback
                }
                aria-live="polite"
              >
                {feedback}
              </p>
            )}
          </form>
        ) : (
          <div
            className={
              styles.waiting
            }
          >
            <p>
              柜子先安静地关着。
            </p>

            <button
              type="button"
              onClick={() => {
                setFormVisible(
                  true,
                )

                setFeedback('')
              }}
            >
              打开私人抽屉
            </button>
          </div>
        )}
      </section>
    </main>
  )
}
