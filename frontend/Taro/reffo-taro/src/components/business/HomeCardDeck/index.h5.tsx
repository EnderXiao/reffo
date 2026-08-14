/// <reference lib="dom" />
import {Text, View} from '@tarojs/components'
import classNames from 'classnames'
import {useCallback, useEffect, useRef, useState} from 'react'
import {
  H5_RAIL_ITEM_HEIGHT,
  H5_RAIL_MINOR_MARK_COUNT,
  resolveH5CardScale,
} from './motion.h5'
import {
  createSharedElementSnapshot,
  writeSharedElementSnapshot,
} from '@/utils/shared-element-transition'
import HomeScoreCard from './HomeScoreCard.h5'
import type {HomeCardDeckProps} from './shared'
import useHomeCardDeckMotion from './useHomeCardDeckMotion.h5'

const CREATE_MODE_STACK_GAP_X = 24
const CARD_OPEN_DRAG_THRESHOLD = 8
const CARD_OPEN_FADE_OUT_DELAY = 270
const CARD_OPEN_NAVIGATION_DELAY = 440
const CARD_OPEN_CLEANUP_DELAY = 820
const CARD_OPEN_RECT_STORAGE_KEY = 'reffo.homeCardOpenRect'

interface CardOpenGestureState {
  cardId: string | null
  isPointerDown: boolean
  moved: boolean
  x: number
  y: number
}

interface CardOpenTransitionState {
  clone: HTMLElement
  overlay: HTMLDivElement
  source: HTMLElement
  homeElement: HTMLElement | null
  frameId: number | null
  timers: number[]
}

function getEventPoint(event: any) {
  const nativeEvent = event?.nativeEvent || event
  const touch = nativeEvent?.touches?.[0] || nativeEvent?.changedTouches?.[0]

  return {
    x: touch?.clientX ?? nativeEvent?.clientX ?? 0,
    y: touch?.clientY ?? nativeEvent?.clientY ?? 0,
  }
}

function getEventCardId(event: any) {
  const nativeEvent = event?.nativeEvent || event
  const target = nativeEvent?.target as HTMLElement | null
  const cardElement = target?.closest?.('[data-home-card-id]') as HTMLElement | null

  return cardElement?.dataset.homeCardId ?? null
}

function findCardElement(stackElement: HTMLDivElement | null, cardId: string) {
  if (!stackElement) {
    return null
  }

  const candidates = stackElement.querySelectorAll('[data-home-card-id]')

  return Array.from(candidates).find(element => (
    (element as HTMLElement).dataset.homeCardId === cardId
  )) as HTMLElement | undefined ?? null
}

function buildCreateModeStackCardStyle(depth: number) {
  const shiftedDepth = depth + 1

  return {
    '--card-left': `${CREATE_MODE_STACK_GAP_X * shiftedDepth}px`,
    '--card-top': `${Math.min(2 + shiftedDepth * 2, 10)}px`,
    '--card-rotate': `${shiftedDepth * 3.8}deg`,
    '--card-depth-scale': String(1 - shiftedDepth * 0.018),
    '--card-opacity': String(1 - shiftedDepth * 0.035),
    zIndex: 32 - shiftedDepth,
  }
}

