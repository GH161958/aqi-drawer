import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  readPocketItemContent,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

interface ReadSourceInput {
  detail:
    | 'compact'
    | 'full'

  videoFrames?: number
}

export function useReadSource(
  itemId: string,
) {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      ({
        detail,
        videoFrames = 0,
      }: ReadSourceInput) =>
        readPocketItemContent(
          itemId,
          {
            detail,
            maxImages: 2,
            videoFrames,
          },
        ),

    onSuccess:
      () => {
        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.item(
              itemId,
            ),
        })

        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.all,
        })
      },
  })
}
