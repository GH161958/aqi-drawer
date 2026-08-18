import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  deleteTagEverywhere,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useDeleteTagEverywhere() {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      deleteTagEverywhere,

    onSuccess:
      () => {
        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.all,
        })
      },
  })
}
