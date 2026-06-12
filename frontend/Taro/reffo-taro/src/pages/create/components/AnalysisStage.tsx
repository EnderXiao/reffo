import {Text, View} from '@tarojs/components'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Animated, Easing, Platform} from 'react-native'
import type {CreateGenerationState} from '../types'
import AnalysisCard from './AnalysisCard'
import AnalysisCopy from './AnalysisCopy'
import {
  DETAIL_HOLD_MS,
  DETAIL_INITIAL_HOLD_MS,
  DETAIL_ITEM_HEIGHT,
  DETAIL_ROLL_MS,
} from './AnalysisStage.constants'
import {styles} from './AnalysisStage.styles'
import CreateBackdrop from './CreateBackdrop'

interface AnalysisStageProps {
  state: CreateGenerationState
  topInset: number
  bottomInset: number
  onCancelGeneration: () => void
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
  const detailItems = useMemo(
    () =>
      Array.isArray(state.detailItems)
        ? state.detailItems.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0,
          )
        : [],
    [state.detailItems],
  )

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
      <View {...({pointerEvents: 'none'} as any)} style={styles.overlayGlow} />

      <View style={styles.content}>
        <AnalysisCard
          monogram={state.monogram}
          cardAnimatedStyle={cardAnimatedStyle}
          frontFaceAnimatedStyle={frontFaceAnimatedStyle}
          backFaceAnimatedStyle={backFaceAnimatedStyle}
          androidFaceProps={androidFaceProps}
        />

        <AnalysisCopy
          detailItems={detailItems}
          detailActiveIndex={detailActiveIndex}
          copyAnimatedStyle={copyAnimatedStyle}
          detailCurrentAnimatedStyle={detailCurrentAnimatedStyle}
          detailNextAnimatedStyle={detailNextAnimatedStyle}
        />
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
