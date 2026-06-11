import {Animated} from 'react-native'
import {
  CARD_DRAG_PERSPECTIVE,
  type DeckLayoutMetrics,
  type DepthKey,
  clamp,
  getPreviewPose,
  interpolateNumber,
  previewDepthMotion,
  resolveDepthLayout,
} from './shared'
import {TAIL_EXIT_INPUT_RANGE, resolveTailExitMotion} from './tailExit.shared'

export function buildStaticCardStyle(depth: DepthKey, layoutMetrics?: DeckLayoutMetrics) {
  const layout = resolveDepthLayout(depth, layoutMetrics)

  return {
    opacity: layout.opacity,
    transform: [
      {translateX: layout.left},
      {translateY: layout.top},
      {rotate: layout.rotate},
      {scale: layout.scale},
    ],
  }
}

export function buildPreviewCardStyle(
  dragX: Animated.Value,
  dragY: Animated.Value,
  depth: DepthKey,
  layoutMetrics?: DeckLayoutMetrics,
) {
  const layout = resolveDepthLayout(depth, layoutMetrics)

  if (depth === 0) {
    return buildStaticCardStyle(depth, layoutMetrics)
  }

  if (depth === 1) {
    const targetLayout = resolveDepthLayout(0, layoutMetrics)
    const motion = previewDepthMotion(1)

    return {
      opacity: dragX.interpolate({
        inputRange: [-220, -132, 0, 132, 220],
        outputRange: [targetLayout.opacity, 0.996, layout.opacity, 0.996, targetLayout.opacity],
        extrapolate: 'clamp',
      }),
      transform: [
        {perspective: CARD_DRAG_PERSPECTIVE},
        {
          translateX: dragX.interpolate({
            inputRange: [-220, -132, 0, 132, 220],
            outputRange: [targetLayout.left, targetLayout.left - 6, layout.left, targetLayout.left - 6, targetLayout.left],
            extrapolate: 'clamp',
          }),
        },
        {
          translateY: dragX.interpolate({
            inputRange: [-220, -132, 0, 132, 220],
            outputRange: [targetLayout.top, targetLayout.top - 3, layout.top, targetLayout.top - 3, targetLayout.top],
            extrapolate: 'clamp',
          }),
        },
        {
          translateY: dragY.interpolate({
            inputRange: [-220, 0, 220],
            outputRange: [-12, 0, 14],
            extrapolate: 'clamp',
          }),
        },
        {
          rotate: dragX.interpolate({
            inputRange: [-220, -132, 0, 132, 220],
            outputRange: ['0deg', '-1.8deg', layout.rotate, '-1.8deg', '0deg'],
            extrapolate: 'clamp',
          }),
        },
        {
          rotateY: dragX.interpolate({
            inputRange: [-220, -132, 0, 132, 220],
            outputRange: ['0deg', `${motion.rotateY * 0.34}deg`, '0deg', `-${motion.rotateY * 0.34}deg`, '0deg'],
            extrapolate: 'clamp',
          }),
        },
        {
          rotateX: dragY.interpolate({
            inputRange: [-220, 0, 220],
            outputRange: [`-${motion.rotateX * 0.72}deg`, '0deg', `${motion.rotateX * 0.72}deg`],
            extrapolate: 'clamp',
          }),
        },
        {
          scale: dragX.interpolate({
            inputRange: [-220, -132, 0, 132, 220],
            outputRange: [targetLayout.scale, 1.016, layout.scale, 1.016, targetLayout.scale],
            extrapolate: 'clamp',
          }),
        },
      ],
    }
  }

  const motion = previewDepthMotion(depth)
  return {
    opacity: layout.opacity,
    transform: [
      {
        translateX: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [layout.left - motion.shiftX * 0.72, layout.left, layout.left - motion.shiftX * 0.72],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [layout.top - motion.shiftY * 0.72, layout.top, layout.top - motion.shiftY * 0.72],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-5, 0, 7],
          extrapolate: 'clamp',
        }),
      },
      {rotate: layout.rotate},
      {
        scale: dragX.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: [
            layout.scale + motion.scaleBoost * 0.44,
            layout.scale + motion.scaleBoost * 0.2,
            layout.scale,
            layout.scale + motion.scaleBoost * 0.2,
            layout.scale + motion.scaleBoost * 0.44,
          ],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildDraggableCardStyle(
  dragX: Animated.Value,
  dragY: Animated.Value,
  layoutMetrics?: DeckLayoutMetrics,
) {
  const layout = resolveDepthLayout(0, layoutMetrics)

  return {
    opacity: layout.opacity,
    transform: [
      {perspective: CARD_DRAG_PERSPECTIVE},
      {translateX: layout.left},
      {translateY: layout.top},
      {translateX: dragX},
      {
        translateY: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-48, 0, 48],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-22, 0, -22],
          extrapolate: 'clamp',
        }),
      },
      {
        rotate: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: ['-7deg', '0deg', '7deg'],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateY: dragX.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: ['22deg', '12deg', '0deg', '-12deg', '-22deg'],
          extrapolate: 'clamp',
        }),
      },
      {
        rotateX: dragY.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: ['-18deg', '-10deg', '0deg', '10deg', '18deg'],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: dragX.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: [0.948, 0.978, 1, 0.978, 0.948],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [0.958, 1, 0.958],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildTopCardTextureStyle(dragX: Animated.Value, dragY: Animated.Value) {
  return {
    transform: [
      {
        translateX: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [18, 0, -18],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-14, 0, 14],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [1.05, 1, 1.05],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildTopCardContentStyle(dragX: Animated.Value, dragY: Animated.Value) {
  return {
    transform: [
      {
        translateX: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [14, 0, -14],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-5, 0, -5],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-16, 0, 16],
          extrapolate: 'clamp',
        }),
      },
      {
        scale: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [1.02, 1, 1.02],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildGroundShadowStyle(dragX: Animated.Value, dragY: Animated.Value) {
  return {
    opacity: dragX.interpolate({
      inputRange: [-220, -120, 0, 120, 220],
      outputRange: [0.11, 0.13, 0.16, 0.13, 0.11],
      extrapolate: 'clamp',
    }),
    transform: [
      {
        translateX: dragX.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-18, 0, 18],
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: dragY.interpolate({
          inputRange: [-220, 0, 220],
          outputRange: [-10, 0, 12],
          extrapolate: 'clamp',
        }),
      },
      {
        scaleX: dragX.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: [1.12, 1.06, 1, 1.06, 1.12],
          extrapolate: 'clamp',
        }),
      },
      {
        scaleY: dragX.interpolate({
          inputRange: [-220, -120, 0, 120, 220],
          outputRange: [0.84, 0.9, 0.92, 0.9, 0.84],
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildTailExitCardStyle(
  progress: Animated.Value,
  releaseOffsetX = 0,
  releaseOffsetY = 0,
  layoutMetrics?: DeckLayoutMetrics,
) {
  const motion = resolveTailExitMotion(releaseOffsetX, releaseOffsetY, layoutMetrics)

  return {
    opacity: progress.interpolate({
      inputRange: [...TAIL_EXIT_INPUT_RANGE],
      outputRange: motion.opacity,
      extrapolate: 'clamp',
    }),
    transform: [
      {perspective: CARD_DRAG_PERSPECTIVE},
      {
        translateX: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.translateX,
          extrapolate: 'clamp',
        }),
      },
      {
        translateY: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.translateY,
          extrapolate: 'clamp',
        }),
      },
      {
        rotate: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.rotate,
          extrapolate: 'clamp',
        }),
      },
      {
        rotateY: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.rotateY,
          extrapolate: 'clamp',
        }),
      },
      {
        rotateX: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.rotateX,
          extrapolate: 'clamp',
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [...TAIL_EXIT_INPUT_RANGE],
          outputRange: motion.scale,
          extrapolate: 'clamp',
        }),
      },
    ],
  }
}

