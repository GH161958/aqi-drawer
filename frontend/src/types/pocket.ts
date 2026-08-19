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

export type PocketKind =
  | 'link'
  | 'text'
  | 'image'
  | 'video'
  | 'mixed'

export interface PocketAttachmentSummary {
  id: string
  name: string
  mimeType: string
  url?: string
}

export interface PocketReplySummary {
  id?: string

  author?:
    | 'EE'
    | 'Aqi'

  text?: string
  content?: string

  createdAt?: string
  source?: string
}

export interface PocketActivityEntry {
  type: string
  actor: string
  at: string

  detail:
    Record<string, unknown>
}

export interface PocketItemSummary {
  id: string
  title: string
  text: string

  sourceApp: string
  sourceUrl: string

  kind: PocketKind
  status: PocketStatus

  deletedAt: string | null

  note: string

  attachments:
    PocketAttachmentSummary[]

  replies:
    PocketReplySummary[]

  collection: string | null

  tags: string[]
  sourceTags: string[]

  activity:
    PocketActivityEntry[]

  createdAt: string
  lastReceivedAt: string
}

export type CabinetSlot =
  | 'all'
  | PocketStatus
  | 'trash'
