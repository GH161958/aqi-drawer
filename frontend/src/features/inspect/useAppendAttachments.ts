import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  appendPocketAttachments,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

import type {
  PocketItemSummary,
} from '../../types/pocket'

export function useAppendAttachments(itemId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      files,
      requestId,
    }: {
      files: File[]
      requestId: string
    }) => appendPocketAttachments(itemId, files, requestId),

    onSuccess: (item) => {
      queryClient.setQueryData(
        pocketQueryKeys.item(itemId),
        item,
      )
      queryClient.setQueriesData<PocketItemSummary[]>(
        { queryKey: pocketQueryKeys.items() },
        (items) => items?.map((entry) =>
          entry.id === item.id ? item : entry,
        ),
      )
      void queryClient.invalidateQueries({
        queryKey: pocketQueryKeys.items(),
      })
    },
  })
}