export function buildTailExitShadowStyle(progress: Animated.Value, releaseOffsetX = 0, releaseOffsetY = 0) {
  const startTranslateX = clamp(releaseOffsetX * 0.12, -24, 24)
  const startTranslateY =
    interpolateNumber(releaseOffsetY, [-220, 0, 220], [-10, 0, 12]) +
    interpolateNumber(releaseOffsetX, [-220, 0, 220], [-6, 0, -6])
  const startScaleX = clamp(1 + Math.abs(releaseOffsetX) / 1400, 1, 1.16)
  const startScaleY = clamp(1 - Math.abs(releaseOffsetX) / 3600, 0.92, 1)
  const startOpacity = clamp(0.18 - (Math.abs(releaseOffsetY) / 2200), 0.1, 0.18)

  return {
    opacity: progress.interpolate({
      inputRange: [0, 0.18, 0.52, 1],
      outputRange: [startOpacity, 0.08, 0.13, 0.16],
    }),
    transform: [
      {
        translateX: progress.interpolate({
          inputRange: [0, 0.2, 0.6, 1],
          outputRange: [startTranslateX, startTranslateX * 0.35, 2, 0],
        }),
      },
      {
        translateY: progress.interpolate({
          inputRange: [0, 0.22, 0.62, 1],
          outputRange: [startTranslateY, 8, 2, 0],
        }),
      },
      {
        scaleX: progress.interpolate({
          inputRange: [0, 0.18, 0.62, 1],
          outputRange: [startScaleX, 0.88, 1.03, 1],
        }),
      },
      {
        scaleY: progress.interpolate({
          inputRange: [0, 0.18, 0.62, 1],
          outputRange: [startScaleY, 0.82, 0.96, 0.92],
        }),
      },
    ],
  }
}

