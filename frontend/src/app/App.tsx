import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  useQueryClient,
} from '@tanstack/react-query'

import {
  pocketQueryKeys,
} from '../api/queryKeys'

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
  isCurrentInspectItem,
} from '../features/inspect/inspectPresentationLogic'

import type {
  CabinetSlot,
} from '../types/pocket'

import {
  drawerHistoryUrl,
  readDrawerHistoryEntry,
  readDrawerItemDeepLink,
  resolveInitialDrawerHistoryEntry,
  withDrawerHistoryEntry,
  type ArchiveSnapshot,
  type DrawerHistoryEntry,
} from './drawerNavigation'

import {
  useArchiveOutsideDismiss,
} from './useArchiveOutsideDismiss'

import styles from './App.module.css'

export function App() {
  const queryClient =
    useQueryClient()

  const initialHistoryEntryRef =
    useRef(
      resolveInitialDrawerHistoryEntry(
        window.history.state,
        window.location.search,
      ),
    )

  const initialHistoryEntry =
    initialHistoryEntryRef.current

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
      initialHistoryEntry
      && initialHistoryEntry.view
        !== 'cabinet'
        ? initialHistoryEntry.slot
        : null,
    )

  const [
    activeItemId,
    setActiveItemId,
  ] =
    useState<string | null>(
      initialHistoryEntry?.view
        === 'inspect'
        ? initialHistoryEntry.itemId
        : null,
    )

  const activeItemIdRef =
    useRef<string | null>(null)

  activeItemIdRef.current = activeItemId

  const [
    presentedItemId,
    setPresentedItemId,
  ] =
    useState<string | null>(null)

  const [
    failedInspectItemId,
    setFailedInspectItemId,
  ] =
    useState<string | null>(null)

  const inspectPresented =
    activeItemId !== null
    && presentedItemId === activeItemId

  const [
    archiveCollection,
    setArchiveCollection,
  ] =
    useState(
      initialHistoryEntry
      && initialHistoryEntry.view
        !== 'cabinet'
        ? initialHistoryEntry.collection
        : '',
    )

  const [
    archiveSource,
    setArchiveSource,
  ] =
    useState(
      initialHistoryEntry
      && initialHistoryEntry.view
        !== 'cabinet'
        ? initialHistoryEntry.source
        : '',
    )

  const [
    archiveTag,
    setArchiveTag,
  ] =
    useState(
      initialHistoryEntry
      && initialHistoryEntry.view
        !== 'cabinet'
        ? initialHistoryEntry.tag
        : '',
    )

  const archiveSnapshot =
    useCallback((
      slot: CabinetSlot,
      scrollY = window.scrollY,
    ): ArchiveSnapshot => ({
      slot,
      collection: archiveCollection,
      source: archiveSource,
      tag: archiveTag,
      scrollY,
    }), [
      archiveCollection,
      archiveSource,
      archiveTag,
    ])

  function replaceHistory(
    entry: DrawerHistoryEntry,
  ) {
    window.history.replaceState(
      withDrawerHistoryEntry(
        window.history.state,
        entry,
      ),
      '',
      drawerHistoryUrl(
        window.location.pathname,
        window.location.search,
        window.location.hash,
        entry,
      ),
    )
  }

  function pushHistory(
    entry: DrawerHistoryEntry,
  ) {
    window.history.pushState(
      withDrawerHistoryEntry(
        window.history.state,
        entry,
      ),
      '',
      drawerHistoryUrl(
        window.location.pathname,
        window.location.search,
        window.location.hash,
        entry,
      ),
    )
  }

  const applyHistoryEntry =
    useCallback((
      entry: DrawerHistoryEntry,
    ) => {
      setPresentedItemId(null)
      setFailedInspectItemId(null)

      if (entry.view === 'cabinet') {
        const previousSlot =
          activeSlot

        setActiveItemId(null)
        setActiveSlot(null)
        setArchiveCollection('')
        setArchiveSource('')
        setArchiveTag('')

        window.requestAnimationFrame(() => {
          window.scrollTo(0, 0)

          document
            .querySelector<HTMLElement>(
              previousSlot
                ? `[data-cabinet-slot="${previousSlot}"]`
                : '[data-cabinet-focus-fallback]',
            )
            ?.focus({ preventScroll: true })
        })

        return
      }

      setActiveSlot(entry.slot)
      setArchiveCollection(entry.collection)
      setArchiveSource(entry.source)
      setArchiveTag(entry.tag)
      inspectScrollYRef.current =
        entry.scrollY

      if (entry.view === 'inspect') {
        setActiveItemId(entry.itemId)
        return
      }

      setActiveItemId(null)

      window.requestAnimationFrame(() => {
        window.scrollTo(0, entry.scrollY)

        const origin =
          inspectFocusReturnRef.current

        const fallback =
          document.querySelector<HTMLElement>(
            '[data-archive-focus-fallback]',
          )

        if (origin?.isConnected) {
          origin.focus({ preventScroll: true })
        } else {
          fallback?.focus({ preventScroll: true })
        }

        inspectFocusReturnRef.current = null
      })
    }, [activeSlot])

  const applyHistoryEntryRef =
    useRef(applyHistoryEntry)
  applyHistoryEntryRef.current =
    applyHistoryEntry

  useEffect(() => {
    const initial =
      initialHistoryEntryRef.current
    const linkedItemId =
      readDrawerItemDeepLink(
        window.location.search,
      )
    const savedEntry =
      readDrawerHistoryEntry(
        window.history.state,
      )

    if (
      linkedItemId
      && initial?.view === 'inspect'
      && (
        savedEntry?.view !== 'inspect'
        || savedEntry.itemId !== linkedItemId
      )
    ) {
      // Place an Archive entry behind a newly opened deep link.
      // Back should return to Drawer, not unexpectedly leave the site.
      replaceHistory({
        version: 1,
        view: 'archive',
        slot: 'all',
        collection: '',
        source: '',
        tag: '',
        scrollY: 0,
      })
      pushHistory(initial)
    } else if (
      !initial
      || (
        new URLSearchParams(
          window.location.search,
        ).has('item')
        && !linkedItemId
      )
    ) {
      // Strip malformed query IDs without opening stale history state.
      replaceHistory(
        initial ?? {
          version: 1,
          view: 'cabinet',
        },
      )
    }

    const previousRestoration =
      window.history.scrollRestoration

    window.history.scrollRestoration =
      'manual'

    const onPopState = (
      event: PopStateEvent,
    ) => {
      const entry =
        resolveInitialDrawerHistoryEntry(
          event.state,
          window.location.search,
        )

      if (entry) {
        applyHistoryEntryRef.current(
          entry,
        )
      }
    }

    window.addEventListener(
      'popstate',
      onPopState,
    )

    return () => {
      window.removeEventListener(
        'popstate',
        onPopState,
      )
      window.history.scrollRestoration =
        previousRestoration
    }
  }, [])

  function resetArchiveIndex() {
    setArchiveCollection('')
    setArchiveSource('')
    setArchiveTag('')
  }

  function openDrawer(
    slot: CabinetSlot,
  ) {
    resetArchiveIndex()
    pushHistory({
      version: 1,
      view: 'archive',
      slot,
      collection: '',
      source: '',
      tag: '',
      scrollY: 0,
    })
    setActiveSlot(slot)
  }

  function returnToCabinet() {
    const current =
      readDrawerHistoryEntry(
        window.history.state,
      )

    if (current?.view === 'archive') {
      window.history.back()
      return
    }

    const cabinet: DrawerHistoryEntry = {
      version: 1,
      view: 'cabinet',
    }

    replaceHistory(cabinet)
    applyHistoryEntry(cabinet)
  }

  function inspectItem(
    itemId: string,
    trigger: HTMLButtonElement,
  ) {
    // Preserve the triggering paper for focus restoration on Back.
    // Keep its focus during media loading; the archive only becomes
    // inert when Inspect is ready to take focus.
    inspectFocusReturnRef.current =
      trigger

    inspectScrollYRef.current =
      window.scrollY

    if (activeSlot) {
      replaceHistory({
        version: 1,
        view: 'archive',
        ...archiveSnapshot(
          activeSlot,
          inspectScrollYRef.current,
        ),
      })

      pushHistory({
        version: 1,
        view: 'inspect',
        itemId,
        ...archiveSnapshot(
          activeSlot,
          inspectScrollYRef.current,
        ),
      })
    }

    setPresentedItemId(null)
    setFailedInspectItemId(null)
    setActiveItemId(itemId)
  }

  const presentInspect =
    useCallback((itemId: string) => {
      if (!isCurrentInspectItem(
        activeItemIdRef.current,
        itemId,
      )) {
        return
      }

      setFailedInspectItemId(null)
      setPresentedItemId(itemId)
    }, [])

  const failInspect =
    useCallback((itemId: string) => {
      if (!isCurrentInspectItem(
        activeItemIdRef.current,
        itemId,
      )) {
        return
      }

      setPresentedItemId(null)
      setFailedInspectItemId(itemId)
    }, [])

  const retryInspect =
    useCallback((itemId: string) => {
      if (!isCurrentInspectItem(
        activeItemIdRef.current,
        itemId,
      )) {
        return
      }

      setPresentedItemId(null)
      setFailedInspectItemId(null)

      void queryClient.refetchQueries({
        queryKey:
          pocketQueryKeys.item(itemId),
        exact: true,
      })
    }, [queryClient])

  function returnToDrawer() {
    const current =
      readDrawerHistoryEntry(
        window.history.state,
      )

    if (current?.view === 'inspect') {
      window.history.back()
      return
    }

    if (!activeSlot) {
      returnToCabinet()
      return
    }

    const archive: DrawerHistoryEntry = {
      version: 1,
      view: 'archive',
      ...archiveSnapshot(
        activeSlot,
        inspectScrollYRef.current,
      ),
    }

    replaceHistory(archive)
    applyHistoryEntry(archive)
  }

  useEffect(() => {
    if (!activeSlot) {
      return
    }

    const current =
      readDrawerHistoryEntry(
        window.history.state,
      )

    if (
      !current
      || current.view === 'cabinet'
    ) {
      return
    }

    replaceHistory({
      ...current,
      ...archiveSnapshot(
        activeSlot,
        current.view === 'inspect'
          ? inspectScrollYRef.current
          : window.scrollY,
      ),
    })
  }, [
    activeSlot,
    archiveCollection,
    archiveSource,
    archiveTag,
    archiveSnapshot,
  ])

  useEffect(() => {
    if (
      !activeSlot
      || activeItemId
    ) {
      return
    }

    let frame = 0

    const saveArchiveScroll = () => {
      if (frame) {
        return
      }

      frame = window.requestAnimationFrame(
        () => {
          frame = 0

          const current =
            readDrawerHistoryEntry(
              window.history.state,
            )

          if (current?.view !== 'archive') {
            return
          }

          replaceHistory({
            ...current,
            ...archiveSnapshot(
              activeSlot,
              window.scrollY,
            ),
          })
        },
      )
    }

    window.addEventListener(
      'scroll',
      saveArchiveScroll,
      { passive: true },
    )

    return () => {
      window.removeEventListener(
        'scroll',
        saveArchiveScroll,
      )

      if (frame) {
        window.cancelAnimationFrame(frame)
      }
    }
  }, [
    activeItemId,
    activeSlot,
    archiveSnapshot,
  ])

  useArchiveOutsideDismiss(
    Boolean(
      activeSlot
      && !activeItemId,
    ),
    returnToCabinet,
  )

  return (
    <main className={styles.shell}>
      <header
        className={styles.header}
        data-archive-dismiss-ignore
        data-cabinet-home={
          !activeItemId
          && !activeSlot
            ? 'true'
            : undefined
        }
        data-archive-home={
          !inspectPresented
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
          // `inert` covers both keyboard and accessibility exclusion.
          // Unlike aria-hidden, it safely handles focus left on an
          // archive paper when browser history opens Inspect.
          inert={
            inspectPresented
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
            activeInspectItemId={
              activeItemId
            }
            failedInspectItemId={
              failedInspectItemId
            }
            presentedInspectItemId={
              presentedItemId
            }
            onRetryInspect={retryInspect}
          />
        </div>
      )}

      {activeItemId ? (
        <InspectStage
          itemId={activeItemId}
          presented={inspectPresented}
          onPresentationReady={
            presentInspect
          }
          onPresentationError={
            failInspect
          }
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
