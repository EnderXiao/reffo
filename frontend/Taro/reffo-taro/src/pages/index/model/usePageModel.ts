import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useDidShow} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {useHistoryStore} from '@/store/historyStore'
import {resumeWorkspaceActions} from '@/store/resumeWorkspaceStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {
  appendRouteParams,
  routePaths,
  scheduleCreateRoutePreload,
  usePageRoute,
  useRouteTransition,
} from '@/shared/routing'
import {toHistorySummaryCardItems, toGenerationTaskCard} from './homeCardData'
import {useBackgroundGenerationStore} from '@/store/backgroundGenerationStore'
import {
  generationTasksApi,
  subscribeGenerationTaskEvents,
} from '@/services/backgroundGeneration'
import {useAuthStore} from '@/store/authStore'
import {isLocalRuntimeEnvironment} from '@/services/runtime-config'
import {feedback} from '@/utils/feedback'
import {suppressNextNavigationTransition} from '@/utils/navigation-transition'
import {
  bootstrapHomeData,
  hasBootstrappedHomeData,
} from '@/utils/home-data-bootstrap'

const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
const NEW_CARD_ID_QUERY_KEY = 'newCardId'

interface ReturningHomeState {
  isReturning: boolean
  cardId: string | null
}

function readReturningHomeState(): ReturningHomeState {
  if (typeof window === 'undefined') {
    return {isReturning: false, cardId: null}
  }

  try {
    const raw = window.sessionStorage?.getItem(RESULT_RETURN_HOME_STORAGE_KEY)

    if (!raw) {
      return {isReturning: false, cardId: null}
    }

    if (raw === '1') {
      return {isReturning: true, cardId: null}
    }

    const parsed = JSON.parse(raw) as {cardId?: unknown}
    const cardId = typeof parsed.cardId === 'string' && parsed.cardId.length > 0
      ? parsed.cardId
      : null

    return {isReturning: true, cardId}
  } catch (error) {
    console.warn('读取首页返回卡片标记失败:', error)
    return {isReturning: false, cardId: null}
  }
}

function removeNewCardIdFromHashUrl() {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return
  }

  const {hash, pathname, search} = window.location
  const [routePath, rawQuery = ''] = hash.split('?')

  if (!rawQuery) {
    return
  }

  const params = new URLSearchParams(rawQuery)

  if (!params.has(NEW_CARD_ID_QUERY_KEY)) {
    return
  }

  params.delete(NEW_CARD_ID_QUERY_KEY)

  const nextQuery = params.toString()
  const nextHash = nextQuery ? `${routePath}?${nextQuery}` : routePath

  window.history.replaceState(window.history.state, document.title, `${pathname}${search}${nextHash}`)
}

export interface IndexPageViewModel {
  cardItems: HomeCardItem[]
  currentCard: HomeCardItem | null
  currentProgress: number
  displayTotal: number
  isLoading: boolean
  isHomeBootReady: boolean
  loadingError: string | null
  hasHistories: boolean
  hasSourceResume: boolean
  sourceResumeTitle: string | null
  isStrategyVisible: boolean
  isCreateMode: boolean
  initialCardIndex: number
  enteringCardId: string | null
  handleEnterCreateMode: () => void
  handleConfirmCreate: () => void
  handleCancelCreate: () => void
  handleViewHistory: () => void
  handleCardPress: (card: HomeCardItem) => Promise<void>
  handleCardChange: (_: HomeCardItem, index: number) => void
  handleDeckFirstInteraction: () => void
  logoSource: string
}

