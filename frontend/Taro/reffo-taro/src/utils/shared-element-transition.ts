export interface SharedElementSnapshot {
  left: number
  top: number
  width: number
  height: number
  viewportWidth?: number
  viewportHeight?: number
}

export interface ScaledSharedElementSnapshot {
  left: number
  top: number
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
}

export function isValidSharedElementSnapshot(value: Partial<SharedElementSnapshot> | null | undefined) {
  if (!value) {
    return false
  }

  return [value.left, value.top, value.width, value.height].every(item => (
    typeof item === 'number' && Number.isFinite(item)
  ))
}

export function readSharedElementSnapshot<T extends SharedElementSnapshot>(
  storageKey: string,
  logLabel: string,
): T | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage?.getItem(storageKey)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<T>
    return isValidSharedElementSnapshot(parsed) ? parsed as T : null
  } catch (error) {
    console.warn(`读取${logLabel}过渡位置失败:`, error)
    return null
  }
}

export function writeSharedElementSnapshot<T extends SharedElementSnapshot>(
  storageKey: string,
  snapshot: T,
  logLabel: string,
) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.setItem(storageKey, JSON.stringify(snapshot))
  } catch (error) {
    console.warn(`保存${logLabel}过渡位置失败:`, error)
  }
}

export function clearSharedElementSnapshot(storageKey: string, logLabel: string) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.removeItem(storageKey)
  } catch (error) {
    console.warn(`清理${logLabel}过渡位置失败:`, error)
  }
}

export function createSharedElementSnapshot<TExtra extends object = Record<string, never>>(
  rect: Pick<SharedElementSnapshot, 'left' | 'top' | 'width' | 'height'>,
  extra?: TExtra,
): SharedElementSnapshot & TExtra {
  const viewportWidth = typeof window !== 'undefined'
    ? window.innerWidth || document.documentElement.clientWidth || rect.width
    : rect.width
  const viewportHeight = typeof window !== 'undefined'
    ? window.innerHeight || document.documentElement.clientHeight || rect.height
    : rect.height

  return {
    ...(extra ?? ({} as TExtra)),
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    viewportWidth,
    viewportHeight,
  }
}

export function createFallbackSharedElementSnapshot(
  width: number,
  height: number,
): SharedElementSnapshot {
  const viewportWidth = typeof window !== 'undefined'
    ? window.innerWidth || document.documentElement.clientWidth || width
    : width
  const viewportHeight = typeof window !== 'undefined'
    ? window.innerHeight || document.documentElement.clientHeight || height
    : height

  return {
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    width,
    height,
    viewportWidth,
    viewportHeight,
  }
}

export function scaleSharedElementSnapshot(
  snapshot: SharedElementSnapshot | null,
  fallback: Pick<SharedElementSnapshot, 'left' | 'top' | 'width' | 'height'>,
): ScaledSharedElementSnapshot {
  const viewportWidth = typeof window !== 'undefined'
    ? window.innerWidth || document.documentElement.clientWidth || fallback.width
    : fallback.width
  const viewportHeight = typeof window !== 'undefined'
    ? window.innerHeight || document.documentElement.clientHeight || fallback.height
    : fallback.height
  const widthRatio = snapshot?.viewportWidth ? viewportWidth / snapshot.viewportWidth : 1
  const heightRatio = snapshot?.viewportHeight ? viewportHeight / snapshot.viewportHeight : 1
  const width = Math.max(1, (snapshot?.width ?? fallback.width) * widthRatio)
  const height = Math.max(1, (snapshot?.height ?? fallback.height) * heightRatio)

  return {
    left: snapshot ? snapshot.left * widthRatio : fallback.left,
    top: snapshot ? snapshot.top * heightRatio : fallback.top,
    width,
    height,
    viewportWidth,
    viewportHeight,
  }
}
