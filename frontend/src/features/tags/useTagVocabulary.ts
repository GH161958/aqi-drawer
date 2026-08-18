import {
  useQuery,
} from '@tanstack/react-query'

import {
  listTagVocabulary,
} from '../../api/pocket'

import {
  pocketQueryKeys,
} from '../../api/queryKeys'

export function useTagVocabulary() {
  return useQuery({
    queryKey:
      pocketQueryKeys.tags(),

    queryFn:
      listTagVocabulary,
  })
}
