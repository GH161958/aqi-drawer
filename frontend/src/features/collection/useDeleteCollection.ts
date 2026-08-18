import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  deleteCollection,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useDeleteCollection() {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      deleteCollection,

    onSuccess:
      () => {
        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.all,
        })
      },
  })
}
