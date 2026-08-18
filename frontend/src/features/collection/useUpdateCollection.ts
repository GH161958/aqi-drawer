import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  updatePocketItemCollection,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

export function useUpdateCollection(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      (
        collection:
          string | null,
      ) =>
        updatePocketItemCollection(
          itemId,
          collection,
        ),

    onSuccess:
      (updatedItem) => {
        queryClient.setQueryData(
          pocketQueryKeys.item(
            itemId,
          ),
          updatedItem,
        )

        queryClient.setQueryData<
          PocketItemSummary[]
        >(
          pocketQueryKeys.items(),
          (items) =>
            items?.map(
              (item) =>
                item.id === itemId
                  ? updatedItem
                  : item,
            ),
        )

        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.collections(),
        })
      },
  })
}
