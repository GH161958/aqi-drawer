export function capturePocketPayload({
  title,
  text,
  expectedFileCount,
}: {
  title: string
  text: string
  expectedFileCount: number
}) {
  const cleanTitle = title.trim()
  const cleanText = text.trim()

  return {
    ...(cleanTitle
      ? {
          title: cleanTitle,
          titleOrigin: 'capture',
        }
      : {}),
    ...(cleanText ? { share: cleanText } : {}),
    expectedFileCount,
  }
}
