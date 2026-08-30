import {useCallback, useEffect, useRef} from 'react'

type TimerHandle = ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>

export function useManagedTimers() {
  const timers = useRef(new Set<TimerHandle>())

  const clear = useCallback(() => {
    timers.current.forEach(timer => {
      clearTimeout(timer)
      clearInterval(timer)
    })
    timers.current.clear()
  }, [])

  const timeout = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer)
      callback()
    }, delay)
    timers.current.add(timer)
    return timer
  }, [])

  const interval = useCallback((callback: () => void, delay: number) => {
    const timer = setInterval(callback, delay)
    timers.current.add(timer)
    return timer
  }, [])

  useEffect(() => clear, [clear])

  return {timeout, interval, clear}
}
