import type {
  PocketItemsResponse,
} from './contracts'

import {
  pocketStatuses,
} from '../types/pocket'

import type {
  PocketAttachmentSummary,
  PocketItemSummary,
  PocketKind,
  PocketReplySummary,
  PocketStatus,
} from '../types/pocket'

const pocketKinds =
  new Set<PocketKind>([
    'link',
    'text',
    'image',
    'video',
    'mixed',
  ])

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
  )
}

function stringValue(
  value: unknown,
  fallback = '',
): string {
  return (
    typeof value === 'string'
      ? value
      : fallback
  )
}

function isPocketStatus(
  value: unknown,
): value is PocketStatus {
  return (
    typeof value === 'string'
    && pocketStatuses.includes(
      value as PocketStatus,
    )
  )
}

function parseKind(
  value: unknown,
): PocketKind {
  if (
    typeof value === 'string'
    && pocketKinds.has(
      value as PocketKind,
    )
  ) {
    return value as PocketKind
  }

  return 'text'
}

function parseAttachment(
  value: unknown,
): PocketAttachmentSummary | null {
  if (!isRecord(value)) return null

  if (typeof value.id !== 'string') {
    return null
  }

  return {
    id: value.id,

    name:
      stringValue(
        value.name,
        'attachment',
      ),

    mimeType:
      stringValue(
        value.mimeType,
        'application/octet-stream',
      ),

    ...(typeof value.url === 'string'
      ? { url: value.url }
      : {}),
  }
}

function parseReply(
  value: unknown,
): PocketReplySummary | null {
  if (!isRecord(value)) return null

  return {
    ...(typeof value.id === 'string'
      ? { id: value.id }
      : {}),

    ...(typeof value.text === 'string'
      ? { text: value.text }
      : {}),

    ...(typeof value.content === 'string'
      ? { content: value.content }
      : {}),
  }
}

function parsePocketItem(
  value: unknown,
): PocketItemSummary | null {
  if (!isRecord(value)) return null

  if (
    typeof value.id !== 'string'
    || !isPocketStatus(value.status)
  ) {
    return null
  }

  const attachments =
    Array.isArray(value.attachments)
      ? value.attachments
          .map(parseAttachment)
          .filter(
            (
              attachment,
            ): attachment is PocketAttachmentSummary =>
              attachment !== null,
          )
      : []

  const replies =
    Array.isArray(value.replies)
      ? value.replies
          .map(parseReply)
          .filter(
            (
              reply,
            ): reply is PocketReplySummary =>
              reply !== null,
          )
      : []

  const tags =
    Array.isArray(value.tags)
      ? value.tags.filter(
          (tag): tag is string =>
            typeof tag === 'string',
        )
      : []

  return {
    id: value.id,

    title:
      stringValue(
        value.title,
        '没有标题的一张纸',
      ),

    text:
      stringValue(value.text),

    sourceApp:
      stringValue(
        value.sourceApp,
        'Aqi Drawer',
      ),

    sourceUrl:
      stringValue(value.sourceUrl),

    kind:
      parseKind(value.kind),

    status:
      value.status,

    deletedAt:
      typeof value.deletedAt === 'string'
        ? value.deletedAt
        : null,

    note:
      stringValue(value.note),

    attachments,
    replies,

    collection:
      typeof value.collection === 'string'
        ? value.collection
        : null,

    tags,

    createdAt:
      stringValue(value.createdAt),

    lastReceivedAt:
      stringValue(
        value.lastReceivedAt,
        stringValue(value.createdAt),
      ),
  }
}

async function readItemList(
  path: string,
): Promise<PocketItemsResponse> {
  const response =
    await fetch(path, {
      credentials: 'same-origin',

      headers: {
        accept: 'application/json',
      },
    })

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !Array.isArray(payload.items)
  ) {
    throw new Error(
      'Drawer API returned an invalid item list.',
    )
  }

  return {
    items:
      payload.items
        .map(parsePocketItem)
        .filter(
          (
            item,
          ): item is PocketItemSummary =>
            item !== null,
        ),
  }
}

export async function listPocketItems(
  limit = 500,
): Promise<PocketItemSummary[]> {
  const payload =
    await readItemList(
      `/api/pocket/items?limit=${limit}`,
    )

  return payload.items
}

export async function listTrashItems(
  limit = 500,
): Promise<PocketItemSummary[]> {
  const payload =
    await readItemList(
      `/api/pocket/trash?limit=${limit}`,
    )

  return payload.items
}
