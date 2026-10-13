import {
  useRef,
  useState,
} from 'react'

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import {
  TrashDrawer,
} from '../trash/TrashDrawer'

import {
  deleteCollection,
  deleteTagEverywhere,
  listCollections,
  listTagVocabulary,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import {
  cabinetSlotLabels,
  formatCabinetCount,
} from '../cabinet/cabinet'

import type {
  CabinetSlot,
  PocketItemSummary,
} from '../../types/pocket'

import {
  useArchiveItems,
} from './useArchiveItems'

import {
  ItemPreview,
} from './ItemPreview'

import {
  ArchiveQuickActions,
} from './ArchiveQuickActions'

import {
  shouldFocusArchiveFallback,
} from './archiveQuickActionLogic'

import type {
  ArchiveQuickActionResult,
} from './archiveQuickActionLogic'

import {
  inspectPreviewState,
} from '../inspect/inspectPresentationLogic'

import {
  ArchiveIndex,
} from './ArchiveIndex'

import {
  applyArchiveIndexFilters,
  archiveIndexOptions,
} from './archiveIndexLogic'

import styles from './ArchiveDrawer.module.css'

interface ArchiveDrawerProps {
  slot: CabinetSlot

  collectionFilter: string
  sourceFilter: string
  tagFilter: string

  onCollectionFilterChange:
    (value: string) => void

  onSourceFilterChange:
    (value: string) => void

  onTagFilterChange:
    (value: string) => void

  onBack: () => void

  onInspect:
    (
      itemId: string,
      trigger: HTMLButtonElement,
    ) => void

  activeInspectItemId:
    string | null

  failedInspectItemId:
    string | null

  presentedInspectItemId:
    string | null

  onRetryInspect:
    (itemId: string) => void
}

export function ArchiveDrawer({
  slot,
  collectionFilter,
  sourceFilter,
  tagFilter,
  onCollectionFilterChange,
  onSourceFilterChange,
  onTagFilterChange,
  onBack,
  onInspect,
  activeInspectItemId,
  failedInspectItemId,
  presentedInspectItemId,
  onRetryInspect,
}: ArchiveDrawerProps) {
  const [quickActionItem, setQuickActionItem] =
    useState<PocketItemSummary | null>(null)

  const quickActionTriggerRef =
    useRef<HTMLButtonElement | null>(null)

  const queryClient =
    useQueryClient()

  const {
    items: drawerItems,
    isPending,
    isError,
  } = useArchiveItems(slot)

  const collectionsQuery =
    useQuery({
      queryKey: [
        'pocket',
        'collections',
      ],

      queryFn:
        listCollections,
    })

  const tagsQuery =
    useQuery({
      queryKey: [
        'pocket',
        'tags',
      ],

      queryFn:
        listTagVocabulary,
    })

  function refreshArchiveData() {
    void queryClient.invalidateQueries({
      queryKey:
        pocketQueryKeys.all,
    })

    void queryClient.invalidateQueries({
      queryKey: [
        'pocket',
        'collections',
      ],
    })

    void queryClient.invalidateQueries({
      queryKey: [
        'pocket',
        'tags',
      ],
    })
  }

  const collectionDelete =
    useMutation({
      mutationFn:
        (collection: string) =>
          deleteCollection(
            collection,
          ),

      onSuccess:
        (
          _result,
          collection,
        ) => {
          if (
            collectionFilter
            === collection
          ) {
            onCollectionFilterChange(
              '',
            )
          }

          refreshArchiveData()
        },
    })

  const tagDelete =
    useMutation({
      mutationFn:
        (tag: string) =>
          deleteTagEverywhere(
            tag,
          ),

      onSuccess:
        (
          _result,
          tag,
        ) => {
          if (
            tagFilter === tag
          ) {
            onTagFilterChange('')
          }

          refreshArchiveData()
        },
    })

  if (slot === 'trash') {
    return (
      <TrashDrawer
        onBack={onBack}
      />
    )
  }

  const label =
    cabinetSlotLabels[slot]

  const showIndex =
    slot === 'all'

  const indexOptions =
    archiveIndexOptions(
      drawerItems,
      collectionsQuery.data
        ?? [],
      tagsQuery.data
        ?? [],
    )

  const effectiveCollection =
    indexOptions.collections
      .includes(
        collectionFilter,
      )
      ? collectionFilter
      : ''

  const effectiveTag =
    indexOptions.tags
      .includes(
        tagFilter,
      )
      ? tagFilter
      : ''

  const effectiveSource =
    indexOptions.sources
      .includes(
        sourceFilter,
      )
      ? sourceFilter
      : ''

  const items =
    showIndex
      ? applyArchiveIndexFilters(
          drawerItems,
          effectiveCollection,
          effectiveSource,
          effectiveTag,
        )
      : drawerItems

  function openPreview(
    item: PocketItemSummary,
    trigger: HTMLButtonElement,
  ) {
    onInspect(item.id, trigger)
  }

  function openQuickActions(
    item: PocketItemSummary,
    trigger: HTMLButtonElement,
  ) {
    quickActionTriggerRef.current = trigger
    setQuickActionItem(item)
  }

  function closeQuickActions(
    preferFallback = false,
  ) {
    setQuickActionItem(null)

    window.requestAnimationFrame(() => {
      const trigger = quickActionTriggerRef.current
      const fallback =
        document.querySelector<HTMLElement>(
          '[data-archive-focus-fallback]',
        )

      if (
        !preferFallback
        && trigger?.isConnected
      ) {
        trigger.focus({ preventScroll: true })
      } else {
        fallback?.focus({ preventScroll: true })
      }

      quickActionTriggerRef.current = null
    })
  }

  function completeQuickAction(
    result: ArchiveQuickActionResult,
  ) {
    closeQuickActions(
      shouldFocusArchiveFallback({
        result,
        slot,
        collectionFilter: effectiveCollection,
      }),
    )
  }

  return (
    <section
      className={styles.view}
      aria-labelledby="archive-title"
      data-archive-focus-fallback
      tabIndex={-1}
    >
      <div
        className={styles.toolbar}
      >
        <p
          id="archive-title"
          className={styles.label}
          aria-label={
            !isPending
              ? `${label} · ${formatCabinetCount(
                  items.length,
                )}`
              : label
          }
        >
          {label}
        </p>
      </div>

      <section
        className={styles.shell}
        aria-live="polite"
        aria-busy={isPending}
      >
        <button
          type="button"
          className={styles.handle}
          aria-label="合上抽屉"
          onClick={onBack}
        >
          <span
            className={styles.handleGrip}
            aria-hidden="true"
          />
          <span
            className="visually-hidden"
          >
            合上抽屉
          </span>
        </button>

        {showIndex
          && !isPending
          && !isError && (
            <ArchiveIndex
              options={
                indexOptions
              }
              collection={
                effectiveCollection
              }
              tag={
                effectiveTag
              }
              source={
                effectiveSource
              }
              onCollectionChange={
                onCollectionFilterChange
              }
              onTagChange={
                onTagFilterChange
              }
              onSourceChange={
                onSourceFilterChange
              }
              onDeleteCollection={
                (collection) =>
                  collectionDelete
                    .mutate(
                      collection,
                    )
              }
              onDeleteTag={
                (tag) =>
                  tagDelete
                    .mutate(tag)
              }
              deletingCollection={
                collectionDelete
                  .isPending
              }
              deletingTag={
                tagDelete.isPending
              }
              deleteCollectionError={
                collectionDelete
                  .isError
                  ? collectionDelete
                      .error
                      .message
                  : ''
              }
              deleteTagError={
                tagDelete.isError
                  ? tagDelete
                      .error
                      .message
                  : ''
              }
            />
          )}

        {isPending && (
          <div
            className={styles.state}
          >
            正在轻轻拉开抽屉……
          </div>
        )}

        {isError && (
          <div
            className={styles.state}
          >
            抽屉暂时没有打开。
          </div>
        )}

        {!isPending
          && !isError
          && items.length === 0 && (
            <div
              className={
                styles.emptyPaper
              }
            >
              {showIndex
                && (
                  effectiveCollection
                  || effectiveTag
                  || effectiveSource
                )
                ? '这个目录组合里暂时没有纸。'
                : '这一格还是空的。'}
            </div>
          )}

        {!isPending
          && !isError
          && items.length > 0 && (
            <ol
              className={styles.list}
            >
              {items.map(
                (item) => (
                  <ItemPreview
                    key={item.id}
                    item={item}
                    onOpen={
                      openPreview
                    }
                    onQuickActions={
                      openQuickActions
                    }
                    inspectState={inspectPreviewState({
                      itemId: item.id,
                      activeItemId:
                        activeInspectItemId,
                      presentedItemId:
                        presentedInspectItemId,
                      failedItemId:
                        failedInspectItemId,
                    })}
                    onRetryInspect={
                      onRetryInspect
                    }
                  />
                ),
              )}
            </ol>
          )}

        {quickActionItem && (
          <ArchiveQuickActions
            item={quickActionItem}
            onClose={() => closeQuickActions()}
            onComplete={completeQuickAction}
          />
        )}
      </section>
    </section>
  )
}
