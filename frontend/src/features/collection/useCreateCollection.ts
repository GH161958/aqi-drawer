import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  createCollection,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useCreateCollection() {
  const queryClient =
    useQueryClient()

  return useMutation({
    mutationFn:
      createCollection,

    onSuccess:
      () => {
        void queryClient.invalidateQueries({
          queryKey:
            pocketQueryKeys.collections(),
        })
      },
  })
}