function useResponsiveCardScale() {
  const [scale, setScale] = useState(resolveH5CardScale)

  useEffect(() => {
    let frameId = 0
    const refresh = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setScale(resolveH5CardScale())
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

export default function HomeCardDeck({
  cards,
  initialIndex,
  enteringCardId,
  returningCardId,
  isCreateMode = false,
  onCreateCardPress,
  onCardPress,
  onCardChange,
  onFirstInteraction,
}: HomeCardDeckProps) {
  const cardScale = useResponsiveCardScale()
  const openGestureRef = useRef<CardOpenGestureState>({
    cardId: null,
    isPointerDown: false,
    moved: false,
    x: 0,
    y: 0,
  })
  const openTransitionRef = useRef<CardOpenTransitionState | null>(null)
  const isOpeningCardRef = useRef(false)
  const suppressClickUntilRef = useRef(0)
  const {
    activeCard,
    activeRailIndex,
    dragState,
    dragVars,
    handleDeckPointerDown,
    handleDeckPointerEnd,
    handleDeckPointerMove,
    handleRailTouchStart,
    isDeckInteractive,
    isRailAnimating,
    orderedCardEntries,
    railItems,
    railRef,
    railTranslateY,
    stackRef,
    visualCapability,
  } = useHomeCardDeckMotion({
    cards,
    initialIndex,
    cardScale,
    isCreateMode,
    onCardChange,
    onFirstInteraction,
  })
  const cleanupOpenTransition = useCallback(() => {
    const transition = openTransitionRef.current

    if (!transition) {
      isOpeningCardRef.current = false
      return
    }

    if (transition.frameId != null) {
      window.cancelAnimationFrame(transition.frameId)
    }

    transition.timers.forEach(timer => window.clearTimeout(timer))
    transition.homeElement?.classList.remove('reffo-home--opening-result')
    transition.source.classList.remove('reffo-home-card--opening-source')
    transition.clone.remove()
    transition.overlay.remove()
    openTransitionRef.current = null
    isOpeningCardRef.current = false
  }, [])

  const playCardOpenTransition = useCallback((card: typeof activeCard) => {
    if (!card || !onCardPress || isCreateMode || isOpeningCardRef.current) {
      return
    }

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const gesture = openGestureRef.current

    if (now < suppressClickUntilRef.current || gesture.moved || (gesture.cardId && gesture.cardId !== card.id)) {
      return
    }

    const source = findCardElement(stackRef.current, card.id)

    if (!source || typeof document === 'undefined') {
      void Promise.resolve(onCardPress(card))
      return
    }

    cleanupOpenTransition()
    isOpeningCardRef.current = true

    const rect = source.getBoundingClientRect()
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || rect.width
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || rect.height
    const targetScale = Math.max(
      viewportWidth / Math.max(rect.width, 1),
      viewportHeight / Math.max(rect.height, 1),
    ) * 1.08
    const translateX = (viewportWidth / 2) - (rect.left + rect.width / 2)
    const translateY = (viewportHeight / 2) - (rect.top + rect.height / 2)
    const overlay = document.createElement('div')
    const clone = source.cloneNode(true) as HTMLElement
    const homeElement = source.closest('.reffo-home') as HTMLElement | null
    const surface = clone.querySelector('.reffo-home-card__surface') as HTMLElement | null
    const resultWash = document.createElement('div')

    resultWash.className = 'reffo-home-card__open-result-wash'
    surface?.appendChild(resultWash)

    writeSharedElementSnapshot(
      CARD_OPEN_RECT_STORAGE_KEY,
      createSharedElementSnapshot(rect, {cardId: card.id}),
      '卡片',
    )

    overlay.className = 'reffo-home-card-open-overlay'
    overlay.style.position = 'fixed'
    overlay.style.inset = '0'
    overlay.style.zIndex = '9998'
    overlay.style.pointerEvents = 'none'
    overlay.style.background = '#ffffff'
    overlay.style.opacity = '0'
    overlay.style.transition = 'opacity 360ms cubic-bezier(0.16, 1, 0.3, 1)'

    clone.classList.add('reffo-home-card--opening-clone')
    clone.classList.remove('reffo-home-card--new-entry')
    clone.style.position = 'fixed'
    clone.style.left = `${rect.left}px`
    clone.style.top = `${rect.top}px`
    clone.style.width = `${rect.width}px`
    clone.style.height = `${rect.height}px`
    clone.style.margin = '0'
    clone.style.zIndex = '9999'
    clone.style.pointerEvents = 'none'
    clone.style.opacity = '1'
    clone.style.transform = 'translate3d(0, 0, 0) scale(1)'
    clone.style.transformOrigin = 'center center'
    clone.style.filter = 'drop-shadow(0 18PX 30PX rgba(21, 30, 46, 0.2))'
    clone.style.willChange = 'transform, opacity, filter'
    clone.style.transition = [
      'transform 460ms cubic-bezier(0.16, 1, 0.3, 1)',
      'opacity 360ms ease',
      'filter 460ms cubic-bezier(0.16, 1, 0.3, 1)',
    ].join(', ')

    source.classList.add('reffo-home-card--opening-source')
    homeElement?.classList.add('reffo-home--opening-result')
    document.body.appendChild(overlay)
    document.body.appendChild(clone)

    const transition: CardOpenTransitionState = {
      clone,
      overlay,
      source,
      homeElement,
      frameId: null,
      timers: [],
    }
    openTransitionRef.current = transition

    transition.frameId = window.requestAnimationFrame(() => {
      transition.frameId = null
      overlay.style.opacity = '1'
      clone.classList.add('reffo-home-card--opening-active')
      clone.style.opacity = '0.58'
      clone.style.filter = 'drop-shadow(0 30PX 58PX rgba(21, 30, 46, 0.16))'
      clone.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${targetScale})`
    })

    transition.timers.push(window.setTimeout(() => {
      clone.style.opacity = '0'
      clone.style.filter = 'drop-shadow(0 18PX 28PX rgba(21, 30, 46, 0.08))'
    }, CARD_OPEN_FADE_OUT_DELAY))
    transition.timers.push(window.setTimeout(() => {
      void Promise.resolve(onCardPress(card)).catch(error => {
        console.error('打开结果页失败:', error)
        cleanupOpenTransition()
      })
    }, CARD_OPEN_NAVIGATION_DELAY))
    transition.timers.push(window.setTimeout(() => {
      cleanupOpenTransition()
    }, CARD_OPEN_CLEANUP_DELAY))
  }, [cleanupOpenTransition, isCreateMode, onCardPress, stackRef])

  useEffect(() => cleanupOpenTransition, [cleanupOpenTransition])

  const handleStackPointerDown = useCallback((event: any) => {
    const point = getEventPoint(event)

    openGestureRef.current = {
      cardId: getEventCardId(event),
      isPointerDown: true,
      moved: false,
      x: point.x,
      y: point.y,
    }
    handleDeckPointerDown(event)
  }, [handleDeckPointerDown])

  const handleStackPointerMove = useCallback((event: any) => {
    const gesture = openGestureRef.current

    if (gesture.isPointerDown) {
      const point = getEventPoint(event)

      if (Math.hypot(point.x - gesture.x, point.y - gesture.y) > CARD_OPEN_DRAG_THRESHOLD) {
        gesture.moved = true
      }
    }

    handleDeckPointerMove(event)
  }, [handleDeckPointerMove])

  const handleStackPointerEnd = useCallback((event: any) => {
    const gesture = openGestureRef.current

    if (gesture.moved) {
      suppressClickUntilRef.current = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 420
    }
    gesture.isPointerDown = false
    handleDeckPointerEnd(event)
  }, [handleDeckPointerEnd])

  const stackPointerHandlers = {
    onPointerDown: handleStackPointerDown,
    onPointerMove: handleStackPointerMove,
    onPointerUp: handleStackPointerEnd,
    onPointerCancel: handleStackPointerEnd,
  } as any

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
            'reffo-home-deck__stack--create-mode': isCreateMode,
          })}
          style={dragVars as any}
          {...stackPointerHandlers}
        >
          {orderedCardEntries.map(({card, depth, isRecycling, isTailEntering}) => {
            const isActive = !isRecycling && card.id === activeCard?.id
            const isPressable = Boolean(onCardPress) && isActive && !isCreateMode && !isRecycling
            return (
              <HomeScoreCard
                key={card.id}
                card={card}
                depth={depth}
                active={isActive}
                visualTier={visualCapability.tier}
                style={isCreateMode ? buildCreateModeStackCardStyle(depth) : undefined}
                className={classNames({
                  'reffo-home-card--draggable': isActive && isDeckInteractive,
                  'reffo-home-card--preview': !isActive && !isRecycling && isDeckInteractive,
                  'reffo-home-card--tail-enter': isTailEntering,
                  'reffo-home-card--recycling': isRecycling,
                  'reffo-home-card--new-entry': card.id === enteringCardId,
                  'reffo-home-card--return-target': card.id === returningCardId,
                  'reffo-home-card--pressable': isPressable,
                })}
                onClick={isPressable ? () => playCardOpenTransition(card) : undefined}
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
              className='reffo-home-card--create-draft'
              style={{zIndex: 48}}
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
                  {Array.from({length: H5_RAIL_MINOR_MARK_COUNT}, (_, tickIndex) => (
                    <View
                      key={tickIndex}
                      className='reffo-home-deck__rail-minor'
                      style={{top: `${(tickIndex + 1) * (H5_RAIL_ITEM_HEIGHT / (H5_RAIL_MINOR_MARK_COUNT + 1))}px`} as any}
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
