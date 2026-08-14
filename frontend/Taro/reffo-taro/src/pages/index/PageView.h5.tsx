import {Image, Text, View} from '@tarojs/components'
import HomeCardDeck from '@/components/business/HomeCardDeck'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import classNames from 'classnames'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {useDidShow} from '@tarojs/taro'
import {useVisualTier} from '@/utils'
import {
  clearSharedElementSnapshot,
  readSharedElementSnapshot,
  scaleSharedElementSnapshot,
  type SharedElementSnapshot,
} from '@/utils/shared-element-transition'
import type {IndexPageViewModel} from './model/usePageModel'
import {HOME_PAGE_CONTENT} from './constants/content'
import githubIcon from '@/assets/home/github.svg'
import './index.h5.scss'

type HeroMode = 'brand' | 'strategy' | 'create'
const RESULT_RETURN_HOME_STORAGE_KEY = 'reffo.resultReturnHome'
const RESULT_RETURN_HOME_DOM_KEY = 'reffoReturnHomePending'
const CARD_OPEN_RECT_STORAGE_KEY = 'reffo.homeCardOpenRect'
const LANDING_TO_HOME_STORAGE_KEY = 'reffo.landingToHome'
const HOME_RETURN_FLIP_MS = 1080
const HOME_LANDING_ENTRY_MS = HOME_RETURN_FLIP_MS
const HOME_CARD_DESIGN_WIDTH = 210

interface ReturningHomePayload {
  cardId: string | null
  transition?: 'view-transition' | null
}

interface CardOpenRectSnapshot extends SharedElementSnapshot {
  cardId?: string
}

type LandingLogoSnapshot = SharedElementSnapshot

function readLandingToHomeSnapshot(): LandingLogoSnapshot | null {
  return readSharedElementSnapshot<LandingLogoSnapshot>(LANDING_TO_HOME_STORAGE_KEY, '封面到首页 logo')
}

function clearLandingToHomeSnapshot() {
  clearSharedElementSnapshot(LANDING_TO_HOME_STORAGE_KEY, '封面到首页 logo')
}

function resolveLandingLogoTransitionStyle(snapshot: LandingLogoSnapshot | null): CSSProperties | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const targetLogo = document.querySelector('.reffo-home__logo-anchor')
  const targetRect = targetLogo?.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 393
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 852
  const pagePadX = Math.min(Math.max(viewportWidth * 0.076, 24), 31)
  const targetWidth = targetRect && targetRect.width > 0 ? targetRect.width : 99
  const targetLeft = targetRect && targetRect.width > 0 ? targetRect.left : pagePadX
  const targetTop = targetRect && targetRect.height > 0 ? targetRect.top : 89
  const startSnapshot = scaleSharedElementSnapshot(snapshot, {
    left: (viewportWidth - 160) / 2,
    top: (viewportHeight - 42) / 2,
    width: 160,
    height: 42,
  })

  return {
    '--reffo-landing-logo-start-x': `${startSnapshot.left}px`,
    '--reffo-landing-logo-start-y': `${startSnapshot.top}px`,
    '--reffo-landing-logo-start-width': `${startSnapshot.width}px`,
    '--reffo-landing-logo-start-height': `${startSnapshot.height}px`,
    '--reffo-landing-logo-target-x': `${targetLeft}px`,
    '--reffo-landing-logo-target-y': `${targetTop}px`,
    '--reffo-landing-logo-target-scale': String(targetWidth / startSnapshot.width),
  } as CSSProperties
}

function readReturnHomeMarker(): ReturningHomePayload | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const raw = window.sessionStorage?.getItem(RESULT_RETURN_HOME_STORAGE_KEY)

    if (!raw) {
      return null
    }

    if (raw === '1') {
      return {cardId: null}
    }

    const parsed = JSON.parse(raw) as {cardId?: unknown; transition?: unknown}
    return {
      cardId: typeof parsed.cardId === 'string' && parsed.cardId.length > 0
        ? parsed.cardId
        : null,
      transition: parsed.transition === 'view-transition' ? 'view-transition' : null,
    }
  } catch (error) {
    console.warn('读取首页返回过渡标记失败:', error)
    return null
  }
}

