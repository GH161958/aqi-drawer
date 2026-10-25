import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'
import { AttachmentReadError, readOriginalAttachment } from './attachment-reader.js'

const makeStore = (filename, text, mimeType = 'text/plain') => {
  const data = Buffer.isBuffer(text) ? text : Buffer.from(text, 'utf8')
  const attachment = {
    name: filename,
    mimeType,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  }
  const calls = []
  const store = {
    async readItemAttachment(itemId, attachmentId, maxBytes) {
      calls.push({ itemId, attachmentId, maxBytes })
      return itemId === 'valid-item' && attachmentId === 'valid-attachment'
        ? { attachment, data }
        : null
    },
  }
  return { store, attachment, data, calls }
}

const args = { itemId: 'valid-item', attachmentId: 'valid-attachment' }

test('reads original UTF-8 Markdown by Unicode code-point offset with hard output cap', async () => {
  const original = '伊伊🦊 test\n'.repeat(140)
  const { store, data, calls } = makeStore('论文笔记.md', original, 'text/markdown')
  const a = await readOriginalAttachment(store, { ...args, maxChars: 500 })
  assert.equal(a.text, Array.from(original).slice(0, 500).join(''))
  assert.equal(a.hasMore, true)
  assert.equal(a.nextOffset, 500)
  assert.equal(a.format, 'md')
  assert.equal(a.sha256, createHash('sha256').update(data).digest('hex'))
  assert.equal(a.filename, '论文笔记.md')
  assert.equal(a.trust, 'untrusted_document_content')
  assert.equal(a.totalPages, null)
  const b = await readOriginalAttachment(store, {
    ...args, offset: a.nextOffset, maxChars: 8000,
  })
  assert.equal(a.text + b.text, original)
  assert.equal(b.hasMore, false)
  assert.equal(b.nextOffset, null)
  assert.deepEqual(calls.map(x => [x.itemId, x.attachmentId]), [
    ['valid-item', 'valid-attachment'], ['valid-item', 'valid-attachment'],
  ])
  assert.equal(calls[0].maxBytes, 25 * 1024 * 1024)
  await assert.rejects(
    readOriginalAttachment(store, { ...args, offset: Array.from(original).length + 1 }),
    /beyond the end/,
  )
  await assert.rejects(
    readOriginalAttachment(store, { ...args, page: 2 }),
    /Use offset/,
  )
})

test('only a matching active item + attachment can be read', async () => {
  const { store } = makeStore('hello.txt', 'hello')
  await assert.rejects(
    readOriginalAttachment(store, { ...args, itemId: 'different-item' }),
    /not found on this active Drawer item/,
  )
  await assert.rejects(
    readOriginalAttachment(store, { ...args, attachmentId: 'different-file' }),
    /not found on this active Drawer item/,
  )
  const trashedStore = { async readItemAttachment() { return null } }
  await assert.rejects(
    readOriginalAttachment(trashedStore, args),
    /not found on this active Drawer item/,
  )
  const oversizedStore = {
    async readItemAttachment() {
      const error = new Error('Do not echo internal storage paths.')
      error.status = 413
      throw error
    },
  }
  await assert.rejects(
    readOriginalAttachment(oversizedStore, args),
    /exceeds the 25 MiB read limit/,
  )
  await assert.rejects(
    readOriginalAttachment(store, { ...args, maxChars: 400 }),
    /Invalid page, offset/,
  )
  await assert.rejects(
    readOriginalAttachment(store, { ...args, maxChars: 9000 }),
    /Invalid page, offset/,
  )
})

