type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: {timeout?: number}) => number
  cancelIdleCallback?: (handle: number) => void
}

export function scheduleIdle(callback: () => void, timeout = 2000) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const idleWindow = window as IdleWindow

  if (idleWindow.requestIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, {timeout})
    return () => idleWindow.cancelIdleCallback?.(handle)
  }

  const handle = window.setTimeout(callback, Math.min(timeout, 1200))
  return () => window.clearTimeout(handle)
}
