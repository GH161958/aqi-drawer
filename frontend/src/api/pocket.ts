import type {
  PocketItemsResponse,
} from './contracts'

import {
  pocketStatuses,
} from '../types/pocket'

import type {
  PocketItemSummary,
  PocketStatus,
} from '../types/pocket'

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === 'object'
    && value !== null
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

  return {
    id: value.id,

    title:
      typeof value.title === 'string'
        ? value.title
        : '没有标题的一张纸',

    status: value.status,

    deletedAt:
      typeof value.deletedAt === 'string'
        ? value.deletedAt
        : null,
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
