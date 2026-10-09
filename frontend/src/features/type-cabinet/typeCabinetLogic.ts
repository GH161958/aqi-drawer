import {
  MAX_SAVED_FONTS,
  MAX_WARDROBE_BYTES,
  type StoredFont,
  type StoredFontFormat,
} from './fontWardrobeStorage'

export const LEGACY_TYPE_STORAGE_KEY = 'aqi-drawer:type-preset'
export const MAX_FONT_BYTES = 20 * 1024 * 1024
export const MAX_DISPLAY_NAME_LENGTH = 60
export const MAX_FONT_URL_LENGTH = 2048
export const SUPPORTED_FONT_EXTENSIONS = [
  'woff2', 'woff', 'ttf', 'otf',
] as const

const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "PingFang TC", system-ui, sans-serif'

export interface SystemFontChoice {
  kind: 'system'
}

export interface CustomFontChoice {
  kind: 'custom'
  fontId: string
  displayName: string
  face: FontFace
}

export type FontChoice = SystemFontChoice | CustomFontChoice
export const SYSTEM_FONT_CHOICE: SystemFontChoice = { kind: 'system' }

let committedChoice: FontChoice = SYSTEM_FONT_CHOICE
let displayedChoice: FontChoice = SYSTEM_FONT_CHOICE

function removeLegacyPreset() {
  try {
    window.localStorage.removeItem(LEGACY_TYPE_STORAGE_KEY)
  } catch {
    // Legacy cleanup is best-effort. System fonts remain available.
  }
}

function extensionFromName(value: string): StoredFontFormat | null {
  const extension = value.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_FONT_EXTENSIONS.includes(extension as StoredFontFormat)
    ? extension as StoredFontFormat
    : null
}

function nextId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function familyForFontId(id: string) {
  return `Aqi User Font ${id.replace(/[^a-zA-Z0-9-]/g, '')}`
}

function removeFace(choice: FontChoice) {
  if (choice.kind === 'custom') {
    document.fonts.delete(choice.face)
  }
}

export function initializeFontDressingRoom() {
  removeLegacyPreset()
  delete document.body.dataset.typePreset
  applyFontChoice(committedChoice)
}

export function getCommittedFontChoice() {
  return committedChoice
}

export function sameFontChoice(left: FontChoice, right: FontChoice) {
  if (left.kind === 'system' || right.kind === 'system') {
    return left.kind === right.kind
  }
  return left.fontId === right.fontId && left.face === right.face
}

export function applyFontChoice(choice: FontChoice) {
  const previous = displayedChoice
  if (!sameFontChoice(previous, choice)) {
    removeFace(previous)
  }
  if (choice.kind === 'custom' && !document.fonts.has(choice.face)) {
    document.fonts.add(choice.face)
  }
  displayedChoice = choice

  const root = document.documentElement
  if (choice.kind === 'custom') {
    const stack = `"${choice.face.family}", ${SYSTEM_FONT_STACK}`
    root.style.setProperty('--font-reading', stack)
    root.style.setProperty('--font-display', stack)
  } else {
    root.style.removeProperty('--font-reading')
    root.style.removeProperty('--font-display')
  }
}

export function commitFontChoice(choice: FontChoice) {
  const previous = committedChoice
  committedChoice = choice
  applyFontChoice(choice)
  if (!sameFontChoice(previous, choice)) {
    removeFace(previous)
  }
}

export function releaseFontChoice(choice: FontChoice) {
  if (
    sameFontChoice(choice, committedChoice)
    || sameFontChoice(choice, displayedChoice)
  ) {
    return
  }
  removeFace(choice)
}

export function normalizeDisplayName(value: string) {
  const name = value.trim()
  if (!name) throw new Error('请给这套字体起一个名字。')
  if (name.length > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error('字体名称不能超过 60 个字符。')
  }
  return name
}

export function defaultDisplayName(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, '').trim()
  return stem.slice(0, MAX_DISPLAY_NAME_LENGTH) || 'Untitled font'
}

export function validateStoredFontRecord(font: StoredFont) {
  if (
    font.schemaVersion !== 1
    || font.slot !== 'combined'
    || !font.id
    || !font.displayName
    || !SUPPORTED_FONT_EXTENSIONS.includes(font.format)
    || !(font.fontBytes instanceof ArrayBuffer)
    || font.byteLength !== font.fontBytes.byteLength
    || font.byteLength <= 0
    || font.byteLength > MAX_FONT_BYTES
  ) {
    throw new Error(
      '这套字体的本地记录不完整。可以在衣柜中删除它后重新导入。',
    )
  }
}

