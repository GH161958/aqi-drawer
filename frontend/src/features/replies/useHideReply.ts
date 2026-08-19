import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  hidePocketReply,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

interface HideReplyInput {
  replyId: string
}

export function useHideReply(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      ({
        replyId,
      }: HideReplyInput) =>
        hidePocketReply(
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
