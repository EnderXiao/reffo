import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  PanResponder,
  unstable_batchedUpdates,
} from 'react-native'
import {State, type PanGestureHandlerStateChangeEvent} from 'react-native-gesture-handler'
import {
  INDEX_ITEM_HEIGHT,
  INDEX_LINE_HEIGHT,
  RAIL_BUBBLE_HEIGHT,
  SWIPE_TRIGGER_DISTANCE,
  SWIPE_TRIGGER_VELOCITY,
  TAIL_EXIT_DURATION,
  VISIBLE_CARDS,
  buildRenderModels,
  modulo,
  type HomeCardDeckProps,
  type TailExitCard,
} from './shared'

export default function useHomeCardDeck({
  cards,
  initialIndex = 0,
  onCardChange,
  onFirstInteraction,
}: HomeCardDeckProps) {
  const visibleCount = Math.min(VISIBLE_CARDS, cards.length)
  const [activeIndex, setActiveIndex] = useState(() =>
    cards.length > 0 ? modulo(initialIndex, cards.length) : 0,
  )
  const [railHeight, setRailHeight] = useState(0)
  const [dragLabel, setDragLabel] = useState('')
  const [isRailDragging, setIsRailDragging] = useState(false)
  const [tailExitCard, setTailExitCard] = useState<TailExitCard | null>(null)
  const activeIndexRef = useRef(activeIndex)
  const onCardChangeRef = useRef(onCardChange)
  const onFirstInteractionRef = useRef(onFirstInteraction)
  const hasNotifiedFirstInteractionRef = useRef(false)
  const cardChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastReportedIndexRef = useRef<number | null>(null)
  const tailExitAnimationRef = useRef<Animated.CompositeAnimation | null>(null)
  const tailExitProgress = useRef(new Animated.Value(0)).current
  const stackHandoffProgress = useRef(new Animated.Value(1)).current
  const dragX = useRef(new Animated.Value(0)).current
  const dragY = useRef(new Animated.Value(0)).current
  const railIndicatorY = useRef(new Animated.Value(0)).current
  const railBubbleY = useRef(new Animated.Value(0)).current

  useEffect(() => {
    onCardChangeRef.current = onCardChange
  }, [onCardChange])

  useEffect(() => {
    onFirstInteractionRef.current = onFirstInteraction
  }, [onFirstInteraction])

  useEffect(() => {
    if (cardChangeTimeoutRef.current) {
      clearTimeout(cardChangeTimeoutRef.current)
      cardChangeTimeoutRef.current = null
    }

    if (cards.length === 0) {
      lastReportedIndexRef.current = null
      return
    }

    const card = cards[activeIndex]
    if (!card) {
      return
    }

    if (lastReportedIndexRef.current == null) {
      lastReportedIndexRef.current = activeIndex
      onCardChangeRef.current?.(card, activeIndex)
      return
    }

    if (lastReportedIndexRef.current === activeIndex) {
      return
    }

    cardChangeTimeoutRef.current = setTimeout(() => {
      lastReportedIndexRef.current = activeIndex
      onCardChangeRef.current?.(card, activeIndex)
      cardChangeTimeoutRef.current = null
    }, 72)

    return () => {
      if (cardChangeTimeoutRef.current) {
        clearTimeout(cardChangeTimeoutRef.current)
        cardChangeTimeoutRef.current = null
      }
    }
  }, [activeIndex, cards])

  useEffect(() => () => {
    if (cardChangeTimeoutRef.current) {
      clearTimeout(cardChangeTimeoutRef.current)
      cardChangeTimeoutRef.current = null
    }

    if (tailExitAnimationRef.current) {
      tailExitAnimationRef.current.stop()
      tailExitAnimationRef.current = null
    }
  }, [])

  useEffect(() => {
    if (cards.length === 0) {
      setActiveIndex(0)
      activeIndexRef.current = 0
      return
    }

    const normalized = modulo(initialIndex, cards.length)
    setActiveIndex(normalized)
    activeIndexRef.current = normalized
  }, [cards, initialIndex])

  useEffect(() => {
    if (!railHeight || cards.length === 0 || isRailDragging) {
      return
    }

    Animated.spring(railIndicatorY, {
      toValue:
        activeIndex * INDEX_ITEM_HEIGHT +
        (INDEX_ITEM_HEIGHT - INDEX_LINE_HEIGHT) / 2,
      useNativeDriver: true,
      tension: 140,
      friction: 18,
    }).start()
  }, [activeIndex, cards.length, isRailDragging, railHeight, railIndicatorY])

  const notifyFirstInteraction = useCallback(() => {
    if (hasNotifiedFirstInteractionRef.current) {
      return
    }

    hasNotifiedFirstInteractionRef.current = true
    onFirstInteractionRef.current?.()
  }, [])

  const clearTailExitCard = useCallback(() => {
    if (tailExitAnimationRef.current) {
      tailExitAnimationRef.current.stop()
      tailExitAnimationRef.current = null
    }

    tailExitProgress.setValue(0)
    stackHandoffProgress.setValue(1)
    setTailExitCard(null)
  }, [stackHandoffProgress, tailExitProgress])

  const resetDeckDrag = useCallback(() => {
    clearTailExitCard()

    Animated.parallel([
      Animated.spring(dragX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 110,
      }),
      Animated.spring(dragY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 110,
      }),
    ]).start()
  }, [clearTailExitCard, dragX, dragY])

  const commitIndex = useCallback((nextIndex: number) => {
    if (cards.length === 0) {
      return
    }

    const normalized = modulo(nextIndex, cards.length)
    activeIndexRef.current = normalized
    setActiveIndex(normalized)
  }, [cards.length])

  const animateDeckAdvance = useCallback((releaseOffsetX = 0, releaseOffsetY = 0) => {
    if (cards.length <= 1) {
      return
    }

    clearTailExitCard()

    const currentCard = cards[activeIndexRef.current]
    const nextIndex = activeIndexRef.current + 1
    const tailReleaseOffsetX =
      releaseOffsetX === 0 ? SWIPE_TRIGGER_DISTANCE : releaseOffsetX

    requestAnimationFrame(() => {
      stackHandoffProgress.setValue(0)
      unstable_batchedUpdates(() => {
        if (currentCard) {
          setTailExitCard({
            key: `tail-exit-${currentCard.id}-${Date.now()}`,
            item: currentCard,
            releaseOffsetX: tailReleaseOffsetX,
            releaseOffsetY,
          })
        }

        commitIndex(nextIndex)
      })

      dragX.setValue(0)
      dragY.setValue(0)

      if (!currentCard) {
        stackHandoffProgress.setValue(1)
        return
      }

      tailExitProgress.setValue(0)
      tailExitAnimationRef.current = Animated.parallel([
        Animated.timing(tailExitProgress, {
          toValue: 1,
          duration: TAIL_EXIT_DURATION,
          easing: Easing.bezier(0.2, 0.92, 0.28, 1),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.spring(stackHandoffProgress, {
          toValue: 1,
          useNativeDriver: true,
          tension: 132,
          friction: 18,
          isInteraction: false,
        }),
      ])
      tailExitAnimationRef.current.start(({finished}) => {
        tailExitAnimationRef.current = null
        if (!finished) {
          return
        }

        tailExitProgress.setValue(0)
        stackHandoffProgress.setValue(1)
        setTailExitCard(null)
      })
    })
  }, [cards, clearTailExitCard, commitIndex, dragX, dragY, stackHandoffProgress, tailExitProgress])

  const shouldAdvanceDeck = useCallback((
    translationX: number,
    translationY: number,
    velocityX: number,
  ) => {
    if (Math.abs(translationX) <= Math.abs(translationY) * 1.05) {
      return false
    }

    return (
      translationX < -SWIPE_TRIGGER_DISTANCE ||
      velocityX < -SWIPE_TRIGGER_VELOCITY ||
      translationX > SWIPE_TRIGGER_DISTANCE ||
      velocityX > SWIPE_TRIGGER_VELOCITY
    )
  }, [])

  const jumpToIndex = useCallback((nextIndex: number) => {
    if (cards.length === 0 || nextIndex === activeIndexRef.current) {
      return
    }

    clearTailExitCard()
    dragX.setValue(0)
    dragY.setValue(0)
    commitIndex(nextIndex)
  }, [cards.length, clearTailExitCard, commitIndex, dragX, dragY])

  const resolveRailIndex = useCallback((locationY: number) => {
    if (!railHeight || cards.length === 0) {
      return activeIndexRef.current
    }

    const clamped = Math.max(0, Math.min(railHeight - 1, locationY))
    return Math.min(cards.length - 1, Math.floor(clamped / INDEX_ITEM_HEIGHT))
  }, [cards.length, railHeight])

  const updateRailFollower = useCallback((locationY: number) => {
    if (!railHeight) {
      return
    }

    const clamped = Math.max(0, Math.min(railHeight - 1, locationY))
    railIndicatorY.setValue(clamped - INDEX_LINE_HEIGHT / 2)
    railBubbleY.setValue(clamped - RAIL_BUBBLE_HEIGHT / 2)

    const nextIndex = resolveRailIndex(clamped)
    setDragLabel(cards[nextIndex]?.indexLabel || '')
    jumpToIndex(nextIndex)
  }, [cards, jumpToIndex, railBubbleY, railHeight, railIndicatorY, resolveRailIndex])

  const deckGestureEvent = useMemo(
    () =>
      Animated.event(
        [{nativeEvent: {translationX: dragX, translationY: dragY}}],
        {useNativeDriver: true},
      ),
    [dragX, dragY],
  )

  const handleDeckGestureStateChange = useCallback((
    event: PanGestureHandlerStateChangeEvent,
  ) => {
    const {oldState, state, translationX, translationY, velocityX} =
      event.nativeEvent

    if (state === State.BEGAN || state === State.ACTIVE) {
      notifyFirstInteraction()
    }

    if (oldState !== State.ACTIVE) {
      return
    }

    if (state === State.END && shouldAdvanceDeck(translationX, translationY, velocityX)) {
      const velocityBoost = Math.max(-180, Math.min(180, velocityX * 120))
      const direction = translationX === 0 ? Math.sign(velocityX || 1) : Math.sign(translationX)
      const baseRelease = translationX === 0 ? direction * SWIPE_TRIGGER_DISTANCE : translationX
      const boostedRelease = baseRelease + velocityBoost
      const normalizedReleaseOffsetX =
        Math.abs(boostedRelease) < SWIPE_TRIGGER_DISTANCE
          ? direction * SWIPE_TRIGGER_DISTANCE
          : Math.max(-220, Math.min(220, boostedRelease))

      animateDeckAdvance(normalizedReleaseOffsetX, translationY)
      return
    }

    resetDeckDrag()
  }, [animateDeckAdvance, notifyFirstInteraction, resetDeckDrag, shouldAdvanceDeck])

  const railPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: event => {
          notifyFirstInteraction()
          setIsRailDragging(true)
          updateRailFollower(event.nativeEvent.locationY)
        },
        onPanResponderMove: event => {
          updateRailFollower(event.nativeEvent.locationY)
        },
        onPanResponderRelease: event => {
          updateRailFollower(event.nativeEvent.locationY)
          setIsRailDragging(false)
        },
        onPanResponderTerminate: () => {
          setIsRailDragging(false)
        },
      }),
    [notifyFirstInteraction, updateRailFollower],
  )

  const renderModels = useMemo(
    () => buildRenderModels(cards, activeIndex, visibleCount),
    [activeIndex, cards, visibleCount],
  )

  const handleRailLayout = useCallback((event: LayoutChangeEvent) => {
    setRailHeight(event.nativeEvent.layout.height)
  }, [])

  return {
    activeIndex,
    deckGestureEvent,
    dragLabel,
    dragX,
    dragY,
    handleDeckGestureStateChange,
    handleRailLayout,
    isRailDragging,
    jumpToIndex,
    railBubbleY,
    railIndicatorY,
    railPanHandlers: railPanResponder.panHandlers,
    renderModels,
    stackHandoffProgress,
    tailExitCard,
    tailExitProgress,
  }
}
