import {useCallback, useEffect, useMemo, useState} from 'react'
import Taro, {useDidShow} from '@tarojs/taro'
import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {isH5} from '@/utils'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {DEMO_CARDS, toHistoryCardItems} from './homeCardData'

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
  handleEnterCreateMode: () => void
  handleConfirmCreate: () => void
  handleCancelCreate: () => void
  handleViewHistory: () => void
  handleCardChange: (_: HomeCardItem, index: number) => void
  handleDeckFirstInteraction: () => void
  logoSource: string
}

export function usePageModel(logoSource: string): IndexPageViewModel {
  const {histories, loading, loadHistories} = useHistoryStore()
  const {
    latestSourceResume,
    loading: sourceResumeLoading,
    loadLatestSourceResume,
  } = useSourceResumeStore()
  const [activeCardIndex, setActiveCardIndex] = useState(DEMO_CARDS.length - 1)
  const [isStrategyVisible, setIsStrategyVisible] = useState(false)
  const [isCreateMode, setIsCreateMode] = useState(false)

  useEffect(() => {
    loadHistories()
    loadLatestSourceResume()
  }, [loadHistories, loadLatestSourceResume])

  const cardItems = useMemo(() => {
    if (histories.length > 0) {
      return toHistoryCardItems(histories)
    }

    return DEMO_CARDS
  }, [histories])

  const hasHistories = histories.length > 0
  const initialDeckIndex = hasHistories ? 0 : Math.max(0, cardItems.length - 1)

  useDidShow(() => {
    setIsStrategyVisible(false)
    setIsCreateMode(false)
    loadHistories()
    loadLatestSourceResume()
  })

  useEffect(() => {
    setActiveCardIndex(initialDeckIndex)
  }, [cardItems.length, initialDeckIndex])

  useEffect(() => {
    if (isStrategyVisible || isCreateMode) {
      return
    }

    if (isH5()) {
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
    Taro.navigateTo({
      url: latestSourceResume
        ? '/pages/create/index?step=jobDescription'
        : '/pages/create/index',
    })
  }, [latestSourceResume])

  const handleCancelCreate = useCallback(() => {
    setIsCreateMode(false)
  }, [])

  const handleViewHistory = useCallback(() => {
    if (latestSourceResume) {
      Taro.navigateTo({url: '/pages/create/index?step=resumeSummary'})
      return
    }

    Taro.showToast({
      title: HOME_PAGE_CONTENT.header.sourceResumeEmptyToast,
      icon: 'none',
    })
  }, [latestSourceResume])

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
    handleEnterCreateMode,
    handleConfirmCreate,
    handleCancelCreate,
    handleViewHistory,
    handleCardChange,
    handleDeckFirstInteraction,
    logoSource,
  }
}
