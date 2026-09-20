export const MAX_CAPTURE_FILES = 5

export function appendCaptureFiles(
  current: File[],
  incoming: Iterable<File>,
): {
  files: File[]
  rejectedCount: number
} {
  const additions = [...incoming]
  const available = Math.max(
    0,
    MAX_CAPTURE_FILES - current.length,
  )

  return {
    files: [
      ...current,
      ...additions.slice(0, available),
    ],
    rejectedCount:
      Math.max(0, additions.length - available),
  }
}
