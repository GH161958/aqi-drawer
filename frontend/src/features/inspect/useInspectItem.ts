import {
  useQuery,
} from '@tanstack/react-query'

import {
  getPocketItem,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useInspectItem(
  itemId: string,
) {
  return useQuery({
    queryKey:
      pocketQueryKeys.item(itemId),

    queryFn: () =>
      getPocketItem(itemId),
  })
}