function readCardOpenRect(): CardOpenRectSnapshot | null {
  return readSharedElementSnapshot<CardOpenRectSnapshot>(CARD_OPEN_RECT_STORAGE_KEY, '卡片')
}

function resolveReturnCardStyle(snapshot: CardOpenRectSnapshot | null): CSSProperties {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {}
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 393
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 852
  const fallbackWidth = Math.min(viewportWidth * 0.55, 218)
  const targetSnapshot = scaleSharedElementSnapshot(snapshot, {
    left: (viewportWidth - fallbackWidth) / 2,
    top: Math.max(96, (viewportHeight - fallbackWidth * 1.546) / 2),
    width: fallbackWidth,
    height: fallbackWidth * 1.546,
  })
  const targetCenterX = targetSnapshot.left + targetSnapshot.width / 2
  const targetCenterY = targetSnapshot.top + targetSnapshot.height / 2
  const startScale = Math.max(
    viewportWidth / Math.max(targetSnapshot.width, 1),
    viewportHeight / Math.max(targetSnapshot.height, 1),
  ) * 1.08

  return {
    '--reffo-home-return-start-x': `${viewportWidth / 2 - targetCenterX}px`,
    '--reffo-home-return-start-y': `${viewportHeight / 2 - targetCenterY}px`,
    '--reffo-home-return-start-scale': String(startScale),
    '--reffo-home-return-left': `${targetSnapshot.left}px`,
    '--reffo-home-return-top': `${targetSnapshot.top}px`,
    '--reffo-home-return-width': `${targetSnapshot.width}px`,
    '--reffo-home-return-height': `${targetSnapshot.height}px`,
    '--card-responsive-scale': String(targetSnapshot.width / HOME_CARD_DESIGN_WIDTH),
  } as CSSProperties
}

function clearCardOpenRect() {
  clearSharedElementSnapshot(CARD_OPEN_RECT_STORAGE_KEY, '卡片')
}

