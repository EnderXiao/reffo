import {Image, Text, View} from '@tarojs/components'
import HomeCardDeck from '@/components/business/HomeCardDeck'
import classNames from 'classnames'
import {useEffect, useMemo, useRef, useState} from 'react'
import {useDidShow} from '@tarojs/taro'
import type {IndexPageViewModel} from './model/usePageModel'
import {HOME_PAGE_CONTENT} from './constants/content'
import githubIcon from '@/assets/home/github.svg'
import './index.h5.scss'

type HeroMode = 'brand' | 'strategy' | 'create'
const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
const RESULT_RETURN_HOME_DOM_KEY = 'reffoReturnHomePending'
const HOME_RETURN_FADE_MS = 460

function hasReturnHomeMarker() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const raw = window.sessionStorage?.getItem(RESULT_RETURN_HOME_STORAGE_KEY)

    return Boolean(raw)
  } catch (error) {
    console.warn('读取首页返回过渡标记失败:', error)
    return false
  }
}

function clearReturnHomeMarker() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.removeItem(RESULT_RETURN_HOME_STORAGE_KEY)
    delete document.documentElement.dataset[RESULT_RETURN_HOME_DOM_KEY]
  } catch (error) {
    console.warn('清理首页返回过渡标记失败:', error)
  }
}

function resolveHeroMode(isCreateMode: boolean, isStrategyVisible: boolean): HeroMode {
  if (isCreateMode) {
    return 'create'
  }

  return isStrategyVisible ? 'strategy' : 'brand'
}

