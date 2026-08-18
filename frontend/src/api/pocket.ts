import type {
  PocketItemsResponse,
} from './contracts'

import {
  pocketStatuses,
} from '../types/pocket'

import type {
  PocketActivityEntry,
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


function parseActivityEntry(
  value: unknown,
): PocketActivityEntry | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    typeof value.type !== 'string'
    || typeof value.at !== 'string'
  ) {
    return null
  }

  return {
    type: value.type,

    actor:
      typeof value.actor === 'string'
        ? value.actor
        : 'system',

    at: value.at,

    detail:
      isRecord(value.detail)
        ? value.detail
        : {},
  }
}

function parseActivityList(
  value: unknown,
): PocketActivityEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(parseActivityEntry)
    .filter(
      (
        entry,
      ): entry is PocketActivityEntry =>
        entry !== null,
    )
}

function parseTagStrings(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry
      }

      if (!isRecord(entry)) {
        return ''
      }

      if (typeof entry.name === 'string') {
        return entry.name
      }

      if (typeof entry.label === 'string') {
        return entry.label
      }

      return ''
    })
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function parseSourceTags(
  value: Record<string, unknown>,
): string[] {
  const direct =
    parseTagStrings(
      value.sourceTags,
    )

  if (direct.length) {
    return direct
  }

  if (isRecord(value.sourceData)) {
    return parseTagStrings(
      value.sourceData.tags,
    )
  }

  return []
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

    sourceTags:
      parseSourceTags(value),

    activity:
      parseActivityList(
        value.activity,
      ),

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

export async function getPocketItem(
  id: string,
): Promise<PocketItemSummary> {
  const response =
    await fetch(
      `/api/pocket/items/${
        encodeURIComponent(id)
      }`,
      {
        credentials: 'same-origin',

        headers: {
          accept: 'application/json',
        },
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? '这张纸已经不在当前抽屉里。'
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !('item' in payload)
  ) {
    throw new Error(
      'Drawer API returned an invalid item.',
    )
  }

  const item =
    parsePocketItem(payload.item)

  if (!item) {
    throw new Error(
      'Drawer item could not be read.',
    )
  }

  return item
}

export async function updatePocketItemStatus(
  id: string,
  status: PocketStatus,
): Promise<PocketItemSummary> {
  const response =
    await fetch(
      `/api/pocket/items/${
        encodeURIComponent(id)
      }/review`,
      {
        method: 'POST',

        credentials: 'same-origin',

        headers: {
          'content-type':
            'application/json',

          accept:
            'application/json',
        },

        body:
          JSON.stringify({
            action: status,
          }),
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    const message =
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`

    throw new Error(message)
  }

  if (
    !isRecord(payload)
    || !('item' in payload)
  ) {
    throw new Error(
      'Drawer API returned an invalid reviewed item.',
    )
  }

  const item =
    parsePocketItem(payload.item)

  if (!item) {
    throw new Error(
      'Updated Drawer item could not be read.',
    )
  }

  return item
}

export interface CreateCollectionResult {
  collection: string
  changed: boolean
}

export interface DeleteCollectionResult {
  changed: boolean
  clearedItemIds: string[]
}

export async function listCollections():
  Promise<string[]> {
  const response =
    await fetch(
      '/api/pocket/collections',
      {
        credentials: 'same-origin',

        headers: {
          accept: 'application/json',
        },
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !Array.isArray(
      payload.collections,
    )
  ) {
    throw new Error(
      'Drawer returned an invalid Collection registry.',
    )
  }

  return [
    ...new Set(
      payload.collections
        .filter(
          (
            value,
          ): value is string =>
            typeof value === 'string',
        )
        .map(
          (value) =>
            value.trim(),
        )
        .filter(Boolean),
    ),
  ].sort(
    (a, b) =>
      a.localeCompare(b),
  )
}

export async function createCollection(
  value: string,
): Promise<CreateCollectionResult> {
  const collection =
    value.trim()

  if (!collection) {
    throw new Error(
      'Collection name is required.',
    )
  }

  const response =
    await fetch(
      '/api/pocket/collections',
      {
        method: 'POST',

        credentials: 'same-origin',

        headers: {
          'content-type':
            'application/json',

          accept:
            'application/json',
        },

        body:
          JSON.stringify({
            collection,
            name: collection,
          }),
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || typeof payload.collection
      !== 'string'
  ) {
    throw new Error(
      'Drawer returned an invalid created Collection.',
    )
  }

  return {
    collection:
      payload.collection,

    changed:
      payload.changed === true,
  }
}

export async function deleteCollection(
  value: string,
): Promise<DeleteCollectionResult> {
  const collection =
    value.trim()

  if (!collection) {
    throw new Error(
      'Collection name is required.',
    )
  }

  const response =
    await fetch(
      `/api/pocket/collections/${
        encodeURIComponent(
          collection,
        )
      }`,
      {
        method: 'DELETE',

        credentials:
          'same-origin',

        headers: {
          accept:
            'application/json',
        },
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  return {
    changed:
      isRecord(payload)
      && payload.changed === true,

    clearedItemIds:
      isRecord(payload)
      && Array.isArray(
        payload.clearedItemIds,
      )
        ? payload.clearedItemIds
            .filter(
              (
                id,
              ): id is string =>
                typeof id === 'string',
            )
        : [],
  }
}

export async function updatePocketItemCollection(
  id: string,
  collection: string | null,
): Promise<PocketItemSummary> {
  const normalized =
    collection?.trim() || null

  const response =
    await fetch(
      `/api/pocket/items/${
        encodeURIComponent(id)
      }/metadata`,
      {
        method: 'PATCH',

        credentials:
          'same-origin',

        headers: {
          'content-type':
            'application/json',

          accept:
            'application/json',
        },

        body:
          JSON.stringify(
            normalized
              ? {
                  collection:
                    normalized,
                }
              : {
                  clearCollection:
                    true,
                },
          ),
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !('item' in payload)
  ) {
    throw new Error(
      'Drawer returned an invalid metadata item.',
    )
  }

  const item =
    parsePocketItem(
      payload.item,
    )

  if (!item) {
    throw new Error(
      'Updated Drawer item could not be read.',
    )
  }

  return item
}

export interface UpdatePocketItemTagsInput {
  tagsAdd?: string[]
  tagsRemove?: string[]
}

export interface DeleteTagEverywhereResult {
  tag: string
  changedCount: number
}

function normalizeTagList(
  values: string[],
): string[] {
  return [
    ...new Set(
      values
        .map(
          (value) =>
            value.trim(),
        )
        .filter(Boolean),
    ),
  ]
}

export async function updatePocketItemTags(
  id: string,
  input: UpdatePocketItemTagsInput,
): Promise<PocketItemSummary> {
  const tagsAdd =
    normalizeTagList(
      input.tagsAdd ?? [],
    )

  const tagsRemove =
    normalizeTagList(
      input.tagsRemove ?? [],
    )

  const response =
    await fetch(
      `/api/pocket/items/${
        encodeURIComponent(id)
      }/metadata`,
      {
        method: 'PATCH',

        credentials:
          'same-origin',

        headers: {
          'content-type':
            'application/json',

          accept:
            'application/json',
        },

        body:
          JSON.stringify({
            tagsAdd,
            tagsRemove,
          }),
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !('item' in payload)
  ) {
    throw new Error(
      'Drawer returned an invalid metadata item.',
    )
  }

  const item =
    parsePocketItem(
      payload.item,
    )

  if (!item) {
    throw new Error(
      'Updated Drawer item could not be read.',
    )
  }

  return item
}

export async function listTagVocabulary():
  Promise<string[]> {
  const response =
    await fetch(
      '/api/pocket/tags',
      {
        credentials:
          'same-origin',

        headers: {
          accept:
            'application/json',
        },
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  if (
    !isRecord(payload)
    || !Array.isArray(
      payload.tags,
    )
  ) {
    throw new Error(
      'Drawer returned an invalid Tag registry.',
    )
  }

  return normalizeTagList(
    payload.tags.filter(
      (
        value,
      ): value is string =>
        typeof value === 'string',
    ),
  ).sort(
    (a, b) =>
      a.localeCompare(b),
  )
}

export async function deleteTagEverywhere(
  value: string,
): Promise<DeleteTagEverywhereResult> {
  const tag =
    value.trim()

  if (!tag) {
    throw new Error(
      'Tag name is required.',
    )
  }

  const response =
    await fetch(
      `/api/pocket/tags/${
        encodeURIComponent(tag)
      }`,
      {
        method: 'DELETE',

        credentials:
          'same-origin',

        headers: {
          accept:
            'application/json',
        },
      },
    )

  const payload: unknown =
    await response
      .json()
      .catch(() => null)

  if (!response.ok) {
    throw new Error(
      isRecord(payload)
      && typeof payload.error === 'string'
        ? payload.error
        : `Drawer API returned ${response.status}`,
    )
  }

  return {
    tag:
      isRecord(payload)
      && typeof payload.tag === 'string'
        ? payload.tag
        : tag,

    changedCount:
      isRecord(payload)
      && typeof payload.changedCount === 'number'
        ? payload.changedCount
        : 0,
  }
}
