import {type CardReleasePose, type DeckLayoutMetrics, clamp, formatDeg, getDraggablePose, interpolateNumber, resolveDepthLayout} from './shared'

export const TAIL_EXIT_INPUT_RANGE = [0, 0.18, 0.54, 1] as const

export interface TailExitMotion {
  opacity: [number, number, number, number]
  rotate: [string, string, string, string]
  rotateX: [string, string, string, string]
  rotateY: [string, string, string, string]
  scale: [number, number, number, number]
  translateX: [number, number, number, number]
  translateY: [number, number, number, number]
}

export interface TailExitPose extends CardReleasePose {
  opacity: number
}

function parseDegrees(value: string) {
  return Number.parseFloat(value.replace('deg', '')) || 0
}

function interpolateDegrees(value: number, outputRange: [string, string, string, string]) {
  const numericOutputRange = outputRange.map(parseDegrees)
  return formatDeg(interpolateNumber(value, [...TAIL_EXIT_INPUT_RANGE], numericOutputRange))
}

export function resolveTailExitMotion(
  releaseOffsetX = 0,
  releaseOffsetY = 0,
  layoutMetrics?: DeckLayoutMetrics,
): TailExitMotion {
  const from = resolveDepthLayout(0, layoutMetrics)
  const startingPose = getDraggablePose(releaseOffsetX, releaseOffsetY, layoutMetrics)
  const exitDirection = releaseOffsetX === 0 ? -1 : Math.sign(releaseOffsetX)
  const exitTravelX = clamp(Math.abs(releaseOffsetX) + 360, 360, 560)
  const exitRotateValue = clamp((releaseOffsetX || exitDirection * 88) / 15, -11, 11)
  const exitRotate = formatDeg(exitRotateValue)
  const exitRotateYValue = -exitDirection * 11
  const exitRotateXValue = clamp(-releaseOffsetY / 12, -6, 6)

  return {
    translateX: [
      startingPose.left,
      startingPose.left + (exitDirection * exitTravelX * 0.42),
      startingPose.left + (exitDirection * exitTravelX * 0.76),
      startingPose.left + (exitDirection * exitTravelX),
    ],
    translateY: [
      startingPose.top,
      startingPose.top + 6,
      startingPose.top + 14,
      startingPose.top + 20,
    ],
    rotate: [
      startingPose.rotate,
      exitRotate,
      exitRotate,
      formatDeg(exitRotateValue * 0.72),
    ],
    rotateY: [
      startingPose.rotateY,
      formatDeg(exitRotateYValue),
      formatDeg(exitRotateYValue * 0.55),
      '0deg',
    ],
    rotateX: [
      startingPose.rotateX,
      formatDeg(exitRotateXValue),
      formatDeg(exitRotateXValue * 0.35),
      '0deg',
    ],
    scale: [startingPose.scale, 0.95, 0.78, 0.58],
    opacity: [from.opacity, from.opacity * 0.96, 0.34, 0],
  }
}

export function getTailExitPose(
  progress: number,
  releaseOffsetX = 0,
  releaseOffsetY = 0,
  layoutMetrics?: DeckLayoutMetrics,
): TailExitPose {
  const motion = resolveTailExitMotion(releaseOffsetX, releaseOffsetY, layoutMetrics)

  return {
    left: interpolateNumber(progress, [...TAIL_EXIT_INPUT_RANGE], motion.translateX),
    top: interpolateNumber(progress, [...TAIL_EXIT_INPUT_RANGE], motion.translateY),
    rotate: interpolateDegrees(progress, motion.rotate),
    rotateY: interpolateDegrees(progress, motion.rotateY),
    rotateX: interpolateDegrees(progress, motion.rotateX),
    scale: interpolateNumber(progress, [...TAIL_EXIT_INPUT_RANGE], motion.scale),
    opacity: interpolateNumber(progress, [...TAIL_EXIT_INPUT_RANGE], motion.opacity),
  }
}
