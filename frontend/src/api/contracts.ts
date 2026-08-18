import type {
  PocketItemSummary,
} from '../types/pocket'

export interface PocketItemsResponse {
  items: PocketItemSummary[]
}

export interface PocketItemResponse {
  item: PocketItemSummary
}
