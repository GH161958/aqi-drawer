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

export interface PocketContentImage {
  url: string
  alt?: string
}

export interface PocketContentSnapshot {
  siteName?: string
  title?: string
  author?: string
  publishedAt?: string
  description?: string
  text?: string

  detail?: 'compact' | 'full'

  textTruncated?: boolean

  finalUrl?: string
  canonicalUrl?: string

  images: PocketContentImage[]

  browserCapturePlan?: {
    needed?: boolean
  }

  video?: {
    detected?: boolean
    durationSeconds?: number
  }

  frameExtraction?: {
    requested?: number
    extracted?: number
  }
}

export interface PocketContentReadResult {
  snapshot: PocketContentSnapshot

  cache: {
    hit?: boolean
  }
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

  hiddenReplies:
    PocketReplySummary[]

  hiddenReplyCount: number


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