test('fails closed for mismatched digest, metadata size, unsupported type and invalid UTF-8', async () => {
  const { store, attachment } = makeStore('notes.txt', 'safe text')
  attachment.sha256 = '0'.repeat(64)
  await assert.rejects(
    readOriginalAttachment(store, args),
    /digest does not match/,
  )
  attachment.sha256 = ''
  attachment.size += 1
  await assert.rejects(
    readOriginalAttachment(store, args),
    /size does not match/,
  )
  const picture = makeStore('image.png', Buffer.from('PNG'), 'image/png')
  await assert.rejects(
    readOriginalAttachment(picture.store, args),
    /Only DOCX, PDF/,
  )
  const binary = makeStore('not-utf8.txt', Buffer.from([0xff, 0xfe]), 'text/plain')
  await assert.rejects(
    readOriginalAttachment(binary.store, args),
    /not valid UTF-8/,
  )
  const nul = makeStore('unsafe.txt', Buffer.from([0x00, 0x61]), 'text/plain')
  await assert.rejects(
    readOriginalAttachment(nul.store, args),
    /binary bytes/,
  )
  assert.equal(AttachmentReadError.name, 'AttachmentReadError')
})

test('reads exactly one PDF page with bounded pagination, preserving one canonical original', async () => {
  const pdf = Buffer.from('%PDF-1.7\nDISPOSABLE PDF UNIT TEST', 'ascii')
  const { store } = makeStore('paper.pdf', pdf, 'application/pdf')
  const pageText = 'Aqi 🐆 PDF passage\n'.repeat(70)
  const seen = []
  let pathUsed = null
  const execute = async (command, commandArgs, options) => {
    seen.push({ command, args: commandArgs, options })
    pathUsed = command === 'pdfinfo' ? commandArgs[0] : commandArgs.at(-2)
    assert.deepEqual(await readFile(pathUsed), pdf)
    if (command === 'pdfinfo') return { stdout: 'Title: Disposable\nPages:          3\n' }
    if (command === 'pdftotext') return { stdout: pageText }
    throw new Error('Unexpected command')
  }
  const first = await readOriginalAttachment(store, { ...args, page: 2, maxChars: 500 }, { execute })
  assert.equal(first.page, 2)
  assert.equal(first.totalPages, 3)
  assert.equal(first.format, 'pdf')
  assert.equal(first.nextPage, null)
  assert.equal(first.hasMore, true)
  assert.equal(first.nextOffset, 500)
  assert.equal(first.text, Array.from(pageText).slice(0, 500).join(''))
  assert.deepEqual(seen.map(x => x.command), ['pdfinfo', 'pdftotext'])
  assert.ok(seen[1].args.includes('-f'))
  assert.ok(seen[1].args.includes('2'))
  assert.ok(seen[1].args.includes('-nopgbrk'))
  assert.equal(seen[1].options.timeout, 12000)
  await assert.rejects(access(pathUsed), { code: 'ENOENT' })
  const rest = await readOriginalAttachment(store, {
    ...args, page: 2, offset: 500, maxChars: 8000,
  }, { execute })
  assert.equal(first.text + rest.text, pageText)
  assert.equal(rest.hasMore, false)
  assert.equal(rest.nextPage, 3)
})

test('PDF missing text never pretends OCR occurred; out-of-range and unsafe PDFs fail closed', async () => {
  const { store } = makeStore('scan.pdf', Buffer.from('%PDF-1.4\nTEST'), 'application/pdf')
  const scan = await readOriginalAttachment(store, args, {
    execute: async command => ({ stdout: command === 'pdfinfo' ? 'Pages: 1\n' : ' \n' }),
  })
  assert.equal(scan.noExtractableText, true)
  assert.equal(scan.totalPages, 1)
  const pdfMetaOnly = async command => ({ stdout: command === 'pdfinfo' ? 'Pages: 1\n' : 'text' })
  await assert.rejects(
    readOriginalAttachment(store, { ...args, page: 2 }, { execute: pdfMetaOnly }),
    /beyond the end/,
  )
  const missing = async () => {
    const err = new Error('private /tmp path')
    err.code = 'ENOENT'
    throw err
  }
  await assert.rejects(
    readOriginalAttachment(store, args, { execute: missing }),
    /extraction is unavailable/,
  )
  const malformed = makeStore('bad.pdf', Buffer.from('not-pdf'), 'application/pdf')
  await assert.rejects(
    readOriginalAttachment(malformed.store, args),
    /PDF type or file signature/,
  )
})
