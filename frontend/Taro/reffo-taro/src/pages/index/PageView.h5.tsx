import {Image, Text, View} from '@tarojs/components'
import {logVisualTier, useVisualTier} from '@/utils'
import classNames from 'classnames'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {IndexPageViewModel} from './model/usePageModel'
import {HOME_PAGE_CONTENT} from './constants/content'
import HomeScoreCard from './components/HomeScoreCard.h5'
import './index.h5.scss'

function GithubMark() {
  return (
    <View className='reffo-home__github-mark'>
      <View className='reffo-home__github-dot' />
    </View>
  )
}

const RAIL_ITEM_HEIGHT = 58
const RAIL_HEIGHT = 406
const RAIL_BUFFER_COUNT = 8
const RAIL_ANIMATION_MS = 180
const RAIL_MINOR_MARK_COUNT = 5
const CARD_DESIGN_WIDTH = 210
const CARD_DESIGN_HEIGHT = 332
const CARD_SWIPE_DISTANCE = 44
const CARD_SWIPE_VELOCITY = 0.28
const CARD_EXIT_DURATION_MS = 420
const CARD_DRAG_MAX = 220

type DeckDragState = {
  x: number
  y: number
  phase: 'idle' | 'dragging' | 'settling' | 'exiting'
}

type DeckCardSnapshot = {
  transform: string
}

type HeroMode = 'brand' | 'strategy' | 'create'

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
  logoSource,
}: {
  currentCard: IndexPageViewModel['currentCard']
  isCreateMode: boolean
  isStrategyVisible: boolean
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
  }, [nextMode, nextStrategyBody, renderMode, renderStrategyBody])

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

function getViewportSize() {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null
  const documentElement = typeof document !== 'undefined' ? document.documentElement : null

  return {
    width: viewport?.width || documentElement?.clientWidth || 393,
    height: viewport?.height || documentElement?.clientHeight || 852,
  }
}

function resolveCardScale() {
  const {width, height} = getViewportSize()
  const pagePadX = Math.min(Math.max(width * 0.076, 24), 31)
  const deckWidth = Math.min(width - pagePadX * 1.48, 346)
  const availableHeight = height - 456
  const widthScale = (deckWidth * 0.72) / CARD_DESIGN_WIDTH
  const heightScale = availableHeight / CARD_DESIGN_HEIGHT
  const maxScale = width >= 768 ? 0.98 : 0.88
  const baseScale = Math.max(0.72, Math.min(widthScale, heightScale, maxScale))

  return Math.min(baseScale * 1.33, width >= 768 ? 1.18 : 1.08)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function modulo(value: number, length: number) {
  return ((value % length) + length) % length
}

function interpolateClamped(value: number, input: [number, number, number], output: [number, number, number]) {
  const [inputMin, inputMid, inputMax] = input
  const [outputMin, outputMid, outputMax] = output
  const clampedValue = clamp(value, inputMin, inputMax)

  if (clampedValue <= inputMid) {
    const progress = (clampedValue - inputMin) / (inputMid - inputMin)
    return outputMin + (outputMid - outputMin) * progress
  }

  const progress = (clampedValue - inputMid) / (inputMax - inputMid)
  return outputMid + (outputMax - outputMid) * progress
}

function useResponsiveCardScale() {
  const [scale, setScale] = useState(resolveCardScale)

  useEffect(() => {
    let frameId = 0
    const refresh = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setScale(resolveCardScale())
      })
    }

    refresh()
    window.addEventListener('resize', refresh)
    window.addEventListener('orientationchange', refresh)
    window.visualViewport?.addEventListener('resize', refresh)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', refresh)
      window.removeEventListener('orientationchange', refresh)
      window.visualViewport?.removeEventListener('resize', refresh)
    }
  }, [])

  return scale
}

