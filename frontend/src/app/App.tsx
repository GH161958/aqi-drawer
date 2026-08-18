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

import type {
  CabinetSlot,
} from '../types/pocket'

import styles from './App.module.css'

export function App() {
  const [
    activeSlot,
    setActiveSlot,
  ] = useState<CabinetSlot | null>(
    null,
  )

  const [
    activeItemId,
    setActiveItemId,
  ] = useState<string | null>(
    null,
  )

  function returnToCabinet() {
    setActiveItemId(null)
    setActiveSlot(null)
  }

  function returnToDrawer() {
    setActiveItemId(null)
  }

  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.kicker}>
          things EE left for Aqi
        </p>

        <h1 className={styles.title}>
          Aqi Drawer
        </h1>
      </header>

      {activeItemId ? (
        <InspectStage
          itemId={activeItemId}
          onBack={returnToDrawer}
        />
      ) : activeSlot ? (
        <ArchiveDrawer
          slot={activeSlot}
          onBack={returnToCabinet}
          onInspect={
            setActiveItemId
          }
        />
      ) : (
        <CabinetHome
          activeSlot={null}
          onOpen={setActiveSlot}
        />
      )}
    </main>
  )
}
