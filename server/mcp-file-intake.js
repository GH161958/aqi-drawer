import { createHash, randomUUID } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import https from 'node:https'
import { isIP, BlockList } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import { createMcpFileOperation } from './mcp-file-operation.js'

export const MAX_MCP_FILE_BYTES = 25 * 1024 * 1024
const BLOCKED = new BlockList()
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10],
  ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) BLOCKED.addSubnet(prefix, bits, 'ipv4')
BLOCKED.addAddress('255.255.255.255', 'ipv4')

function publicIPv4(value) {
  return isIP(value) === 4 && !BLOCKED.check(value, 'ipv4')
}

export function permittedFileHosts(value) {
  const entries = Array.isArray(value) ? value : String(value || '').split(',')
  return entries.map((entry) => String(entry).trim().toLowerCase()).filter((entry) => {
    return /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(entry)
      && !entry.startsWith('-') && !entry.includes('..')
      && !entry.endsWith('.local') && !entry.endsWith('.internal')
  }).filter((host, index, all) => all.indexOf(host) === index)
}

export function validateMcpFileUrl(input, allowedHosts) {
  let url
  try { url = new URL(input) } catch { throw new Error('Invalid temporary file URL.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
    throw new Error('Temporary file URL must use HTTPS without credentials, custom ports or fragments.')
  }
  if (isIP(url.hostname) || !permittedFileHosts(allowedHosts).includes(url.hostname.toLowerCase())) {
    throw new Error('Temporary file host is not explicitly allowlisted.')
  }
  return url
}

// Probe is a metadata-only inspection of a ChatGPT-provided fileParams value.
// Never perform DNS resolution, fetch the URL, access Store, or echo a signed
// URL, token, path, query, file_id, file name, or MIME in the result.
export function describeMcpFileHost(file) {
  if (!file || typeof file !== 'object'
    || typeof file.file_id !== 'string' || !file.file_id.trim()
    || typeof file.download_url !== 'string' || !file.download_url) {
    throw new Error('A ChatGPT file parameter is required for a hostname-only probe.')
  }
  let url
  try { url = new URL(file.download_url) } catch {
    throw new Error('Temporary file URL is invalid.')
  }
  if (url.protocol !== 'https:' || url.username || url.password
    || url.port || url.hash || isIP(url.hostname)) {
    throw new Error('Temporary file host must be a plain HTTPS DNS hostname.')
  }
  const candidate = url.hostname.toLowerCase()
  if (!permittedFileHosts([candidate]).includes(candidate)) {
    throw new Error('Temporary file hostname is not suitable for allowlist review.')
  }
  return {
    hostname: candidate,
    noDownload: true,
    noStorageWrite: true,
    approvedForDownloads: false,
    nextStep: 'Ask EE to independently review the hostname before allowing any file download.',
  }
}

function safeName(value) {
  const name = String(value || '').replaceAll('\\', '/').split('/').at(-1)
    .split('').filter((char) => char.charCodeAt(0) > 31 && char.charCodeAt(0) !== 127).join('').trim().slice(0, 200)
  if (!name || name === '.' || name === '..' || !/\.[A-Za-z0-9]{1,8}$/u.test(name)) {
    throw new Error('File needs a safe name with a supported extension.')
  }
  return name
}

// Bounded comparisons for technical metadata only. Never inspect title/text.
const normalizeTechnicalId = value => String(value).slice(0, 4096).normalize('NFKC').toLowerCase()
const compactTechnicalId = value => normalizeTechnicalId(value).replace(/[^\p{L}\p{N}]/gu, '')

function containsLongFileId(value, fileId) {
  const rawId = normalizeTechnicalId(fileId)
  const raw = normalizeTechnicalId(value)
  if (rawId.length >= 16 && raw.includes(rawId)) return true
  const name = compactTechnicalId(value)
  const id = compactTechnicalId(fileId)
  const tail = compactTechnicalId(String(fileId).split(/[\\/:]/u).at(-1))
  return [id, tail].filter(alias => alias.length >= 16).some(alias =>
    name.includes(alias) || (alias.length >= 24
      && (name.includes(alias.slice(0, 16)) || name.includes(alias.slice(-16)))))
}

export function validateMcpFileRequestIdPrivacy(requestId, fileId) {
  if (containsLongFileId(requestId, fileId)) {
    throw new Error('Use an independent stable request_id, not a temporary file identifier.')
  }
}

function technicalFileName(file) {
  const raw = String(file.file_name || '')
  if (raw.length > 4096) throw new Error('Technical file name is too long.')
  const safe = safeName(raw)
  const extension = path.extname(safe)
  // Percent-bearing host names are deliberately opaque: do not decode them.
  // Keep the supplied plain extension, then run the existing type validation.
  const sensitive = raw.includes('%') || containsLongFileId(raw, file.file_id)
    || normalizeTechnicalId(path.basename(safe, extension)) === normalizeTechnicalId(file.file_id)
    || normalizeTechnicalId(raw).includes(normalizeTechnicalId(file.download_url))
  return sensitive ? 'chatgpt-file' + extension : safe
}

const EXT_BY_MIME = {
  'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg',
  'image/gif': '.gif', 'image/webp': '.webp', 'text/plain': '.txt',
  'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
}

function resolveFileName(file, bytes) {
  if (file.file_name) return technicalFileName(file)
  const mime = String(file.mime_type || '').split(';')[0].toLowerCase()
  const first = bytes.subarray(0, 16)
  const extension = EXT_BY_MIME[mime]
    || (first.subarray(0, 5).toString() === '%PDF-' ? '.pdf' : '')
    || (first.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? '.png' : '')
    || (first.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? '.jpg' : '')
    || (['GIF87a', 'GIF89a'].includes(first.subarray(0, 6).toString()) ? '.gif' : '')
    || (first.subarray(0, 4).toString() === 'RIFF' && first.subarray(8, 12).toString() === 'WEBP' ? '.webp' : '')
  if (!extension) throw new Error('The file host omitted its name and type. Provide a supported file name or MIME type.')
  return 'chatgpt-file' + extension
}

function classifyFile(name, bytes, declaredMime = '') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > MAX_MCP_FILE_BYTES) {
    throw new Error('File must contain 1 to 25 MiB of data.')
  }
  const extension = path.extname(name).toLowerCase()
  const head = bytes.subarray(0, 16)
  const signature = {
    '.pdf': ['application/pdf', head.subarray(0, 5).toString() === '%PDF-'],
    '.png': ['image/png', head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))],
    '.jpg': ['image/jpeg', head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))],
    '.jpeg': ['image/jpeg', head.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))],
    '.gif': ['image/gif', ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString())],
    '.webp': ['image/webp', head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP'],
    '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))],
    '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))],
    '.pptx': ['application/vnd.openxmlformats-officedocument.presentationml.presentation', head.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))],
  }[extension]
  let mime
  if (signature) {
    if (!signature[1]) throw new Error('File signature does not match its extension.')
    mime = signature[0]
  } else if (['.txt', '.md', '.csv', '.json'].includes(extension)) {
    if (bytes.includes(0)) throw new Error('Text file contains binary bytes.')
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error('Text file must be UTF-8.') }
    if (extension === '.json') {
      try { JSON.parse(bytes.toString('utf8')) } catch { throw new Error('Invalid JSON file.') }
    }
    mime = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.json': 'application/json' }[extension]
  } else {
    throw new Error('File type is not supported for MCP Intake V1.')
  }
  const advertised = String(declaredMime || '').split(';')[0].trim().toLowerCase()
  if (advertised && advertised !== 'application/octet-stream' && advertised !== mime
    && !(mime.startsWith('text/') && advertised === 'text/plain')) {
    throw new Error('File MIME metadata conflicts with the verified file type.')
  }
  return mime
}

