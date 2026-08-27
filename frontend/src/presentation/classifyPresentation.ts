import type {
  PocketAttachmentSummary,
  PocketItemSummary,
} from '../types/pocket'

export type PresentationKind =
  | 'text'
  | 'article'
  | 'photo'
  | 'video'
  | 'audio'
  | 'document'
  | 'product'
  | 'repository'
  | 'mixed'

export type SourceFlavor =
  | 'xiaohongshu'
  | 'taobao'
  | 'jd'
  | 'pinduoduo'
  | 'bilibili'
  | 'douyin'
  | 'wechat'
  | 'weibo'
  | 'zhihu'
  | 'douban'
  | 'youtube'
  | 'instagram'
  | 'tiktok'
  | 'x'
  | 'spotify'
  | 'apple-music'
  | 'netease-music'
  | 'github'
  | 'generic'

export interface PresentationClassification {
  kind: PresentationKind
  sourceFlavor: SourceFlavor
}

export const presentationKindLabels:
  Record<PresentationKind, string> = {
    text: '文字',
    article: '网页',
    photo: '图片',
    video: '视频',
    audio: '音频',
    document: '文档',
    product: '商品',
    repository: '代码仓库',
    mixed: '混合内容',
  }

interface SourceRule {
  flavor: SourceFlavor
  needles: string[]
}

const sourceRules: SourceRule[] = [
  {
    flavor: 'xiaohongshu',
    needles: [
      '小红书',
      'xiaohongshu.com',
      'xhslink.com',
      'xhslink.cn',
    ],
  },
  {
    flavor: 'taobao',
    needles: [
      '淘宝',
      '天猫',
      'taobao.com',
      'tmall.com',
      'm.tb.cn',
      'tb.cn',
    ],
  },
  {
    flavor: 'jd',
    needles: [
      '京东',
      'jd.com',
      '3.cn',
    ],
  },
  {
    flavor: 'pinduoduo',
    needles: [
      '拼多多',
      'pinduoduo.com',
      'yangkeduo.com',
    ],
  },
  {
    flavor: 'bilibili',
    needles: [
      '哔哩哔哩',
      'bilibili',
      'b23.tv',
    ],
  },
  {
    flavor: 'douyin',
    needles: [
      '抖音',
      'douyin.com',
      'iesdouyin.com',
    ],
  },
  {
    flavor: 'wechat',
    needles: [
      '微信',
      'weixin.qq.com',
      'mp.weixin.qq.com',
    ],
  },
  {
    flavor: 'weibo',
    needles: [
      '微博',
      'weibo.com',
      'weibo.cn',
    ],
  },
  {
    flavor: 'zhihu',
    needles: [
      '知乎',
      'zhihu.com',
    ],
  },
  {
    flavor: 'douban',
    needles: [
      '豆瓣',
      'douban.com',
    ],
  },
  {
    flavor: 'youtube',
    needles: [
      'youtube',
      'youtube.com',
      'youtu.be',
    ],
  },
  {
    flavor: 'instagram',
    needles: [
      'instagram',
      'instagram.com',
    ],
  },
  {
    flavor: 'tiktok',
    needles: [
      'tiktok',
      'tiktok.com',
    ],
  },
  {
    flavor: 'x',
    needles: [
      'twitter',
      'twitter.com',
      'x.com',
    ],
  },
  {
    flavor: 'spotify',
    needles: [
      'spotify',
      'spotify.com',
    ],
  },
  {
    flavor: 'apple-music',
    needles: [
      'apple music',
      'music.apple.com',
    ],
  },
  {
    flavor: 'netease-music',
    needles: [
      '网易云',
      '网易云音乐',
      'music.163.com',
    ],
  },
  {
    flavor: 'github',
    needles: [
      'github',
      'github.com',
    ],
  },
]

type AttachmentFamily =
  | 'photo'
  | 'video'
  | 'audio'
  | 'document'

function sourceHaystack(
  item: PocketItemSummary,
): string {
  return [
    item.sourceApp,
    item.sourceUrl,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function classifySourceFlavor(
  item: PocketItemSummary,
): SourceFlavor {
  const haystack =
    sourceHaystack(item)

  return (
    sourceRules.find(
      (rule) =>
        rule.needles.some(
          (needle) =>
            haystack.includes(
              needle.toLowerCase(),
            ),
        ),
    )?.flavor
    ?? 'generic'
  )
}

function attachmentFamily(
  attachment: PocketAttachmentSummary,
): AttachmentFamily {
  const mime =
    attachment.mimeType
      .trim()
      .toLowerCase()

  if (mime.startsWith('image/')) {
    return 'photo'
  }

  if (mime.startsWith('video/')) {
    return 'video'
  }

  if (mime.startsWith('audio/')) {
    return 'audio'
  }

  return 'document'
}

function attachmentPresentation(
  item: PocketItemSummary,
): PresentationKind | null {
  if (item.attachments.length === 0) {
    return null
  }

  const families =
    new Set(
      item.attachments.map(
        attachmentFamily,
      ),
    )

  if (families.size > 1) {
    return 'mixed'
  }

  const family =
    [...families][0]

  return family ?? 'document'
}

function sourceNativePresentation(
  flavor: SourceFlavor,
): PresentationKind | null {
  if (
    flavor === 'taobao'
    || flavor === 'jd'
    || flavor === 'pinduoduo'
  ) {
    return 'product'
  }

  if (flavor === 'github') {
    return 'repository'
  }

  if (
    flavor === 'youtube'
    || flavor === 'bilibili'
    || flavor === 'douyin'
    || flavor === 'tiktok'
  ) {
    return 'video'
  }

  if (
    flavor === 'spotify'
    || flavor === 'apple-music'
    || flavor === 'netease-music'
  ) {
    return 'audio'
  }

  return null
}

export function classifyPresentation(
  item: PocketItemSummary,
): PresentationClassification {
  const sourceFlavor =
    classifySourceFlavor(item)

  const fromAttachments =
    attachmentPresentation(item)

  if (fromAttachments) {
    return {
      kind: fromAttachments,
      sourceFlavor,
    }
  }

  if (item.kind === 'image') {
    return {
      kind: 'photo',
      sourceFlavor,
    }
  }

  if (item.kind === 'video') {
    return {
      kind: 'video',
      sourceFlavor,
    }
  }

  const fromSource =
    sourceNativePresentation(
      sourceFlavor,
    )

  if (fromSource) {
    return {
      kind: fromSource,
      sourceFlavor,
    }
  }

  if (item.sourceUrl) {
    return {
      kind: 'article',
      sourceFlavor,
    }
  }

  if (item.kind === 'mixed') {
    return {
      kind: 'mixed',
      sourceFlavor,
    }
  }

  return {
    kind: 'text',
    sourceFlavor,
  }
}