export async function loadStoredFontChoice(font: StoredFont) {
  validateStoredFontRecord(font)
  try {
    const face = new FontFace(
      familyForFontId(font.id),
      font.fontBytes.slice(0),
    )
    await face.load()
    return {
      kind: 'custom',
      fontId: font.id,
      displayName: font.displayName,
      face,
    } satisfies CustomFontChoice
  } catch {
    throw new Error(
      '浏览器没能读懂这套已保存的字体。可以删除后重新导入。',
    )
  }
}

async function validatedRecord(
  input: Omit<StoredFont, 'id' | 'schemaVersion' | 'slot' | 'byteLength' | 'createdAt'>,
) {
  if (input.fontBytes.byteLength === 0) {
    throw new Error('这个字体文件是空的。')
  }
  if (input.fontBytes.byteLength > MAX_FONT_BYTES) {
    throw new Error('字体文件不能超过 20 MiB。')
  }
  const record: StoredFont = {
    ...input,
    id: nextId(),
    schemaVersion: 1,
    slot: 'combined',
    byteLength: input.fontBytes.byteLength,
    createdAt: Date.now(),
  }
  const choice = await loadStoredFontChoice(record)
  return { record, choice }
}

export async function createStoredFontFromFile(
  file: File,
  requestedDisplayName: string,
) {
  const format = extensionFromName(file.name)
  if (!format) {
    throw new Error('请选择 .woff2、.woff、.ttf 或 .otf 字体。')
  }
  if (file.size > MAX_FONT_BYTES) {
    throw new Error('字体文件不能超过 20 MiB。')
  }
  return validatedRecord({
    displayName: normalizeDisplayName(requestedDisplayName),
    sourceType: 'file',
    originalFilename: file.name,
    format,
    fontBytes: await file.arrayBuffer(),
  })
}

export function normalizeFontUrl(value: string) {
  if (value.length > MAX_FONT_URL_LENGTH) throw new Error('字体网址太长了。')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('请输入完整的 HTTPS 字体网址。')
  }
  if (url.protocol !== 'https:') throw new Error('字体网址必须使用 https://。')
  if (url.username || url.password) {
    throw new Error('字体网址不能包含用户名或密码。')
  }
  url.hash = ''
  return url.href
}

async function readLimitedResponse(response: Response) {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_FONT_BYTES) {
    throw new Error('字体文件不能超过 20 MiB。')
  }
  if (!response.body) {
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_FONT_BYTES) {
      throw new Error('字体文件不能超过 20 MiB。')
    }
    return bytes
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > MAX_FONT_BYTES) {
        await reader.cancel()
        throw new Error('字体文件不能超过 20 MiB。')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

export async function createStoredFontFromUrl(
  requestedUrl: string,
  requestedDisplayName: string,
) {
  const normalizedSourceUrl = normalizeFontUrl(requestedUrl)
  const requestedFormat = extensionFromName(new URL(normalizedSourceUrl).pathname)
  if (!requestedFormat) {
    throw new Error('字体网址需要指向 .woff2、.woff、.ttf 或 .otf 文件。')
  }

  let response: Response
  try {
    response = await fetch(normalizedSourceUrl, {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
    })
  } catch {
    throw new Error(
      '这个字体网址不允许浏览器读取。请下载字体文件后使用本地导入。',
    )
  }
  if (!response.ok) throw new Error(`字体下载失败（${response.status}）。`)

  const finalUrl = new URL(response.url || normalizedSourceUrl)
  if (finalUrl.protocol !== 'https:') {
    throw new Error('字体网址重定向到了非 HTTPS 地址。')
  }
  const finalFormat = extensionFromName(finalUrl.pathname) ?? requestedFormat
  return validatedRecord({
    displayName: normalizeDisplayName(requestedDisplayName),
    sourceType: 'url',
    sourceUrl: normalizedSourceUrl,
    normalizedSourceUrl,
    format: finalFormat,
    fontBytes: await readLimitedResponse(response),
  })
}

export function assertNoWardrobeConflict(
  fonts: StoredFont[],
  candidate: Pick<StoredFont, 'displayName' | 'normalizedSourceUrl'>,
  ignoredId?: string,
) {
  const nameKey = candidate.displayName.toLocaleLowerCase()
  if (fonts.some((font) =>
    font.id !== ignoredId
    && font.displayName.toLocaleLowerCase() === nameKey,
  )) {
    throw new Error('衣柜里已经有同名字体。')
  }
  if (
    candidate.normalizedSourceUrl
    && fonts.some((font) =>
      font.id !== ignoredId
      && font.normalizedSourceUrl === candidate.normalizedSourceUrl,
    )
  ) {
    throw new Error('这个字体网址已经导入过了。')
  }
}

export function wardrobeLimitsLabel() {
  return `${MAX_SAVED_FONTS} fonts · ${MAX_WARDROBE_BYTES / 1024 / 1024} MiB total`
}
