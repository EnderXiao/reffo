import {useCallback, useEffect, useRef, useState} from 'react'
import {shareApi} from '@/services/share'
import {routePaths, usePageRoute, useRouteTransition} from '@/shared/routing'
import type {PublicShareLink} from '@/types/share'
import {SHARE_LANDING_REVEAL_DELAY_MS} from '@/utils/share/share-image-spec'

export type ShareLandingStatus = 'loading' | 'teaser' | 'revealed' | 'error'

export interface ShareLandingViewModel {
  share: PublicShareLink | null
  status: ShareLandingStatus
  errorMessage: string
  retry: () => void
  handleExperience: () => void
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as {code?: unknown}).code)
    if (code === 'SHARE_LINK_EXPIRED') return '分享已过期'
    if (code === 'SHARE_LINK_REVOKED') return '分享已被作者取消'
    if (code === 'SHARE_LINK_INVALID') return '分享内容不存在'
  }

  return '分享内容加载失败，请稍后重试'
}

export function usePageModel(): ShareLandingViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const token = pageRoute.readString('shareToken') || (() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash || ''
    const match = hash.match(/[?&]shareToken=([^&]+)/)
    return match ? decodeURIComponent(match[1]) : null
  })()
  const [share, setShare] = useState<PublicShareLink | null>(null)
  const [status, setStatus] = useState<ShareLandingStatus>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const remainingTimeRef = useRef(SHARE_LANDING_REVEAL_DELAY_MS)
  const revealStartedAtRef = useRef(0)

  const retry = useCallback(() => {
    setShare(null)
    setStatus('loading')
    setErrorMessage('')
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    let active = true
    setStatus('loading')
    setErrorMessage('')

    if (!token) {
      setShare(null)
      setStatus('error')
      setErrorMessage('分享内容不存在')
      return () => {
        active = false
      }
    }

    shareApi.getPublicLink(token)
      .then(result => {
        if (!active) return
        setShare(result)
        setStatus('teaser')
      })
      .catch(error => {
        if (!active) return
        setShare(null)
        setStatus('error')
        setErrorMessage(getErrorMessage(error))
      })

    return () => {
      active = false
    }
  }, [attempt, token])

  useEffect(() => {
    if (status !== 'teaser') return

    const clearRevealTimer = () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current)
        revealTimerRef.current = null
      }
    }
    const scheduleReveal = () => {
      clearRevealTimer()
      revealStartedAtRef.current = Date.now()
      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null
        remainingTimeRef.current = SHARE_LANDING_REVEAL_DELAY_MS
        setStatus('revealed')
      }, remainingTimeRef.current)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (revealTimerRef.current) {
          remainingTimeRef.current = Math.max(
            0,
            remainingTimeRef.current - (Date.now() - revealStartedAtRef.current),
          )
        }
        clearRevealTimer()
        return
      }

      scheduleReveal()
    }

    if (document.visibilityState === 'visible') scheduleReveal()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearRevealTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [status])

  const handleExperience = useCallback(() => {
    void route.navigate(routePaths.create, {
      source: 'share_link',
      shareId: share?.share_id || '',
      shareMode: share?.mode || 'blank',
    })
  }, [route, share])

  return {
    share,
    status,
    errorMessage,
    retry,
    handleExperience,
  }
}