function HomeHeroH5({
  currentCard,
  isCreateMode,
  isStrategyVisible,
  immediateStrategy,
  logoSource,
}: {
  currentCard: IndexPageViewModel['currentCard']
  isCreateMode: boolean
  isStrategyVisible: boolean
  immediateStrategy?: boolean
  logoSource: string
}) {
  const [renderMode, setRenderMode] = useState<HeroMode>(() => resolveHeroMode(isCreateMode, isStrategyVisible))
  const [renderStrategyBody, setRenderStrategyBody] = useState(currentCard?.strategyBody || '')
  const [isSwitching, setIsSwitching] = useState(false)
  const switchTimerRef = useRef<number | null>(null)
  const nextMode = resolveHeroMode(isCreateMode, isStrategyVisible)
  const nextStrategyBody = currentCard?.strategyBody || ''
  const strategyParagraphs = useMemo(
    () =>
      renderStrategyBody
        .split(/\n+/)
        .map(paragraph => paragraph.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 2),
    [renderStrategyBody],
  )

  useEffect(() => {
    const shouldUpdate =
      renderMode !== nextMode ||
      (nextMode === 'strategy' && renderStrategyBody !== nextStrategyBody)

    if (!shouldUpdate) {
      setIsSwitching(false)
      return undefined
    }

    if (immediateStrategy && nextMode === 'strategy') {
      if (switchTimerRef.current != null) {
        window.clearTimeout(switchTimerRef.current)
        switchTimerRef.current = null
      }
      setRenderMode(nextMode)
      setRenderStrategyBody(nextStrategyBody)
      setIsSwitching(false)
      return undefined
    }

    setIsSwitching(true)

    if (switchTimerRef.current != null) {
      window.clearTimeout(switchTimerRef.current)
    }

    switchTimerRef.current = window.setTimeout(() => {
      setRenderMode(nextMode)
      setRenderStrategyBody(nextStrategyBody)
      setIsSwitching(false)
      switchTimerRef.current = null
    }, 160)

    return () => {
      if (switchTimerRef.current != null) {
        window.clearTimeout(switchTimerRef.current)
        switchTimerRef.current = null
      }
    }
  }, [immediateStrategy, nextMode, nextStrategyBody, renderMode, renderStrategyBody])

  return (
    <View className='reffo-home__hero'>
      <View
        className={classNames('reffo-home__hero-stage', {
          'reffo-home__hero-stage--switching': isSwitching,
        })}
      >
        {renderMode === 'brand' ? (
          <View className='reffo-home__hero-brand'>
            <Image src={logoSource} className='reffo-home__logo' mode='aspectFit' />
            <Text className='reffo-home__title'>
              {HOME_PAGE_CONTENT.hero.titlePrefix}
              <Text className='reffo-home__title-accent'>{HOME_PAGE_CONTENT.hero.titleAccentOne}</Text>
              {HOME_PAGE_CONTENT.hero.titleMiddle}
              {HOME_PAGE_CONTENT.hero.titleSuffixPrefix}
              <Text className='reffo-home__title-accent'>{HOME_PAGE_CONTENT.hero.titleAccentTwo}</Text>
            </Text>
          </View>
        ) : renderMode === 'create' ? (
          <View className='reffo-home__hero-create'>
            <Text className='reffo-home__hero-create-title'>
              {HOME_PAGE_CONTENT.hero.createTitlePrefix}
              <Text className='reffo-home__title-accent'>{HOME_PAGE_CONTENT.hero.createTitleAccent}</Text>
            </Text>
            <Text className='reffo-home__hero-label'>{HOME_PAGE_CONTENT.hero.createGuideLabel}</Text>
            <Text className='reffo-home__hero-create-body'>{HOME_PAGE_CONTENT.hero.createGuideBody}</Text>
          </View>
        ) : (
          <View className='reffo-home__hero-strategy'>
            <Text className='reffo-home__hero-label'>{HOME_PAGE_CONTENT.hero.strategyLabel}</Text>
            <View className='reffo-home__hero-strategy-body'>
              {strategyParagraphs.map((paragraph, index) => (
                <Text
                  key={`${index}-${paragraph}`}
                  className={classNames('reffo-home__hero-strategy-text', {
                    'reffo-home__hero-strategy-text--paragraph': index < strategyParagraphs.length - 1,
                  })}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  )
}

export default function PageView({
  cardItems,
  currentCard,
  currentProgress,
  displayTotal,
  hasHistories,
  hasSourceResume,
  sourceResumeTitle,
  isStrategyVisible,
  isCreateMode,
  initialCardIndex,
  enteringCardId,
  handleEnterCreateMode,
  handleConfirmCreate,
  handleCancelCreate,
  handleViewHistory,
  handleCardPress,
  handleCardChange,
  handleDeckFirstInteraction,
  logoSource,
}: IndexPageViewModel) {
  const sourceLabel = hasSourceResume && sourceResumeTitle ? sourceResumeTitle : '源简历'
  const [isReturningFromResult, setIsReturningFromResult] = useState(false)
  const returnFadeTimerRef = useRef<number | null>(null)
  const returnFadeFrameRef = useRef<number | null>(null)
  const isReturnHomeTransition = isReturningFromResult

  useDidShow(() => {
    if (typeof window === 'undefined') {
      return
    }

    const shouldAnimate = hasReturnHomeMarker()

    if (!shouldAnimate) {
      return
    }

    setIsReturningFromResult(false)
    if (returnFadeFrameRef.current != null) {
      window.cancelAnimationFrame(returnFadeFrameRef.current)
    }
    returnFadeFrameRef.current = window.requestAnimationFrame(() => {
      returnFadeFrameRef.current = null
      setIsReturningFromResult(true)
    })
    if (returnFadeTimerRef.current != null) {
      window.clearTimeout(returnFadeTimerRef.current)
    }
    returnFadeTimerRef.current = window.setTimeout(() => {
      returnFadeTimerRef.current = null
      clearReturnHomeMarker()
      setIsReturningFromResult(false)
    }, HOME_RETURN_FADE_MS)
  })

  useEffect(() => () => {
    if (returnFadeFrameRef.current != null) {
      window.cancelAnimationFrame(returnFadeFrameRef.current)
      returnFadeFrameRef.current = null
    }
    if (returnFadeTimerRef.current != null) {
      window.clearTimeout(returnFadeTimerRef.current)
      clearReturnHomeMarker()
    }
  }, [])

  return (
    <View
      className={classNames('reffo-home', {
        'reffo-home--returning-from-result': isReturnHomeTransition,
      })}
    >
      <View className='reffo-home__backdrop' />
      <View className='reffo-home__frame'>
        <View className='reffo-home__header'>
          <View
            className={classNames('reffo-home__source-button', {
              'reffo-home__source-button--active': hasSourceResume,
            })}
            onClick={handleViewHistory}
          >
            {!hasSourceResume ? <Text className='reffo-home__source-plus'>+</Text> : null}
            <Text className='reffo-home__source-text'>{sourceLabel}</Text>
          </View>
          <View className='reffo-home__github-button'>
            <Image src={githubIcon} className='reffo-home__github-icon' mode='aspectFit' />
          </View>
        </View>

        <HomeHeroH5
          currentCard={currentCard}
          isCreateMode={isCreateMode}
          isStrategyVisible={isStrategyVisible}
          immediateStrategy={isReturnHomeTransition}
          logoSource={logoSource}
        />

        <View
          className={classNames('reffo-home__progress', {
            'reffo-home__progress--hidden': isCreateMode,
          })}
        >
          当前简历 {currentProgress}/{displayTotal} 项
        </View>

        <HomeCardDeck
          cards={cardItems}
          initialIndex={initialCardIndex}
          enteringCardId={enteringCardId}
          isCreateMode={isCreateMode}
          onCreateCardPress={handleConfirmCreate}
          onCardPress={hasHistories ? handleCardPress : undefined}
          onCardChange={handleCardChange}
          onFirstInteraction={handleDeckFirstInteraction}
        />

        <View className='reffo-home__footer'>
          {!isCreateMode ? (
            <View
              key='primary-action'
              className='reffo-home__primary-action'
              onClick={handleEnterCreateMode}
            >
              <Text className='reffo-home__primary-plus'>+</Text>
              <Text className='reffo-home__primary-text'>创建 Reffo 简历</Text>
            </View>
          ) : (
            <View key='inline-actions' className='reffo-home__inline-actions'>
              <View className='reffo-home__inline-action' onClick={handleConfirmCreate}>
                <Text className='reffo-home__inline-icon'>↗</Text>
                <Text>点击以开始</Text>
              </View>
              <View className='reffo-home__inline-action reffo-home__inline-action--cancel' onClick={handleCancelCreate}>
                <Text className='reffo-home__inline-icon'>×</Text>
                <Text>取消</Text>
              </View>
            </View>
          )}
          <Text className='reffo-home__disclaimer'>*内容由人工智能生成，请仔细检查</Text>
        </View>
      </View>
    </View>
  )
}
