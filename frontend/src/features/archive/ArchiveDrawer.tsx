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
}: ArchiveDrawerProps) {
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
  ) {
    onInspect(item.id)
  }

  return (
    <section
      className={styles.view}
      aria-labelledby="archive-title"
    >
      <div
        className={styles.toolbar}
      >
        <button
          type="button"
          className={styles.back}
          onClick={onBack}
        >
          放回柜子
        </button>

        <p
          id="archive-title"
          className={styles.label}
        >
          {label}

          {!isPending && (
            <>
              {' · '}

              {formatCabinetCount(
                items.length,
              )}
            </>
          )}
        </p>
      </div>

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
                />
              ),
            )}
          </ol>
        )}
    </section>
  )
}
