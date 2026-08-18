const DEFAULT_BRANCH = 'main'
const MAX_CONTENT_BYTES = 300_000

export const VAULT_ALLOWED_PATHS = Object.freeze([
  '00_HOME/Aqi_Index.md',
  '00_HOME/Current.md',
  '10_IDENTITY/Aqi_Seed.md',
  '20_VOICE/Aqi_Voice.md',
  '20_VOICE/Voice_Candidates.md',
  '40_WORK/Aqi_Engineering_Handoff.md',
])

const HISTORY_DIRS = Object.freeze({
  '10_IDENTITY/Aqi_Seed.md': '10_IDENTITY/Seed_History',
  '20_VOICE/Aqi_Voice.md': '20_VOICE/Voice_History',
  '40_WORK/Aqi_Engineering_Handoff.md': '40_WORK/Handoff_History',
})

export class GitHubVaultClient {
  constructor({
    token = '',
    repo = '',
    branch = DEFAULT_BRANCH,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.token = clean(token)
    this.repo = clean(repo)
    this.branch = clean(branch) || DEFAULT_BRANCH
    this.fetchImpl = fetchImpl

    if (this.repo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(this.repo)) {
      throw new Error('AQI_VAULT_REPO must use owner/repository format.')
    }

    const [owner = '', name = ''] = this.repo.split('/')
    this.owner = owner
    this.name = name
  }

  get configured() {
    return Boolean(this.token && this.owner && this.name)
  }

  describe() {
    return {
      configured: this.configured,
      repository: this.repo || null,
      branch: this.branch,
      paths: [...VAULT_ALLOWED_PATHS],
    }
  }

  async read(path) {
    this.assertConfigured()
    this.assertAllowed(path)

    const payload = await this.request(
      'GET',
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`,
    )

    if (
      payload?.type !== 'file'
      || typeof payload?.sha !== 'string'
      || typeof payload?.content !== 'string'
    ) {
      throw new Error(`Canonical Vault path is not a readable file: ${path}`)
    }

    const content = Buffer
      .from(payload.content.replaceAll('\n', ''), 'base64')
      .toString('utf8')

    return {
      path,
      sha: payload.sha,
      size: Buffer.byteLength(content),
      content,
    }
  }

  async update({
    path,
    content,
    expectedSha,
    commitMessage = '',
    snapshotHistory = true,
  }) {
    this.assertConfigured()
    this.assertAllowed(path)

    if (typeof content !== 'string') {
      throw new Error('Canonical Vault content must be text.')
    }

    if (Buffer.byteLength(content) > MAX_CONTENT_BYTES) {
      throw new Error(`Canonical Vault content exceeds ${MAX_CONTENT_BYTES} bytes.`)
    }

    const current = await this.read(path)

    if (!expectedSha || current.sha !== expectedSha) {
      throw new Error(`Vault SHA mismatch for ${path}. Read the file again before updating.`)
    }

    let historyPath = null

    if (snapshotHistory && HISTORY_DIRS[path]) {
      historyPath = this.makeHistoryPath(path, current.sha)

      await this.request(
        'PUT',
        `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/contents/${encodePath(historyPath)}`,
        {
          message: `Snapshot ${path} before canonical update`,
          content: Buffer.from(current.content, 'utf8').toString('base64'),
          branch: this.branch,
        },
      )
    }

    const payload = await this.request(
      'PUT',
      `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.name)}/contents/${encodePath(path)}`,
      {
        message: normalizeCommitMessage(commitMessage, path),
        content: Buffer.from(content, 'utf8').toString('base64'),
        sha: current.sha,
        branch: this.branch,
      },
    )

    return {
      path,
      sha: payload?.content?.sha || null,
      commitSha: payload?.commit?.sha || null,
      historyPath,
    }
  }

  assertConfigured() {
    if (!this.configured) {
      throw new Error('Aqi Canonical Vault is not configured on this deployment.')
    }
  }

  assertAllowed(path) {
    if (!VAULT_ALLOWED_PATHS.includes(path)) {
      throw new Error(`Vault path is not allowlisted: ${path}`)
    }
  }

  makeHistoryPath(path, sha) {
    const directory = HISTORY_DIRS[path]
    const base = path.split('/').at(-1).replace(/\.md$/i, '')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    return `${directory}/${base}_${stamp}_${sha.slice(0, 8)}.md`
  }

  async request(method, path, body) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'user-agent': 'aqi-drawer-vault-bridge',
        'x-github-api-version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    const raw = await response.text()

    let payload = {}

    if (raw) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = { message: raw.slice(0, 300) }
      }
    }

    if (!response.ok) {
      const message = typeof payload?.message === 'string'
        ? payload.message
        : `HTTP ${response.status}`

      throw new Error(
        `Canonical Vault GitHub request failed (${response.status}): ${message}`,
      )
    }

    return payload
  }
}

function encodePath(path) {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCommitMessage(value, path) {
  const cleaned = clean(value).replace(/\s+/g, ' ').slice(0, 120)
  return cleaned || `Update canonical ${path}`
}