export function buildTailAdvanceCardStyle(
  progress: Animated.Value,
  depth: DepthKey,
  releaseOffsetX = 0,
  releaseOffsetY = 0,
  layoutMetrics?: DeckLayoutMetrics,
) {
  const target = resolveDepthLayout(depth, layoutMetrics)
  const start =
    depth === 4
      ? {
          left: resolveDepthLayout(5, layoutMetrics).left,
          top: resolveDepthLayout(5, layoutMetrics).top,
          rotate: resolveDepthLayout(5, layoutMetrics).rotate,
          rotateX: '0deg',
          rotateY: '0deg',
          scale: resolveDepthLayout(5, layoutMetrics).scale,
          opacity: resolveDepthLayout(5, layoutMetrics).opacity,
        }
      : getPreviewPose((depth + 1) as DepthKey, releaseOffsetX, releaseOffsetY, layoutMetrics)

  return {
    opacity: progress.interpolate({
      inputRange: [0, 1],
      outputRange: [start.opacity, target.opacity],
      extrapolate: 'clamp',
    }),
    transform: [
      {perspective: CARD_DRAG_PERSPECTIVE},
      {
        translateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.left, target.left],
        }),
      },
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.top, target.top],
        }),
      },
      {
        rotate: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.rotate, target.rotate],
        }),
      },
      {
        rotateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.rotateY, '0deg'],
        }),
      },
      {
        rotateX: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.rotateX, '0deg'],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [start.scale, target.scale],
        }),
      },
    ],
  }
}

export function buildTailPreviewStyle(
  depth: DepthKey,
  releaseOffsetX = 0,
  releaseOffsetY = 0,
  layoutMetrics?: DeckLayoutMetrics,
) {
  const startingPose = getPreviewPose(depth, releaseOffsetX, releaseOffsetY, layoutMetrics)
  const target = resolveDepthLayout(depth, layoutMetrics)

  return {
    opacity: target.opacity,
    transform: [
      {perspective: CARD_DRAG_PERSPECTIVE},
      {translateX: startingPose.left},
      {translateY: startingPose.top},
      {rotate: startingPose.rotate},
      {rotateY: startingPose.rotateY},
      {rotateX: startingPose.rotateX},
      {scale: startingPose.scale},
    ],
  }
}
