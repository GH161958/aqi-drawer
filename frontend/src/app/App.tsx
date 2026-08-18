import {
  useState,
} from 'react'

import {
  ArchiveDrawer,
} from '../features/archive/ArchiveDrawer'

import {
  CabinetHome,
} from '../features/cabinet/CabinetHome'

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

      {activeSlot === null ? (
        <CabinetHome
          activeSlot={null}
          onOpen={setActiveSlot}
        />
      ) : (
        <ArchiveDrawer
          slot={activeSlot}
          onBack={() =>
            setActiveSlot(null)
          }
        />
      )}
    </main>
  )
}
