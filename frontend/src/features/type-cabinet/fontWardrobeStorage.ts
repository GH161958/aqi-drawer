export const FONT_WARDROBE_DB_NAME =
  'aqi-drawer-font-wardrobe'

export const FONT_WARDROBE_DB_VERSION = 1

export const FONT_STORE_NAME = 'fonts'
export const SETTINGS_STORE_NAME = 'settings'

export const MAX_SAVED_FONTS = 12
export const MAX_WARDROBE_BYTES =
  100 * 1024 * 1024

const SETTINGS_KEY = 'wardrobe'

export type StoredFontFormat =
  | 'woff2'
  | 'woff'
  | 'ttf'
  | 'otf'

export type StoredFont = {
  id: string
  schemaVersion: 1
  slot: 'combined'
  displayName: string
  sourceType: 'file' | 'url'
  sourceUrl?: string
  normalizedSourceUrl?: string
  originalFilename?: string
  format: StoredFontFormat
  byteLength: number
  createdAt: number
  fontBytes: ArrayBuffer
}

export type FontWardrobeSettings = {
  activeFontId: string | null
}

type StoredSettingsRecord =
  FontWardrobeSettings & {
    key: typeof SETTINGS_KEY
  }

function requestResult<T>(
  request: IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(
      request.error
      ?? new Error('IndexedDB request failed.'),
    )
  })
}

function transactionComplete(
  transaction: IDBTransaction,
) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(
      transaction.error
      ?? new Error('IndexedDB transaction aborted.'),
    )
    transaction.onerror = () => reject(
      transaction.error
      ?? new Error('IndexedDB transaction failed.'),
    )
  })
}

export async function openFontWardrobe() {
  if (!('indexedDB' in window)) {
    throw new Error(
      '这个浏览器暂时不能保存字体衣柜。System 字体仍可使用。',
    )
  }

  const request = window.indexedDB.open(
    FONT_WARDROBE_DB_NAME,
    FONT_WARDROBE_DB_VERSION,
  )

  request.onupgradeneeded = () => {
    const database = request.result

    if (!database.objectStoreNames.contains(FONT_STORE_NAME)) {
      const store = database.createObjectStore(
        FONT_STORE_NAME,
        { keyPath: 'id' },
      )

      store.createIndex(
        'displayNameKey',
        'displayNameKey',
        { unique: true },
      )
      store.createIndex(
        'normalizedSourceUrl',
        'normalizedSourceUrl',
        { unique: true },
      )
    }

    if (!database.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
      database.createObjectStore(
        SETTINGS_STORE_NAME,
        { keyPath: 'key' },
      )
    }
  }

  const database = await requestResult(request)

  database.onversionchange = () => {
    database.close()
  }

  return database
}

function withStorageKeys(font: StoredFont) {
  return {
    ...font,
    displayNameKey:
      font.displayName.toLocaleLowerCase(),
  }
}

function withoutStorageKeys(value: StoredFont & {
  displayNameKey?: string
}) {
  const {
    displayNameKey: _displayNameKey,
    ...font
  } = value

  return font
}

export async function listStoredFonts(
  database: IDBDatabase,
) {
  const transaction = database.transaction(
    FONT_STORE_NAME,
    'readonly',
  )
  const values = await requestResult(
    transaction
      .objectStore(FONT_STORE_NAME)
      .getAll(),
  ) as Array<StoredFont & {
    displayNameKey?: string
  }>

  await transactionComplete(transaction)

  return values
    .map(withoutStorageKeys)
    .sort((left, right) =>
      left.createdAt - right.createdAt,
    )
}

export async function getStoredFont(
  database: IDBDatabase,
  id: string,
) {
  const transaction = database.transaction(
    FONT_STORE_NAME,
    'readonly',
  )
  const value = await requestResult(
    transaction
      .objectStore(FONT_STORE_NAME)
      .get(id),
  ) as (StoredFont & {
    displayNameKey?: string
  }) | undefined

  await transactionComplete(transaction)

  return value
    ? withoutStorageKeys(value)
    : null
}

export async function getWardrobeSettings(
  database: IDBDatabase,
): Promise<FontWardrobeSettings> {
  const transaction = database.transaction(
    SETTINGS_STORE_NAME,
    'readonly',
  )
  const value = await requestResult(
    transaction
      .objectStore(SETTINGS_STORE_NAME)
      .get(SETTINGS_KEY),
  ) as StoredSettingsRecord | undefined

  await transactionComplete(transaction)

  return {
    activeFontId:
      typeof value?.activeFontId === 'string'
        ? value.activeFontId
        : null,
  }
}

export async function saveStoredFont(
  database: IDBDatabase,
  font: StoredFont,
) {
  const transaction = database.transaction(
    FONT_STORE_NAME,
    'readwrite',
  )
  const store = transaction.objectStore(
    FONT_STORE_NAME,
  )
  const values = await requestResult(
    store.getAll(),
  ) as Array<StoredFont & {
    displayNameKey?: string
  }>

  if (values.length >= MAX_SAVED_FONTS) {
    transaction.abort()
    throw new Error('字体衣柜最多保存 12 套字体。')
  }

  const knownBytes = values.reduce(
    (sum, value) => sum + value.byteLength,
    0,
  )

  if (knownBytes + font.byteLength > MAX_WARDROBE_BYTES) {
    transaction.abort()
    throw new Error('字体衣柜总容量不能超过 100 MiB。')
  }

  store.add(withStorageKeys(font))
  await transactionComplete(transaction)
}

export async function setActiveFontId(
  database: IDBDatabase,
  activeFontId: string | null,
) {
  const transaction = database.transaction(
    SETTINGS_STORE_NAME,
    'readwrite',
  )

  transaction
    .objectStore(SETTINGS_STORE_NAME)
    .put({
      key: SETTINGS_KEY,
      activeFontId,
    } satisfies StoredSettingsRecord)

  await transactionComplete(transaction)
}

export async function renameStoredFont(
  database: IDBDatabase,
  id: string,
  displayName: string,
) {
  const transaction = database.transaction(
    FONT_STORE_NAME,
    'readwrite',
  )
  const store = transaction.objectStore(
    FONT_STORE_NAME,
  )
  const existing = await requestResult(
    store.get(id),
  ) as (StoredFont & {
    displayNameKey?: string
  }) | undefined

  if (!existing) {
    transaction.abort()
    throw new Error('找不到这套字体。')
  }

  store.put(withStorageKeys({
    ...withoutStorageKeys(existing),
    displayName,
  }))

  await transactionComplete(transaction)
}

export async function deleteStoredFont(
  database: IDBDatabase,
  id: string,
) {
  const transaction = database.transaction(
    [FONT_STORE_NAME, SETTINGS_STORE_NAME],
    'readwrite',
  )
  const settingsStore = transaction.objectStore(
    SETTINGS_STORE_NAME,
  )
  const settings = await requestResult(
    settingsStore.get(SETTINGS_KEY),
  ) as StoredSettingsRecord | undefined

  if (settings?.activeFontId === id) {
    settingsStore.put({
      key: SETTINGS_KEY,
      activeFontId: null,
    } satisfies StoredSettingsRecord)
  }

  transaction
    .objectStore(FONT_STORE_NAME)
    .delete(id)

  await transactionComplete(transaction)
}
