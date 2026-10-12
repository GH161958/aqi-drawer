const localAttachmentPaths = [
  '/api/pocket/items/',
  '/api/pocket/media/',
]

export function safeAttachmentUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined

  const candidate = value.trim()

  if (
    localAttachmentPaths.some(
      (prefix) => candidate.startsWith(prefix),
    )
  ) {
    return candidate
  }

  try {
    const parsed = new URL(candidate)

    if (
      parsed.protocol === 'http:'
      || parsed.protocol === 'https:'
    ) {
      return parsed.href
    }
  } catch {
    return undefined
  }

  return undefined
}
