import {Text, View} from '@tarojs/components'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Animated, Easing, Platform, StyleSheet} from 'react-native'
import SvgIcon, {Circle, Path} from 'react-native-svg'
import type {CreateGenerationState} from '../types'
import CreateBackdrop from './CreateBackdrop'

const CARD_WIDTH = 166
const CARD_HEIGHT = 222
const DETAIL_ITEM_HEIGHT = 42
const DETAIL_INITIAL_HOLD_MS = 2400
const DETAIL_HOLD_MS = 1500
const DETAIL_ROLL_MS = 460

interface AnalysisStageProps {
  state: CreateGenerationState
  topInset: number
  bottomInset: number
  onCancelGeneration: () => void
}

function AnalysisBackFace() {
  return (
    <View style={styles.cardBackContent}>
      <View style={styles.cardHardwareCompact}>
        <View style={[styles.cardHardwareSlot, styles.cardHardwareSlotBack] as any} />
      </View>

      <View style={styles.backBadgeWrap}>
        <SvgIcon width='66' height='66' viewBox='0 0 88 88'>
          <Circle
            cx='44'
            cy='44'
            r='43.5'
            stroke='rgba(255,255,255,0.94)'
            strokeWidth='1'
            fill='none'
          />
          <Path
            d='M44 20C46.4 34.6 53.4 41.6 68 44C53.4 46.4 46.4 53.4 44 68C41.6 53.4 34.6 46.4 20 44C34.6 41.6 41.6 34.6 44 20Z'
            fill='rgba(255,255,255,0.98)'
          />
          <Path
            d='M61 26C61.9 31.1 64.4 33.6 69.5 34.5C64.4 35.4 61.9 37.9 61 43C60.1 37.9 57.6 35.4 52.5 34.5C57.6 33.6 60.1 31.1 61 26Z'
            fill='rgba(255,255,255,0.8)'
          />
        </SvgIcon>
      </View>

      <View style={styles.backBodyBars}>
        <View style={styles.backPrimaryBar} />
        <View style={styles.backSecondaryBar} />
      </View>
    </View>
  )
}

