import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useDidShow, useRouter} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {useHistoryStore} from '@/store/historyStore'
import {resumeWorkspaceActions} from '@/store/resumeWorkspaceStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {appendRouteParams, routePaths, useRouteTransition} from '@/shared/routing'
import {toHistoryCardItems} from './homeCardData'

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
  handleCardPress: (card: HomeCardItem) => void
  handleCardChange: (_: HomeCardItem, index: number) => void
  handleDeckFirstInteraction: () => void
  logoSource: string
}

export function usePageModel(logoSource: string): IndexPageViewModel {
  const router = useRouter()
  const route = useRouteTransition()
  const {histories, loading, loadHistories} = useHistoryStore()
  const {
    latestSourceResume,
    loading: sourceResumeLoading,
    loadLatestSourceResume,
  } = useSourceResumeStore()
  const initialReturningHomeState = useMemo(readReturningHomeState, [])
  const [activeCardIndex, setActiveCardIndex] = useState(0)
  const [isStrategyVisible, setIsStrategyVisible] = useState(initialReturningHomeState.isReturning)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(
    typeof router.params[NEW_CARD_ID_QUERY_KEY] === 'string' ? router.params[NEW_CARD_ID_QUERY_KEY] : null,
  )
  const [returningCardId, setReturningCardId] = useState<string | null>(initialReturningHomeState.cardId)
  const consumedEntryCardIdRef = useRef<string | null>(null)
  const hasShownHomeRef = useRef(false)

  useEffect(() => {
    if (initialReturningHomeState.isReturning) {
      return
    }

    loadHistories({skipIfLoaded: true})
    loadLatestSourceResume({skipIfLoaded: true})
  }, [initialReturningHomeState.isReturning, loadHistories, loadLatestSourceResume])

  useEffect(() => {
    if (typeof router.params[NEW_CARD_ID_QUERY_KEY] === 'string') {
      removeNewCardIdFromHashUrl()
    }
  }, [router.params])

  const cardItems = useMemo(() => {
    return histories.length > 0 ? toHistoryCardItems(histories) : []
  }, [histories])

  const hasHistories = histories.length > 0
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
    const nextEnteringCardId = typeof router.params[NEW_CARD_ID_QUERY_KEY] === 'string'
      ? router.params[NEW_CARD_ID_QUERY_KEY]
      : null
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
      loadHistories({skipIfLoaded: isFirstHomeShow})
      loadLatestSourceResume({skipIfLoaded: isFirstHomeShow})
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

    void route.navigate(appendRouteParams(routePaths.create, latestSourceResume ? {step: 'jobDescription'} : undefined))
  }, [latestSourceResume])

  const handleCancelCreate = useCallback(() => {
    if (!shouldShowCreateCard) {
      setIsCreateMode(false)
    }
  }, [shouldShowCreateCard])

  const handleViewHistory = useCallback(() => {
    void route.navigate(appendRouteParams(routePaths.create, latestSourceResume ? {step: 'resumeSummary'} : undefined))
  }, [latestSourceResume])

  const handleCardPress = useCallback((card: HomeCardItem) => {
    if (resolvedCreateMode) {
      return
    }

    const targetHistory = histories.find(history => history.id === card.id)
    if (!targetHistory) {
      return
    }

    void route.navigate(appendRouteParams(routePaths.result, {
      id: targetHistory.id,
      fromCard: 1,
    }))
  }, [histories, resolvedCreateMode])

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
    isLoading: loading.isLoading || sourceResumeLoading.isLoading,
    loadingError: loading.error || sourceResumeLoading.error,
    hasHistories,
    hasSourceResume: Boolean(latestSourceResume),
    sourceResumeTitle: latestSourceResume?.title ?? null,
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