function clearReturnHomeMarker() {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.sessionStorage?.removeItem(RESULT_RETURN_HOME_STORAGE_KEY)
    clearCardOpenRect()
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
            <View className='reffo-home__logo-anchor'>
              <img src={logoSource} className='reffo-home__logo' alt='Reffo' />
            </View>
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
  const visualCapability = useVisualTier({benchmark: true})
  const sourceLabel = hasSourceResume && sourceResumeTitle ? sourceResumeTitle : '源简历'
  const [returnHomePayload, setReturnHomePayload] = useState<ReturningHomePayload | null>(() => readReturnHomeMarker())
  const [isReturningFromResult, setIsReturningFromResult] = useState(() => Boolean(readReturnHomeMarker()))
  const [returnTransitionKey, setReturnTransitionKey] = useState(0)
  const [landingLogoSnapshot, setLandingLogoSnapshot] = useState<LandingLogoSnapshot | null>(
    () => readLandingToHomeSnapshot(),
  )
  const [landingLogoStyle, setLandingLogoStyle] = useState<CSSProperties | null>(null)
  const returnFadeTimerRef = useRef<number | null>(null)
  const landingEntryTimerRef = useRef<number | null>(null)
  const isReturnHomeTransition = isReturningFromResult
  const isLandingEntryTransition = Boolean(landingLogoSnapshot)
  const isHomeEntryTransition = isReturnHomeTransition || isLandingEntryTransition
  const returningCardId = returnHomePayload?.cardId ?? null
  const isViewTransitionReturn = returnHomePayload?.transition === 'view-transition'
  const returnCard = useMemo(() => (
    returningCardId ? cardItems.find(card => card.id === returningCardId) ?? currentCard : currentCard
  ), [cardItems, currentCard, returningCardId])
  const returnCardStyle = useMemo(
    () => resolveReturnCardStyle(readCardOpenRect()),
    [returnTransitionKey],
  )

  useDidShow(() => {
    if (typeof window === 'undefined') {
      return
    }

    const payload = readReturnHomeMarker()

    if (!payload) {
      return
    }

    setReturnHomePayload(payload)
    setReturnTransitionKey(key => key + 1)
    setIsReturningFromResult(true)
    if (returnFadeTimerRef.current != null) {
      window.clearTimeout(returnFadeTimerRef.current)
    }
    returnFadeTimerRef.current = window.setTimeout(() => {
      returnFadeTimerRef.current = null
      clearReturnHomeMarker()
      setReturnHomePayload(null)
      setIsReturningFromResult(false)
    }, HOME_RETURN_FLIP_MS)
  })

  useLayoutEffect(() => {
    if (!landingLogoSnapshot) {
      return undefined
    }

    const updateLogoTransition = () => {
      const nextStyle = resolveLandingLogoTransitionStyle(landingLogoSnapshot)
      if (nextStyle) {
        setLandingLogoStyle(nextStyle)
      }
    }

    updateLogoTransition()
    const raf = window.requestAnimationFrame(updateLogoTransition)

    if (landingEntryTimerRef.current != null) {
      window.clearTimeout(landingEntryTimerRef.current)
    }

    landingEntryTimerRef.current = window.setTimeout(() => {
      landingEntryTimerRef.current = null
      clearLandingToHomeSnapshot()
      setLandingLogoSnapshot(null)
      setLandingLogoStyle(null)
    }, HOME_LANDING_ENTRY_MS)

    return () => {
      window.cancelAnimationFrame(raf)
      if (landingEntryTimerRef.current != null) {
        window.clearTimeout(landingEntryTimerRef.current)
        landingEntryTimerRef.current = null
      }
    }
  }, [landingLogoSnapshot])

  useEffect(() => () => {
    if (returnFadeTimerRef.current != null) {
      window.clearTimeout(returnFadeTimerRef.current)
      clearReturnHomeMarker()
    }
    if (landingEntryTimerRef.current != null) {
      window.clearTimeout(landingEntryTimerRef.current)
      clearLandingToHomeSnapshot()
    }
  }, [])

  return (
    <View
      className={classNames('reffo-home', {
        'reffo-home--entry-active': isHomeEntryTransition,
        'reffo-home--returning-from-result': isReturnHomeTransition,
        'reffo-home--landing-entry': isLandingEntryTransition,
      })}
    >
      {isLandingEntryTransition && landingLogoStyle ? (
        <View className='reffo-home__landing-logo-layer'>
          <img
            src={logoSource}
            className='reffo-home__landing-logo'
            style={landingLogoStyle}
            alt='Reffo'
          />
        </View>
      ) : null}
      {isReturnHomeTransition && returnCard ? (
        <View
          key={returnTransitionKey}
          className={classNames('reffo-home__return-layer', {
            'reffo-home__return-layer--view-transition': isViewTransitionReturn,
          })}
        >
          <View className='reffo-home__return-backdrop' />
          <View
            className={classNames('reffo-home__return-card-stage', {
              'reffo-home__return-card-stage--view-transition': isViewTransitionReturn,
            })}
            style={returnCardStyle}
          >
            <HomeScoreCard
              card={returnCard}
              depth={0}
              active
              visualTier={visualCapability.tier}
              className='reffo-home__return-card'
            />
          </View>
        </View>
      ) : null}
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
          returningCardId={isReturnHomeTransition ? returningCardId : null}
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
              {hasHistories ? (
                <View className='reffo-home__inline-action reffo-home__inline-action--cancel' onClick={handleCancelCreate}>
                  <Text className='reffo-home__inline-icon'>×</Text>
                  <Text>取消</Text>
                </View>
              ) : null}
            </View>
          )}
          <Text className='reffo-home__disclaimer'>*内容由人工智能生成，请仔细检查</Text>
        </View>
      </View>
    </View>
  )
}
