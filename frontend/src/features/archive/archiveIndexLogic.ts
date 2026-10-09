import type {
  PocketItemSummary,
} from '../../types/pocket'

export interface ArchiveIndexOptions {
  collections: string[]
  sources: string[]
  tags: string[]
}

export function sourceCategory(
  item: PocketItemSummary,
): string {
  const sourceIdentity =
    [
      item.sourceApp,
      item.sourceUrl,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

  if (
    sourceIdentity.includes('小红书')
    || sourceIdentity.includes('xiaohongshu')
    || sourceIdentity.includes('xhslink')
  ) {
    return '小红书'
  }

  if (item.kind === 'image') {
    return '图片'
  }

  if (
    item.kind === 'link'
    || Boolean(item.sourceUrl)
  ) {
    return '网页'
  }

  if (item.attachments.length > 0) {
    const mime =
      item.attachments[0]?.mimeType
      || ''

    return mime.startsWith('video/')
      ? '视频'
      : '文档'
  }

  return '文字'
}

function cleanRegistry(
  values: Array<string | null | undefined>,
): string[] {
  return [
    ...new Set(
      values
        .map(
          (value) =>
            value?.trim(),
        )
        .filter(
          (
            value,
          ): value is string =>
            Boolean(value),
        ),
    ),
  ]
}

export function archiveIndexOptions(
  items: PocketItemSummary[],
  registeredCollections: string[] = [],
  registeredTags: string[] = [],
): ArchiveIndexOptions {
  const collections =
    cleanRegistry([
      ...registeredCollections,

      ...items.map(
        (item) =>
          item.collection,
      ),
    ])
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'zh-CN',
          ),
      )

  const sources =
    [
      ...new Set(
        items.map(
          sourceCategory,
        ),
      ),
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'zh-CN',
          ),
      )

  const tags =
    cleanRegistry([
      ...registeredTags,

      ...items.flatMap(
        (item) =>
          item.tags,
      ),
    ])
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'zh-CN',
          ),
      )

  return {
    collections,
    sources,
    tags,
  }
}

export function applyArchiveIndexFilters(
  items: PocketItemSummary[],
  collection: string,
  source: string,
  tag: string,
): PocketItemSummary[] {
  return items.filter(
    (item) =>
      (
        !collection
        || item.collection === collection
      )
      && (
        !source
        || sourceCategory(item)
          === source
      )
      && (
        !tag
        || item.tags.includes(tag)
      ),
  )
}
