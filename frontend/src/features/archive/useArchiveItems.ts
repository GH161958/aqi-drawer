import {
  useMemo,
} from 'react'

import {
  useQuery,
} from '@tanstack/react-query'

import {
  listPocketItems,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  CabinetSlot,
} from '../../types/pocket'

export function useArchiveItems(
  slot: CabinetSlot,
) {
  const query =
    useQuery({
      queryKey:
        pocketQueryKeys.items(),

      queryFn: () =>
        listPocketItems(500),
    })

  const items =
    useMemo(() => {
      const all =
        query.data ?? []

      if (slot === 'all') {
        return all
      }

      if (slot === 'trash') {
        return []
      }

      return all.filter(
        (item) =>
          item.status === slot,
      )
    }, [
      query.data,
      slot,
    ])

  return {
    ...query,
    items,
  }
}
