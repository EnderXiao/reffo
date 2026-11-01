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

const COMPLETE_AUTO_RETURN_DELAY_MS = 10000
const COMPLETE_ENTRY_ANIMATION_DURATION_MS = 1500
const SHARE_EXIT_DURATION_MS = 720

export interface CompletePageViewModel {
  card: HomeCardItem | null
  historyId: string | null
  loading: boolean
  hasInitialEntryAnimation: boolean
  isShareReturnEntry: boolean
  isSharingTransition: boolean
  handleShare: () => void
  handleContinue: () => void
}

export function usePageModel(): CompletePageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const historySummaries = useHistoryStore(state => state.historySummaries)
  const loading = useHistoryStore(state => state.loading)
  const loadHistory = useHistoryStore(state => state.loadHistory)
  const loadHistorySummaries = useHistoryStore(state => state.loadHistorySummaries)
  const hasNavigatedRef = useRef(false)
  const autoReturnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const historyId = pageRoute.readString('historyId')
  const [isResolvingHistory, setIsResolvingHistory] = useState(Boolean(historyId))
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
      return historySummaries.find(item => item.id === historyId) ?? null
    }

    return historySummaries[0] ?? null
  }, [historySummaries, historyId])
  const card = useMemo(
    () => historySummary ? toHistorySummaryCardItem(historySummary) : null,
    [historySummary],
  )
  const loadingPage = (loading.isLoading || isResolvingHistory) && !historySummary
  const enteringCardId = historySummary?.id ?? historyId

  useEffect(() => {
    if (!historyId) {
      void loadHistorySummaries()
      return
    }

    if (historySummary) {
      setIsResolvingHistory(false)
      return
    }

    setIsResolvingHistory(true)
    void loadHistory(historyId).finally(() => setIsResolvingHistory(false))
  }, [historyId, historySummary, loadHistory, loadHistorySummaries])

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

    if (loadingPage || isSharingTransition) {
      return clearAutoReturnTimer
    }

    autoReturnTimerRef.current = setTimeout(
      handleContinue,
      COMPLETE_AUTO_RETURN_DELAY_MS,
    )

    return clearAutoReturnTimer
  }, [clearAutoReturnTimer, handleContinue, isSharingTransition, loadingPage])

  return {
    card,
    historyId: historySummary?.id || historyId || null,
    loading: loadingPage,
    hasInitialEntryAnimation,
    isShareReturnEntry,
    isSharingTransition,
    handleShare,
    handleContinue,
  }
}
