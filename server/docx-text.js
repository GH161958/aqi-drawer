import { inflateRawSync } from 'node:zlib'

// Read only the OOXML Word main document part. Never expand an archive to disk,
// execute macros, dereference external relationships, or return original bytes.
// Limits are intentionally independent of the existing 25 MiB attachment cap.
const MAX_ZIP_ENTRIES = 2000
const MAX_XML_BYTES = 8 * 1024 * 1024
const MAX_TEXT_CHARACTERS = 2_000_000

export class DocxTextError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DocxTextError'
  }
}

function invalid() {
  throw new DocxTextError('DOCX is invalid, unsupported, or exceeds safe extraction limits.')
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function findEndOfCentralDirectory(bytes) {
  for (let pos = bytes.length - 22; pos >= Math.max(0, bytes.length - 22 - 65535); pos--) {
    if (bytes.readUInt32LE(pos) === 0x06054b50
      && pos + 22 + bytes.readUInt16LE(pos + 20) === bytes.length) return pos
  }
  invalid()
}

function readMainDocumentXml(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 22) invalid()
  const end = findEndOfCentralDirectory(bytes)
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) invalid()
  const count = bytes.readUInt16LE(end + 10)
  if (count < 1 || count > MAX_ZIP_ENTRIES || bytes.readUInt16LE(end + 8) !== count) invalid()
  const centralLength = bytes.readUInt32LE(end + 12)
  const centralStart = bytes.readUInt32LE(end + 16)
  if (centralStart > end || centralLength > end - centralStart) invalid()
  let pos = centralStart
  let result = null

  for (let i = 0; i < count; i++) {
    if (pos + 46 > centralStart + centralLength || bytes.readUInt32LE(pos) !== 0x02014b50) invalid()
    const flags = bytes.readUInt16LE(pos + 8)
    const method = bytes.readUInt16LE(pos + 10)
    const expectedCrc = bytes.readUInt32LE(pos + 16)
    const compressedSize = bytes.readUInt32LE(pos + 20)
    const originalSize = bytes.readUInt32LE(pos + 24)
    const nameLength = bytes.readUInt16LE(pos + 28)
    const extraLength = bytes.readUInt16LE(pos + 30)
    const commentLength = bytes.readUInt16LE(pos + 32)
    const localOffset = bytes.readUInt32LE(pos + 42)
    const next = pos + 46 + nameLength + extraLength + commentLength
    if (next > centralStart + centralLength) invalid()
    const name = bytes.subarray(pos + 46, pos + 46 + nameLength).toString('utf8')
    pos = next
    if (name !== 'word/document.xml') continue
    if (result !== null || flags & 1 || ![0, 8].includes(method)
      || originalSize > MAX_XML_BYTES || originalSize === 0) invalid()
    if (localOffset + 30 > centralStart || bytes.readUInt32LE(localOffset) !== 0x04034b50) invalid()
    const localNameLength = bytes.readUInt16LE(localOffset + 26)
    const localExtraLength = bytes.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart > centralStart || compressedSize > centralStart - dataStart) invalid()
    if (!bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)
      .equals(Buffer.from('word/document.xml'))) invalid()
    let extracted
    try {
      const data = bytes.subarray(dataStart, dataStart + compressedSize)
      extracted = method === 8
        ? inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES })
        : Buffer.from(data)
    } catch {
      invalid()
    }
    if (extracted.length !== originalSize || crc32(extracted) !== expectedCrc) invalid()
    result = extracted
  }
  if (!result || pos !== centralStart + centralLength) invalid()
  let xml
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(result)
  } catch {
    invalid()
  }
  if (/<!(?:DOCTYPE|ENTITY)/i.test(xml) || !/<w:document(?:\s|>)/.test(xml)
    || !/<w:body(?:\s|>)/.test(xml)) invalid()
  return xml
}

function decodeXmlText(raw) {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, name) => {
    if (name[0] === '#') {
      const value = name[1]?.toLowerCase() === 'x'
        ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
      if (!Number.isInteger(value) || value < 0 || value > 0x10ffff
        || (value >= 0xd800 && value <= 0xdfff)) invalid()
      return String.fromCodePoint(value)
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name] ?? whole
  })
}

// Main body selectable text only. Keep paragraph/table boundaries for useful
// reading, but never present this as faithful Word layout or revision history.
export function extractDocxMainText(bytes) {
  const xml = readMainDocumentXml(bytes)
  const out = []
  let inText = false
  let deleted = 0
  let characters = 0
  const push = (s) => {
    if (!s) return
    characters += s.length
    if (characters > MAX_TEXT_CHARACTERS) invalid()
    out.push(s)
  }
  for (const m of xml.matchAll(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)) {
    const value = m[0]
    if (value.startsWith('<!--')) continue
    if (!value.startsWith('<')) {
      if (inText && deleted === 0) push(decodeXmlText(value))
      continue
    }
    const tag = /^<\s*(\/?)\s*([\w:.-]+)/.exec(value)
    if (!tag) continue
    const closing = tag[1] === '/'
    const selfClosing = /\/\s*>$/.test(value)
    const name = tag[2]
    if (name === 'w:del') {
      if (closing) deleted = Math.max(0, deleted - 1)
      else if (!selfClosing) deleted++
      continue
    }
    if (name === 'w:t') {
      inText = !closing && !selfClosing
      continue
    }
    if (deleted > 0) continue
    if (!closing && (name === 'w:tab')) push('\t')
    if (!closing && (name === 'w:br' || name === 'w:cr')) push('\n')
    if (closing && name === 'w:p') push('\n')
    if (closing && name === 'w:tc') push('\t')
  }
  return out.join('').replace(/[\t ]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trimEnd()
}
