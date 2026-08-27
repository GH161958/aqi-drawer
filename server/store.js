import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { canonicalizeUrl, inferSourceApp, isGenericSourceApp, normalizeIncomingShare } from './share-normalizer.js'

const EMPTY_STORE = {
  schemaVersion: 1,
  updatedAt: null,
  items: [],
  collections: [],
  tags: [],
}
const STATUSES = new Set(['inbox', 'tonight', 'discussed', 'deferred', 'memory_candidate', 'archived'])
const DEDUPE_WINDOW_MS = 10 * 60 * 1000
const MAX_XHS_IMAGES = 30
const MAX_XHS_DOWNLOAD_BYTES = 80 * 1024 * 1024
const ACTIVITY_TYPES = new Set(['received', 'seen_by_aqi', 'content_read', 'reply_added', 'status_changed', 'metadata_changed', 'source_refreshed', 'trashed', 'restored'])

export class PocketStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir)
    this.filePath = path.join(this.dataDir, 'pocket-store.json')
    this.mediaDir = path.join(this.dataDir, 'media')
    this.queue = Promise.resolve()
  }

  async init() {
    await mkdir(this.mediaDir, { recursive: true })
    try {
      await readFile(this.filePath, 'utf8')
      const state = await this.#read()
      let stateChanged = false

      /*
        Collection Registry V1 migration.

        Existing Drawers used item.collection as the only
        source of truth. Preserve all those names by folding
        them into the new independent registry.
      */
      const migratedCollections = [
        ...new Set([
          ...(
            Array.isArray(state.collections)
              ? state.collections
              : []
          ),
          ...state.items.map(
            (item) => item.collection,
          ),
        ]
          .map((value) => normalizeCollection(value))
          .filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b))

      if (
        !Array.isArray(state.collections)
        || JSON.stringify(state.collections)
          !== JSON.stringify(migratedCollections)
      ) {
        state.collections = migratedCollections
        stateChanged = true
      }

      if (!state.attentionInitializedAt) {
        const now = new Date().toISOString()
        state.attentionInitializedAt = now
        for (const item of state.items) item.seenByCAt ||= now
        stateChanged = true
      }

      if (stateChanged) {
        await this.#write(state)
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      await this.#write({ ...EMPTY_STORE, attentionInitializedAt: new Date().toISOString() })
    }
  }

  async list({ status, limit = 100, includeDeleted = false } = {}) {
    const state = await this.#read()
    return state.items
      .filter((item) => (includeDeleted || !item.deletedAt) && (!status || item.status === status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 100, 500)))
      .map(publicItem)
  }

  async get(id) {
    const state = await this.#read()
    const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
    return item ? publicItem(item) : null
  }

  /* TRASH LIFECYCLE V1 BEGIN */

  async listTrash({ limit = 100 } = {}) {
    const state = await this.#read()

    return state.items
      .filter((item) => Boolean(item.deletedAt))
      .sort((a, b) => (
        b.deletedAt
        || b.updatedAt
        || b.createdAt
      ).localeCompare(
        a.deletedAt
        || a.updatedAt
        || a.createdAt
      ))
      .slice(
        0,
        Math.max(
          1,
          Math.min(
            Number(limit) || 100,
            500,
          ),
        ),
      )
      .map(publicItem)
  }

  async trash(
    id,
    { actor = 'system' } = {},
  ) {
    return this.#mutate((state) => {
      const item = state.items.find(
        (entry) => entry.id === id,
      )

      if (!item) {
        throw httpError(
          404,
          'Pocket item not found.',
        )
      }

      /*
        Idempotent:
        throwing the same paper away twice
        must not create duplicate activity.
      */
      if (item.deletedAt) {
        return {
          item: publicItem(item),
          changed: false,
        }
      }

      const now =
        new Date().toISOString()

      item.deletedAt = now
      item.updatedAt = now
      item.syncState = 'synced'

      appendActivity(
        item,
        'trashed',
        normalizeActor(actor),
        {},
        now,
      )

      return {
        item: publicItem(item),
        changed: true,
      }
    })
  }

  async restore(
    id,
    { actor = 'system' } = {},
  ) {
    return this.#mutate((state) => {
      const item = state.items.find(
        (entry) => entry.id === id,
      )

      if (!item) {
        throw httpError(
          404,
          'Pocket item not found.',
        )
      }

      /*
        Idempotent restore:
        an already-active item remains active.
      */
      if (!item.deletedAt) {
        return {
          item: publicItem(item),
          changed: false,
        }
      }

      const now =
        new Date().toISOString()

      item.deletedAt = null
      item.updatedAt = now
      item.syncState = 'synced'

      appendActivity(
        item,
        'restored',
        normalizeActor(actor),
        {},
        now,
      )

      return {
        item: publicItem(item),
        changed: true,
      }
    })
  }

  async permanentlyDelete(id) {
    /*
      First commit the Store mutation.

      Media cleanup happens only AFTER the JSON
      store has been safely written, so a failed
      store write can never leave a live item
      pointing at files we already deleted.
    */
    const removal =
      await this.#mutate((state) => {
        const index =
          state.items.findIndex(
            (entry) => entry.id === id,
          )

        if (index < 0) {
          throw httpError(
            404,
            'Pocket item not found.',
          )
        }

        const item =
          state.items[index]

        /*
          Safety boundary:
          active items may never be permanently
          deleted in one request.
        */
        if (!item.deletedAt) {
          throw httpError(
            409,
            'Pocket item must be in Trash before permanent deletion.',
          )
        }

        const candidateStorageNames =
          new Set(
            (
              Array.isArray(item.attachments)
                ? item.attachments
                : []
            )
              .map(
                (attachment) =>
                  clean(
                    attachment?.storageName,
                  ),
              )
              .filter(Boolean)
              .map((name) =>
                path.basename(name),
              ),
          )

        state.items.splice(index, 1)

        /*
          Defensive reference check:
          never unlink a media file while another
          item still references the same storageName.
        */
        const stillReferenced =
          new Set(
            state.items.flatMap((entry) =>
              (
                Array.isArray(entry.attachments)
                  ? entry.attachments
                  : []
              )
                .map(
                  (attachment) =>
                    clean(
                      attachment?.storageName,
                    ),
                )
                .filter(Boolean)
                .map((name) =>
                  path.basename(name),
                ),
            ),
          )

        const orphanedStorageNames =
          [...candidateStorageNames]
            .filter(
              (name) =>
                !stillReferenced.has(name),
            )

        return {
          id: item.id,
          orphanedStorageNames,
        }
      })

    let mediaDeleted = 0
    let mediaMissing = 0

    const mediaCleanupFailed = []

    for (
      const storageName
      of removal.orphanedStorageNames
    ) {
      const filePath =
        path.join(
          this.mediaDir,
          path.basename(storageName),
        )

      try {
        await unlink(filePath)
        mediaDeleted += 1
      } catch (error) {
        if (error?.code === 'ENOENT') {
          mediaMissing += 1
          continue
        }

        mediaCleanupFailed.push({
          storageName:
            path.basename(storageName),
          error:
            error?.message
            || 'Media cleanup failed.',
        })
      }
    }

    return {
      id: removal.id,
      deleted: true,
      mediaDeleted,
      mediaMissing,
      mediaCleanupFailed,
    }
  }

  /* TRASH LIFECYCLE V1 END */

  async getForContentRead(id) {
    const state = await this.#read()
    const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
    return item ? publicItem(item, { includeContentSnapshot: true }) : null
  }

  async peekUnseen({ limit = 8 } = {}) {
    const state = await this.#read()
    return state.items
      .filter((item) => !item.deletedAt && !item.seenByCAt && item.status !== 'archived')
      .sort((a, b) => (b.lastReceivedAt || b.updatedAt || b.createdAt).localeCompare(a.lastReceivedAt || a.updatedAt || a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
      .map(publicItem)
  }

  async upsert(input) {
    return this.#mutate((state) => {
      const now = new Date().toISOString()
      const normalized = normalizeItem(input, now)
      const hasExplicitId = Boolean(clean(input?.id))
      const identityIndex = findSourceIdentityDuplicate(state.items, normalized)
      const duplicateIndex = identityIndex >= 0 ? identityIndex : hasExplicitId ? -1 : findRecentDuplicate(state.items, normalized, now)
      if (duplicateIndex >= 0) {
        state.items[duplicateIndex] = mergeDuplicate(state.items[duplicateIndex], normalized, now)
        return publicItem(state.items[duplicateIndex])
      }
      const index = state.items.findIndex((item) => item.id === normalized.id)
      if (index < 0) {
        appendActivity(normalized, 'received', inferReceivedActor(normalized), { count: normalized.receivedCount }, normalized.lastReceivedAt)
        state.items.push(normalized)
      }
      else if (normalized.updatedAt >= state.items[index].updatedAt) state.items[index] = normalized
      return publicItem(index < 0 ? normalized : state.items[index])
    })
  }

  async upsertXhs(input, { loadImage } = {}) {
    if (typeof loadImage !== 'function') throw httpError(500, 'XHS image loader is not configured.')
    const xhs = normalizeSourceData(input?.xhs)
    if (xhs.provider !== 'xiaohongshu' || !clean(xhs.noteId)) throw httpError(422, 'XHS noteId is required.')
    return this.#mutate(async (state) => {
      const now = new Date().toISOString()
      const sourceIdentity = { provider: 'xiaohongshu', externalId: clean(xhs.noteId) }
      const existingIndex = state.items.findIndex((item) => !item.deletedAt
        && item.sourceIdentity?.provider === sourceIdentity.provider
        && item.sourceIdentity?.externalId === sourceIdentity.externalId)
      const existing = existingIndex >= 0 ? state.items[existingIndex] : null
      const previousXhsImages = (existing?.attachments || []).filter((attachment) => attachment.sourceImage?.provider === 'xiaohongshu')
      const nonXhsAttachments = mergeAttachments(
        (existing?.attachments || []).filter((attachment) => attachment.sourceImage?.provider !== 'xiaohongshu'),
        Array.isArray(input.attachments) ? input.attachments.map(normalizeAttachment) : [],
      )
      const imageAttachments = []
      const imageRecords = []
      let downloadedImages = 0
      let downloadedBytes = 0
      const remoteImages = Array.isArray(xhs.images) ? xhs.images.slice(0, MAX_XHS_IMAGES) : []

      for (let position = 0; position < remoteImages.length; position += 1) {
        const image = remoteImages[position]
        const imageIndex = Math.max(1, Number(image.index) || position + 1)
        const remoteUrl = clean(image.url)
        const sourceKey = canonicalImageSource(remoteUrl)
        const previous = previousXhsImages.find((attachment) => attachment.sourceImage?.index === imageIndex
          && attachment.sourceImage?.sourceKey === sourceKey)
        if (previous && await completeAttachment(this.mediaDir, previous)) {
          imageAttachments.push(previous)
          imageRecords.push(sourceImageRecord(previous, 'ready'))
          continue
        }
        if (downloadedBytes >= MAX_XHS_DOWNLOAD_BYTES) {
          imageRecords.push({
            index: imageIndex,
            status: 'failed',
            width: finitePositive(image.width),
            height: finitePositive(image.height),
            error: 'XHS image download budget was exhausted.',
          })
          continue
        }
        try {
          const loaded = await loadImage(remoteUrl)
          const mimeType = clean(loaded?.mimeType)
          const extension = extensionFromMime(mimeType)
          const storageName = randomUUID()
          const temporary = path.join(this.mediaDir, `${storageName}.tmp`)
          const target = path.join(this.mediaDir, storageName)
          const buffer = Buffer.isBuffer(loaded?.buffer) ? loaded.buffer : Buffer.from(loaded?.buffer || [])
          if (!buffer.length) throw new Error('XHS image was empty.')
          if (downloadedBytes + buffer.length > MAX_XHS_DOWNLOAD_BYTES) throw new Error('XHS image download budget was exceeded.')
          await writeFile(temporary, buffer)
          await rename(temporary, target)
          const attachment = normalizeAttachment({
            id: randomUUID(),
            name: `xiaohongshu-${sourceIdentity.externalId}-${String(imageIndex).padStart(2, '0')}.${extension}`,
            mimeType,
            size: buffer.length,
            sha256: createHash('sha256').update(buffer).digest('hex'),
            storageName,
            sourceImage: {
              provider: 'xiaohongshu',
              index: imageIndex,
              remoteUrl,
              sourceKey,
              width: loaded.width ?? image.width ?? null,
              height: loaded.height ?? image.height ?? null,
            },
          })
          imageAttachments.push(attachment)
          imageRecords.push(sourceImageRecord(attachment, 'ready'))
          downloadedImages += 1
          downloadedBytes += buffer.length
        } catch (error) {
          imageRecords.push({
            index: imageIndex,
            status: 'failed',
            width: finitePositive(image.width),
            height: finitePositive(image.height),
            error: clean(error?.message).slice(0, 240) || 'XHS image download failed.',
          })
        }
      }

      const attachments = [...nonXhsAttachments, ...imageAttachments]
      const failedImages = imageRecords.filter((image) => image.status === 'failed').length
      const sourceData = normalizeSourceData({
        ...xhs,
        parseStatus: failedImages ? 'partial' : xhs.parseStatus === 'failed' ? 'failed' : 'complete',
        images: imageRecords,
        imageCount: remoteImages.length,
        downloadedImages,
        downloadedBytes,
        failedImages,
        sharedText: clean(input.sharedText || input.text),
        refreshedAt: now,
      })
      const normalized = normalizeItem({
        ...input,
        title: clean(xhs.title) || input.title,
        text: clean(xhs.desc) || input.text,
        sourceUrl: clean(xhs.canonicalUrl) || input.sourceUrl,
        sourceApp: '小红书',
        kind: attachments.length ? 'mixed' : 'link',
        attachments,
        sourceIdentity,
        sourceData,
      }, now)

      if (!existing) {
        appendActivity(normalized, 'received', inferReceivedActor(normalized), { count: normalized.receivedCount }, normalized.lastReceivedAt)
        state.items.push(normalized)
        return publicItem(normalized)
      }
      const refreshed = {
        ...existing,
        title: normalized.title,
        text: normalized.text,
        sourceUrl: normalized.sourceUrl,
        sourceApp: '小红书',
        note: normalized.note || existing.note,
        kind: normalized.kind,
        attachments,
        sourceIdentity,
        sourceData,
        fingerprint: normalized.fingerprint,
        receivedCount: Math.max(1, Number(existing.receivedCount) || 1) + 1,
        lastReceivedAt: now,
        seenByCAt: null,
        updatedAt: now,
        syncState: 'synced',
      }
      appendActivity(refreshed, 'received', inferReceivedActor(normalized), { count: refreshed.receivedCount }, now)
      appendActivity(refreshed, 'source_refreshed', 'system', {}, now)
      state.items[existingIndex] = refreshed
      return publicItem(refreshed)
    })
  }

  async takeUnseen({ limit = 8 } = {}) {
    return this.#mutate((state) => {
      const now = new Date().toISOString()
      const items = state.items
        .filter((item) => !item.deletedAt && !item.seenByCAt && item.status !== 'archived')
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Math.max(1, Math.min(Number(limit) || 8, 20)))
      for (const item of items) {
        item.seenByCAt = now
        item.updatedAt = now
        appendActivity(item, 'seen_by_aqi', 'Aqi', {}, now)
      }
      return items.map(publicItem)
    })
  }

  async reply(id, input) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const replyId = clean(input.replyId) || randomUUID()
      const existing = item.replies.find((reply) => reply.id === replyId)
      if (existing) return { item: publicItem(item), reply: clone(existing), duplicate: true }
      const text = clean(input.text)
      if (!text) throw httpError(400, 'Reply text is required.')
      const reply = {
        id: replyId,
        author: input.author === 'EE' ? 'EE' : 'Aqi',
        text,
        createdAt: input.createdAt || new Date().toISOString(),
        source: ['aqi-drawer', 'chatgpt', 'shortcut'].includes(input.source) ? input.source : 'chatgpt',
      }
      item.replies.push(reply)
      item.updatedAt = reply.createdAt
      item.syncState = 'synced'
      appendActivity(item, 'reply_added', reply.author, { replyId: reply.id, author: reply.author }, reply.createdAt)
      return { item: publicItem(item), reply: clone(reply), duplicate: false }
    })
  }

  async editNote(id, note) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const nextNote = clean(note)
      if (item.note === nextNote) return { item: publicItem(item), changed: false }
      item.note = nextNote
      item.updatedAt = new Date().toISOString()
      item.syncState = 'synced'
      return { item: publicItem(item), changed: true }
    })
  }

  async setReplyHidden(id, replyId, hidden) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const reply = item.replies.find((entry) => entry.id === replyId)
      if (!reply) throw httpError(404, 'Pocket reply not found.')

      const isHidden = Boolean(reply.hiddenAt)
      if (isHidden === hidden) {
        return { item: publicItem(item), changed: false }
      }

      const now = new Date().toISOString()

      if (hidden) {
        reply.hiddenAt = now
      } else {
        delete reply.hiddenAt
      }

      item.updatedAt = now
      item.syncState = 'synced'

      return { item: publicItem(item), changed: true }
    })
  }

  async hideReply(id, replyId) {
    return this.setReplyHidden(id, replyId, true)
  }

  async review(id, action, candidateResult, { actor = 'system' } = {}) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      if (!STATUSES.has(action)) throw httpError(400, 'Unknown pocket review action.')
      if (item.status === action) return publicItem(item)
      const now = new Date().toISOString()
      const previousStatus = item.status
      item.status = action
      item.updatedAt = now
      item.syncState = 'synced'
      if (action === 'discussed') {
        item.seenByCAt ||= now
        item.discussedAt = now
      }
      if (action === 'memory_candidate') {
        item.memoryCandidate = candidateResult?.ok
          ? {
              status: 'pending_review',
              candidateIds: candidateResult.candidateIds ?? [],
              rootHash: candidateResult.rootHash,
              updatedAt: now,
            }
          : {
              status: 'pending_sync',
              candidateIds: [],
              error: candidateResult?.error || 'C-Memory is not configured.',
              updatedAt: now,
            }
      }
      appendActivity(item, 'status_changed', normalizeActor(actor), { from: previousStatus, to: action }, now)
      return publicItem(item)
    })
  }

  async listCollections() {
    const state = await this.#read()

    return [
      ...new Set([
        ...(
          Array.isArray(state.collections)
            ? state.collections
            : []
        ),
        ...state.items
          .filter((item) => !item.deletedAt)
          .map((item) => item.collection),
      ]
        .map((value) => normalizeCollection(value))
        .filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b))
  }

  async createCollection(value) {
    const collection = normalizeCollection(value)

    if (!collection) {
      throw httpError(
        422,
        'Collection name is required.',
      )
    }

    return this.#mutate((state) => {
      state.collections = Array.isArray(
        state.collections,
      )
        ? state.collections
        : []

      if (state.collections.includes(collection)) {
        return {
          collection,
          changed: false,
        }
      }

      state.collections = [
        ...state.collections,
        collection,
      ].sort((a, b) => a.localeCompare(b))

      return {
        collection,
        changed: true,
      }
    })
  }

  async deleteCollection(
    value,
    { actor = 'system' } = {},
  ) {
    const collection = normalizeCollection(value)

    if (!collection) {
      throw httpError(
        422,
        'Collection name is required.',
      )
    }

    return this.#mutate((state) => {
      state.collections = Array.isArray(
        state.collections,
      )
        ? state.collections
        : []

      const existed =
        state.collections.includes(collection)

      state.collections =
        state.collections.filter(
          (entry) => entry !== collection,
        )

      const now = new Date().toISOString()
      const clearedItemIds = []

      for (const item of state.items) {
        if (
          item.deletedAt
          || item.collection !== collection
        ) {
          continue
        }

        const collectionFrom =
          item.collection

        item.collection = null
        item.updatedAt = now
        item.syncState = 'synced'

        appendActivity(
          item,
          'metadata_changed',
          normalizeActor(actor),
          {
            collectionFrom,
            collectionTo: null,
            tagsAdded: [],
            tagsRemoved: [],
          },
          now,
        )

        clearedItemIds.push(item.id)
      }

      return {
        collection,
        changed:
          existed
          || clearedItemIds.length > 0,
        clearedItemIds,
      }
    })
  }

  async listTags() {
    const state = await this.#read()

    return [
      ...new Set([
        ...(
          Array.isArray(state.tags)
            ? state.tags
            : []
        ),
        ...state.items
          .filter((item) => !item.deletedAt)
          .flatMap((item) =>
            normalizeTags(item.tags),
          ),
      ]
        .map((value) =>
          normalizeTags([value])[0],
        )
        .filter(Boolean)),
    ].sort((a, b) =>
      a.localeCompare(b),
    )
  }

  async createTag(value) {
    const tag =
      normalizeTags([value])[0]

    if (!tag) {
      throw httpError(
        422,
        'Tag name is required.',
      )
    }

    return this.#mutate((state) => {
      state.tags =
        Array.isArray(state.tags)
          ? state.tags
          : []

      if (state.tags.includes(tag)) {
        return {
          tag,
          changed: false,
        }
      }

      state.tags = [
        ...state.tags,
        tag,
      ].sort((a, b) =>
        a.localeCompare(b),
      )

      return {
        tag,
        changed: true,
      }
    })
  }

  async deleteTag(
    value,
    { actor = 'system' } = {},
  ) {
    const tag =
      normalizeTags([value])[0]

    if (!tag) {
      throw httpError(
        422,
        'Tag name is required.',
      )
    }

    return this.#mutate((state) => {
      state.tags =
        Array.isArray(state.tags)
          ? state.tags
          : []

      /*
        Repair old stores before deletion:
        existing item tags belong to the registry,
        even when state.tags did not exist yet.
      */
      state.tags = [
        ...new Set([
          ...state.tags,
          ...state.items
            .filter(
              (item) =>
                !item.deletedAt,
            )
            .flatMap(
              (item) =>
                normalizeTags(
                  item.tags,
                ),
            ),
        ]),
      ].sort((a, b) =>
        a.localeCompare(b),
      )

      const existed =
        state.tags.includes(tag)

      state.tags =
        state.tags.filter(
          (entry) =>
            entry !== tag,
        )

      const now =
        new Date().toISOString()

      const changedItemIds = []

      for (const item of state.items) {
        if (item.deletedAt) {
          continue
        }

        const before =
          normalizeTags(item.tags)

        if (!before.includes(tag)) {
          continue
        }

        item.tags =
          before.filter(
            (entry) =>
              entry !== tag,
          )

        item.updatedAt = now
        item.syncState = 'synced'

        appendActivity(
          item,
          'metadata_changed',
          normalizeActor(actor),
          {
            collectionFrom:
              item.collection || null,

            collectionTo:
              item.collection || null,

            tagsAdded: [],

            tagsRemoved:
              [tag],
          },
          now,
        )

        changedItemIds.push(
          item.id,
        )
      }

      return {
        tag,

        changed:
          existed
          || changedItemIds.length > 0,

        changedCount:
          changedItemIds.length,

        changedItemIds,
      }
    })
  }

  async editMetadata(id, input, { actor = 'system' } = {}) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const collectionFrom = item.collection || null
      const tagsFrom = normalizeTags(item.tags)

      /*
        Tag Registry V1:
        a tag remains part of the Drawer vocabulary
        even when this item becomes its last user.

        Fold both the existing item tags and requested
        additions into the registry before applying
        tagsRemove.
      */
      state.tags =
        Array.isArray(state.tags)
          ? state.tags
          : []

      state.tags = [
        ...new Set([
          ...state.tags,
          ...tagsFrom,
          ...normalizeTags(
            input?.tagsAdd,
          ),
        ]),
      ].sort((a, b) =>
        a.localeCompare(b),
      )

      let collectionTo = collectionFrom
      if (input?.clearCollection === true) collectionTo = null
      else if (Object.hasOwn(input || {}, 'collection')) collectionTo = normalizeCollection(input.collection)
      const remove = new Set(normalizeTags(input?.tagsRemove))
      const tagsAfterRemove = tagsFrom.filter((tag) => !remove.has(tag))
      const tagsTo = normalizeTags([...tagsAfterRemove, ...normalizeTags(input?.tagsAdd)])
      const tagsAdded = tagsTo.filter((tag) => !tagsFrom.includes(tag))
      const tagsRemoved = tagsFrom.filter((tag) => !tagsTo.includes(tag))
      state.collections = Array.isArray(
        state.collections,
      )
        ? state.collections
        : []

      let collectionRegistered = false

      if (
        collectionTo
        && !state.collections.includes(collectionTo)
      ) {
        state.collections = [
          ...state.collections,
          collectionTo,
        ].sort((a, b) => a.localeCompare(b))

        collectionRegistered = true
      }

      const changed =
        collectionFrom !== collectionTo
        || tagsAdded.length > 0
        || tagsRemoved.length > 0

      if (!changed) {
        return {
          item: publicItem(item),
          changed: collectionRegistered,
        }
      }
      const now = new Date().toISOString()
      item.collection = collectionTo
      item.tags = tagsTo
      item.updatedAt = now
      item.syncState = 'synced'
      appendActivity(item, 'metadata_changed', normalizeActor(actor), {
        collectionFrom,
        collectionTo,
        tagsAdded,
        tagsRemoved,
      }, now)
      return { item: publicItem(item), changed: true }
    })
  }

  async recordContentRead(id, { mode = 'compact', actor = 'system', sourceRefreshed = false } = {}) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      appendActivity(item, 'content_read', normalizeActor(actor), { mode: normalizeReadMode(mode) })
      if (sourceRefreshed) appendActivity(item, 'source_refreshed', 'system')
      return publicItem(item)
    })
  }

  async setContentSnapshot(id, snapshot) {
    return this.#mutate((state) => {
      const item = state.items.find((entry) => entry.id === id && !entry.deletedAt)
      if (!item) throw httpError(404, 'Pocket item not found.')
      const incoming = normalizeContentSnapshot(snapshot)
      const current = item.contentSnapshot ? normalizeContentSnapshot(item.contentSnapshot) : null
      const sameSource = current?.sourceUrl === incoming.sourceUrl
      const currentIsAtLeastAsFresh = Date.parse(current?.fetchedAt) >= Date.parse(incoming.fetchedAt)
      item.contentSnapshot = sameSource && current.detail === 'full' && incoming.detail !== 'full' && currentIsAtLeastAsFresh
        ? current
        : incoming
      return publicItem(item)
    })
  }

  async getAttachmentFile(attachmentId) {
    const state = await this.#read()
    for (const item of state.items) {
      const attachment = item.attachments.find((entry) => entry.id === attachmentId && entry.storageName)
      if (!attachment) continue
      return {
        attachment: publicAttachment(attachment),
        filePath: path.join(this.mediaDir, path.basename(attachment.storageName)),
      }
    }
    return null
  }

  async readAttachment(attachmentId, maxBytes = 5 * 1024 * 1024) {
    const state = await this.#read()
    for (const item of state.items) {
      const attachment = item.attachments.find((entry) => entry.id === attachmentId && entry.storageName)
      if (!attachment) continue
      if (attachment.size > maxBytes) throw httpError(413, 'Attachment is too large to return through MCP.')
      const storageName = path.basename(attachment.storageName)
      return {
        attachment: publicAttachment(attachment),
        data: await readFile(path.join(this.mediaDir, storageName)),
      }
    }
    return null
  }

  async #read() {
    const raw = await readFile(this.filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.items)) throw new Error('Pocket store is invalid.')
    parsed.items = parsed.items.map(hydrateStoredItem)
    return parsed
  }

  async #write(state) {
    const next = { ...state, updatedAt: new Date().toISOString() }
    const temporary = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(next, null, 2), 'utf8')
    await rename(temporary, this.filePath)
  }

  #mutate(operation) {
    const run = async () => {
      const state = await this.#read()
      const result = await operation(state)
      await this.#write(state)
      return result
    }
    this.queue = this.queue.then(run, run)
    return this.queue
  }
}

