import {
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  applyTypePreset,
  clearTypePreset,
  DEFAULT_TYPE_PRESET,
  preloadTypeCabinet,
  readTypePreset,
  storeTypePreset,
  TYPE_PRESET_NAMES,
  TYPE_PRESETS,
  type TypePresetName,
} from './typeCabinetLogic'

import styles from './TypeCabinet.module.css'

export function TypeCabinet() {
  const dialogRef =
    useRef<HTMLDialogElement>(
      null,
    )

  const triggerRef =
    useRef<HTMLButtonElement>(
      null,
    )

  const [
    committedPreset,
    setCommittedPreset,
  ] =
    useState<TypePresetName>(
      readTypePreset,
    )

  const [
    draftPreset,
    setDraftPreset,
  ] =
    useState<TypePresetName>(
      committedPreset,
    )

  const [
    status,
    setStatus,
  ] =
    useState('')

  useEffect(() => {
    applyTypePreset(
      committedPreset,
    )
  }, [committedPreset])

  function openCabinet() {
    preloadTypeCabinet()

    setDraftPreset(
      committedPreset,
    )

    applyTypePreset(
      committedPreset,
    )

    setStatus('')

    const dialog =
      dialogRef.current

    if (
      dialog
      && !dialog.open
    ) {
      dialog.showModal()

      window.requestAnimationFrame(
        () => {
          dialog.focus({
            preventScroll: true,
          })
        },
      )
    }
  }

  function dismissCabinet() {
    applyTypePreset(
      committedPreset,
    )

    setDraftPreset(
      committedPreset,
    )

    setStatus('')

    const dialog =
      dialogRef.current

    if (dialog?.open) {
      dialog.close()
    }

    triggerRef.current
      ?.focus({
        preventScroll: true,
      })
  }

  function tryPreset(
    preset: TypePresetName,
  ) {
    setDraftPreset(preset)

    applyTypePreset(preset)

    setStatus(
      `${TYPE_PRESETS[preset].label} 正在试穿。`,
    )
  }

  function wearPreset() {
    storeTypePreset(
      draftPreset,
    )

    setCommittedPreset(
      draftPreset,
    )

    applyTypePreset(
      draftPreset,
    )

    setStatus(
      '这套字已经穿好了。',
    )

    window.setTimeout(
      () => {
        const dialog =
          dialogRef.current

        if (dialog?.open) {
          dialog.close()
        }

        triggerRef.current
          ?.focus({
            preventScroll: true,
          })
      },
      160,
    )
  }

  function restorePreset() {
    clearTypePreset()

    setCommittedPreset(
      DEFAULT_TYPE_PRESET,
    )

    setDraftPreset(
      DEFAULT_TYPE_PRESET,
    )

    applyTypePreset(
      DEFAULT_TYPE_PRESET,
    )

    setStatus(
      '已经恢复原样。',
    )
  }

  const manifest =
    TYPE_PRESETS[draftPreset]

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={
          styles.trigger
        }
        aria-label="打开字体试衣间"
        title="Type Cabinet"
        onClick={
          openCabinet
        }
      >
        <span
          className={
            styles.triggerDot
          }
          aria-hidden="true"
        />
      </button>

      <dialog
        ref={dialogRef}
        tabIndex={-1}
        className={
          styles.dialog
        }
        aria-labelledby="type-cabinet-title"
        onClick={
          (event) => {
            if (
              event.target
              === dialogRef.current
            ) {
              dismissCabinet()
            }
          }
        }
        onCancel={
          (event) => {
            event.preventDefault()
            dismissCabinet()
          }
        }
      >
        <section
          className={
            styles.sheet
          }
        >
          <button
            type="button"
            className={
              styles.close
            }
            aria-label="放回字体样张"
            onClick={
              dismissCabinet
            }
          >
            放回
          </button>

          <p
            className={
              styles.kicker
            }
          >
            TYPE CABINET
          </p>

          <h2
            id="type-cabinet-title"
            className={
              styles.title
            }
          >
            字体试衣间
          </h2>

          <div
            className={
              styles.specimen
            }
            aria-live="polite"
          >
            <p
              className={
                styles.specimenDisplay
              }
            >
              Aqi Drawer
            </p>

            <p
              className={
                styles.specimenHeading
              }
            >
              第一次投喂测试
            </p>

            <p
              className={
                styles.specimenBody
              }
            >
              如果阿栖能看到这句话，
              就说明我们的抽屉真的接通啦 ovo
            </p>

            <p
              className={
                styles.specimenMeta
              }
            >
              伊伊手动投喂 · 2026.08.15 · No.001
            </p>
          </div>

          <div
            className={
              styles.presets
            }
            role="group"
            aria-labelledby="type-preset-label"
          >
            <p
              id="type-preset-label"
              className={
                styles.presetsLabel
              }
            >
              选择一套字
            </p>

            {TYPE_PRESET_NAMES.map(
              (presetName) => {
                const preset =
                  TYPE_PRESETS[
                    presetName
                  ]

                const selected =
                  draftPreset
                  === presetName

                return (
                  <button
                    key={
                      preset.id
                    }
                    type="button"
                    className={
                      styles.preset
                    }
                    data-selected={
                      selected
                        ? 'true'
                        : undefined
                    }
                    aria-pressed={
                      selected
                    }
                    onClick={() =>
                      tryPreset(
                        presetName,
                      )
                    }
                  >
                    <span
                      className={
                        styles.presetIndex
                      }
                    >
                      {preset.index}
                    </span>

                    <strong>
                      {preset.label}
                    </strong>

                    <small>
                      {preset.display}
                      {' / '}
                      {preset.cjk}
                    </small>
                  </button>
                )
              },
            )}
          </div>

          <dl
            className={
              styles.manifest
            }
          >
            <div>
              <dt>DISPLAY</dt>
              <dd>
                {manifest.display}
              </dd>
            </div>

            <div>
              <dt>CJK</dt>
              <dd>
                {manifest.cjk}
              </dd>
            </div>

            <div>
              <dt>BODY</dt>
              <dd>
                {manifest.body}
              </dd>
            </div>

            <div>
              <dt>META</dt>
              <dd>
                {manifest.meta}
              </dd>
            </div>
          </dl>

          <div
            className={
              styles.actions
            }
          >
            <button
              type="button"
              onClick={
                wearPreset
              }
            >
              穿上这套
            </button>

            <button
              type="button"
              onClick={
                restorePreset
              }
            >
              恢复原样
            </button>
          </div>

          <p
            className={
              styles.status
            }
            aria-live="polite"
          >
            {status}
          </p>
        </section>
      </dialog>
    </>
  )
}