// file_id is an opaque host-issued identifier. The MCP fileParams contract
// does not mandate a "file_" prefix. Reject blank, control-containing and
// unreasonably large values without logging or otherwise exposing the ID.
export function validChatGptFileId(value) {
  return typeof value === 'string'
    && value.length <= 512
    && value.trim().length > 0
    && [...value].every((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
}

export function validateMcpFileBytes(file, bytes) {
  if (!file || typeof file !== 'object' || !validChatGptFileId(file.file_id)) {
    throw new Error('A valid ChatGPT file_id is required.')
  }
  const filename = resolveFileName(file, bytes)
  return { filename, mimeType: classifyFile(filename, bytes, file.mime_type) }
}

// Fetch is intentionally restrictive: explicitly allowed HTTPS host only,
// every resolved IPv4 address checked, pinned IP for the TLS connection,
// no HTTP redirects, bounded bytes and time. Signed URLs never get logged.
export async function downloadChatGptFile(file, {
  allowedHosts, resolver, operation, request = https.get,
} = {}) {
  const ownOperation = !operation
  operation ||= createMcpFileOperation()
  const { signal } = operation
  // One resolver per transfer: aborting it cannot cancel another request's DNS.
  const dns = resolver ? null : new Resolver({ timeout: 15000, tries: 1 })
  const cancelDns = () => dns?.cancel()
  signal.addEventListener('abort', cancelDns, { once: true })
  try {
    operation.check()
    const url = validateMcpFileUrl(file?.download_url, allowedHosts)
    // Custom resolvers may ignore cancellation: detach and discard late results
    // before HTTPS. The production resolver's active DNS query is cancelled.
    const addresses = await operation.wait(resolver
      ? resolver(url.hostname, { all: true, family: 4, verbatim: true, signal })
      : dns.resolve4(url.hostname).then(values => values.map(address => ({ address, family: 4 }))))
    operation.check()
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !publicIPv4(entry.address))) {
      throw new Error('File host DNS address is not a permitted public IPv4 address.')
    }
    const address = addresses[0].address
    return await operation.wait(new Promise((resolve, reject) => {
      const req = request(url, {
        agent: false, signal, timeout: 15000,
        headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
        lookup: (_name, options, cb) => {
          if (options?.all) cb(null, [{ address, family: 4 }])
          else cb(null, address, 4)
        },
      }, async (res) => {
        if (res.statusCode !== 200 || Number(res.headers['content-length']) > MAX_MCP_FILE_BYTES) {
          res.destroy()
          reject(new Error('Temporary file download failed, redirected or exceeded the size limit.'))
          return
        }
        const chunks = []
        let total = 0
        try {
          await pipeline(res, new Transform({
            transform(chunk, _encoding, callback) {
              total += chunk.length
              if (total > MAX_MCP_FILE_BYTES) {
                callback(new Error('File exceeds the 25 MiB Intake limit.'))
                return
              }
              chunks.push(chunk)
              callback()
            },
          }), { signal })
          operation.check()
          if (!total) throw new Error('Downloaded file is empty.')
          resolve(Buffer.concat(chunks, total))
        } catch (error) {
          req.destroy()
          reject(error)
        }
      })
      const abort = () => req.destroy(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      req.once('close', () => signal.removeEventListener('abort', abort))
      req.on('timeout', () => req.destroy(new Error('File download timed out.')))
      req.on('error', reject)
      if (signal.aborted) abort()
    }))
  } finally {
    signal.removeEventListener('abort', cancelDns)
    cancelDns()
    if (ownOperation) operation.dispose()
  }
}

// The URL participates only in a one-way fingerprint, never in durable state.
// A changed URL is a new byte claim even if the opaque file_id is unchanged.
export function describeMcpFileIntakeRequest({ requestId, mode, itemId, title = '', text = '', file }) {
  if (!['new', 'append'].includes(mode)) throw new Error('Choose new or append.')
  if (!/^[A-Za-z0-9_.:-]{8,120}$/u.test(String(requestId || ''))) {
    throw new Error('A stable 8–120 character request_id is required.')
  }
  if (mode === 'new' && itemId) throw new Error('New file Intake must not supply an item ID.')
  if (mode === 'append' && (!itemId || title || text)) throw new Error('Append requires existing item_id, without title or text replacement.')
  if (typeof title !== 'string' || title.length > 160 || typeof text !== 'string' || text.length > 20000) {
    throw new Error('File item title/text is too long.')
  }
  if (!validChatGptFileId(file?.file_id)) throw new Error('A valid ChatGPT file_id is required.')
  validateMcpFileRequestIdPrivacy(requestId, file.file_id)
  describeMcpFileHost(file)
  const filename = file.file_name ? technicalFileName(file) : ''
  const requestHash = createHash('sha256').update(JSON.stringify([
    mode, itemId || '', title, text, file.file_id, filename, file.mime_type || '',
    file.download_url,
  ])).digest('hex')
  return { requestId, requestHash, mode, itemId: itemId || '', title, text }
}

export async function readMcpFileIntakeReceipt(store, input) {
  const previous = await store.getMcpFileIntakeReceipt(input)
  if (!previous) return null
  const stored = await store.readAttachment(previous.attachmentId, MAX_MCP_FILE_BYTES)
  if (!stored || stored.data.length !== previous.bytes
    || createHash('sha256').update(stored.data).digest('hex') !== previous.sha256) {
    throw new Error('Previously saved attachment is missing or corrupted. Manual review required.')
  }
  const current = await store.getMcpFileIntakeReceipt(input)
  if (!current || current.attachmentId !== previous.attachmentId
    || current.sha256 !== previous.sha256 || current.bytes !== previous.bytes
    || current.mimeType !== previous.mimeType) {
    throw new Error('Original Intake attachment changed during retry. Manual review required.')
  }
  return { ...current, duplicate: true }
}

export function createMcpFileIntakeService({ store, allowedHosts = [], download = downloadChatGptFile, persistFileId = true }) {
  if (!store) throw new Error('File Intake requires the existing PocketStore.')
  // Read-only replay probe: never grants a new host permission to download.
  const replay = async (args) => {
    const input = describeMcpFileIntakeRequest(args)
    try {
      return { receipt: await readMcpFileIntakeReceipt(store, input), verificationRequired: false }
    } catch (error) {
      if (error?.code !== 'MCP_FILE_REPLAY_VERIFICATION_REQUIRED') throw error
      return { receipt: null, verificationRequired: true }
    }
  }
  return {
    replay,
    async save({ requestId, mode, itemId, title = '', text = '', file }, suppliedOperation) {
      const operation = suppliedOperation || createMcpFileOperation()
      try {
        operation.check()
        // A downloader gets cancellation/read checks, never publication authority.
        const downloadOperation = Object.freeze({
          signal: operation.signal, deadline: operation.deadline,
          check: operation.check, wait: operation.wait,
        })
        const args = { requestId, mode, itemId, title, text, file }
        const input = describeMcpFileIntakeRequest(args)
        const fileId = file?.file_id
        const previous = await operation.wait(replay(args))
        if (previous.receipt) return previous.receipt
        if (previous.verificationRequired) {
          // Legacy fingerprints and any changed fileParams need actual bytes.
          // No request-ID-only or opaque-file-ID-only success shortcut.
          validateMcpFileUrl(file.download_url, allowedHosts)
          operation.check()
          const retryBytes = await operation.wait(download(file, { allowedHosts, operation: downloadOperation, signal: operation.signal }))
          const { mimeType: retryMimeType } = validateMcpFileBytes(file, retryBytes)
          const verifiedFile = {
            bytes: retryBytes.length,
            sha256: createHash('sha256').update(retryBytes).digest('hex'),
            mimeType: retryMimeType,
          }
          const evidence = { ...input, title, text, verifiedFile }
          const matched = await operation.wait(readMcpFileIntakeReceipt(store, evidence))
          if (!matched) throw new Error('Original Intake request no longer exists. Manual review required.')
          return matched
        }
        // Validate BEFORE making an outbound request.
        validateMcpFileUrl(file.download_url, allowedHosts)
        operation.check()
        const bytes = await operation.wait(download(file, { allowedHosts, operation: downloadOperation, signal: operation.signal }))
        const { filename: verifiedName, mimeType } = validateMcpFileBytes(file, bytes)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        operation.check()
        const storageName = randomUUID()
        const finalPath = path.join(store.mediaDir, storageName)
        const pendingPath = finalPath + '.part'
        let committed = false
        try {
          operation.check()
          const writer = createWriteStream(pendingPath, { flags: 'wx', mode: 0o600 })
          await pipeline([bytes], writer, { signal: operation.signal })
          const written = await stat(pendingPath)
          if (!written.isFile() || written.size !== bytes.length) throw new Error('File was not persisted completely.')
          operation.check()
          await rename(pendingPath, finalPath)
          operation.check()
          const attachment = { id: randomUUID(), name: verifiedName, mimeType, size: bytes.length, sha256, storageName }
          const receipt = await operation.wait(store.saveMcpFileIntake({
            ...input, fileId: persistFileId ? fileId : undefined, attachment, authorization: operation,
          }))
          committed = !receipt.duplicate
          return receipt
        } finally {
          await rm(pendingPath, { force: true }).catch(() => {})
          if (!committed) await rm(finalPath, { force: true }).catch(() => {})
        }
      } finally {
        if (!suppliedOperation) { operation.cancel(); operation.dispose() }
      }
    },
  }
}
