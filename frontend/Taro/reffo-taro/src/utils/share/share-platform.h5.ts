export type ShareUrlResult = 'shared' | 'copied' | 'manual' | 'cancelled'
export type ShareImageResult = 'shared' | 'downloaded' | 'cancelled'

function isH5Runtime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined'
}

export async function copyShareText(text: string) {
  if (!isH5Runtime()) throw new Error('当前平台不支持复制分享链接')
  if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持自动复制')

  await navigator.clipboard.writeText(text)
}

export async function shareOrCopyUrl(
  url: string,
  title: string,
  text: string,
): Promise<ShareUrlResult> {
  if (!isH5Runtime()) throw new Error('当前平台不支持链接分享')

  const navigatorWithShare = navigator as Navigator & {
    share?: (data: {title?: string; text?: string; url?: string}) => Promise<void>
    canShare?: (data: {url?: string}) => boolean
  }

  if (navigatorWithShare.share && navigatorWithShare.canShare?.({url}) !== false) {
    try {
      await navigatorWithShare.share({title, text, url})
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  try {
    await copyShareText(url)
    return 'copied'
  } catch {
    return 'manual'
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}

export async function saveShareImage(
  blob: Blob,
  filename: string,
  title: string,
): Promise<ShareImageResult> {
  if (!isH5Runtime()) throw new Error('当前平台不支持保存分享图')

  if (typeof File === 'undefined') {
    downloadBlob(blob, filename)
    return 'downloaded'
  }

  const file = new File([blob], filename, {type: 'image/png'})
  const navigatorWithShare = navigator as Navigator & {
    share?: (data: {files?: File[]; title?: string}) => Promise<void>
    canShare?: (data: {files?: File[]}) => boolean
  }

  if (
    navigatorWithShare.share
    && navigatorWithShare.canShare?.({files: [file]}) !== false
  ) {
    try {
      await navigatorWithShare.share({files: [file], title})
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  downloadBlob(blob, filename)
  return 'downloaded'
}
