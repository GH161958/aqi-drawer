import {
  useState,
} from 'react'

import {
  CabinetHome,
} from '../features/cabinet/CabinetHome'

import {
  cabinetSlotLabels,
} from '../features/cabinet/cabinet'

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

      <CabinetHome
        activeSlot={activeSlot}
        onOpen={setActiveSlot}
      />

      <p className={styles.migrationNote}>
        {activeSlot
          ? `「${
              cabinetSlotLabels[
                activeSlot
              ]
            }」已经接通。下一箱会把里面的纸也搬进来。`
          : 'Cabinet HOME 已经住进 React 新家。'}
      </p>
    </main>
  )
}