function normalizeItem(input, now) {
  const incoming = normalizeIncomingShare(input)
  const text = clean(incoming.text)
  const sourceUrl = clean(incoming.sourceUrl)
  const attachments = Array.isArray(incoming.attachments) ? incoming.attachments.map(normalizeAttachment) : []
  if (!text && !sourceUrl && attachments.length === 0) throw httpError(400, 'Text, sourceUrl, or an attachment is required.')
  const id = clean(incoming.id) || randomUUID()
  const createdAt = validIso(incoming.createdAt) ? incoming.createdAt : now
  const inferredSource = inferSourceApp(sourceUrl)
  const requestedSource = clean(incoming.sourceApp)
  const sourceApp = inferredSource && isGenericSourceApp(requestedSource)
    ? inferredSource
    : requestedSource || inferredSource || 'Aqi Drawer'
  return {
    id,
    title: clean(incoming.title) || deriveTitle(text, sourceUrl),
    text,
    sourceUrl,
    sourceApp,
    note: clean(incoming.note),
    kind: ['link', 'text', 'image', 'video', 'mixed'].includes(incoming.kind)
      ? incoming.kind
      : attachments.length ? 'mixed' : sourceUrl ? 'link' : 'text',
    status: STATUSES.has(incoming.status) ? incoming.status : 'inbox',
    attachments,
    replies: Array.isArray(incoming.replies) ? incoming.replies.map(normalizeReply).filter(Boolean) : [],
    collection: normalizeCollection(incoming.collection),
    tags: normalizeTags(incoming.tags),
    activity: normalizeActivity(incoming.activity),
    memoryCandidate: normalizeCandidate(incoming.memoryCandidate, createdAt),
    ...(incoming.contentSnapshot ? { contentSnapshot: normalizeContentSnapshot(incoming.contentSnapshot) } : {}),
    ...(incoming.sourceIdentity ? { sourceIdentity: normalizeSourceIdentity(incoming.sourceIdentity) } : {}),
    ...(incoming.sourceData ? { sourceData: normalizeSourceData(incoming.sourceData) } : {}),
    fingerprint: clean(incoming.fingerprint) || createFingerprint(text, sourceUrl, attachments),
    receivedCount: Math.max(1, Number(incoming.receivedCount) || 1),
    lastReceivedAt: validIso(incoming.lastReceivedAt) ? incoming.lastReceivedAt : createdAt,
    seenByCAt: validIso(incoming.seenByCAt) ? incoming.seenByCAt : null,
    discussedAt: validIso(incoming.discussedAt) ? incoming.discussedAt : null,
    createdAt,
    updatedAt: validIso(incoming.updatedAt) ? incoming.updatedAt : now,
    deletedAt: validIso(incoming.deletedAt) ? incoming.deletedAt : null,
    syncState: 'synced',
  }
}

function normalizeContentSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Content snapshot must be an object.')
  }
  const snapshot = clone(value)
  delete snapshot.rawHtml
  delete snapshot.media
  delete snapshot.buffers
  delete snapshot.frameExtraction
  delete snapshot.visuals
  delete snapshot.browserCapturePlan
  return snapshot
}

function findRecentDuplicate(items, candidate, now) {
  if (!candidate.fingerprint) return -1
  const cutoff = Date.parse(now) - DEDUPE_WINDOW_MS
  return items.findIndex((item) => {
    if (item.deletedAt) return false
    const fingerprint = item.fingerprint || createFingerprint(item.text, item.sourceUrl, item.attachments)
    const receivedAt = Date.parse(item.lastReceivedAt || item.updatedAt || item.createdAt)
    return fingerprint === candidate.fingerprint && Number.isFinite(receivedAt) && receivedAt >= cutoff
  })
}

function mergeDuplicate(existing, incoming, now) {
  const attachments = [...existing.attachments]
  for (const attachment of incoming.attachments) {
    const duplicate = attachments.some((entry) => entry.sha256 && attachment.sha256
      ? entry.sha256 === attachment.sha256
      : entry.name === attachment.name && entry.size === attachment.size)
    if (!duplicate) attachments.push(attachment)
  }
  const merged = {
    ...existing,
    title: existing.title || incoming.title,
    text: incoming.text.length > clean(existing.text).length ? incoming.text : existing.text,
    sourceUrl: existing.sourceUrl || incoming.sourceUrl,
    sourceApp: isGenericSourceApp(existing.sourceApp) && !isGenericSourceApp(incoming.sourceApp)
      ? incoming.sourceApp
      : existing.sourceApp,
    note: existing.note || incoming.note,
    kind: attachments.length ? 'mixed' : existing.sourceUrl || incoming.sourceUrl ? 'link' : 'text',
    attachments,
    ...(incoming.sourceIdentity ? { sourceIdentity: incoming.sourceIdentity } : {}),
    ...(incoming.sourceData ? { sourceData: incoming.sourceData } : {}),
    fingerprint: incoming.fingerprint,
    receivedCount: Math.max(1, Number(existing.receivedCount) || 1) + 1,
    lastReceivedAt: now,
    seenByCAt: null,
    updatedAt: now,
    syncState: 'synced',
  }
  appendActivity(merged, 'received', inferReceivedActor(incoming), { count: merged.receivedCount }, now)
  return merged
}

