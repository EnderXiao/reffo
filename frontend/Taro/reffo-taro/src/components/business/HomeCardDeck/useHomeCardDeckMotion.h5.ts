/// <reference lib="dom" />
import {logVisualTier, useVisualTier} from '@/utils'
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {
  H5_CARD_DRAG_MAX,
  H5_CARD_EXIT_DURATION_MS,
  H5_RAIL_ANIMATION_MS,
  H5_RAIL_BUFFER_COUNT,
  H5_RAIL_HEIGHT,
  H5_RAIL_ITEM_HEIGHT,
  buildH5DeckDragVars,
  clamp,
  modulo,
  resolveH5DeckDragPresentation,
  shouldAdvanceH5Deck,
  type H5DeckCardSnapshot,
  type H5DeckDragState,
} from './motion.h5'
import type {HomeCardItem} from './shared'

interface UseHomeCardDeckMotionOptions {
  cards: HomeCardItem[]
  cardScale: number
  isCreateMode: boolean
  onCardChange?: (card: HomeCardItem, index: number) => void
  onFirstInteraction?: () => void
}

export default function useHomeCardDeckMotion({
  cards,
  cardScale,
  isCreateMode,
  onCardChange,
  onFirstInteraction,
}: UseHomeCardDeckMotionOptions) {
  const visualCapability = useVisualTier({benchmark: true})
  const [activeRailIndex, setActiveRailIndex] = useState(() => Math.max(0, cards.length - 1))
  const [railMotionY, setRailMotionY] = useState(0)
  const [isRailAnimating, setIsRailAnimating] = useState(false)
  const [dragState, setDragState] = useState<H5DeckDragState>({x: 0, y: 0, phase: 'idle'})
  const [recyclingCardId, setRecyclingCardId] = useState<string | null>(null)
  const railRef = useRef<HTMLDivElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const railAnimationTimerRef = useRef<number | null>(null)
  const deckSettleTimerRef = useRef<number | null>(null)
  const deckFlipSnapshotRef = useRef<Map<string, H5DeckCardSnapshot> | null>(null)
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
  const isDeckInteractive = !isCreateMode && cards.length > 1
  const railCenterOffset = H5_RAIL_HEIGHT / 2
  const railTranslateY = railCenterOffset - H5_RAIL_BUFFER_COUNT * H5_RAIL_ITEM_HEIGHT + railMotionY
  const dragVars = buildH5DeckDragVars(dragState)

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

    return Array.from({length: H5_RAIL_BUFFER_COUNT * 2 + 1}, (_, offset) => {
      const virtualIndex = activeRailIndex - H5_RAIL_BUFFER_COUNT + offset
      const sourceIndex = modulo(virtualIndex, cards.length)
      return {
        card: cards[sourceIndex],
        virtualIndex,
      }
    })
  }, [activeRailIndex, cards])

  const notifyFirstInteraction = () => {
    if (hasInteractedRef.current) {
      return
    }

    hasInteractedRef.current = true
    firstInteractionTimerRef.current = window.setTimeout(() => {
      firstInteractionTimerRef.current = null
      onFirstInteraction?.()
    }, 0)
  }

  const captureDeckFlipSnapshot = () => {
    const stackElement = stackRef.current

    if (!stackElement) {
      return
    }

    const snapshot = new Map<string, H5DeckCardSnapshot>()
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

      if (!cardId) {
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
          duration: H5_CARD_EXIT_DURATION_MS,
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

  const applyDeckDragVisuals = (state: H5DeckDragState) => {
    const stackElement = stackRef.current

    if (!stackElement) {
      return
    }

    const presentation = resolveH5DeckDragPresentation(state, cardScale)

    Object.entries(presentation.cssVars).forEach(([property, value]) => {
      stackElement.style.setProperty(property, value)
    })
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

      activeCardElement.style.setProperty('--card-highlight-strength', String(presentation.activeCard.highlightStrength))
      activeCardElement.style.setProperty('--card-highlight-angle', presentation.activeCard.highlightAngle)
      activeCardElement.style.setProperty('--card-highlight-x', presentation.activeCard.highlightX)
      activeCardElement.style.setProperty('--card-highlight-y', presentation.activeCard.highlightY)
      activeCardElement.style.transition = 'none'
      activeCardElement.style.filter = presentation.activeCard.filter
      activeCardElement.style.transform = presentation.activeCard.transform(cardLeft, cardTop)
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
    setRailMotionY(-direction * H5_RAIL_ITEM_HEIGHT)

    if (railAnimationTimerRef.current != null) {
      window.clearTimeout(railAnimationTimerRef.current)
    }

    railAnimationTimerRef.current = window.setTimeout(() => {
      setIsRailAnimating(false)
      setActiveRailIndex(current => current + direction)
      setRailMotionY(0)
      railAnimatingRef.current = false
      railAnimationTimerRef.current = null
    }, H5_RAIL_ANIMATION_MS)
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
    const nextState: H5DeckDragState = {x: 0, y: 0, phase: 'dragging'}

    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)
  }

  const updateDeckDrag = (clientX: number, clientY: number) => {
    if (dragStateRef.current.phase !== 'dragging') {
      return
    }

    const start = dragStartRef.current
    const nextX = clamp(clientX - start.x, -H5_CARD_DRAG_MAX, H5_CARD_DRAG_MAX)
    const nextY = clamp(clientY - start.y, -H5_CARD_DRAG_MAX, H5_CARD_DRAG_MAX)
    const nextState: H5DeckDragState = {x: nextX, y: nextY, phase: 'dragging'}

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

    const nextState: H5DeckDragState = {x: 0, y: 0, phase: 'exiting'}

    dragStateRef.current = nextState
    applyDeckDragVisuals(nextState)
    setDragState(nextState)
    setRecyclingCardId(activeCard.id)
    setActiveRailIndex(current => current + 1)

    if (deckSettleTimerRef.current != null) {
      window.clearTimeout(deckSettleTimerRef.current)
    }

    deckSettleTimerRef.current = window.setTimeout(() => {
      const idleState: H5DeckDragState = {x: 0, y: 0, phase: 'idle'}

      dragStateRef.current = idleState
      applyDeckDragVisuals(idleState)
      setDragState(idleState)
      setRecyclingCardId(null)
      deckSettleTimerRef.current = null
    }, H5_CARD_EXIT_DURATION_MS)
  }

  const resetDeckDrag = () => {
    const nextState: H5DeckDragState = {x: 0, y: 0, phase: 'settling'}

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

        const idleState: H5DeckDragState = {x: 0, y: 0, phase: 'idle'}

        dragStateRef.current = idleState
        applyDeckDragVisuals(idleState)
        return idleState
      })
    }, 260)
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

    if (shouldAdvanceH5Deck(currentDrag.x, currentDrag.y, velocityX)) {
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
      onCardChange?.(nextCard, sourceIndex)
    }
  }, [activeRailIndex, cards, onCardChange])

  useEffect(() => {
    dragStateRef.current = dragState
    applyDeckDragVisuals(dragState)
  }, [cardScale, dragState])

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
  }, [activeCard, isDeckInteractive])

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

  return {
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
  }
}
