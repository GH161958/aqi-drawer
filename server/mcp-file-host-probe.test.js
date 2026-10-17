import assert from 'node:assert/strict'
import test from 'node:test'
import { describeMcpFileHost } from './mcp-file-intake.js'

const disposable = {
  file_id: 'file_disposable_qa_only',
  download_url: 'https://Uploads.Example.Org/signed/file.pdf?token=NEVER_ECHO_SECRET',
  file_name: 'user-private-file.pdf',
  mime_type: 'application/pdf',
}

test('fileParams diagnostic returns only lowercase hostname, never a signed URL or file metadata', () => {
  const answer = describeMcpFileHost(disposable)
  assert.deepEqual(answer, {
    hostname: 'uploads.example.org',
    noDownload: true,
    noStorageWrite: true,
    approvedForDownloads: false,
    nextStep: 'Ask EE to independently review the hostname before allowing any file download.',
  })
  const returned = JSON.stringify(answer)
  for (const secret of ['NEVER_ECHO_SECRET', 'file_disposable_qa_only',
    'user-private-file.pdf', '/signed/', 'application/pdf']) {
    assert.ok(!returned.includes(secret), 'Diagnostic must not expose ' + secret)
  }
  const noMetadata = describeMcpFileHost({
    file_id: disposable.file_id, download_url: disposable.download_url,
  })
  assert.equal(noMetadata.hostname, 'uploads.example.org')
})

test('diagnostic rejects unsafe URLs before any DNS or network operation', () => {
  for (const download_url of [
    'http://uploads.example.org/test?secret=abc',
    'https://127.0.0.1/private',
    'https://[::1]/private',
    'https://user:password@uploads.example.org/path',
    'https://uploads.example.org:9000/file',
    'https://uploads.example.org/file#fragment',
    'https://localhost/file', 'https://metadata.internal/file',
    'https://host.local/file', 'https://uploads.example.org./file',
    'file:///etc/passwd',
  ]) {
    assert.throws(() => describeMcpFileHost({ ...disposable, download_url }))
  }
  assert.throws(() => describeMcpFileHost({ ...disposable, file_id: '' }), /parameter/)
  assert.throws(() => describeMcpFileHost(undefined), /parameter/)
})
