import {
  useRef,
  useState,
} from 'react'

import {
  ArchiveDrawer,
} from '../features/archive/ArchiveDrawer'

import {
  CabinetHome,
} from '../features/cabinet/CabinetHome'

import {
  InspectStage,
} from '../features/inspect/InspectStage'

import type {
  CabinetSlot,
} from '../types/pocket'

import styles from './App.module.css'

export function App() {
  const inspectFocusReturnRef =
    useRef<HTMLButtonElement | null>(
      null,
    )

  const inspectScrollYRef =
    useRef(0)

  const [
    activeSlot,
    setActiveSlot,
  ] =
    useState<CabinetSlot | null>(
      null,
    )

  const [
    activeItemId,
    setActiveItemId,
  ] =
    useState<string | null>(
      null,
    )

  const [
    archiveCollection,
    setArchiveCollection,
  ] =
    useState('')

  const [
    archiveSource,
    setArchiveSource,
  ] =
    useState('')

  const [
    archiveTag,
    setArchiveTag,
  ] =
    useState('')

  function resetArchiveIndex() {
    setArchiveCollection('')
    setArchiveSource('')
    setArchiveTag('')
  }

  function openDrawer(
    slot: CabinetSlot,
  ) {
    resetArchiveIndex()
    setActiveSlot(slot)
  }

  function returnToCabinet() {
    setActiveItemId(null)
    setActiveSlot(null)

    resetArchiveIndex()
  }

  function inspectItem(
    itemId: string,
    trigger: HTMLButtonElement,
  ) {
    inspectFocusReturnRef.current =
      trigger

    inspectScrollYRef.current =
      window.scrollY

    setActiveItemId(itemId)
  }

  function returnToDrawer() {
    setActiveItemId(null)

    window.requestAnimationFrame(
      () => {
        window.scrollTo(
          0,
          inspectScrollYRef.current,
        )

        const origin =
          inspectFocusReturnRef.current

        const fallback =
          document.querySelector<HTMLElement>(
            '[data-archive-focus-fallback]',
          )

        if (origin?.isConnected) {
          origin.focus({
            preventScroll: true,
          })
        } else {
          fallback?.focus({
            preventScroll: true,
          })
        }

        inspectFocusReturnRef.current =
          null

      },
    )
  }

  return (
    <main className={styles.shell}>
      <header
        className={styles.header}
        data-cabinet-home={
          !activeItemId
          && !activeSlot
            ? 'true'
            : undefined
        }
        data-archive-home={
          !activeItemId
          && activeSlot
            ? 'true'
            : undefined
        }
      >
        <p
          className={styles.kicker}
        >
          things EE left for Aqi
        </p>

        <h1
          className={styles.title}
        >
          Aqi Drawer
        </h1>

      </header>

      {activeSlot && (
        <div
          aria-hidden={
            activeItemId
              ? true
              : undefined
          }
          inert={
            activeItemId
              ? true
              : undefined
          }
        >
          <ArchiveDrawer
            slot={activeSlot}
            collectionFilter={
              archiveCollection
            }
            sourceFilter={
              archiveSource
            }
            tagFilter={
              archiveTag
            }
            onCollectionFilterChange={
              setArchiveCollection
            }
            onSourceFilterChange={
              setArchiveSource
            }
            onTagFilterChange={
              setArchiveTag
            }
            onBack={
              returnToCabinet
            }
            onInspect={inspectItem}
          />
        </div>
      )}

      {activeItemId ? (
        <InspectStage
          itemId={activeItemId}
          onBack={returnToDrawer}
        />
      ) : !activeSlot ? (
        <CabinetHome
          activeSlot={null}
          onOpen={openDrawer}
        />
      ) : null}
    </main>
  )
}
