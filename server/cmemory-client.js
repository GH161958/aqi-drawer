export class CMemoryClient {
  constructor({ baseUrl = 'http://127.0.0.1:4282', token = '', fetchImpl = fetch } = {}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.token = token
    this.fetch = fetchImpl
  }

  async health() {
    return this.#request('/health', { auth: false })
  }

  async turnPre(payload) {
    return this.#request('/v1/turns/pre', { method: 'POST', body: payload })
  }

  async confirmSurface({ recallId, memoryId }) {
    return this.#request(`/v1/recalls/${encodeURIComponent(recallId)}/surfaced/${encodeURIComponent(memoryId)}`, {
      method: 'POST',
      body: {},
    })
  }

  async turnPost(payload) {
    return this.#request('/v1/turns/post', { method: 'POST', body: { ...payload, remember: false } })
  }

  async stagePocketCandidate(item) {
    if (!this.token) return { ok: false, error: 'CMEMORY_TOKEN is not configured.' }
    const text = renderSourceTruth(item)
    try {
      const request = {
        sourceApp: 'aqi-drawer',
        sourceItemId: item.id,
        actorId: 'ee',
        text,
        occurredAt: item.createdAt,
        suggestedVault: 'relationship-private',
        suggestedImportance: 0.6,
        suggestedSensitivity: 1,
        evidenceConfidence: 1,
        maxSegmentLength: 420,
      }
      const preview = await this.#request('/v1/imports/narrative/preview', { method: 'POST', body: request })
      const staged = await this.#request('/v1/imports/narrative/stage', { method: 'POST', body: request })
      return {
        ok: true,
        candidateIds: extractIds(staged),
        rootHash: staged?.rootHash ?? preview?.rootHash,
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'C-Memory staging failed.' }
    }
  }

  async #request(pathname, { method = 'GET', body, auth = true } = {}) {
    if (auth && !this.token) throw new Error('CMEMORY_TOKEN is not configured.')
    const response = await this.fetch(`${this.baseUrl}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${this.token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const raw = await response.text()
    const value = raw ? safeJson(raw) : {}
    if (!response.ok) {
      const detail = value?.message || value?.error || raw.slice(0, 300)
      throw new Error(`C-Memory ${response.status}: ${detail}`)
    }
    return value
  }
}

function renderSourceTruth(item) {
  return [
    `口袋条目：${item.title}`,
    item.text && `原文：${item.text}`,
    item.sourceUrl && `来源链接：${item.sourceUrl}`,
    item.sourceApp && `来源 App：${item.sourceApp}`,
    item.note && `伊伊的备注：${item.note}`,
    `收藏时间：${item.createdAt}`,
  ].filter(Boolean).join('\n')
}

function extractIds(value) {
  const candidates = value?.candidateIds ?? value?.candidates ?? value?.items ?? []
  return Array.isArray(candidates)
    ? candidates.map((entry) => typeof entry === 'string' ? entry : entry?.id).filter(Boolean)
    : []
}

function safeJson(raw) {
  try { return JSON.parse(raw) } catch { return { message: raw } }
}
