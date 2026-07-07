import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useDidShow, useRouter} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {feedback} from '@/utils/feedback'
import {navigation} from '@/utils/navigation'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {DEMO_CARDS, toHistoryCardItems} from './homeCardData'

const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'

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
  const {histories, loading, loadHistories} = useHistoryStore()
  const {
    latestSourceResume,
    loading: sourceResumeLoading,
    loadLatestSourceResume,
  } = useSourceResumeStore()
  const initialReturningHomeState = useMemo(readReturningHomeState, [])
  const [activeCardIndex, setActiveCardIndex] = useState(DEMO_CARDS.length - 1)
  const [isStrategyVisible, setIsStrategyVisible] = useState(initialReturningHomeState.isReturning)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [enteringCardId, setEnteringCardId] = useState<string | null>(
    typeof router.params.newCardId === 'string' ? router.params.newCardId : null,
  )
  const [returningCardId, setReturningCardId] = useState<string | null>(initialReturningHomeState.cardId)
  const consumedEntryCardIdRef = useRef<string | null>(null)
  const hasShownHomeRef = useRef(false)

  useEffect(() => {
    if (initialReturningHomeState.isReturning) {
      return
    }

    loadHistories()
    loadLatestSourceResume()
  }, [initialReturningHomeState.isReturning, loadHistories, loadLatestSourceResume])

  const cardItems = useMemo(() => {
    if (histories.length > 0) {
      return toHistoryCardItems(histories)
    }

    return DEMO_CARDS
  }, [histories])

  const hasHistories = histories.length > 0
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
    : hasHistories ? 0 : Math.max(0, cardItems.length - 1)

  useDidShow(() => {
    const nextEnteringCardId = typeof router.params.newCardId === 'string'
      ? router.params.newCardId
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
      loadHistories()
      loadLatestSourceResume()
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
    if (isStrategyVisible || isCreateMode) {
      return
    }

    const timer = setTimeout(() => {
      setIsStrategyVisible(true)
    }, 2000)

    return () => clearTimeout(timer)
  }, [isCreateMode, isStrategyVisible])

  const handleEnterCreateMode = useCallback(() => {
    setIsCreateMode(true)
  }, [])

  const handleConfirmCreate = useCallback(() => {
    void navigation.navigateTo(
      latestSourceResume
        ? '/pages/create/index?step=jobDescription'
        : '/pages/create/index',
    )
  }, [latestSourceResume])

  const handleCancelCreate = useCallback(() => {
    setIsCreateMode(false)
  }, [])

  const handleViewHistory = useCallback(() => {
    if (latestSourceResume) {
      void navigation.navigateTo('/pages/create/index?step=resumeSummary')
      return
    }

    feedback.message(HOME_PAGE_CONTENT.header.sourceResumeEmptyToast)
  }, [latestSourceResume])

  const handleCardPress = useCallback((card: HomeCardItem) => {
    if (isCreateMode) {
      return
    }

    const targetHistory = histories.find(history => history.id === card.id)
    if (!targetHistory) {
      return
    }

    void navigation.navigateTo(
      `/pages/result/index?id=${encodeURIComponent(targetHistory.id)}&fromCard=1`,
    )
  }, [histories, isCreateMode])

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
    isCreateMode,
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
