import {useCallback, useEffect, useMemo, useRef} from 'react'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {useHistoryStore} from '@/store/historyStore'
import {routePaths, usePageRoute, useRouteTransition} from '@/shared/routing'
import {toHistorySummaryCardItem} from '../index/model/homeCardData'

const COMPLETE_AUTO_RETURN_DELAY_MS = 10000

export interface CompletePageViewModel {
  card: HomeCardItem | null
  loading: boolean
  handleContinue: () => void
}

export function usePageModel(): CompletePageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const {historySummaries, loading, loadHistorySummaries} = useHistoryStore()
  const hasNavigatedRef = useRef(false)
  const autoReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyId = pageRoute.readString('historyId')
  const historySummary = useMemo(() => {
    if (historyId) {
      return historySummaries.find(item => item.id === historyId) ?? null
    }

    return historySummaries[0] ?? null
  }, [historySummaries, historyId])
  const card = useMemo(
    () => historySummary ? toHistorySummaryCardItem(historySummary) : null,
    [historySummary],
  )
  const loadingPage = loading.isLoading && !historySummary
  const enteringCardId = historySummary?.id ?? historyId

  useEffect(() => {
    void loadHistorySummaries()
  }, [loadHistorySummaries])

  const clearAutoReturnTimer = useCallback(() => {
    if (autoReturnTimerRef.current == null) {
      return
    }

    clearTimeout(autoReturnTimerRef.current)
    autoReturnTimerRef.current = null
  }, [])

  const handleContinue = useCallback(() => {
    if (hasNavigatedRef.current) {
      return
    }

    clearAutoReturnTimer()
    hasNavigatedRef.current = true
    void route.reset(
      routePaths.home,
      enteringCardId ? {newCardId: enteringCardId} : undefined,
    )
  }, [clearAutoReturnTimer, enteringCardId, route])

  useEffect(() => {
    clearAutoReturnTimer()

    if (loadingPage) {
      return clearAutoReturnTimer
    }

    autoReturnTimerRef.current = setTimeout(
      handleContinue,
      COMPLETE_AUTO_RETURN_DELAY_MS,
    )

    return clearAutoReturnTimer
  }, [clearAutoReturnTimer, handleContinue, loadingPage])

  return {
    card,
    loading: loadingPage,
    handleContinue,
  }
}
