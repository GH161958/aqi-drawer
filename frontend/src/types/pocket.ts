export const pocketStatuses = [
  'inbox',
  'tonight',
  'discussed',
  'deferred',
  'memory_candidate',
  'archived',
] as const

export type PocketStatus =
  (typeof pocketStatuses)[number]

export interface PocketItemSummary {
  id: string
  title: string
  status: PocketStatus
  deletedAt: string | null
}

export type CabinetSlot =
  | 'all'
  | PocketStatus
  | 'trash'
