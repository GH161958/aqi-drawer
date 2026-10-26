import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { readOriginalAttachment } from './attachment-reader.js'
import { DocxTextError, extractDocxMainText } from './docx-text.js'

const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const itemId = 'valid-item'
const attachmentId = 'valid-attachment'
const args = { itemId, attachmentId }

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

// A synthetic but fully formed ZIP: local header + central directory + EOCD.
// Tests use real DEFLATE bytes; no external files or private fixtures.
function makeDocx(xml, { method = 8 } = {}) {
  const name = Buffer.from('word/document.xml')
  const raw = Buffer.from(xml, 'utf8')
  const compressed = method === 8 ? deflateRawSync(raw) : raw
  const checksum = crc32(raw)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(method, 8)
  local.writeUInt32LE(checksum, 14)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  const localPart = Buffer.concat([local, name, compressed])
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(method, 10)
  central.writeUInt32LE(checksum, 16)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(raw.length, 24)
  central.writeUInt16LE(name.length, 28)
  const centralPart = Buffer.concat([central, name])
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralPart.length, 12)
  end.writeUInt32LE(localPart.length, 16)
  return Buffer.concat([localPart, centralPart, end])
}

const wrap = body =>
  '<?xml version="1.0" encoding="UTF-8"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:body>' + body + '</w:body></w:document>'

function mockStore(bytes, name = '合成研究笔记.docx', type = mime) {
  const attachment = {
    name, mimeType: type, size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const store = {
    async readItemAttachment(id, file) {
      return id === itemId && file === attachmentId
        ? { attachment, data: bytes } : null
    },
  }
  return { store, attachment }
}

test('DOCX main body: Unicode, XML entities, paragraphs, table and deleted text', () => {
  const bytes = makeDocx(wrap(
    '<w:p><w:r><w:t xml:space="preserve">伊伊 &amp; 雪豹 🐆 &lt;QA&gt;</w:t></w:r>'
    + '<w:del><w:r><w:t>deleted secret</w:t></w:r></w:del></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>甲</w:t></w:r></w:p></w:tc>'
    + '<w:tc><w:p><w:r><w:t>乙</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:r><w:t>Line</w:t><w:tab/><w:t>two</w:t><w:br/><w:t>three</w:t></w:r></w:p>',
  ))
  const output = extractDocxMainText(bytes)
  assert.ok(output.includes('伊伊 & 雪豹 🐆 <QA>'))
  assert.ok(output.includes('甲\n\t乙'))
  assert.ok(output.includes('Line\ttwo\nthree'))
  assert.equal(output.includes('deleted secret'), false)
})

test('DOCX reader reuses original attachment ownership, sha/size and code-point pagination', async () => {
  const text = '雪豹🦊 ' + 'Hello 世界 '.repeat(160) + '完毕'
  const bytes = makeDocx(wrap('<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'))
  const { store, attachment } = mockStore(bytes)
  const first = await readOriginalAttachment(store, { ...args, maxChars: 500 })
  assert.equal(first.format, 'docx')
  assert.equal(first.page, null)
  assert.equal(first.totalPages, null)
  assert.equal(first.nextPage, null)
  assert.equal(first.filename, attachment.name)
  assert.equal(first.size, bytes.length)
  assert.equal(first.sha256, attachment.sha256)
  assert.equal(first.trust, 'untrusted_document_content')
  assert.equal(first.hasMore, true)
  assert.equal(first.nextOffset, 500)
  const second = await readOriginalAttachment(store, {
    ...args, offset: first.nextOffset, maxChars: 8000,
  })
  assert.equal(first.text + second.text, text)
  assert.equal(second.hasMore, false)
  assert.equal(second.nextOffset, null)
  await assert.rejects(
    readOriginalAttachment(store, { ...args, page: 2 }), /Use offset, not page/,
  )
  await assert.rejects(
    readOriginalAttachment(store, { ...args, itemId: 'different' }), /not found/,
  )
})

test('DOCX validation rejects forged size, CRC, wrong MIME, wrong extension and unsupported legacy DOC', async () => {
  const valid = makeDocx(wrap('<w:p><w:r><w:t>Valid</w:t></w:r></w:p>'))
  const corruptedCrc = Buffer.from(valid)
  // central directory CRC is 16 bytes into central header
  const offset = corruptedCrc.readUInt32LE(corruptedCrc.length - 6)
  corruptedCrc.writeUInt32LE(0, offset + 16)
  assert.throws(() => extractDocxMainText(corruptedCrc), DocxTextError)
  const bomb = Buffer.from(valid)
  bomb.writeUInt32LE(12 * 1024 * 1024, offset + 24)
  assert.throws(() => extractDocxMainText(bomb), DocxTextError)
  assert.throws(() => extractDocxMainText(Buffer.from('PKnotzip')), DocxTextError)
  const mismatched = mockStore(valid, 'word.docx', 'text/plain')
  await assert.rejects(readOriginalAttachment(mismatched.store, args), /MIME type/)
  const legacy = mockStore(valid, 'old.doc', 'application/msword')
  await assert.rejects(readOriginalAttachment(legacy.store, args), /Legacy .doc/)
  const tampered = mockStore(valid)
  tampered.attachment.sha256 = '0'.repeat(64)
  await assert.rejects(readOriginalAttachment(tampered.store, args), /digest does not match/)
})

test('DOCX empty main body reports no extractable text without pretending to OCR', async () => {
  const bytes = makeDocx(wrap('<w:p><w:r><w:drawing /></w:r></w:p>'))
  const { store } = mockStore(bytes)
  const result = await readOriginalAttachment(store, args)
  assert.equal(result.noExtractableText, true)
  assert.equal(result.text, '')
  assert.equal(result.hasMore, false)
})

test('existing TXT remains supported without any new Word conversion dependency', async () => {
  const text = 'Existing TXT still reads directly.\n'
  const bytes = Buffer.from(text)
  const { store } = mockStore(bytes, 'notes.txt', 'text/plain')
  const result = await readOriginalAttachment(store, args)
  assert.equal(result.format, 'txt')
  assert.equal(result.text, text)
})