function findSourceIdentityDuplicate(items, candidate) {
  const provider = clean(candidate.sourceIdentity?.provider)
  const externalId = clean(candidate.sourceIdentity?.externalId)
  if (!provider || !externalId) return -1
  return items.findIndex((item) => !item.deletedAt
    && item.sourceIdentity?.provider === provider
    && item.sourceIdentity?.externalId === externalId)
}

function createFingerprint(text, sourceUrl, attachments = []) {
  const url = canonicalizeUrl(sourceUrl)
  const attachmentKeys = attachments.map((entry) => entry.sha256 || `${entry.name}:${entry.size}`).sort().join('|')
  const source = url ? `url:${url}` : clean(text) ? `text:${clean(text).replace(/\s+/g, ' ')}` : `files:${attachmentKeys}`
  return source ? createHash('sha256').update(source).digest('hex') : ''
}

function normalizeAttachment(value) {
  return {
    id: clean(value?.id) || randomUUID(),
    name: clean(value?.name) || 'attachment',
    mimeType: clean(value?.mimeType) || 'application/octet-stream',
    size: Math.max(0, Number(value?.size) || 0),
    ...(clean(value?.sha256) ? { sha256: clean(value.sha256) } : {}),
    ...(clean(value?.url) ? { url: clean(value.url) } : {}),
    ...(clean(value?.storageName) ? { storageName: path.basename(clean(value.storageName)) } : {}),
    ...(value?.sourceImage ? { sourceImage: normalizeSourceImage(value.sourceImage) } : {}),
  }
}

