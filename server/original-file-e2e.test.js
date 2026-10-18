import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startBridge } from './index.js'

// Genuine 3-page PDF with xref table and independent selectable text streams.
// All data is generated inside isolated tests. No private or remote files.
function makeThreePagePdf(markers = ['FIRST_PAGE_ONLY_111', 'SECOND_PAGE_ONLY_222', 'THIRD_PAGE_ONLY_333']) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 3 /Kids [3 0 R 4 0 R 5 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 8 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 9 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...markers.map((word) => {
      const stream = word ? 'BT /F1 16 Tf 72 720 Td (' + word + ') Tj ET\n' : ''
      return '<< /Length ' + Buffer.byteLength(stream, 'ascii') + ' >>\nstream\n' + stream + 'endstream'
    }),
  ]
  let raw = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(raw, 'ascii'))
    raw += (i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n'
  }
  const xrefAt = Buffer.byteLength(raw, 'ascii')
  raw += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n'
  for (let i = 1; i < offsets.length; i++) {
    raw += String(offsets[i]).padStart(10, '0') + ' 00000 n \n'
  }
  raw += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefAt + '\n%%EOF\n'
  return Buffer.from(raw, 'ascii')
}
const isAvailable = (command) => {
  const status = spawnSync(command, ['-v'], { timeout: 3000, encoding: 'utf8' })
  return !status.error && status.status === 0
}
const hasPoppler = isAvailable('pdfinfo') && isAvailable('pdftotext')
if (process.env.AQI_REQUIRE_ORIGINAL_PDF_E2E === '1' && !hasPoppler) {
  throw new Error('Docker production image must provide pdfinfo and pdftotext.')
}
test('genuine 3-page PDF through isolated Owner MCP + durable Media', {
  skip: !hasPoppler && 'Poppler unavailable on this host; Docker CI requires the E2E.',
}, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aqi-real-pdf-e2e-'))
  let bridge
  let client
  t.after(async () => {
    await Promise.allSettled([client?.close(), bridge?.stop()])
    await rm(directory, { recursive: true, force: true })
  })
  const mcpPath = '/mcp/' + randomBytes(32).toString('base64url')
  bridge = await startBridge({
    dataDir: directory, port: 0, host: '127.0.0.1', mcpPath,
    enableOwnerInPlace: true, enableMcpCapture: true,
    enableUnifiedOwner: true, enableLegacyMcp: true,
    enableMcpFileIntake: false, enableMcpFileHostProbe: false,
    captureMcpPath: '',
  })
  client = new Client({ name: 'disposable-original-pdf-e2e', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(
    new URL('http://127.0.0.1:' + bridge.address.port + mcpPath),
  ))
  const pdf = makeThreePagePdf()
  const sha = createHash('sha256').update(pdf).digest('hex')
  const mediaName = randomUUID()
  const attachmentId = randomUUID()
  await writeFile(path.join(bridge.store.mediaDir, mediaName), pdf, { flag: 'wx', mode: 0o600 })
  const receipt = await bridge.store.saveMcpFileIntake({
    requestId: 'disposable-original-pdf-e2e-0001',
    requestHash: 'c'.repeat(64),
    mode: 'new', title: 'Short project reference',
    text: 'Description, not the original PDF text.',
    fileId: 'isolated-disposable-fixture',
    attachment: {
      id: attachmentId, storageName: mediaName,
      name: 'project-reference.pdf', mimeType: 'application/pdf',
      size: pdf.length, sha256: sha,
    },
  })
  const before = await bridge.store.get(receipt.itemId)
  const names = (await client.listTools()).tools.map((entry) => entry.name)
  assert.ok(names.includes('pocket_attachment_read'))
  for (const [page, own, other1, other2] of [
    [1, 'FIRST_PAGE_ONLY_111', 'SECOND_PAGE_ONLY_222', 'THIRD_PAGE_ONLY_333'],
    [2, 'SECOND_PAGE_ONLY_222', 'FIRST_PAGE_ONLY_111', 'THIRD_PAGE_ONLY_333'],
    [3, 'THIRD_PAGE_ONLY_333', 'FIRST_PAGE_ONLY_111', 'SECOND_PAGE_ONLY_222'],
  ]) {
    const response = await client.callTool({
      name: 'pocket_attachment_read',
      arguments: {
        item_id: receipt.itemId, attachment_id: attachmentId,
        page, offset: 0, max_chars: 500,
      },
    })
    assert.equal(response.isError, undefined, JSON.stringify(response))
    const output = response.structuredContent
    assert.equal(output.format, 'pdf')
    assert.equal(output.page, page)
    assert.equal(output.totalPages, 3)
    assert.equal(output.filename, 'project-reference.pdf')
    assert.equal(output.sha256, sha)
    assert.equal(output.noExtractableText, false)
    assert.ok(output.text.includes(own))
    assert.equal(output.text.includes(other1), false)
    assert.equal(output.text.includes(other2), false)
    assert.equal(output.nextPage, page < 3 ? page + 1 : null)
    assert.match(response.content[0].text, /UNTRUSTED ORIGINAL DOCUMENT CONTENT/)
    assert.equal(JSON.stringify(response).includes(mediaName), false)
  }
  // A valid PDF can contain a page with no selectable text. Do not make up OCR.
  const blankPdf = makeThreePagePdf(['HAS_VISIBLE_TEXT', '', 'OTHER_TEXT'])
  const blankId = randomUUID()
  const blankStorage = randomUUID()
  await writeFile(path.join(bridge.store.mediaDir, blankStorage), blankPdf, {
    flag: 'wx', mode: 0o600,
  })
  const blankReceipt = await bridge.store.saveMcpFileIntake({
    requestId: 'disposable-original-pdf-blank-0001',
    requestHash: 'b'.repeat(64),
    mode: 'new', title: 'Blank-page PDF test', fileId: 'isolated-blank-fixture',
    attachment: {
      id: blankId, storageName: blankStorage, name: 'blank-page.pdf',
      mimeType: 'application/pdf', size: blankPdf.length,
      sha256: createHash('sha256').update(blankPdf).digest('hex'),
    },
  })
  const noText = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: { item_id: blankReceipt.itemId, attachment_id: blankId, page: 2 },
  })
  assert.equal(noText.isError, undefined)
  assert.equal(noText.structuredContent.noExtractableText, true)
  assert.equal(noText.structuredContent.text.trim(), '')
  assert.match(noText.content[0].text, /OCR has not been performed/)
  const malformedPdf = Buffer.from('%PDF-1.4\ninvalid-test-document')
  const malformedId = randomUUID()
  const malformedStorage = randomUUID()
  await writeFile(path.join(bridge.store.mediaDir, malformedStorage), malformedPdf, {
    flag: 'wx', mode: 0o600,
  })
  const malformedReceipt = await bridge.store.saveMcpFileIntake({
    requestId: 'disposable-original-pdf-invalid-0001',
    requestHash: 'a'.repeat(64),
    mode: 'new', title: 'Malformed PDF test', fileId: 'isolated-malformed-fixture',
    attachment: {
      id: malformedId, storageName: malformedStorage, name: 'broken.pdf',
      mimeType: 'application/pdf', size: malformedPdf.length,
      sha256: createHash('sha256').update(malformedPdf).digest('hex'),
    },
  })
  const invalid = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: { item_id: malformedReceipt.itemId, attachment_id: malformedId },
  })
  assert.equal(invalid.isError, true)
  assert.match(invalid.content[0].text, /PDF metadata could not be read/)
  assert.equal(JSON.stringify(invalid).includes(malformedStorage), false)

  const denied = await client.callTool({
    name: 'pocket_attachment_read',
    arguments: { item_id: randomUUID(), attachment_id: attachmentId },
  })
  assert.equal(denied.isError, true)
  assert.deepEqual(await bridge.store.get(receipt.itemId), before)
})
