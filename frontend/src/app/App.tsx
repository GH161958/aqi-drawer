import {
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

import {
  TypeCabinet,
} from '../features/type-cabinet/TypeCabinet'

import type {
  CabinetSlot,
} from '../types/pocket'

import styles from './App.module.css'

export function App() {
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

  function returnToDrawer() {
    setActiveItemId(null)
  }

  return (
    <main className={styles.shell}>
      <header
        className={styles.header}
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

        <TypeCabinet />
      </header>

      {activeItemId ? (
        <InspectStage
          itemId={activeItemId}
          originSlot={
            activeSlot ?? 'all'
          }
          onBack={returnToDrawer}
        />
      ) : activeSlot ? (
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
          onInspect={
            setActiveItemId
          }
        />
      ) : (
        <CabinetHome
          activeSlot={null}
          onOpen={openDrawer}
        />
      )}
    </main>
  )
}
