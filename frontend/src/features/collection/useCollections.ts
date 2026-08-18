import {
  useQuery,
} from '@tanstack/react-query'

import {
  listCollections,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useCollections() {
  return useQuery({
    queryKey:
      pocketQueryKeys.collections(),

    queryFn:
      listCollections,
  })
}
