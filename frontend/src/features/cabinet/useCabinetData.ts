import {
  useMemo,
} from 'react'

import {
  useQuery,
} from '@tanstack/react-query'

import {
  listPocketItems,
  listTrashItems,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import {
  pocketStatuses,
} from '../../types/pocket'

import type {
  CabinetSlot,
} from '../../types/pocket'

type CabinetCounts =
  Record<CabinetSlot, number>

export function useCabinetData() {
  const itemsQuery =
    useQuery({
      queryKey:
        pocketQueryKeys.items(),

      queryFn: () =>
        listPocketItems(500),
    })

  const trashQuery =
    useQuery({
      queryKey:
        pocketQueryKeys.trash(),

      queryFn: () =>
        listTrashItems(500),
    })

  const counts =
    useMemo<CabinetCounts>(() => {
      const next =
        Object.fromEntries(
          [
            'all',
            ...pocketStatuses,
            'trash',
          ].map(
            (slot) => [slot, 0],
          ),
        ) as CabinetCounts

      const items =
        itemsQuery.data ?? []

      next.all = items.length

      for (const item of items) {
        next[item.status] += 1
      }

      next.trash =
        trashQuery.data?.length ?? 0

      return next
    }, [
      itemsQuery.data,
      trashQuery.data,
    ])

  return {
    counts,

    isLoading:
      itemsQuery.isPending
      || trashQuery.isPending,

    isError:
      itemsQuery.isError
      || trashQuery.isError,
  }
}
