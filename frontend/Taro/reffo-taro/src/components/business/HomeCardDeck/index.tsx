import {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {Animated, Easing, StyleSheet, View, useWindowDimensions} from 'react-native'
import {PanGestureHandler} from 'react-native-gesture-handler'
import {HOME_PAGE_CONTENT} from '@/pages/index/constants/content'
import {
  buildTailAdvanceCardStyle,
  buildDraggableCardStyle,
  buildGroundShadowStyle,
  buildPreviewCardStyle,
  buildStaticCardStyle,
  buildTailExitCardStyle,
  buildTailExitShadowStyle,
  buildTopCardContentStyle,
  buildTopCardTextureStyle,
} from './animation.native'
import CardTexture from './CardTexture.native'
import CreateDraftCard from './CreateDraftCard.native'
import {CardMainContent} from './CardContent.native'
import IndexRail from './IndexRail.native'
import {
  DEFAULT_DECK_WIDTH,
  VISIBLE_CARDS,
  backgroundColorForDepth,
  contentOpacityForDepth,
  createDeckLayoutMetrics,
  overlayOpacityForDepth,
  resolveCardElevation,
  resolveCardLayer,
  resolveDeckWidth,
  type HomeCardDeckProps,
  type RenderCardModel,
} from './shared'
import {styles} from './styles.native'
import useHomeCardDeck from './useHomeCardDeck.native'

function HomeCardDeck({
  cards,
  initialIndex = 0,
  isCreateMode = false,
  onCreateCardPress,
  onCardChange,
  onFirstInteraction,
}: HomeCardDeckProps) {
  const {width: windowWidth} = useWindowDimensions()
  const deckWidth = useMemo(
    () => Math.min(DEFAULT_DECK_WIDTH, resolveDeckWidth(windowWidth)),
    [windowWidth],
  )
  const layoutMetrics = useMemo(
    () => createDeckLayoutMetrics(Math.min(VISIBLE_CARDS, Math.max(cards.length, 1)), deckWidth),
    [cards.length, deckWidth],
  )
  const createModeProgress = useRef(new Animated.Value(isCreateMode ? 1 : 0)).current
  const draftTranslateX = useRef(new Animated.Value(isCreateMode ? 0 : 160)).current
  const draftOpacity = useRef(new Animated.Value(isCreateMode ? 1 : 0)).current
  const [isDraftVisible, setIsDraftVisible] = useState(isCreateMode)

  const {
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
    railPanHandlers,
    renderModels,
    stackHandoffProgress,
    tailExitCard,
    tailExitProgress,
  } = useHomeCardDeck({
    cards,
    initialIndex,
    onCardChange,
    onFirstInteraction,
  })

  useEffect(() => {
    if (isCreateMode) {
      setIsDraftVisible(true)
      draftTranslateX.setValue(156)
      draftOpacity.setValue(0)

      Animated.parallel([
        Animated.timing(createModeProgress, {
          toValue: 1,
          duration: 280,
          easing: Easing.bezier(0.2, 0.92, 0.28, 1),
          useNativeDriver: true,
        }),
        Animated.timing(draftTranslateX, {
          toValue: 0,
          duration: 320,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
          useNativeDriver: true,
        }),
        Animated.timing(draftOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start()

      return
    }

    Animated.timing(createModeProgress, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()

    if (!isDraftVisible) {
      draftTranslateX.setValue(160)
      draftOpacity.setValue(0)
      return
    }

    Animated.parallel([
      Animated.timing(draftTranslateX, {
        toValue: -148,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(draftOpacity, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(({finished}) => {
      if (!finished) {
        return
      }

      setIsDraftVisible(false)
      draftTranslateX.setValue(160)
      draftOpacity.setValue(0)
    })
  }, [createModeProgress, draftOpacity, draftTranslateX, isCreateMode])

  const stackAnimatedStyle = {
    opacity: createModeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.5],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateX: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -10],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 0.978],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
  const railAnimatedStyle = {
    opacity: createModeProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateX: createModeProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 24],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
  const draftAnimatedStyle = {
    opacity: draftOpacity,
    transform: [{translateX: draftTranslateX}],
  }

  const renderTailExitCard = useCallback(() => {
    if (!tailExitCard) {
      return null
    }

    const tailExitStyle = buildTailExitCardStyle(
      tailExitProgress,
      tailExitCard.releaseOffsetX,
      tailExitCard.releaseOffsetY,
      layoutMetrics,
    )
    const tailZIndex = 96
    const tailElevation = 14
    const bodyOpacity = contentOpacityForDepth(0)
    const dimOpacity = overlayOpacityForDepth(0)

    return (
      <View
        key={`${tailExitCard.key}-front`}
        style={[styles.cardLayer, {zIndex: tailZIndex, elevation: tailElevation}]}
        pointerEvents='none'
      >
        <Animated.View
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
          pointerEvents='none'
          style={[
            styles.cardBase,
            {
              backgroundColor: backgroundColorForDepth(tailExitCard.item, 0),
              borderColor: tailExitCard.item.borderColor,
              zIndex: tailZIndex,
              elevation: tailElevation,
            },
            tailExitStyle,
          ]}
        >
          <View style={styles.cardHandle} pointerEvents='none' />
          <CardTexture
            item={tailExitCard.item}
          />
          <Animated.View style={[styles.cardContent, {opacity: bodyOpacity}]}>
            <CardMainContent item={tailExitCard.item} />
          </Animated.View>
          <Animated.View
            style={[styles.dimOverlay, {opacity: dimOpacity}]}
            pointerEvents='none'
          />
        </Animated.View>
      </View>
    )
  }, [layoutMetrics, tailExitCard, tailExitProgress])

  const renderCardModel = useCallback((model: RenderCardModel) => {
    const cardZIndex = resolveCardLayer(model.depth)
    const cardElevation = resolveCardElevation(model.depth)
    const handoffFromDepth = model.depth === 4 ? 4 : ((model.depth + 1) as RenderCardModel['depth'])
    const baseBackgroundColor =
      tailExitCard && model.depth === 1
        ? backgroundColorForDepth(model.item, handoffFromDepth)
        : backgroundColorForDepth(model.item, model.depth)
    const handoffBackgroundOpacity =
      tailExitCard && model.depth === 1
        ? stackHandoffProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 1],
            extrapolate: 'clamp',
          })
        : null
    const staticBodyOpacity = contentOpacityForDepth(model.depth)
    const bodyOpacity =
      tailExitCard && model.depth <= 1
        ? stackHandoffProgress.interpolate({
            inputRange: [0, 1],
            outputRange: [
              model.depth === 0 ? contentOpacityForDepth(1) : 0,
              staticBodyOpacity,
            ],
            extrapolate: 'clamp',
          })
        : staticBodyOpacity
    const staticDimOpacity = overlayOpacityForDepth(model.depth)
    const dimOpacity = tailExitCard
      ? stackHandoffProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [
            overlayOpacityForDepth(handoffFromDepth),
            staticDimOpacity,
          ],
          extrapolate: 'clamp',
        })
      : staticDimOpacity
    const idleDragStyle =
      !tailExitCard && model.depth === 0
        ? buildDraggableCardStyle(dragX, dragY, layoutMetrics)
        : null
    const idleTextureStyle =
      !tailExitCard && model.depth === 0
        ? buildTopCardTextureStyle(dragX, dragY)
        : null
    const idleContentStyle =
      !tailExitCard && model.depth === 0
        ? buildTopCardContentStyle(dragX, dragY)
        : null
    const previewStyle =
      tailExitCard
        ? buildTailAdvanceCardStyle(
            stackHandoffProgress,
            model.depth,
            tailExitCard.releaseOffsetX,
            tailExitCard.releaseOffsetY,
            layoutMetrics,
          )
        : model.depth === 0
          ? buildStaticCardStyle(model.depth, layoutMetrics)
          : buildPreviewCardStyle(dragX, dragY, model.depth, layoutMetrics)
    const canDrag = !isCreateMode && !tailExitCard && model.depth === 0
    const showDetailedCard = model.depth <= 1
    const textureOpacity =
      tailExitCard && model.depth === 1
        ? stackHandoffProgress.interpolate({
            inputRange: [0, 0.35, 1],
            outputRange: [0, 1, 1],
            extrapolate: 'clamp',
          })
        : 1

    const cardBody = (
      <Animated.View
        renderToHardwareTextureAndroid={canDrag || Boolean(tailExitCard && model.depth <= 1)}
        shouldRasterizeIOS={canDrag || Boolean(tailExitCard && model.depth <= 1)}
        style={[
          styles.cardBase,
          {
            backgroundColor: baseBackgroundColor,
            borderColor: model.item.borderColor,
            zIndex: cardZIndex,
            elevation: cardElevation,
          },
          previewStyle,
          idleDragStyle,
        ]}
        pointerEvents={canDrag ? 'auto' : 'none'}
      >
        <View style={styles.cardHandle} pointerEvents='none' />
        {handoffBackgroundOpacity ? (
          <Animated.View
            pointerEvents='none'
            style={[
              StyleSheet.absoluteFillObject,
              {backgroundColor: model.item.surfaceColor, opacity: handoffBackgroundOpacity},
            ]}
          />
        ) : null}
        <Animated.View
          pointerEvents='none'
          style={[styles.textureWrap, idleTextureStyle, {opacity: textureOpacity}]}
        >
          <CardTexture item={model.item} />
        </Animated.View>
        {showDetailedCard ? (
          <Animated.View
            style={[styles.cardContent, {opacity: bodyOpacity}, idleContentStyle]}
          >
            <CardMainContent item={model.item} />
          </Animated.View>
        ) : null}
        <Animated.View
          style={[styles.dimOverlay, {opacity: dimOpacity}]}
          pointerEvents='none'
        />
      </Animated.View>
    )

    if (canDrag) {
      return (
        <View
          key={model.key}
          style={[styles.cardLayer, {zIndex: cardZIndex, elevation: cardElevation}]}
          pointerEvents='box-none'
        >
          <PanGestureHandler
            enabled
            minDist={4}
            onGestureEvent={deckGestureEvent}
            onHandlerStateChange={handleDeckGestureStateChange}
          >
            {cardBody}
          </PanGestureHandler>
        </View>
      )
    }

    return (
      <View
        key={model.key}
        style={[styles.cardLayer, {zIndex: cardZIndex, elevation: cardElevation}]}
        pointerEvents='none'
      >
        {cardBody}
      </View>
    )
  }, [
    deckGestureEvent,
    dragX,
    dragY,
    handleDeckGestureStateChange,
    isCreateMode,
    stackHandoffProgress,
    tailExitCard,
    layoutMetrics,
  ])

  if (cards.length === 0 && !isDraftVisible) {
    return null
  }

  return (
    <View style={[styles.container, {width: deckWidth}]}>
      <Animated.View
        style={[styles.stack, {width: deckWidth}, stackAnimatedStyle]}
        pointerEvents={isCreateMode ? 'none' : 'auto'}
      >
        <Animated.View
          pointerEvents='none'
          style={[
            styles.groundShadow,
            {left: layoutMetrics.shadowLeft, width: layoutMetrics.shadowWidth},
            tailExitCard
              ? buildTailExitShadowStyle(
                  tailExitProgress,
                  tailExitCard.releaseOffsetX,
                  tailExitCard.releaseOffsetY,
                )
              : buildGroundShadowStyle(dragX, dragY),
          ]}
        />
        {renderModels
          .slice()
          .sort((left, right) => resolveCardLayer(left.depth) - resolveCardLayer(right.depth))
          .map(renderCardModel)}
        {tailExitCard ? renderTailExitCard() : null}
      </Animated.View>

      {isDraftVisible ? (
        <Animated.View
          pointerEvents='box-none'
          style={[styles.createCardLayer, draftAnimatedStyle]}
        >
          <CreateDraftCard
            title={HOME_PAGE_CONTENT.createCard.title}
            promptPrefix={HOME_PAGE_CONTENT.createCard.promptPrefix}
            promptAccent={HOME_PAGE_CONTENT.createCard.promptAccent}
            onPress={onCreateCardPress}
          />
        </Animated.View>
      ) : null}

      {cards.length > 0 ? (
        <Animated.View
          style={[StyleSheet.absoluteFillObject, railAnimatedStyle]}
          pointerEvents={isCreateMode ? 'none' : 'box-none'}
        >
          <IndexRail
            cards={cards}
            activeIndex={activeIndex}
            isRailDragging={isRailDragging}
            dragLabel={dragLabel}
            railIndicatorY={railIndicatorY}
            railBubbleY={railBubbleY}
            panHandlers={railPanHandlers}
            onLayout={handleRailLayout}
            onPressIndex={jumpToIndex}
          />
        </Animated.View>
      ) : null}
    </View>
  )
}

export default memo(HomeCardDeck)
export type {HomeCardItem} from './shared'
