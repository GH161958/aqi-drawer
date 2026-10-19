import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  drawerHistoryKey,
  drawerHistoryUrl,
  isArchiveOutsideTap,
  readDrawerHistoryEntry,
  readDrawerItemDeepLink,
  resolveInitialDrawerHistoryEntry,
  withDrawerHistoryEntry,
} from '../src/app/drawerNavigation.ts'

test('drawer history preserves unrelated host state', () => {
  const entry = {
    version: 1 as const,
    view: 'archive' as const,
    slot: 'all' as const,
    collection: 'Reading',
    source: '',
    tag: 'later',
    scrollY: 418,
  }

  const state = withDrawerHistoryEntry(
    {
      hostOwned: 'keep',
    },
    entry,
  )

  assert.equal(state.hostOwned, 'keep')
  assert.deepEqual(
    state[drawerHistoryKey],
    entry,
  )
  assert.deepEqual(
    readDrawerHistoryEntry(state),
    entry,
  )
})

test('drawer history rejects invalid views and slots', () => {
  assert.equal(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'archive',
        slot: 'unknown',
      },
    }),
    null,
  )

  assert.equal(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'inspect',
        slot: 'all',
        itemId: '',
      },
    }),
    null,
  )
})

test('drawer history restores inspect snapshot safely', () => {
  assert.deepEqual(
    readDrawerHistoryEntry({
      [drawerHistoryKey]: {
        version: 1,
        view: 'inspect',
        slot: 'inbox',
        itemId: 'item-1',
        collection: 'Inbox',
        source: 'Safari',
        tag: 'read',
        scrollY: 215,
      },
    }),
    {
      version: 1,
      view: 'inspect',
      slot: 'inbox',
      itemId: 'item-1',
      collection: 'Inbox',
      source: 'Safari',
      tag: 'read',
      scrollY: 215,
    },
  )
})

const flowerId =
  '71b4c775-7f65-4afe-9c47-de6c2dcfce97'
const otherId =
  'f5cd54a8-6f33-480d-ba92-52a049153172'

test('one valid item URL opens that Inspect paper from a cold start', () => {
  const entry = resolveInitialDrawerHistoryEntry(
    null,
    '?item=' + flowerId,
  )
  assert.deepEqual(entry, {
    version: 1,
    view: 'inspect',
    itemId: flowerId,
    slot: 'all',
    collection: '',
    source: '',
    tag: '',
    scrollY: 0,
  })
  assert.equal(readDrawerItemDeepLink('?item=' + flowerId), flowerId)
  assert.equal(
    drawerHistoryUrl('/drawer-next', '?theme=warm', '#top', entry!),
    '/drawer-next?theme=warm&item=' + flowerId + '#top',
  )
  // A refreshed tab keeps the exact same saved archive and Inspect entry.
  const restored = resolveInitialDrawerHistoryEntry(
    withDrawerHistoryEntry({}, entry!),
    '?item=' + flowerId,
  )
  assert.deepEqual(restored, entry)
})

test('Back to Archive removes only the item URL parameter', () => {
  const archive = {
    version: 1 as const, view: 'archive' as const,
    slot: 'all' as const,
    collection: '', source: '', tag: '', scrollY: 0,
  }
  const inspect = {
    ...archive, view: 'inspect' as const, itemId: flowerId,
  }
  const url = drawerHistoryUrl(
    '/drawer-next', '?theme=warm&item=' + flowerId + '&debug=1', '#notes',
    archive,
  )
  assert.equal(url, '/drawer-next?theme=warm&debug=1#notes')
  assert.equal(
    drawerHistoryUrl(
      '/drawer-next', '?theme=warm', '', inspect,
    ),
    '/drawer-next?theme=warm&item=' + flowerId,
  )
  assert.equal(
    drawerHistoryUrl('/drawer-next', '?item=' + flowerId, '', {
      version: 1, view: 'cabinet',
    }),
    '/drawer-next',
  )
})

test('URL item overrides an unrelated stale History state', () => {
  const original = {
    version: 1 as const, view: 'inspect' as const,
    slot: 'inbox' as const, itemId: otherId,
    collection: 'old', source: '', tag: '', scrollY: 500,
  }
  const saved = withDrawerHistoryEntry({ owner: true }, original)
  assert.deepEqual(
    resolveInitialDrawerHistoryEntry(saved, '?item=' + flowerId),
    {
      version: 1, view: 'inspect', itemId: flowerId,
      slot: 'all', collection: '', source: '', tag: '', scrollY: 0,
    },
  )
  assert.deepEqual(resolveInitialDrawerHistoryEntry(saved, ''), original)
  assert.deepEqual(
    resolveInitialDrawerHistoryEntry(
      saved, '?item=' + otherId,
    ), original,
  )
})

test('malformed, duplicated, and suspicious IDs fail closed', () => {
  for (const search of [
    '?item=../api',
    '?item=abc',
    '?item=' + flowerId + '&item=' + otherId,
    '?item=%2Fetc%2Fpasswd',
    '?item=',
  ]) {
    assert.equal(readDrawerItemDeepLink(search), null)
    assert.deepEqual(
      resolveInitialDrawerHistoryEntry(
        withDrawerHistoryEntry({}, {
          version: 1, view: 'inspect', slot: 'all',
          itemId: otherId, collection: '',
          source: '', tag: '', scrollY: 0,
        }),
        search,
      ),
      { version: 1, view: 'cabinet' },
    )
  }
})

const boundary = {
  left: 100,
  right: 300,
  top: 80,
  bottom: 600,
}

function outsideTap(
  overrides: Partial<Parameters<
    typeof isArchiveOutsideTap
  >[0]> = {},
) {
  return isArchiveOutsideTap({
    startX: 50,
    startY: 200,
    endX: 52,
    endY: 202,
    elapsedMs: 120,
    boundary,
    edgeGuard: 8,
    movementLimit: 10,
    selectionActive: false,
    interactiveTarget: false,
    ...overrides,
  })
}

test('a deliberate tap outside the drawer dismisses it', () => {
  assert.equal(outsideTap(), true)
})

test('drawer edge taps and interactions do not dismiss', () => {
  assert.equal(
    outsideTap({
      startX: 95,
      endX: 95,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      interactiveTarget: true,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      selectionActive: true,
    }),
    false,
  )
})

test('scroll, drag, and long press do not dismiss', () => {
  assert.equal(
    outsideTap({
      endY: 240,
    }),
    false,
  )
  assert.equal(
    outsideTap({
      elapsedMs: 900,
    }),
    false,
  )
})

test('Inspect focus handoff uses inert, not aria-hidden, for Archive history transitions', () => {
  // Back/Forward can present Inspect without a direct archive-button click.
  // An inert subtree is excluded from focus and the accessibility tree.
  const app = readFileSync(
    new URL('../src/app/App.tsx', import.meta.url),
    'utf8',
  )
  const inspect = readFileSync(
    new URL('../src/features/inspect/InspectStage.tsx', import.meta.url),
    'utf8',
  )
  const start = app.indexOf('{activeSlot && (')
  const end = app.indexOf('<ArchiveDrawer', start)
  assert.ok(start >= 0 && end > start)
  const archiveHost = app.slice(start, end)

  assert.match(archiveHost, /inert=\{/u)
  assert.doesNotMatch(archiveHost, /aria-hidden/u)
  assert.match(
    inspect,
    /useLayoutEffect\(\s*\(\) => \{\s*if \(!presented\) return\s*returnButtonRef\.current\?\.focus/u,
  )
})