function HomeCardDeckH5({
  cards,
  isCreateMode,
  onCreateCardPress,
  onCardChange,
  onFirstInteraction,
}: {
  cards: IndexPageViewModel['cardItems']
  isCreateMode: boolean
  onCreateCardPress: () => void
  onCardChange: IndexPageViewModel['handleCardChange']
  onFirstInteraction: IndexPageViewModel['handleDeckFirstInteraction']
}) {
  const cardScale = useResponsiveCardScale()
  const visualCapability = useVisualTier({benchmark: true})
  const [activeRailIndex, setActiveRailIndex] = useState(() => Math.max(0, cards.length - 1))
  const [railMotionY, setRailMotionY] = useState(0)
  const [isRailAnimating, setIsRailAnimating] = useState(false)
  const [dragState, setDragState] = useState<DeckDragState>({x: 0, y: 0, phase: 'idle'})
  const [recyclingCardId, setRecyclingCardId] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const railAnimationTimerRef = useRef<number | null>(null)
  const deckSettleTimerRef = useRef<number | null>(null)
  const deckFlipSnapshotRef = useRef<Map<string, DeckCardSnapshot> | null>(null)
  const deckFlipAnimationsRef = useRef<Map<string, Animation>>(new Map())
  const firstInteractionTimerRef = useRef<number | null>(null)
  const railAnimatingRef = useRef(false)
  const touchStartYRef = useRef<number | null>(null)
  const hasInteractedRef = useRef(false)
  const dragStartRef = useRef({
    pointerId: null as number | null,
    x: 0,
    y: 0,
    startedAt: 0,
    lastX: 0,
    lastAt: 0,
  })
  const dragStateRef = useRef(dragState)
  const resolvedActiveIndex = cards.length > 0 ? modulo(activeRailIndex, cards.length) : 0
  const activeCard = cards[resolvedActiveIndex]
  const orderedCardEntries = useMemo(() => {
    if (!cards.length) {
      return []
    }

    const visibleCount = Math.min(5, cards.length)
    const nextCards = []

    for (let offset = 0; offset < cards.length && nextCards.length < visibleCount; offset += 1) {
      const card = cards[modulo(resolvedActiveIndex + offset, cards.length)]

      nextCards.push({
        card,
        depth: offset,
        isRecycling: card.id === recyclingCardId,
        isTailEntering: Boolean(recyclingCardId) && offset === visibleCount - 1 && card.id !== recyclingCardId,
      })
    }

    if (recyclingCardId && !nextCards.some(entry => entry.card.id === recyclingCardId)) {
      const recyclingCard = cards.find(card => card.id === recyclingCardId)

      if (recyclingCard) {
        nextCards.push({
          card: recyclingCard,
          depth: visibleCount - 1,
          isRecycling: true,
          isTailEntering: false,
        })
      }
    }

    return nextCards.sort((current, next) => {
      if (current.depth !== next.depth) {
        return next.depth - current.depth
      }

      if (current.isRecycling === next.isRecycling) {
        return 0
      }

      return current.isRecycling ? 1 : -1
    })
  }, [cards, recyclingCardId, resolvedActiveIndex])
  const railItems = useMemo(() => {
    if (!cards.length) {
      return []
    }

    return Array.from({length: RAIL_BUFFER_COUNT * 2 + 1}, (_, offset) => {
      const virtualIndex = activeRailIndex - RAIL_BUFFER_COUNT + offset
      const sourceIndex = modulo(virtualIndex, cards.length)
      return {
        card: cards[sourceIndex],
        virtualIndex,
      }
    })
  }, [activeRailIndex, cards])
  const railCenterOffset = RAIL_HEIGHT / 2
  const railTranslateY = railCenterOffset - RAIL_BUFFER_COUNT * RAIL_ITEM_HEIGHT + railMotionY
  const dragMagnitude = Math.min(1, Math.abs(dragState.x) / CARD_DRAG_MAX)
  const isDeckInteractive = !isCreateMode && cards.length > 1
  const dragVars = {
    '--card-drag-x': `${dragState.x}px`,
    '--card-drag-y': `${clamp(dragState.y, -CARD_DRAG_MAX, CARD_DRAG_MAX)}px`,
    '--card-drag-rotate': `${clamp(dragState.x / 31.4, -7, 7)}deg`,
    '--card-drag-rotate-y': `${clamp(-dragState.x / 10, -22, 22)}deg`,
    '--card-drag-rotate-x': `${clamp(dragState.y / 12.2, -18, 18)}deg`,
    '--card-drag-scale-x': String(1 - dragMagnitude * 0.052),
    '--card-drag-scale-y': String(1 - Math.min(1, Math.abs(dragState.y) / CARD_DRAG_MAX) * 0.042),
    '--card-drag-lift-y': `${-Math.abs(dragState.x) * 0.1}px`,
    '--card-preview-progress': String(dragMagnitude),
  }
  const notifyFirstInteraction = () => {
    if (hasInteractedRef.current) {
      return
    }

    hasInteractedRef.current = true
    firstInteractionTimerRef.current = window.setTimeout(() => {
      firstInteractionTimerRef.current = null
      onFirstInteraction()
    }, 0)
  }
  const captureDeckFlipSnapshot = () => {
    const stackElement = stackRef.current

    if (!stackElement) {
      return
    }

    const snapshot = new Map<string, DeckCardSnapshot>()
    const cardElements = stackElement.querySelectorAll('[data-home-card-id]')

    cardElements.forEach(element => {
      const cardElement = element as HTMLElement
      const cardId = cardElement.dataset.homeCardId

      if (!cardId) {
        return
      }

      const computedStyle = window.getComputedStyle(cardElement)

      snapshot.set(cardId, {
        transform: computedStyle.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : computedStyle.transform,
      })
    })

    deckFlipSnapshotRef.current = snapshot
  }
  const playDeckFlipAnimation = () => {
    const stackElement = stackRef.current
    const snapshot = deckFlipSnapshotRef.current

    if (!stackElement || !snapshot) {
      return
    }

    deckFlipSnapshotRef.current = null

    const cardElements = stackElement.querySelectorAll('[data-home-card-id]')

    cardElements.forEach(element => {
      const cardElement = element as HTMLElement
      const cardId = cardElement.dataset.homeCardId
      const fromState = cardId ? snapshot.get(cardId) : null

      if (!fromState || typeof cardElement.animate !== 'function') {
        return
      }

      const computedStyle = window.getComputedStyle(cardElement)
      const nextTransform = computedStyle.transform === 'none' ? 'matrix(1, 0, 0, 1, 0, 0)' : computedStyle.transform
      const hasTransformChange = fromState.transform !== nextTransform

      if (!hasTransformChange) {
        return
      }

      deckFlipAnimationsRef.current.get(cardId)?.cancel()
      const animation = cardElement.animate(
        [
          {
            transform: fromState.transform,
          },
          {
            transform: nextTransform,
          },
        ],
        {
          duration: CARD_EXIT_DURATION_MS,
          easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          fill: 'none',
        },
      )

      deckFlipAnimationsRef.current.set(cardId, animation)
      animation.onfinish = () => {
        if (deckFlipAnimationsRef.current.get(cardId) === animation) {
          deckFlipAnimationsRef.current.delete(cardId)
        }
      }
      animation.oncancel = () => {
        if (deckFlipAnimationsRef.current.get(cardId) === animation) {
          deckFlipAnimationsRef.current.delete(cardId)
        }
      }
    })
  }
  const applyDeckDragVisuals = (state: DeckDragState) => {
    const stackElement = stackRef.current

    if (!stackElement) {
      return
    }

    const magnitude = Math.min(1, Math.hypot(state.x, state.y) / CARD_DRAG_MAX)
    const highlightDx = -state.x
    const highlightDy = -state.y
    const highlightAngle = Math.round((Math.atan2(highlightDy, highlightDx || 0.01) * 180) / Math.PI + 90)
    const highlightX = interpolateClamped(highlightDx, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [14, 50, 86])
    const highlightY = interpolateClamped(highlightDy, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [12, 50, 88])
    const verticalDrag = interpolateClamped(state.y, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [-48, 0, 48])
    const horizontalLift = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [-22, 0, -22])
    const textureX = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [18, 0, -18])
    const textureY = interpolateClamped(state.y, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [-14, 0, 14])
    const textureScale = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [1.05, 1, 1.05])
    const contentX = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [14, 0, -14])
    const contentLift = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [-5, 0, -5])
    const contentY = interpolateClamped(state.y, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [-16, 0, 16])
    const contentScale = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [1.02, 1, 1.02])
    const scaleX = interpolateClamped(state.x, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [0.948, 1, 0.948])
    const scaleY = interpolateClamped(state.y, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [0.958, 1, 0.958])
    const shadowOpacity = interpolateClamped(Math.abs(state.x), [0, 120, CARD_DRAG_MAX], [0.16, 0.13, 0.11])
    const shadowBlur = interpolateClamped(Math.abs(state.x), [0, 120, CARD_DRAG_MAX], [18, 20, 23])
    const shadowY = interpolateClamped(state.y, [-CARD_DRAG_MAX, 0, CARD_DRAG_MAX], [7, 12, 24])

    stackElement.style.setProperty('--card-drag-x', `${state.x}px`)
    stackElement.style.setProperty('--card-drag-y', `${verticalDrag}px`)
    stackElement.style.setProperty('--card-drag-rotate', `${clamp(state.x / 31.4, -7, 7)}deg`)
    stackElement.style.setProperty('--card-drag-rotate-y', `${clamp(-state.x / 10, -22, 22)}deg`)
    stackElement.style.setProperty('--card-drag-rotate-x', `${clamp(state.y / 12.2, -18, 18)}deg`)
    stackElement.style.setProperty('--card-drag-scale-x', String(scaleX))
    stackElement.style.setProperty('--card-drag-scale-y', String(scaleY))
    stackElement.style.setProperty('--card-drag-lift-y', `${horizontalLift}px`)
    stackElement.style.setProperty('--card-preview-progress', String(magnitude))
    stackElement.style.setProperty('--card-texture-x', `${textureX}px`)
    stackElement.style.setProperty('--card-texture-y', `${textureY}px`)
    stackElement.style.setProperty('--card-texture-scale', String(textureScale))
    stackElement.style.setProperty('--card-content-x', `${contentX}px`)
    stackElement.style.setProperty('--card-content-y', `${contentLift + contentY}px`)
    stackElement.style.setProperty('--card-content-scale', String(contentScale))
    stackElement.classList.toggle('reffo-home-deck__stack--dragging', state.phase === 'dragging')
    stackElement.classList.toggle('reffo-home-deck__stack--settling', state.phase === 'settling')
    stackElement.classList.toggle('reffo-home-deck__stack--exiting', state.phase === 'exiting')

    const activeCardElement = stackElement.querySelector('.reffo-home-card--draggable') as HTMLElement | null

    if (!activeCardElement) {
      return
    }

    if (state.phase === 'dragging') {
      const cardLeft = activeCardElement.style.getPropertyValue('--card-left') || '0px'
      const cardTop = activeCardElement.style.getPropertyValue('--card-top') || '0px'

      activeCardElement.style.setProperty('--card-highlight-strength', String(0.26 + magnitude * 1.05))
      activeCardElement.style.setProperty('--card-highlight-angle', `${highlightAngle}deg`)
      activeCardElement.style.setProperty('--card-highlight-x', `${highlightX}%`)
      activeCardElement.style.setProperty('--card-highlight-y', `${highlightY}%`)
      activeCardElement.style.transition = 'none'
      activeCardElement.style.filter = `drop-shadow(${clamp(state.x * 0.08, -18, 18)}px ${shadowY}px ${shadowBlur}px rgba(21, 30, 46, ${shadowOpacity}))`
      activeCardElement.style.transform = [
        'perspective(1280px)',
        `translate3d(calc(${cardLeft} + ${state.x}px), calc(${cardTop} + ${verticalDrag + horizontalLift}px), 0)`,
        `rotate(${clamp(state.x / 31.4, -7, 7)}deg)`,
        `rotateY(${clamp(-state.x / 10, -22, 22)}deg)`,
        `rotateX(${clamp(state.y / 12.2, -18, 18)}deg)`,
        `scale(${cardScale * scaleX * scaleY})`,
      ].join(' ')
      return
    }

    if (state.phase === 'settling') {
      activeCardElement.style.removeProperty('--card-highlight-strength')
      activeCardElement.style.removeProperty('--card-highlight-angle')
      activeCardElement.style.removeProperty('--card-highlight-x')
      activeCardElement.style.removeProperty('--card-highlight-y')
      activeCardElement.style.transition = 'transform 260ms cubic-bezier(0.2, 0.92, 0.28, 1)'
      activeCardElement.style.removeProperty('filter')
      activeCardElement.style.removeProperty('transform')
      return
    }

    activeCardElement.style.removeProperty('--card-highlight-strength')
    activeCardElement.style.removeProperty('--card-highlight-angle')
    activeCardElement.style.removeProperty('--card-highlight-x')
    activeCardElement.style.removeProperty('--card-highlight-y')
    activeCardElement.style.removeProperty('transition')
    activeCardElement.style.removeProperty('transform')
    activeCardElement.style.removeProperty('filter')
  }
  const stepRail = (delta: number) => {
    if (!cards.length || railAnimatingRef.current) {
      return
    }

    notifyFirstInteraction()
    const direction = delta > 0 ? 1 : -1
    railAnimatingRef.current = true
    setIsRailAnimating(true)
    setRailMotionY(-direction * RAIL_ITEM_HEIGHT)

    if (railAnimationTimerRef.current != null) {
      window.clearTimeout(railAnimationTimerRef.current)
    }

    railAnimationTimerRef.current = window.setTimeout(() => {
      setIsRailAnimating(false)
      setActiveRailIndex(current => current + direction)
      setRailMotionY(0)
      railAnimatingRef.current = false
      railAnimationTimerRef.current = null
    }, RAIL_ANIMATION_MS)
  }
  const consumeScrollEvent = (event: WheelEvent | TouchEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }
  const handleRailTouchStart = (event: any) => {
    touchStartYRef.current = event?.touches?.[0]?.clientY ?? null
  }
  const beginDeckDrag = (clientX: number, clientY: number, pointerId: number | null = null) => {
    if (!isDeckInteractive) {
      return
    }

    if (dragStateRef.current.phase === 'dragging') {
      return
    }

    notifyFirstInteraction()
    const now = performance.now()

    if (pointerId != null) {
      stackRef.current?.setPointerCapture?.(pointerId)
    }

    dragStartRef.current = {
      pointerId,
      x: clientX,
      y: clientY,
      startedAt: now,
      lastX: clientX,
      lastAt: now,
    }
    const nextState: DeckDragState = {x: 0, y: 0, phase: 'dragging'}

    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)
  }
  const updateDeckDrag = (clientX: number, clientY: number) => {
    if (dragStateRef.current.phase !== 'dragging') {
      return
    }

    const start = dragStartRef.current
    const nextX = clamp(clientX - start.x, -CARD_DRAG_MAX, CARD_DRAG_MAX)
    const nextY = clamp(clientY - start.y, -CARD_DRAG_MAX, CARD_DRAG_MAX)
    const nextState: DeckDragState = {x: nextX, y: nextY, phase: 'dragging'}

    dragStartRef.current = {
      ...start,
      lastX: clientX,
      lastAt: performance.now(),
    }
    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)
  }
  const commitDeckAdvance = () => {
    if (!activeCard || cards.length <= 1) {
      setDragState({x: 0, y: 0, phase: 'settling'})
      return
    }

    captureDeckFlipSnapshot()

    const nextState: DeckDragState = {x: 0, y: 0, phase: 'exiting'}

    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)
    setRecyclingCardId(activeCard.id)
    setActiveRailIndex(current => current + 1)

    if (deckSettleTimerRef.current != null) {
      window.clearTimeout(deckSettleTimerRef.current)
    }

    deckSettleTimerRef.current = window.setTimeout(() => {
      const idleState: DeckDragState = {x: 0, y: 0, phase: 'idle'}

      dragStateRef.current = idleState
      applyDeckDragVisuals(idleState)
      setDragState(idleState)
      setRecyclingCardId(null)
      deckSettleTimerRef.current = null
    }, CARD_EXIT_DURATION_MS)
  }
  const resetDeckDrag = () => {
    const nextState: DeckDragState = {x: 0, y: 0, phase: 'settling'}

    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)

    if (deckSettleTimerRef.current != null) {
      window.clearTimeout(deckSettleTimerRef.current)
      deckSettleTimerRef.current = null
    }

    setRecyclingCardId(null)

    window.setTimeout(() => {
      setDragState(current => {
        if (current.phase !== 'settling') {
          return current
        }

        const idleState: DeckDragState = {x: 0, y: 0, phase: 'idle'}

        dragStateRef.current = idleState
        applyDeckDragVisuals(idleState)
        return idleState
      })
    }, 260)
  }
  const shouldAdvanceDeck = (translationX: number, translationY: number, velocityX: number) => {
    if (Math.abs(translationX) <= Math.abs(translationY) * 1.05) {
      return false
    }

    return (
      translationX < -CARD_SWIPE_DISTANCE ||
      translationX > CARD_SWIPE_DISTANCE ||
      velocityX < -CARD_SWIPE_VELOCITY ||
      velocityX > CARD_SWIPE_VELOCITY
    )
  }
  const finishDeckDrag = (isCancel = false) => {
    if (dragStateRef.current.phase !== 'dragging') {
      return
    }

    const start = dragStartRef.current
    const currentDrag = dragStateRef.current
    const now = performance.now()
    const elapsed = Math.max(16, now - start.startedAt)
    const velocityX = currentDrag.x / elapsed

    if (start.pointerId != null) {
      stackRef.current?.releasePointerCapture?.(start.pointerId)
    }

    if (isCancel) {
      resetDeckDrag()
      return
    }

    if (shouldAdvanceDeck(currentDrag.x, currentDrag.y, velocityX)) {
      commitDeckAdvance()
      return
    }

    resetDeckDrag()
  }
  const handleDeckPointerDown = (event: any) => {
    const nativeEvent = event.nativeEvent || event

    beginDeckDrag(nativeEvent.clientX ?? 0, nativeEvent.clientY ?? 0, nativeEvent.pointerId ?? null)
  }
  const handleDeckPointerMove = (event: any) => {
    const nativeEvent = event.nativeEvent || event

    event.preventDefault?.()
    updateDeckDrag(nativeEvent.clientX ?? 0, nativeEvent.clientY ?? 0)
  }
  const handleDeckPointerEnd = (event: any) => {
    const nativeEvent = event.nativeEvent || event

    finishDeckDrag(nativeEvent.type === 'pointercancel')
  }
  useEffect(() => {
    if (!cards.length) {
      return
    }

    const sourceIndex = modulo(activeRailIndex, cards.length)
    const nextCard = cards[sourceIndex]

    if (nextCard) {
      onCardChange(nextCard, sourceIndex)
    }
  }, [activeRailIndex, cards, onCardChange])
  useEffect(() => {
    dragStateRef.current = dragState
    applyDeckDragVisuals(dragState)
  }, [dragState])
  useLayoutEffect(() => {
    if (dragState.phase !== 'exiting') {
      return
    }

    playDeckFlipAnimation()
  }, [dragState.phase, orderedCardEntries])
  useEffect(() => {
    const stackElement = stackRef.current

    if (!stackElement) {
      return undefined
    }

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]

      if (!touch) {
        return
      }

      beginDeckDrag(touch.clientX, touch.clientY)
    }
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]

      if (!touch || dragStateRef.current.phase !== 'dragging') {
        return
      }

      event.preventDefault()
      updateDeckDrag(touch.clientX, touch.clientY)
    }
    const handleTouchEnd = () => {
      finishDeckDrag(false)
    }
    const handleTouchCancel = () => {
      finishDeckDrag(true)
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) {
        return
      }

      beginDeckDrag(event.clientX, event.clientY)
    }
    const handleMouseMove = (event: MouseEvent) => {
      if (dragStateRef.current.phase !== 'dragging') {
        return
      }

      event.preventDefault()
      updateDeckDrag(event.clientX, event.clientY)
    }
    const handleMouseUp = () => {
      finishDeckDrag(false)
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return
      }

      beginDeckDrag(event.clientX, event.clientY, event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      if (dragStateRef.current.phase !== 'dragging') {
        return
      }

      event.preventDefault()
      updateDeckDrag(event.clientX, event.clientY)
    }
    const handlePointerUp = () => {
      finishDeckDrag(false)
    }
    const handlePointerCancel = () => {
      finishDeckDrag(true)
    }

    stackElement.addEventListener('pointerdown', handlePointerDown)
    stackElement.addEventListener('touchstart', handleTouchStart, {passive: false})
    stackElement.addEventListener('touchmove', handleTouchMove, {passive: false})
    stackElement.addEventListener('touchend', handleTouchEnd)
    stackElement.addEventListener('touchcancel', handleTouchCancel)
    stackElement.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('pointermove', handlePointerMove, {passive: false})
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    window.addEventListener('mousemove', handleMouseMove, {passive: false})
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      stackElement.removeEventListener('pointerdown', handlePointerDown)
      stackElement.removeEventListener('touchstart', handleTouchStart)
      stackElement.removeEventListener('touchmove', handleTouchMove)
      stackElement.removeEventListener('touchend', handleTouchEnd)
      stackElement.removeEventListener('touchcancel', handleTouchCancel)
      stackElement.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDeckInteractive, activeCard])
  useEffect(() => {
    const railElement = railRef.current

    if (!railElement) {
      return undefined
    }

    const handleNativeWheel = (event: WheelEvent) => {
      consumeScrollEvent(event)

      if (Math.abs(event.deltaY) < 4) {
        return
      }

      stepRail(event.deltaY > 0 ? 1 : -1)
    }
    const handleNativeTouchMove = (event: TouchEvent) => {
      const startY = touchStartYRef.current
      const nextY = event.touches?.[0]?.clientY

      consumeScrollEvent(event)

      if (startY == null || nextY == null) {
        return
      }

      const deltaY = nextY - startY

      if (Math.abs(deltaY) < 18) {
        return
      }

      stepRail(deltaY > 0 ? -1 : 1)
      touchStartYRef.current = nextY
    }

    railElement.addEventListener('wheel', handleNativeWheel, {passive: false})
    railElement.addEventListener('touchmove', handleNativeTouchMove, {passive: false})

    return () => {
      railElement.removeEventListener('wheel', handleNativeWheel)
      railElement.removeEventListener('touchmove', handleNativeTouchMove)
    }
  }, [cards.length])
  useEffect(() => {
    return () => {
      if (railAnimationTimerRef.current != null) {
        window.clearTimeout(railAnimationTimerRef.current)
      }

      if (deckSettleTimerRef.current != null) {
        window.clearTimeout(deckSettleTimerRef.current)
      }

      deckFlipAnimationsRef.current.forEach(animation => animation.cancel())
      deckFlipAnimationsRef.current.clear()

      if (firstInteractionTimerRef.current != null) {
        window.clearTimeout(firstInteractionTimerRef.current)
      }
    }
  }, [])
  useEffect(() => {
    logVisualTier(visualCapability, 'home-page')
  }, [visualCapability])

  return (
    <View
      className={classNames('reffo-home-deck-wrap', `reffo-home-deck-wrap--${visualCapability.tier}`)}
      style={{'--card-responsive-scale': cardScale} as any}
    >
      <View className='reffo-home-deck'>
        <View
          ref={stackRef as any}
          className={classNames('reffo-home-deck__stack', {
            'reffo-home-deck__stack--dragging': dragState.phase === 'dragging',
            'reffo-home-deck__stack--settling': dragState.phase === 'settling',
            'reffo-home-deck__stack--exiting': dragState.phase === 'exiting',
          })}
          style={dragVars as any}
          onPointerDown={handleDeckPointerDown}
          onPointerMove={handleDeckPointerMove}
          onPointerUp={handleDeckPointerEnd}
          onPointerCancel={handleDeckPointerEnd}
        >
          {orderedCardEntries.map(({card, depth, isRecycling, isTailEntering}) => {
            const isActive = !isRecycling && card.id === activeCard?.id
            return (
              <HomeScoreCard
                key={card.id}
                card={card}
                depth={depth}
                active={isActive}
                visualTier={visualCapability.tier}
                className={classNames({
                  'reffo-home-card--draggable': isActive && isDeckInteractive,
                  'reffo-home-card--preview': !isActive && !isRecycling && isDeckInteractive,
                  'reffo-home-card--tail-enter': isTailEntering,
                  'reffo-home-card--recycling': isRecycling,
                })}
              />
            )
          })}
          {isCreateMode ? (
            <HomeScoreCard
              key='create-draft-card'
              depth={0}
              active
              visualTier={visualCapability.tier}
              variant='create'
              onClick={onCreateCardPress}
            />
          ) : null}
        </View>
        <View
          ref={railRef as any}
          className='reffo-home-deck__rail'
          onTouchStart={handleRailTouchStart}
        >
          <View
            className={classNames('reffo-home-deck__rail-wheel', {
              'reffo-home-deck__rail-wheel--animating': isRailAnimating,
            })}
            style={{transform: `translateY(${railTranslateY}px)`} as any}
          >
            {railItems.map(({card, virtualIndex}) => {
              const distance = Math.min(4, Math.abs(virtualIndex - activeRailIndex))
              const isActive = virtualIndex === activeRailIndex

              return (
                <View
                  key={`${card.id}-${virtualIndex}`}
                  className={classNames(
                    'reffo-home-deck__rail-item',
                    `reffo-home-deck__rail-item--d${distance}`,
                    {
                      'reffo-home-deck__rail-item--active': isActive,
                    },
                  )}
                >
                  <View className='reffo-home-deck__rail-major'>
                    <Text className='reffo-home-deck__rail-label'>{card.indexLabel}</Text>
                    <View className='reffo-home-deck__rail-tick reffo-home-deck__rail-tick--major' />
                  </View>
                  {Array.from({length: RAIL_MINOR_MARK_COUNT}, (_, tickIndex) => (
                    <View
                      key={tickIndex}
                      className='reffo-home-deck__rail-minor'
                      style={{top: `${(tickIndex + 1) * (RAIL_ITEM_HEIGHT / (RAIL_MINOR_MARK_COUNT + 1))}px`} as any}
                    >
                      <View className='reffo-home-deck__rail-tick reffo-home-deck__rail-tick--minor' />
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
        </View>
      </View>
    </View>
  )
}

export default function PageView({
  cardItems,
  currentCard,
  currentProgress,
  displayTotal,
  hasSourceResume,
  sourceResumeTitle,
  isStrategyVisible,
  isCreateMode,
  handleEnterCreateMode,
  handleConfirmCreate,
  handleCancelCreate,
  handleViewHistory,
  handleCardChange,
  handleDeckFirstInteraction,
  logoSource,
}: IndexPageViewModel) {
  const sourceLabel = hasSourceResume && sourceResumeTitle ? sourceResumeTitle : '源简历'

  return (
    <View className='reffo-home'>
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
            <GithubMark />
          </View>
        </View>

        <HomeHeroH5
          currentCard={currentCard}
          isCreateMode={isCreateMode}
          isStrategyVisible={isStrategyVisible}
          logoSource={logoSource}
        />

        <View
          className={classNames('reffo-home__progress', {
            'reffo-home__progress--hidden': isCreateMode,
          })}
        >
          当前简历 {currentProgress}/{displayTotal} 项
        </View>

        <HomeCardDeckH5
          cards={cardItems}
          isCreateMode={isCreateMode}
          onCreateCardPress={handleConfirmCreate}
          onCardChange={handleCardChange}
          onFirstInteraction={handleDeckFirstInteraction}
        />

        <View className='reffo-home__footer'>
          {!isCreateMode ? (
            <View className='reffo-home__primary-action' onClick={handleEnterCreateMode}>
              <Text className='reffo-home__primary-plus'>+</Text>
              <Text className='reffo-home__primary-text'>创建 Reffo 简历</Text>
            </View>
          ) : (
            <View className='reffo-home__inline-actions'>
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
