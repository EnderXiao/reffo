const FILE_PICK_CANCEL_PATTERN = /cancel|取消/i

export function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function formatResumeFileSize(size: number) {
  const sizeInMb = size / (1024 * 1024)
  if (sizeInMb >= 1) {
    return `${sizeInMb.toFixed(sizeInMb >= 10 ? 0 : 1)} Mb`
  }

  return `${Math.max(1, Math.round(size / 1024))} Kb`
}

export function isResumeFileUploadCancelled(error: unknown) {
  const message = typeof error === 'object' && error !== null
    ? `${(error as {message?: string}).message || ''}${(error as {errMsg?: string}).errMsg || ''}`
    : String(error || '')

  return FILE_PICK_CANCEL_PATTERN.test(message)
}
