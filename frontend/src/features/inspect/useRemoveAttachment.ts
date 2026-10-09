import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  removePocketAttachment,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

export function useRemoveAttachment(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      (attachmentId: string) =>
        removePocketAttachment(
          itemId,
          attachmentId,
        ),

    onSuccess: (item) => {
      queryClient.setQueryData(
        pocketQueryKeys.item(itemId),
        item,
      )

      queryClient.setQueriesData<
        PocketItemSummary[]
      >(
        {
          queryKey:
            pocketQueryKeys.items(),
        },
        (items) =>
          items?.map((entry) =>
            entry.id === item.id
              ? item
              : entry,
          ),
      )

      void queryClient.invalidateQueries({
        queryKey:
          pocketQueryKeys.items(),
      })
    },
  })
}
