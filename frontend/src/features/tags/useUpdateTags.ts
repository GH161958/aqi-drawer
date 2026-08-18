import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  updatePocketItemTags,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

import type {
  UpdatePocketItemTagsInput,
} from '../../api/pocket'

export function useUpdateTags(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      (
        input:
          UpdatePocketItemTagsInput,
      ) =>
        updatePocketItemTags(
          itemId,
          input,
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
            pocketQueryKeys.tags(),
        })
      },
  })
}
