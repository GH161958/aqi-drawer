import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import {
  permanentlyDeletePocketItem,
  restorePocketItem,
  trashPocketItem,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

function useRefreshDrawer() {
  const queryClient =
    useQueryClient()

  return () =>
    queryClient.invalidateQueries({
      queryKey:
        pocketQueryKeys.all,
    })
}

export function useTrashItem(
  itemId: string,
) {
  const refresh =
    useRefreshDrawer()

  return useMutation({
    mutationFn:
      () =>
        trashPocketItem(itemId),

    onSuccess:
      () => {
        void refresh()
      },
  })
}

export function useRestoreItem(
  itemId: string,
) {
  const refresh =
    useRefreshDrawer()

  return useMutation({
    mutationFn:
      () =>
        restorePocketItem(itemId),

    onSuccess:
      () => {
        void refresh()
      },
  })
}

export function usePermanentlyDeleteItem(
  itemId: string,
) {
  const refresh =
    useRefreshDrawer()

  return useMutation({
    mutationFn:
      () =>
        permanentlyDeletePocketItem(
          itemId,
        ),

    onSuccess:
      () => {
        void refresh()
      },
  })
}
