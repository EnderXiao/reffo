import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useDidHide, useDidShow} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {useHistoryStore} from '@/store/historyStore'
import {routePaths, usePageRoute, useRouteTransition} from '@/shared/routing'
import {
  consumeCompleteInitialEntry,
  consumeShareReturnEntry,
  runShareHandoffTransition,
} from '@/utils/navigation-transition'
import {toHistorySummaryCardItem} from '../index/model/homeCardData'
import {toResumeHistorySummaryFromHistory} from '@/utils/history-summary'

const COMPLETE_AUTO_RETURN_DELAY_MS = 10000
const COMPLETE_ENTRY_ANIMATION_DURATION_MS = 1500
const SHARE_EXIT_DURATION_MS = 720

export interface CompletePageViewModel {
  card: HomeCardItem | null
  historyId: string | null
  loading: boolean
  error: string | null
  hasInitialEntryAnimation: boolean
  isShareReturnEntry: boolean
  isSharingTransition: boolean
  handleShare: () => void
  handleContinue: () => void
  handleRetry: () => void
}

export function usePageModel(): CompletePageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const historyId = pageRoute.readString('historyId')
  const historySummaries = useHistoryStore(state => state.historySummaries)
  const historyDetail = useHistoryStore(state => historyId
    ? state.histories.find(item => item.id === historyId)
      ?? (state.currentHistory?.id === historyId ? state.currentHistory : null)
    : state.histories[0] ?? state.currentHistory)
  const loading = useHistoryStore(state => state.loading)
  const loadHistory = useHistoryStore(state => state.loadHistory)
  const loadHistorySummaries = useHistoryStore(state => state.loadHistorySummaries)
  const hasNavigatedRef = useRef(false)
  const autoReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isResolvingHistory, setIsResolvingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retryAttempt, setRetryAttempt] = useState(0)
  const [isSharingTransition, setIsSharingTransition] = useState(false)
  const [entryMode, setEntryMode] = useState<'initial' | 'share-return' | 'steady'>(() => {
    const isCompleteInitialEntry = consumeCompleteInitialEntry()
    const isShareReturnEntry = consumeShareReturnEntry()
    if (isShareReturnEntry) return 'share-return'
    return isCompleteInitialEntry ? 'initial' : 'steady'
  })
  const hasInitialEntryAnimation = entryMode === 'initial'
  const isShareReturnEntry = entryMode === 'share-return'
  const historySummary = useMemo(() => {
    if (historyId) {
      return historySummaries.find(item => item.id === historyId)
        ?? (historyDetail ? toResumeHistorySummaryFromHistory(historyDetail) : null)
    }

    return historySummaries[0]
      ?? (historyDetail ? toResumeHistorySummaryFromHistory(historyDetail) : null)
  }, [historySummaries, historyId, historyDetail])
  const card = useMemo(
    () => historySummary ? toHistorySummaryCardItem(historySummary) : null,
    [historySummary],
  )
  const loadingPage = (loading.isLoading || isResolvingHistory) && !historySummary
  const enteringCardId = historySummary?.id ?? historyId

  useEffect(() => {
    if (historySummary) {
      setIsResolvingHistory(false)
      setError(null)
      return
    }

    let active = true
    setIsResolvingHistory(true)
    setError(null)
    void (async () => {
      try {
        if (historyId) {
          const history = await loadHistory(historyId)
          if (active && !history) setError('暂时找不到这份简历，请重试或返回首页查看。')
        } else {
          await loadHistorySummaries()
          if (active && !useHistoryStore.getState().historySummaries.length) {
            setError('暂时没有可展示的简历，请重试或返回首页查看。')
          }
        }
      } catch {
        if (active) setError('简历卡加载失败，请重试或返回首页查看。')
      } finally {
        if (active) setIsResolvingHistory(false)
      }
    })()
    return () => { active = false }
  }, [historyId, historySummary, loadHistory, loadHistorySummaries, retryAttempt])

  const handleRetry = useCallback(() => setRetryAttempt(attempt => attempt + 1), [])

  const clearAutoReturnTimer = useCallback(() => {
    if (autoReturnTimerRef.current == null) {
      return
    }

    clearTimeout(autoReturnTimerRef.current)
    autoReturnTimerRef.current = null
  }, [])

  useEffect(() => {
    if (!hasInitialEntryAnimation) return

    const timer = setTimeout(
      () => setEntryMode('steady'),
      COMPLETE_ENTRY_ANIMATION_DURATION_MS,
    )
    return () => clearTimeout(timer)
  }, [entryMode])

  const resetTransitionState = useCallback(() => {
    clearAutoReturnTimer()
    hasNavigatedRef.current = false
    setEntryMode('steady')
    setIsSharingTransition(false)
  }, [clearAutoReturnTimer])

  useDidHide(resetTransitionState)
  useDidShow(() => {
    if (consumeShareReturnEntry()) {
      setEntryMode('share-return')
    }
  })

  const handleShare = useCallback(() => {
    if (!historySummary?.id || hasNavigatedRef.current) {
      return
    }

    clearAutoReturnTimer()
    hasNavigatedRef.current = true
    setIsSharingTransition(true)
    setTimeout(() => {
      void runShareHandoffTransition(
        () => route.navigate(routePaths.share, {historyId: historySummary.id}),
      ).finally(resetTransitionState)
    }, SHARE_EXIT_DURATION_MS)
  }, [clearAutoReturnTimer, historySummary?.id, resetTransitionState, route])

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

    if (!card || loadingPage || isSharingTransition) {
      return clearAutoReturnTimer
    }

    autoReturnTimerRef.current = setTimeout(
      handleContinue,
      COMPLETE_AUTO_RETURN_DELAY_MS,
    )

    return clearAutoReturnTimer
  }, [card, clearAutoReturnTimer, handleContinue, isSharingTransition, loadingPage])

  return {
    card,
    historyId: historySummary?.id || historyId || null,
    loading: loadingPage,
    error,
    hasInitialEntryAnimation,
    isShareReturnEntry,
    isSharingTransition,
    handleShare,
    handleContinue,
    handleRetry,
  }
}