function normalizeSourceIdentity(value) {
  return {
    provider: clean(value?.provider),
    externalId: clean(value?.externalId),
  }
}

function normalizeSourceData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const normalized = clone(value)
  delete normalized.rawHtml
  delete normalized.initialState
  delete normalized.buffers
  return normalized
}

function normalizeSourceImage(value) {
  return {
    provider: clean(value?.provider),
    index: Math.max(1, Number(value?.index) || 1),
    remoteUrl: clean(value?.remoteUrl),
    sourceKey: clean(value?.sourceKey),
    width: finitePositive(value?.width),
    height: finitePositive(value?.height),
  }
}

function mergeAttachments(existing, incoming) {
  const merged = [...existing]
  for (const attachment of incoming) {
    const duplicate = merged.some((entry) => entry.id === attachment.id || (entry.sha256 && attachment.sha256
      ? entry.sha256 === attachment.sha256
      : entry.name === attachment.name && entry.size === attachment.size))
    if (!duplicate) merged.push(attachment)
  }
  return merged
}

async function completeAttachment(mediaDir, attachment) {
  if (!clean(attachment?.storageName) || Number(attachment?.size) <= 0) return false
  try {
    const found = await stat(path.join(mediaDir, path.basename(attachment.storageName)))
    return found.isFile() && found.size === Number(attachment.size)
  } catch {
    return false
  }
}

