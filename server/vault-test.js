import assert from 'node:assert/strict'
import {
  GitHubVaultClient,
  VAULT_ALLOWED_PATHS,
} from './vault-client.js'

const voicePath = '20_VOICE/Aqi_Voice.md'
const initialSha = 'a'.repeat(40)

const files = new Map([
  [
    voicePath,
    {
      sha: initialSha,
      content: '# Aqi Voice\n\nbefore\n',
    },
  ],
])

let sequence = 1

const fakeFetch = async (input, options = {}) => {
  const url = new URL(input)
  const marker = '/contents/'
  const markerIndex = url.pathname.indexOf(marker)

  if (markerIndex < 0) {
    return jsonResponse(404, { message: 'not found' })
  }

  const encodedPath = url.pathname.slice(markerIndex + marker.length)

  const path = encodedPath
    .split('/')
    .map((part) => decodeURIComponent(part))
    .join('/')

  const method = options.method || 'GET'

  if (method === 'GET') {
    const found = files.get(path)

    if (!found) {
      return jsonResponse(404, { message: 'not found' })
    }

    return jsonResponse(200, {
      type: 'file',
      sha: found.sha,
      encoding: 'base64',
      content: Buffer.from(found.content, 'utf8').toString('base64'),
    })
  }

  if (method === 'PUT') {
    const body = JSON.parse(options.body || '{}')
    const existing = files.get(path)

    if (body.sha && (!existing || existing.sha !== body.sha)) {
      return jsonResponse(409, { message: 'sha conflict' })
    }

    sequence += 1

    const sha = sequence.toString(16).padStart(40, '0')
    const content = Buffer.from(body.content, 'base64').toString('utf8')

    files.set(path, { sha, content })

    return jsonResponse(200, {
      content: { sha },
      commit: {
        sha: (sequence + 100).toString(16).padStart(40, '0'),
      },
    })
  }

  return jsonResponse(405, { message: 'method not allowed' })
}

const client = new GitHubVaultClient({
  token: 'test-token-that-never-leaves-this-offline-test',
  repo: 'GH161958/aqi-vault-canonical',
  branch: 'main',
  fetchImpl: fakeFetch,
})

assert.equal(client.configured, true)

const description = client.describe()

assert.equal(description.repository, 'GH161958/aqi-vault-canonical')
assert.equal(description.paths.includes(voicePath), true)
assert.equal(description.paths.length, VAULT_ALLOWED_PATHS.length)
assert.equal('token' in description, false)

await assert.rejects(
  () => client.read('.env'),
  /not allowlisted/,
)

const before = await client.read(voicePath)

assert.equal(before.sha, initialSha)
assert.match(before.content, /before/)

await assert.rejects(
  () => client.update({
    path: voicePath,
    content: '# stale',
    expectedSha: 'b'.repeat(40),
  }),
  /SHA mismatch/,
)

const saved = await client.update({
  path: voicePath,
  content: '# Aqi Voice\n\nafter\n',
  expectedSha: before.sha,
  commitMessage: 'Test canonical Voice update',
})

assert.equal(saved.path, voicePath)
assert.match(
  saved.historyPath,
  /^20_VOICE\/Voice_History\/Aqi_Voice_/,
)

const after = await client.read(voicePath)

assert.match(after.content, /after/)

const historyEntries = [...files.entries()]
  .filter(([path]) => path.startsWith('20_VOICE/Voice_History/'))

assert.equal(historyEntries.length, 1)
assert.match(historyEntries[0][1].content, /before/)

const disabled = new GitHubVaultClient()

assert.equal(disabled.configured, false)

await assert.rejects(
  () => disabled.read(voicePath),
  /not configured/,
)

console.log('AQI_VAULT_CLIENT_TEST_OK')

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
