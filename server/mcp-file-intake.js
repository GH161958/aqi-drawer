import { createHash, randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import https from 'node:https'
import { isIP, BlockList } from 'node:net'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'

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

function safeName(value) {
  const name = String(value || '').replaceAll('\\', '/').split('/').at(-1)
    .replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 200)
  if (!name || name === '.' || name === '..' || !/\.[A-Za-z0-9]{1,8}$/u.test(name)) {
    throw new Error('File needs a safe name with a supported extension.')
  }
  return name
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

export function validateMcpFileBytes(file, bytes) {
  if (!file || typeof file !== 'object' || !/^file[_-][\w-]{1,200}$/u.test(String(file.file_id || ''))) {
    throw new Error('A valid ChatGPT file_id is required.')
  }
  const filename = safeName(file.file_name || file.file_id + '.bin')
  return { filename, mimeType: classifyFile(filename, bytes, file.mime_type) }
}

// Fetch is intentionally restrictive: explicitly allowed HTTPS host only,
// every resolved IPv4 address checked, pinned IP for the TLS connection,
// no HTTP redirects, bounded bytes and time. Signed URLs never get logged.
export async function downloadChatGptFile(file, { allowedHosts, resolver = lookup } = {}) {
  const url = validateMcpFileUrl(file?.download_url, allowedHosts)
  const addresses = await resolver(url.hostname, { all: true, family: 4, verbatim: true })
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => !publicIPv4(entry.address))) {
    throw new Error('File host DNS address is not a permitted public IPv4 address.')
  }
  const address = addresses[0].address
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      agent: false,
      timeout: 15000,
      headers: { accept: 'application/octet-stream', 'accept-encoding': 'identity' },
      lookup: (_name, options, cb) => {
        if (options?.all) cb(null, [{ address, family: 4 }])
        else cb(null, address, 4)
      },
    }, async (res) => {
      if (res.statusCode !== 200) {
        res.destroy()
        reject(new Error('Temporary file download failed or redirected. Refresh the ChatGPT file parameter.'))
        return
      }
      if (Number(res.headers['content-length']) > MAX_MCP_FILE_BYTES) {
        res.destroy()
        reject(new Error('File exceeds the 25 MiB Intake limit.'))
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
        }))
        if (!total) throw new Error('Downloaded file is empty.')
        resolve(Buffer.concat(chunks, total))
      } catch (error) {
        request.destroy()
        reject(error)
      }
    })
    request.on('timeout', () => request.destroy(new Error('File download timed out.')))
    request.on('error', reject)
  })
}

export function createMcpFileIntakeService({ store, allowedHosts = [], download = downloadChatGptFile }) {
  if (!store) throw new Error('File Intake requires the existing PocketStore.')
  return {
    async save({ requestId, mode, itemId, title = '', text = '', file }) {
      if (!['new', 'append'].includes(mode)) throw new Error('Choose new or append.')
      if (!/^[A-Za-z0-9_.:-]{8,120}$/u.test(String(requestId || ''))) {
        throw new Error('A stable 8–120 character request_id is required.')
      }
      if (mode === 'new' && itemId) throw new Error('New file Intake must not supply an item ID.')
      if (mode === 'append' && (!itemId || title || text)) throw new Error('Append requires existing item_id, without title or text replacement.')
      if (String(title).length > 160 || String(text).length > 20000) throw new Error('File item title/text is too long.')
      const fileId = String(file?.file_id || '')
      const filename = safeName(file?.file_name || '')
      if (!/^file[_-][\w-]{1,200}$/u.test(fileId)) throw new Error('A valid ChatGPT file_id is required.')
      const requestHash = createHash('sha256').update(JSON.stringify([
        mode, itemId || '', title, text, fileId, filename, file.mime_type || '',
      ])).digest('hex')
      const input = { requestId, requestHash, mode, itemId: itemId || '', title, text }
      const previous = await store.getMcpFileIntakeReceipt(input)
      if (previous) return { ...previous, duplicate: true }
      // Validate BEFORE making an outbound request.
      validateMcpFileUrl(file.download_url, allowedHosts)
      const bytes = await download(file, { allowedHosts })
      const { mimeType } = validateMcpFileBytes(file, bytes)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      const storageName = randomUUID()
      const finalPath = path.join(store.mediaDir, storageName)
      const pendingPath = finalPath + '.part'
      let committed = false
      try {
        const writer = createWriteStream(pendingPath, { flags: 'wx', mode: 0o600 })
        await pipeline([bytes], writer)
        const written = await stat(pendingPath)
        if (!written.isFile() || written.size !== bytes.length) throw new Error('File was not persisted completely.')
        await rename(pendingPath, finalPath)
        const attachment = { id: randomUUID(), name: filename, mimeType, size: bytes.length, sha256, storageName }
        const receipt = await store.saveMcpFileIntake({
          ...input, fileId, attachment,
        })
        committed = !receipt.duplicate
        return receipt
      } finally {
        await rm(pendingPath, { force: true }).catch(() => {})
        if (!committed) await rm(finalPath, { force: true }).catch(() => {})
      }
    },
  }
}