function canonicalImageSource(value) {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    return url.href
  } catch {
    return clean(value)
  }
}

function sourceImageRecord(attachment, status) {
  return {
    index: attachment.sourceImage.index,
    status,
    attachmentId: attachment.id,
    width: attachment.sourceImage.width,
    height: attachment.sourceImage.height,
    bytes: attachment.size,
    mimeType: attachment.mimeType,
  }
}

function extensionFromMime(value) {
  if (value === 'image/png') return 'png'
  if (value === 'image/gif') return 'gif'
  if (value === 'image/webp') return 'webp'
  if (value === 'image/avif') return 'avif'
  return 'jpg'
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function normalizeReply(value) {
  if (!value || !clean(value.text)) return null
  return {
    id: clean(value.id) || randomUUID(),
    author: value.author === 'EE' ? 'EE' : 'Aqi',
    text: clean(value.text),
    createdAt: validIso(value.createdAt) ? value.createdAt : new Date().toISOString(),
    source: ['aqi-drawer', 'chatgpt', 'shortcut'].includes(value.source) ? value.source : 'aqi-drawer',
    ...(validIso(value.hiddenAt) ? { hiddenAt: value.hiddenAt } : {}),
  }
}

function normalizeCandidate(value, now) {
  const allowed = ['none', 'pending_sync', 'pending_review', 'approved', 'rejected']
  return {
    status: allowed.includes(value?.status) ? value.status : 'none',
    candidateIds: Array.isArray(value?.candidateIds) ? value.candidateIds.map(clean).filter(Boolean) : [],
    ...(clean(value?.error) ? { error: clean(value.error) } : {}),
    updatedAt: validIso(value?.updatedAt) ? value.updatedAt : now,
  }
}

function deriveTitle(text, url) {
  if (text) return text.replace(/\s+/g, ' ').slice(0, 42)
  try { return new URL(url).hostname } catch { return '刚刚叼回来的东西' }
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validIso(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function clone(value) {
  return structuredClone(value)
}

function publicItem(item, { includeContentSnapshot = false } = {}) {
  const visible = clone(item)
  delete visible.fingerprint
  const contentSnapshot = visible.contentSnapshot
  if (!includeContentSnapshot) delete visible.contentSnapshot

  const normalizedReplies =
    (Array.isArray(item.replies) ? item.replies : [])
      .map(normalizeReply)
      .filter(Boolean)

  const visibleReplies =
    normalizedReplies.filter((reply) => !reply.hiddenAt)

  const hiddenReplies =
    normalizedReplies.filter((reply) => Boolean(reply.hiddenAt))

  return {
    ...visible,
    receivedCount: Math.max(1, Number(item.receivedCount) || 1),
    lastReceivedAt: item.lastReceivedAt || item.createdAt,
    seenByCAt: item.seenByCAt || null,
    discussedAt: item.discussedAt || null,
    collection: item.collection || null,
    tags: normalizeTags(item.tags),
    activity: normalizeActivity(item.activity),
    replies: visibleReplies,
    hiddenReplies,
    hiddenReplyCount: hiddenReplies.length,
    attachments: item.attachments.map(publicAttachment),
    ...(contentSnapshot && !includeContentSnapshot ? { contentRead: summarizeContentSnapshot(contentSnapshot) } : {}),
  }
}

function hydrateStoredItem(item) {
  return {
    ...item,
    collection: normalizeCollection(item?.collection),
    tags: normalizeTags(item?.tags),
    activity: normalizeActivity(item?.activity),
    attachments: Array.isArray(item?.attachments) ? item.attachments : [],
    replies: Array.isArray(item?.replies) ? item.replies.map(normalizeReply).filter(Boolean) : [],
  }
}

function normalizeCollection(value) {
  const normalized = clean(value).replace(/\s+/g, ' ').slice(0, 80)
  return normalized || null
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : []
  const result = []
  for (const entry of values) {
    const tag = clean(entry).replace(/^#+/u, '').replace(/\s+/g, ' ').slice(0, 50)
    if (tag && !result.includes(tag)) result.push(tag)
    if (result.length >= 40) break
  }
  return result
}

function normalizeActivity(value) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => normalizeActivityEntry(entry)).filter(Boolean)
}

function normalizeActivityEntry(entry) {
  if (!entry || !ACTIVITY_TYPES.has(entry.type) || !validIso(entry.at)) return null
  const detail = normalizeActivityDetail(entry.type, entry.detail)
  return {
    id: clean(entry.id) || randomUUID(),
    type: entry.type,
    actor: normalizeActor(entry.actor),
    at: entry.at,
    ...(Object.keys(detail).length ? { detail } : {}),
  }
}

function appendActivity(item, type, actor, detail = {}, at = new Date().toISOString()) {
  if (!ACTIVITY_TYPES.has(type)) return
  item.activity = normalizeActivity(item.activity)
  item.activity.push({
    id: randomUUID(),
    type,
    actor: normalizeActor(actor),
    at: validIso(at) ? at : new Date().toISOString(),
    ...(Object.keys(normalizeActivityDetail(type, detail)).length ? { detail: normalizeActivityDetail(type, detail) } : {}),
  })
}

function normalizeActivityDetail(type, detail = {}) {
  if (type === 'received') return { count: Math.max(1, Number(detail.count) || 1) }
  if (type === 'content_read') return { mode: normalizeReadMode(detail.mode) }
  if (type === 'reply_added') return { replyId: clean(detail.replyId).slice(0, 120), author: normalizeActor(detail.author) }
  if (type === 'status_changed') return STATUSES.has(detail.from) && STATUSES.has(detail.to) ? { from: detail.from, to: detail.to } : {}
  if (type === 'metadata_changed') return {
    collectionFrom: normalizeCollection(detail.collectionFrom),
    collectionTo: normalizeCollection(detail.collectionTo),
    tagsAdded: normalizeTags(detail.tagsAdded),
    tagsRemoved: normalizeTags(detail.tagsRemoved),
  }
  return {}
}

function normalizeActor(value) {
  return ['EE', 'Aqi', 'system'].includes(value) ? value : 'system'
}

function normalizeReadMode(value) {
  return ['compact', 'full', 'images', 'video_frames', 'refresh'].includes(value) ? value : 'compact'
}

function inferReceivedActor(item) {
  const source = clean(item?.sourceApp).toLowerCase()
  return /iphone|快捷指令|shortcut|分享菜单/u.test(source) ? 'EE' : 'system'
}

function summarizeContentSnapshot(snapshot) {
  return {
    cachedAt: snapshot.fetchedAt,
    detail: snapshot.detail,
    pageType: snapshot.pageType,
    title: clean(snapshot.title).slice(0, 160),
    textPreview: clean(snapshot.text).replace(/\s+/g, ' ').slice(0, 240),
    imagesAvailable: Array.isArray(snapshot.images) ? snapshot.images.length : 0,
    videoDetected: Boolean(snapshot.video),
  }
}

function publicAttachment(attachment) {
  const { storageName, ...safe } = clone(attachment)
  if (safe.sourceImage) {
    const { remoteUrl, sourceKey, ...visibleSourceImage } = safe.sourceImage
    void remoteUrl
    void sourceKey
    safe.sourceImage = visibleSourceImage
  }
  return {
    ...safe,
    ...(storageName && !safe.url ? { url: `/api/pocket/media/${encodeURIComponent(attachment.id)}` } : {}),
  }
}

export function httpError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
