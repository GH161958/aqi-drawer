import type {
  CabinetSlot,
} from '../types/pocket'

export const drawerHistoryKey =
  '__aqiDrawerNavigation'

export interface ArchiveSnapshot {
  slot: CabinetSlot
  collection: string
  source: string
  tag: string
  scrollY: number
}

export type DrawerHistoryEntry =
  | {
      version: 1
      view: 'cabinet'
    }
  | ({
      version: 1
      view: 'archive'
    } & ArchiveSnapshot)
  | ({
      version: 1
      view: 'inspect'
      itemId: string
    } & ArchiveSnapshot)

const cabinetSlots = new Set<CabinetSlot>([
  'all',
  'inbox',
  'tonight',
  'discussed',
  'deferred',
  'memory_candidate',
  'archived',
  'trash',
])

function finiteScrollY(value: unknown) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? value
    : 0
}

function text(value: unknown) {
  return typeof value === 'string'
    ? value
    : ''
}

export function readDrawerHistoryEntry(
  state: unknown,
): DrawerHistoryEntry | null {
  if (
    !state
    || typeof state !== 'object'
  ) {
    return null
  }

  const candidate =
    (state as Record<string, unknown>)[
      drawerHistoryKey
    ]

  if (
    !candidate
    || typeof candidate !== 'object'
  ) {
    return null
  }

  const value =
    candidate as Record<string, unknown>

  if (
    value.version !== 1
    || typeof value.view !== 'string'
  ) {
    return null
  }

  if (value.view === 'cabinet') {
    return {
      version: 1,
      view: 'cabinet',
    }
  }

  if (
    value.view !== 'archive'
    && value.view !== 'inspect'
  ) {
    return null
  }

  if (
    typeof value.slot !== 'string'
    || !cabinetSlots.has(
      value.slot as CabinetSlot,
    )
  ) {
    return null
  }

  const snapshot: ArchiveSnapshot = {
    slot: value.slot as CabinetSlot,
    collection: text(value.collection),
    source: text(value.source),
    tag: text(value.tag),
    scrollY: finiteScrollY(value.scrollY),
  }

  if (value.view === 'archive') {
    return {
      version: 1,
      view: 'archive',
      ...snapshot,
    }
  }

  if (
    typeof value.itemId !== 'string'
    || value.itemId.length === 0
  ) {
    return null
  }

  return {
    version: 1,
    view: 'inspect',
    itemId: value.itemId,
    ...snapshot,
  }
}

export function withDrawerHistoryEntry(
  state: unknown,
  entry: DrawerHistoryEntry,
) {
  const existing =
    state
    && typeof state === 'object'
      ? state as Record<string, unknown>
      : {}

  return {
    ...existing,
    [drawerHistoryKey]: entry,
  }
}

// A shareable address selects one item, without putting credentials or
// original-file URLs in the link. Item IDs are identifiers, not auth tokens.
const itemQueryKey = 'item'
const itemIdPattern =
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu

export function readDrawerItemDeepLink(
  search: string,
): string | null {
  const candidates =
    new URLSearchParams(search).getAll(
      itemQueryKey,
    )

  if (
    candidates.length !== 1
    || !itemIdPattern.test(candidates[0])
  ) {
    return null
  }

  return candidates[0]
}

export function resolveInitialDrawerHistoryEntry(
  state: unknown,
  search: string,
): DrawerHistoryEntry | null {
  const saved = readDrawerHistoryEntry(state)
  const parameters = new URLSearchParams(search)
  if (!parameters.has(itemQueryKey)) {
    return saved
  }

  const itemId = readDrawerItemDeepLink(search)
  if (!itemId) {
    // Malformed / duplicate link parameters should not open stale papers.
    return { version: 1, view: 'cabinet' }
  }

  if (
    saved?.view === 'inspect'
    && saved.itemId === itemId
  ) {
    return saved
  }

  return {
    version: 1,
    view: 'inspect',
    itemId,
    slot: 'all',
    collection: '',
    source: '',
    tag: '',
    scrollY: 0,
  }
}

export function drawerHistoryUrl(
  pathname: string,
  search: string,
  hash: string,
  entry: DrawerHistoryEntry,
): string {
  const parameters =
    new URLSearchParams(search)

  if (entry.view === 'inspect') {
    parameters.set(itemQueryKey, entry.itemId)
  } else {
    parameters.delete(itemQueryKey)
  }

  const query = parameters.toString()
  return pathname
    + (query ? '?' + query : '')
    + hash
}

export interface OutsideTapSample {
  startX: number
  startY: number
  endX: number
  endY: number
  elapsedMs: number
  boundary:
    Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>
  edgeGuard: number
  movementLimit: number
  selectionActive: boolean
  interactiveTarget: boolean
}

export function isArchiveOutsideTap({
  startX,
  startY,
  endX,
  endY,
  elapsedMs,
  boundary,
  edgeGuard,
  movementLimit,
  selectionActive,
  interactiveTarget,
}: OutsideTapSample) {
  if (
    selectionActive
    || interactiveTarget
    || elapsedMs > 700
    || Math.hypot(
      endX - startX,
      endY - startY,
    ) > movementLimit
  ) {
    return false
  }

  const outsideAt = (
    x: number,
    y: number,
  ) => (
    x < boundary.left - edgeGuard
    || x > boundary.right + edgeGuard
    || y < boundary.top - edgeGuard
    || y > boundary.bottom + edgeGuard
  )

  return outsideAt(startX, startY)
    && outsideAt(endX, endY)
}
