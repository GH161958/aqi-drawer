import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MAX_CHARACTERS = 8000
const PDF_COMMAND_TIMEOUT_MS = 12000
const TEXT_EXTENSIONS = new Map([
  ['.md', ['text/markdown', 'text/plain', 'application/octet-stream']],
  ['.markdown', ['text/markdown', 'text/plain', 'application/octet-stream']],
  ['.txt', ['text/plain', 'application/octet-stream']],
  ['.csv', ['text/csv', 'text/plain', 'application/octet-stream']],
  ['.json', ['application/json', 'text/plain', 'application/octet-stream']],
])

export class AttachmentReadError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AttachmentReadError'
  }
}

function reject(message) {
  throw new AttachmentReadError(message)
}

function pageSlice(text, offset, maxChars) {
  const characters = Array.from(text)
  if (offset > characters.length) reject('Text offset is beyond the end of this document or page.')
  const next = Math.min(characters.length, offset + maxChars)
  return {
    text: characters.slice(offset, next).join(''),
    offset,
    totalCharacters: characters.length,
    hasMore: next < characters.length,
    nextOffset: next < characters.length ? next : null,
  }
}

async function extractPdfPage(bytes, page, execute) {
  const directory = await mkdtemp(path.join(tmpdir(), 'aqi-drawer-pdf-read-'))
  const file = path.join(directory, 'document.pdf')
  try {
    await writeFile(file, bytes, { flag: 'wx', mode: 0o600 })
    let info
    try {
      info = await execute('pdfinfo', [file], {
        timeout: PDF_COMMAND_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        encoding: 'utf8',
      })
    } catch (error) {
      if (error?.code === 'ENOENT') reject('PDF text extraction is unavailable on this server.')
      reject('PDF metadata could not be read (invalid, encrypted, or timed out).')
    }
    const pages = /^Pages:\s*(\d+)\s*$/mi.exec(info.stdout)?.[1]
    const totalPages = Number(pages)
    if (!Number.isSafeInteger(totalPages) || totalPages < 1 || totalPages > 10000) {
      reject('PDF page count is invalid or exceeds the V1 safety limit.')
    }
    if (page > totalPages) reject('Requested page is beyond the end of this PDF.')
    let output
    try {
      output = await execute('pdftotext', [
        '-f', String(page), '-l', String(page),
        '-enc', 'UTF-8', '-nopgbrk', file, '-',
      ], {
        timeout: PDF_COMMAND_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8',
      })
    } catch (error) {
      if (error?.code === 'ENOENT') reject('PDF text extraction is unavailable on this server.')
      reject('PDF page text could not be extracted (invalid, encrypted, or timed out).')
    }
    return { text: output.stdout, totalPages }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

// One explicit item + attachment, read from existing canonical Store/Media.
// Never resolve a caller-supplied path, follow a URL, mutate a Pocket item,
// or return the original bytes in an ordinary MCP text response.
export async function readOriginalAttachment(
  store,
  { itemId, attachmentId, page = 1, offset = 0, maxChars = 6000 },
  { execute = execFileAsync } = {},
) {
  if (!store?.readItemAttachment) reject('Drawer attachment reader is unavailable.')
  if (typeof itemId !== 'string' || !itemId || typeof attachmentId !== 'string' || !attachmentId) {
    reject('A valid item ID and attachment ID are required.')
  }
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000
    || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_ATTACHMENT_BYTES
    || !Number.isSafeInteger(maxChars) || maxChars < 500 || maxChars > MAX_CHARACTERS) {
    reject('Invalid page, offset, or maximum character count.')
  }
  let found
  try {
    found = await store.readItemAttachment(itemId, attachmentId, MAX_ATTACHMENT_BYTES)
  } catch (error) {
    if (error?.status === 413) reject('Attachment exceeds the 25 MiB read limit.')
    throw error
  }
  if (!found) reject('Attachment not found on this active Drawer item.')
  const attachment = found.attachment
  const bytes = found.data
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_ATTACHMENT_BYTES) {
    reject('Attachment is empty or exceeds the 25 MiB read limit.')
  }
  if (Number.isFinite(attachment.size) && attachment.size !== bytes.length) {
    reject('Original attachment size does not match stored metadata.')
  }
  const computedSha256 = createHash('sha256').update(bytes).digest('hex')
  if (attachment.sha256 && attachment.sha256.toLowerCase() !== computedSha256) {
    reject('Original attachment digest does not match stored metadata.')
  }
  const filename = String(attachment.name || 'untitled')
  const extension = path.extname(filename).toLowerCase()
  const mimeType = String(attachment.mimeType || '').split(';')[0].trim().toLowerCase()
  const common = {
    itemId,
    attachmentId,
    filename,
    mimeType,
    size: bytes.length,
    sha256: computedSha256,
    trust: 'untrusted_document_content',
  }

  if (extension === '.pdf') {
    if (!['application/pdf', 'application/octet-stream', ''].includes(mimeType)
      || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
      reject('Attachment PDF type or file signature is invalid.')
    }
    const extracted = await extractPdfPage(bytes, page, execute)
    const slice = pageSlice(extracted.text, offset, maxChars)
    return {
      ...common,
      format: 'pdf',
      page,
      totalPages: extracted.totalPages,
      ...slice,
      noExtractableText: extracted.text.trim().length === 0,
      nextPage: !slice.hasMore && page < extracted.totalPages ? page + 1 : null,
    }
  }

  const allowedMime = TEXT_EXTENSIONS.get(extension)
  if (!allowedMime || (mimeType && !allowedMime.includes(mimeType))) {
    reject('Only PDF, UTF-8 Markdown, TXT, CSV, and JSON are supported in V1.')
  }
  if (page !== 1) reject('Use offset, not page, when reading a UTF-8 document.')
  if (bytes.includes(0)) reject('Text attachment contains binary bytes.')
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    reject('Text attachment is not valid UTF-8.')
  }
  return {
    ...common,
    format: extension.slice(1),
    page: null,
    totalPages: null,
    ...pageSlice(decoded, offset, maxChars),
    noExtractableText: false,
    nextPage: null,
  }
}