export function usePageModel(logoSource: string): IndexPageViewModel {
  const pageRoute = usePageRoute()
  const route = useRouteTransition()
  const historySummaries = useHistoryStore(state => state.historySummaries)
  const generationTasks = useBackgroundGenerationStore(state => state.tasks)
  const generationError = useBackgroundGenerationStore(state => state.error)
  const refreshTasks = useBackgroundGenerationStore(state => state.refresh)
  const accountId = useAuthStore(state => state.session?.user.id)
  const notifiedTasksRef = useRef(new Set<string>())
  const historyLoading = useHistoryStore(state => state.loading)
  const loadHistorySummaries = useHistoryStore(state => state.loadHistorySummaries)
  const latestSourceResumeSummary = useSourceResumeStore(state => state.latestSourceResumeSummary)
  const sourceResumeLoading = useSourceResumeStore(state => state.loading)
  const loadLatestSourceSummary = useSourceResumeStore(state => state.loadLatestSourceSummary)
  const initialReturningHomeState = useMemo(readReturningHomeState, [])
  const shouldSkipBootCover = initialReturningHomeState.isReturning
    || Boolean(pageRoute.readString(NEW_CARD_ID_QUERY_KEY))
    || Boolean(pageRoute.readString('backgroundTaskId'))
  const [isHomeBootReady, setIsHomeBootReady] = useState(
    () => hasBootstrappedHomeData() || shouldSkipBootCover,
  )
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const [isStrategyVisible, setIsStrategyVisible] = useState(initialReturningHomeState.isReturning)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(
    pageRoute.readString(NEW_CARD_ID_QUERY_KEY) || pageRoute.readString('backgroundTaskId'),
  )
  const [returningCardId, setReturningCardId] = useState<string | null>(initialReturningHomeState.cardId)
  const consumedEntryCardIdRef = useRef<string | null>(null)
  const hasShownHomeRef = useRef(false)
  const hasStartedHomeBootRef = useRef(false)

  useEffect(() => scheduleCreateRoutePreload(), [])

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    let staleTimer: ReturnType<typeof setTimeout> | undefined
    let fallbackEnabled = false
    let streamHealthy = false
    let fallbackDelay = 15000
    const hasActiveTasks = () => useBackgroundGenerationStore.getState().tasks.some(task => (
      task.status === 'queued' || task.status === 'running'
    ))
    const clearFallbackTimer = () => {
      if (fallbackTimer) clearTimeout(fallbackTimer)
      fallbackTimer = undefined
    }
    const scheduleFallback = () => {
      clearFallbackTimer()
      if (!active || !fallbackEnabled) return
      fallbackTimer = setTimeout(async () => {
        if (!active || !fallbackEnabled) return
        if (!streamHealthy && hasActiveTasks() && (typeof document === 'undefined' || document.visibilityState !== 'hidden')) {
          await refreshTasks()
          fallbackDelay = Math.min(fallbackDelay * 2, 60000)
        }
        if (active && fallbackEnabled) scheduleFallback()
      }, fallbackDelay)
    }
    const enterFallback = () => {
      if (!active || streamHealthy) return
      fallbackEnabled = true
      fallbackDelay = 15000
      scheduleFallback()
    }
    const resetStaleWatch = () => {
      if (!active) return
      if (staleTimer) clearTimeout(staleTimer)
      staleTimer = setTimeout(() => {
        streamHealthy = false
        enterFallback()
      }, 45000)
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      void refreshTasks()
      if (!streamHealthy) enterFallback()
    }
    const handleOnline = () => {
      void refreshTasks()
      if (!streamHealthy) enterFallback()
    }
    const connect = async () => {
      const enabled = Boolean(accountId) || await isLocalRuntimeEnvironment()
      if (!active || !enabled) return
      await refreshTasks()
      if (!active) return
      unsubscribe = subscribeGenerationTaskEvents({
        onOpen: () => {
          if (!active) return
          streamHealthy = true
          fallbackEnabled = false
          clearFallbackTimer()
          resetStaleWatch()
          void refreshTasks()
        },
        onActivity: () => {
          if (!active) return
          streamHealthy = true
          resetStaleWatch()
        },
        onTask: task => {
          if (!active) return
          streamHealthy = true
          useBackgroundGenerationStore.getState().upsert(task)
          resetStaleWatch()
        },
        onError: () => {
          if (!active) return
          streamHealthy = false
          enterFallback()
        },
        onClose: () => {
          if (!active) return
          streamHealthy = false
          enterFallback()
        },
      })
      resetStaleWatch()
    }
    void connect()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('online', handleOnline)
    }
    return () => {
      active = false
      unsubscribe?.()
      clearFallbackTimer()
      if (staleTimer) clearTimeout(staleTimer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('online', handleOnline)
      }
    }
  }, [accountId, refreshTasks])

  useEffect(() => {
    const newlyReady = generationTasks.filter(task => task.status === 'completed' && !task.read_at
      && !task.confirmed_at && !notifiedTasksRef.current.has(task.id))
    if (!newlyReady.length) return
    newlyReady.forEach(task => notifiedTasksRef.current.add(task.id))
    feedback.success(newlyReady.length === 1 ? `${newlyReady[0].company}的简历已准备好` : `${newlyReady.length}份新简历已准备好`)
    void loadHistorySummaries({force: true})
  }, [generationTasks, loadHistorySummaries])

  useEffect(() => {
    if (hasStartedHomeBootRef.current) {
      return undefined
    }

    hasStartedHomeBootRef.current = true
    let active = true
    void bootstrapHomeData().finally(() => {
      if (active && !isHomeBootReady) {
        setIsHomeBootReady(true)
      }
    })

    return () => {
      active = false
    }
  }, [isHomeBootReady])

  useEffect(() => {
    if (pageRoute.readString(NEW_CARD_ID_QUERY_KEY)) {
      removeNewCardIdFromHashUrl()
    }
  }, [pageRoute])

  const cardItems = useMemo(() => {
    const historyIds = new Set(historySummaries.map(summary => summary.id))
    const tasks = generationTasks.filter(task => task.status !== 'cancelled')
    const visibleTasks = tasks
      .filter(task => !task.confirmed_at || !historyIds.has(task.history_id || ''))
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
    const taskHistoryIds = new Set(visibleTasks.map(task => task.history_id))
    return [
      ...visibleTasks.map(task => toGenerationTaskCard(task, historySummaries.find(summary => summary.id === task.history_id))),
      ...toHistorySummaryCardItems(historySummaries.filter(summary => !taskHistoryIds.has(summary.id))),
    ]
  }, [historySummaries, generationTasks])

  const hasHistories = cardItems.length > 0
  const shouldShowCreateCard = !hasHistories
  const resolvedCreateMode = isCreateMode || shouldShowCreateCard
  const enteringCardIndex = useMemo(
    () => enteringCardId ? cardItems.findIndex(card => card.id === enteringCardId) : -1,
    [cardItems, enteringCardId],
  )
  const returningCardIndex = useMemo(
    () => returningCardId ? cardItems.findIndex(card => card.id === returningCardId) : -1,
    [cardItems, returningCardId],
  )
  const initialDeckIndex = enteringCardIndex >= 0
    ? enteringCardIndex
    : returningCardIndex >= 0 ? returningCardIndex
    : 0

  useDidShow(() => {
    const nextEnteringCardId = pageRoute.readString(NEW_CARD_ID_QUERY_KEY)
    const returningHomeState = readReturningHomeState()
    const isFirstHomeShow = !hasShownHomeRef.current

    hasShownHomeRef.current = true

    setIsCreateMode(false)
    if (returningHomeState.isReturning) {
      if (returningHomeState.cardId) {
        setReturningCardId(returningHomeState.cardId)
      }
      setIsStrategyVisible(true)
    } else if (nextEnteringCardId && consumedEntryCardIdRef.current !== nextEnteringCardId) {
      consumedEntryCardIdRef.current = nextEnteringCardId
      setEnteringCardId(nextEnteringCardId)
      setIsStrategyVisible(true)
    } else if (isFirstHomeShow) {
      setIsStrategyVisible(false)
    } else {
      setIsStrategyVisible(true)
    }
    if (!returningHomeState.isReturning) {
      loadHistorySummaries({skipIfLoaded: isFirstHomeShow})
      loadLatestSourceSummary({skipIfLoaded: isFirstHomeShow})
    }
  })

  useEffect(() => {
    setActiveCardIndex(initialDeckIndex)
  }, [cardItems.length, initialDeckIndex])

  useEffect(() => {
    if (!enteringCardId) {
      return undefined
    }

    const timer = setTimeout(() => {
      setEnteringCardId(current => current === enteringCardId ? null : current)
    }, 1800)

    return () => clearTimeout(timer)
  }, [enteringCardId])

  useEffect(() => {
    if (isStrategyVisible || resolvedCreateMode) {
      return
    }

    const timer = setTimeout(() => {
      setIsStrategyVisible(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [isStrategyVisible, resolvedCreateMode])

  const handleEnterCreateMode = useCallback(() => {
    setIsCreateMode(true)
  }, [])

  const handleConfirmCreate = useCallback(() => {
    resumeWorkspaceActions.reset()

    void route.navigate(appendRouteParams(routePaths.create, latestSourceResumeSummary ? {step: 'jobDescription'} : undefined))
  }, [latestSourceResumeSummary])

  const handleCancelCreate = useCallback(() => {
    if (!shouldShowCreateCard) {
      setIsCreateMode(false)
    }
  }, [shouldShowCreateCard])

  const handleViewHistory = useCallback(() => {
    void route.navigate(appendRouteParams(routePaths.create, latestSourceResumeSummary ? {step: 'resumeSummary'} : undefined))
  }, [latestSourceResumeSummary])

  const handleCardPress = useCallback((card: HomeCardItem) => {
    if (resolvedCreateMode || card.generationStatus === 'generating') {
      return Promise.resolve()
    }

    if (card.generationStatus === 'failed' && card.generationTaskId) {
      const taskId = card.generationTaskId
      feedback.modal({title: '重新生成这份简历？', content: '将从已保存的生成阶段继续。', confirmText: '重试',
        onConfirm: () => {void generationTasksApi.action(taskId, 'retry')
          .then(task => useBackgroundGenerationStore.getState().upsert(task))
          .catch(error => feedback.error(error instanceof Error ? error.message : '重试失败'))}})
      return Promise.resolve()
    }

    const targetHistoryId = card.historyId || card.id
    if (!historySummaries.some(summary => summary.id === targetHistoryId)) {
      return Promise.resolve()
    }

    suppressNextNavigationTransition()
    return route.navigate(appendRouteParams(routePaths.result, {
      id: targetHistoryId,
      fromCard: 1,
      ...(card.generationTaskId ? {jobId: card.generationTaskId} : {}),
    }))
  }, [historySummaries, resolvedCreateMode, route])

  const handleCardChange = useCallback((_: HomeCardItem, index: number) => {
    setActiveCardIndex(previousIndex =>
      previousIndex === index ? previousIndex : index,
    )
  }, [])

  const handleDeckFirstInteraction = useCallback(() => {
    setIsStrategyVisible(true)
  }, [])

  const displayOrderIds = useMemo(
    () =>
      [...cardItems.slice(initialDeckIndex), ...cardItems.slice(0, initialDeckIndex)].map(
        item => item.id,
      ),
    [cardItems, initialDeckIndex],
  )

  const currentProgress = useMemo(() => {
    if (cardItems.length === 0) {
      return 0
    }

    const activeId = cardItems[activeCardIndex]?.id
    const orderIndex = activeId ? displayOrderIds.indexOf(activeId) : -1
    return orderIndex >= 0 ? orderIndex + 1 : 1
  }, [activeCardIndex, cardItems, displayOrderIds])

  return {
    cardItems,
    currentCard: cardItems[activeCardIndex] ?? null,
    currentProgress,
    displayTotal: cardItems.length,
    isLoading: historyLoading.isLoading || sourceResumeLoading.isLoading,
    isHomeBootReady,
    loadingError: historyLoading.error || sourceResumeLoading.error || generationError,
    hasHistories,
    hasSourceResume: Boolean(latestSourceResumeSummary),
    sourceResumeTitle: latestSourceResumeSummary?.title ?? null,
    isStrategyVisible,
    isCreateMode: resolvedCreateMode,
    initialCardIndex: initialDeckIndex,
    enteringCardId,
    handleEnterCreateMode,
    handleConfirmCreate,
    handleCancelCreate,
    handleViewHistory,
    handleCardPress,
    handleCardChange,
    handleDeckFirstInteraction,
    logoSource,
  }
}
