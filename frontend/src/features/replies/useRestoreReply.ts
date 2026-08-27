import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  restorePocketReply,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

interface RestoreReplyInput {
  replyId: string
}

export function useRestoreReply(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      ({
        replyId,
      }: RestoreReplyInput) =>
        restorePocketReply(
          itemId,
          replyId,
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
