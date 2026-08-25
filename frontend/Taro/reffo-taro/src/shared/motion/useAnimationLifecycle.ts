import {useCallback, useEffect, useRef} from 'react'
import {useManagedTimers} from './useManagedTimers'

export function useAnimationLifecycle() {
  const frameIds = useRef(new Set<number>())
  const timers = useManagedTimers()

  const frame = useCallback((callback: FrameRequestCallback) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      callback(0)
      return null
    }
    const id = window.requestAnimationFrame(timestamp => {
      frameIds.current.delete(id)
      callback(timestamp)
    })
    frameIds.current.add(id)
    return id
  }, [])

  const cancel = useCallback(() => {
    if (typeof window !== 'undefined') {
      frameIds.current.forEach(id => window.cancelAnimationFrame(id))
    }
    frameIds.current.clear()
    timers.clear()
  }, [timers])

  useEffect(() => cancel, [cancel])

  return {frame, cancel, timeout: timers.timeout, interval: timers.interval}
}
