import {useCallback, useEffect, useMemo, useRef} from 'react'
import {useRouter} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {useHistoryStore} from '@/store/historyStore'
import type {ResumeHistory} from '@/types'
import {routePaths, useRouteTransition} from '@/shared/routing'
import {toHistoryCardItem} from '../index/model/homeCardData'

const COMPLETE_AUTO_RETURN_DELAY_MS = 10000

export interface CompletePageViewModel {
  history: ResumeHistory | null
  card: HomeCardItem | null
  loading: boolean
  handleContinue: () => void
}

export function usePageModel(): CompletePageViewModel {
  const router = useRouter()
  const route = useRouteTransition()
  const {histories, loading, loadHistories} = useHistoryStore()
  const hasNavigatedRef = useRef(false)
  const autoReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyId = typeof router.params.historyId === 'string'
    ? router.params.historyId
    : null
  const history = useMemo(() => {
    if (historyId) {
      return histories.find(item => item.id === historyId) ?? null
    }

    return histories[0] ?? null
  }, [histories, historyId])
  const card = useMemo(
    () => history ? toHistoryCardItem(history) : null,
    [history],
  )
  const loadingPage = loading.isLoading && !history
  const enteringCardId = history?.id ?? historyId

  useEffect(() => {
    void loadHistories()
  }, [loadHistories])

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
    history,
    card,
    loading: loadingPage,
    handleContinue,
  }
}
