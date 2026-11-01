import {useCallback, useEffect, useMemo, useState} from 'react'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {useHistoryStore} from '@/store/historyStore'
import {usePageRoute, useRouteTransition} from '@/shared/routing'
import {
  consumeShareHandoffEntry,
  runShareReturnTransition,
} from '@/utils/navigation-transition'
import type {ShareContentMode} from '@/types/share'
import {
  toHistoryCardItem,
  toHistorySummaryCardItem,
} from '../index/model/homeCardData'

export interface SharePageViewModel {
  card: HomeCardItem | null
  historyId: string | null
  loading: boolean
  mode: ShareContentMode
  jobAvailable: boolean
  captureOnMount: boolean
  isReturning: boolean
  handleModeChange: (mode: ShareContentMode) => void
  handleBack: () => void
}

export function usePageModel(): SharePageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const routeHistoryId = pageRoute.readString('historyId') || (() => {
    const hash = typeof window === 'undefined' ? '' : window.location.hash || ''
    const match = hash.match(/[?&]historyId=([^&]+)/)
    return match ? decodeURIComponent(match[1]) : null
  })()
  const historySummaries = useHistoryStore(state => state.historySummaries)
  const histories = useHistoryStore(state => state.histories)
  const loading = useHistoryStore(state => state.loading)
  const loadHistory = useHistoryStore(state => state.loadHistory)
  const [isResolvingHistory, setIsResolvingHistory] = useState(Boolean(routeHistoryId))
  const [mode, setMode] = useState<ShareContentMode>('job')
  const [captureOnMount] = useState(() => !consumeShareHandoffEntry())
  const [isReturning, setIsReturning] = useState(false)

  const historySummary = useMemo(() => {
    if (!routeHistoryId) return null
    return historySummaries.find(item => item.id === routeHistoryId) || null
  }, [historySummaries, routeHistoryId])
  const history = useMemo(
    () => routeHistoryId ? histories.find(item => item.id === routeHistoryId) || null : null,
    [histories, routeHistoryId],
  )
  const card = useMemo(
    () => {
      if (historySummary) return toHistorySummaryCardItem(historySummary)
      return history ? toHistoryCardItem(history) : null
    },
    [history, historySummary],
  )
  const loadingPage = (loading.isLoading || isResolvingHistory) && !card
  const jobAvailable = Boolean(
    card
    && card.company
    && card.company !== '--'
    && card.role
    && card.role !== '--',
  )

  useEffect(() => {
    if (!routeHistoryId) {
      setIsResolvingHistory(false)
      return
    }

    if (historySummary || history) {
      setIsResolvingHistory(false)
      return
    }

    setIsResolvingHistory(true)
    void loadHistory(routeHistoryId)
      .catch(() => undefined)
      .finally(() => setIsResolvingHistory(false))
  }, [history, historySummary, loadHistory, routeHistoryId])

  useEffect(() => {
    setMode(jobAvailable ? 'job' : 'blank')
  }, [jobAvailable])

  const handleBack = useCallback(() => {
    if (isReturning) return
    setIsReturning(true)
    void runShareReturnTransition(() => route.back())
  }, [isReturning, route])

  return {
    card,
    historyId: routeHistoryId,
    loading: loadingPage,
    mode,
    jobAvailable,
    captureOnMount,
    isReturning,
    handleModeChange: setMode,
    handleBack,
  }
}