export default function AnalysisStage({
  state,
  topInset,
  bottomInset,
  onCancelGeneration,
}: AnalysisStageProps) {
  const introProgress = useRef(new Animated.Value(0)).current
  const cardSpin = useRef(new Animated.Value(0)).current
  const detailRollProgress = useRef(new Animated.Value(0)).current
  const spinAnimationRef = useRef<Animated.CompositeAnimation | null>(null)
  const spinDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailAnimationRef = useRef<Animated.CompositeAnimation | null>(null)
  const [detailActiveIndex, setDetailActiveIndex] = useState(0)
  const detailSource = useMemo(
    () =>
      Array.isArray(state.detailItems)
        ? state.detailItems.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
          )
        : [],
    [state.detailItems],
  )
  const detailItems = detailSource

  useEffect(() => {
    introProgress.setValue(0)
    cardSpin.setValue(0)
    detailRollProgress.setValue(0)
    setDetailActiveIndex(0)

    Animated.timing(introProgress, {
      toValue: 1,
      duration: 560,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()

    spinDelayRef.current = setTimeout(() => {
      spinAnimationRef.current = Animated.loop(
        Animated.timing(cardSpin, {
          toValue: 1,
          duration: 2600,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      )
      spinAnimationRef.current.start()
    }, 420)

    if (detailItems.length > 1) {
      let activeIndex = 0

      const scheduleDetailRoll = (delay: number) => {
        detailTimerRef.current = setTimeout(() => {
          const nextIndex = (activeIndex + 1) % detailItems.length

          detailRollProgress.setValue(0)

          detailAnimationRef.current = Animated.timing(detailRollProgress, {
            toValue: 1,
            duration: DETAIL_ROLL_MS,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })

          detailAnimationRef.current.start(({finished}) => {
            if (!finished) {
              return
            }

            activeIndex = nextIndex
            setDetailActiveIndex(activeIndex)
            detailRollProgress.setValue(0)
            scheduleDetailRoll(DETAIL_HOLD_MS)
          })
        }, delay)
      }

      scheduleDetailRoll(DETAIL_INITIAL_HOLD_MS)
    }

    return () => {
      if (spinDelayRef.current) {
        clearTimeout(spinDelayRef.current)
      }
      if (detailTimerRef.current) {
        clearTimeout(detailTimerRef.current)
      }
      spinAnimationRef.current?.stop?.()
      detailAnimationRef.current?.stop?.()
    }
  }, [cardSpin, detailItems.length, detailRollProgress, introProgress])

  const cardAnimatedStyle = {
    opacity: introProgress.interpolate({
      inputRange: [0, 0.16, 1],
      outputRange: [0, 1, 1],
    }),
    transform: [
      {
        translateY: introProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [112, 0],
        }),
      },
      {
        scale: introProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [1.82, 1],
        }),
      },
    ],
  }

  const frontFaceAnimatedStyle = {
    opacity: cardSpin.interpolate({
      inputRange: [0, 0.22, 0.28, 0.72, 0.78, 1],
      outputRange: [1, 1, 0, 0, 1, 1],
    }),
    transform: [
      {perspective: 1100},
      {
        rotateY: cardSpin.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', '360deg'],
        }),
      },
    ],
  }

  const backFaceAnimatedStyle = {
    opacity: cardSpin.interpolate({
      inputRange: [0, 0.22, 0.28, 0.72, 0.78, 1],
      outputRange: [0, 0, 1, 1, 0, 0],
    }),
    transform: [
      {perspective: 1100},
      {
        rotateY: cardSpin.interpolate({
          inputRange: [0, 1],
          outputRange: ['180deg', '540deg'],
        }),
      },
    ],
  }

  const copyAnimatedStyle = {
    opacity: introProgress.interpolate({
      inputRange: [0, 0.45, 1],
      outputRange: [0, 0, 1],
    }),
    transform: [
      {
        translateY: introProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [26, 0],
        }),
      },
    ],
  }
  const detailCurrentAnimatedStyle = {
    transform: [
      {
        translateY: detailRollProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, -DETAIL_ITEM_HEIGHT],
        }),
      },
    ],
  }
  const detailNextAnimatedStyle = {
    transform: [
      {
        translateY: detailRollProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [DETAIL_ITEM_HEIGHT, 0],
        }),
      },
    ],
  }
  const androidFaceProps =
    Platform.OS === 'android'
      ? {
          needsOffscreenAlphaCompositing: true,
          renderToHardwareTextureAndroid: true,
        }
      : {}

  return (
    <View
      style={[
        styles.overlay,
        {
          paddingTop: topInset + 10,
          paddingBottom: Math.max(bottomInset, 22),
        },
      ] as any}
      data-testid='create-analysis-stage'
    >
      <CreateBackdrop variant='warm' />
      <View pointerEvents='none' style={styles.overlayGlow} />

      <View style={styles.content}>
        <Animated.View style={[styles.cardStage, cardAnimatedStyle] as any}>
          <View style={styles.cardSpinShell}>
            <Animated.View
              {...androidFaceProps}
              style={[styles.cardFace, styles.cardFront, frontFaceAnimatedStyle] as any}
            >
              <View style={styles.cardHardware}>
                <View style={styles.cardHardwareSlot} />
              </View>
              <View style={styles.frontBadge}>
                <Text style={styles.frontBadgeText}>{state.monogram}</Text>
              </View>
              <View style={styles.frontPrimaryBar} />
              <View style={styles.frontSecondaryBar} />
            </Animated.View>

            <Animated.View
              {...androidFaceProps}
              style={[styles.cardFace, styles.cardBack, backFaceAnimatedStyle] as any}
            >
              <AnalysisBackFace />
            </Animated.View>
          </View>
        </Animated.View>

        <Animated.View style={[styles.copyBlock, copyAnimatedStyle] as any}>
          <View style={styles.titleRow}>
            <Text style={styles.titleLead}>正在分析</Text>
            <View style={styles.detailViewport}>
              {detailItems.length > 0 ? (
                detailItems.length === 1 ? (
                  <View style={styles.detailItem}>
                    <Text numberOfLines={1} ellipsizeMode='tail' style={styles.titleDetail}>
                      {detailItems[0]}
                    </Text>
                  </View>
                ) : (
                  <>
                    <Animated.View
                      style={[styles.detailSlide, detailCurrentAnimatedStyle] as any}
                    >
                      <Text numberOfLines={1} ellipsizeMode='tail' style={styles.titleDetail}>
                        {detailItems[detailActiveIndex]}
                      </Text>
                    </Animated.View>
                    <Animated.View style={[styles.detailSlide, detailNextAnimatedStyle] as any}>
                      <Text numberOfLines={1} ellipsizeMode='tail' style={styles.titleDetail}>
                        {detailItems[(detailActiveIndex + 1) % detailItems.length]}
                      </Text>
                    </Animated.View>
                  </>
                )
              ) : null}
            </View>
          </View>

          <Text style={styles.subtitle}>正在为你的目标岗位量身定做最佳匹配简历……</Text>
        </Animated.View>
      </View>

      <View
        style={styles.cancelAction}
        onClick={onCancelGeneration}
        role='button'
        data-testid='analysis-cancel-action'
      >
        <Text style={styles.cancelActionMark}>×</Text>
        <Text style={styles.cancelActionText}>取消生成</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  overlayGlow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.36)',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 88,
  },
  cardStage: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    marginBottom: 52,
    position: 'relative',
  },
  cardSpinShell: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    overflow: 'visible',
  },
  cardFace: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    alignItems: 'center',
    paddingTop: 16,
    backfaceVisibility: 'hidden',
  },
  cardFront: {
    backgroundColor: '#fbf4ef',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.88)',
    shadowColor: '#9d8f86',
  },
  cardBack: {
    backgroundColor: '#1e1b1b',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.94)',
    alignItems: 'stretch',
    overflow: 'hidden',
  },
  cardHardware: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 28,
  },
  cardHardwareCompact: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 28,
  },
  cardHardwareSlot: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(248,240,233,0.98)',
  },
  cardHardwareSlotBack: {
    width: 52,
    height: 8,
    backgroundColor: '#9d9998',
  },
  frontBadge: {
    width: 66,
    height: 66,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(232, 224, 217, 0.95)',
    shadowColor: '#d8d2cd',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 36,
  },
  frontBadgeText: {
    color: '#959caf',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '700',
  },
  frontPrimaryBar: {
    width: 102,
    height: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(235, 231, 228, 0.92)',
    marginBottom: 12,
  },
  frontSecondaryBar: {
    width: 74,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(232, 228, 225, 0.82)',
  },
  cardBackContent: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },
  backBadgeWrap: {
    width: 66,
    height: 66,
    marginBottom: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBodyBars: {
    width: '100%',
    alignItems: 'center',
  },
  backPrimaryBar: {
    width: 102,
    height: 16,
    borderRadius: 999,
    backgroundColor: '#5d5c61',
    marginBottom: 12,
  },
  backSecondaryBar: {
    width: 74,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#67656a',
  },
  copyBlock: {
    width: '100%',
    alignItems: 'center',
  },
  titleRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  titleLead: {
    color: '#ff6230',
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
    marginRight: 8,
  },
  detailViewport: {
    width: 210,
    height: DETAIL_ITEM_HEIGHT,
    overflow: 'hidden',
    justifyContent: 'center',
    position: 'relative',
  },
  detailTrack: {
    width: '100%',
  },
  detailItem: {
    width: '100%',
    height: DETAIL_ITEM_HEIGHT,
  },
  detailSlide: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: DETAIL_ITEM_HEIGHT,
  },
  titleDetail: {
    width: '100%',
    color: '#696768',
    fontSize: 20,
    lineHeight: DETAIL_ITEM_HEIGHT,
    fontWeight: '600',
  },
  subtitle: {
    color: '#b1adb0',
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  cancelAction: {
    position: 'absolute',
    right: 32,
    bottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelActionMark: {
    color: '#1f1b1a',
    fontSize: 20,
    lineHeight: 22,
    marginRight: 6,
  },
  cancelActionText: {
    color: '#1f1b1a',
    fontSize: 15.5,
    lineHeight: 22,
    fontWeight: '500',
  },
})
