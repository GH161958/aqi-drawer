import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  updatePocketItemStatus,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
  PocketStatus,
} from '../../types/pocket'

export function useFileItem(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      (status: PocketStatus) =>
        updatePocketItemStatus(
          itemId,
          status,
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
            pocketQueryKeys.all,
        })
      },
  })
}
