import type {CardTone} from './palette'

export interface HomeCardItem {
  id: string
  company: string
  indexLabel: string
  location: string
  role: string
  dateLabel: string
  score: number
  primaryColor: string
  surfaceColor: string
  stackColor: string
  logoColor: string
  borderColor: string
  tone: CardTone
  strategyBody: string
}

export interface HomeCardDeckProps {
  cards: HomeCardItem[]
  initialIndex?: number
  enteringCardId?: string | null
  returningCardId?: string | null
  isCreateMode?: boolean
  onCreateCardPress?: () => void
  onCardPress?: (card: HomeCardItem) => void | Promise<void>
  onCardChange?: (card: HomeCardItem, index: number) => void
  onFirstInteraction?: () => void
}

export type DepthKey = 0 | 1 | 2 | 3 | 4

export interface RenderCardModel {
  key: string
  item: HomeCardItem
  depth: DepthKey
}

export interface CardReleasePose {
  left: number
  top: number
  rotate: string
  rotateX: string
  rotateY: string
  scale: number
  opacity: number
}

export interface TailExitCard {
  key: string
  item: HomeCardItem
  releaseOffsetX: number
  releaseOffsetY: number
}

export interface DeckLayout {
  left: number
  top: number
  rotate: string
  scale: number
  opacity: number
}

export interface DeckLayoutMetrics {
  containerWidth: number
  hiddenStep: number
  layouts: Record<DepthKey | 5, DeckLayout>
  shadowLeft: number
  shadowWidth: number
  spread: number
  visibleCount: number
}

export const CARD_WIDTH = 218
export const CARD_HEIGHT = 337
export const SCORE_PANEL_HEIGHT = 80
export const INDEX_ITEM_HEIGHT = 24
export const INDEX_LINE_HEIGHT = 2
export const RAIL_BUBBLE_HEIGHT = 28
export const VISIBLE_CARDS = 5
export const SWIPE_TRIGGER_DISTANCE = 44
export const SWIPE_TRIGGER_VELOCITY = 0.28
export const CARD_DRAG_PERSPECTIVE = 1280
export const TAIL_EXIT_DURATION = 280
export const DEFAULT_DECK_WIDTH = 346
export const DEFAULT_DECK_SIDE_PADDING = 47

const INDEX_RAIL_WIDTH = 22
const STACK_RIGHT_GAP = 10
const MAX_STACK_SPREAD = 96
const MIN_HIDDEN_STEP = 12

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000
}

export function resolveDeckWidth(viewportWidth: number) {
  return Math.max(CARD_WIDTH + INDEX_RAIL_WIDTH + 32, viewportWidth - DEFAULT_DECK_SIDE_PADDING)
}

export function createDeckLayoutMetrics(
  visibleCount: number,
  containerWidth = DEFAULT_DECK_WIDTH,
): DeckLayoutMetrics {
  const resolvedVisibleCount = Math.max(1, Math.min(VISIBLE_CARDS, visibleCount))
  const availableSpread = Math.max(0, containerWidth - CARD_WIDTH - INDEX_RAIL_WIDTH - STACK_RIGHT_GAP)
  const spread = Math.min(MAX_STACK_SPREAD, availableSpread)
  const actualStep = resolvedVisibleCount > 1 ? spread / (resolvedVisibleCount - 1) : 0
  const hiddenStep = Math.max(MIN_HIDDEN_STEP, actualStep > 0 ? actualStep * 0.42 : 16)
  const verticalStep = Math.max(4, Math.min(6.5, (actualStep || hiddenStep) * 0.16))
  const rotateStep = resolvedVisibleCount > 1 ? 18.5 / (resolvedVisibleCount - 1) : 0
  const hiddenRotateStep = Math.max(3.5, rotateStep > 0 ? rotateStep * 0.72 : 4.5)
  const scaleStep = resolvedVisibleCount > 1 ? 0.032 / (resolvedVisibleCount - 1) : 0
  const hiddenScaleStep = Math.max(0.006, scaleStep > 0 ? scaleStep * 0.72 : 0.008)
  const opacityStep = resolvedVisibleCount > 1 ? 0.032 / (resolvedVisibleCount - 1) : 0
  const hiddenOpacityStep = Math.max(0.006, opacityStep > 0 ? opacityStep * 0.72 : 0.008)
  const layouts = {} as Record<DepthKey | 5, DeckLayout>

  let lastVisibleLeft = 0
  let lastVisibleTop = 0
  let lastVisibleRotate = 0
  let lastVisibleScale = 1
  let lastVisibleOpacity = 1

  for (let depth = 0; depth <= 4; depth += 1) {
    const isVisibleDepth = depth < resolvedVisibleCount
    const left = isVisibleDepth
      ? actualStep * depth
      : lastVisibleLeft + (hiddenStep * (depth - (resolvedVisibleCount - 1)))
    const top = isVisibleDepth
      ? depth === 0
        ? -10
        : verticalStep * depth
      : lastVisibleTop + (3 * (depth - (resolvedVisibleCount - 1)))
    const rotate = isVisibleDepth
      ? rotateStep * depth
      : lastVisibleRotate + (hiddenRotateStep * (depth - (resolvedVisibleCount - 1)))
    const scale = isVisibleDepth
      ? 1 - (scaleStep * depth)
      : lastVisibleScale - (hiddenScaleStep * (depth - (resolvedVisibleCount - 1)))
    const opacity = isVisibleDepth
      ? 1 - (opacityStep * depth)
      : Math.max(0, lastVisibleOpacity - (hiddenOpacityStep * (depth - (resolvedVisibleCount - 1))))

    layouts[depth as DepthKey] = {
      left: roundMetric(Math.max(0, left)),
      top: roundMetric(Math.max(0, top)),
      rotate: `${roundMetric(Math.max(0, rotate))}deg`,
      scale: roundMetric(Math.max(0.9, scale)),
      opacity: roundMetric(Math.max(0.94, opacity)),
    }

    if (isVisibleDepth) {
      lastVisibleLeft = left
      lastVisibleTop = top
      lastVisibleRotate = rotate
      lastVisibleScale = scale
      lastVisibleOpacity = opacity
    }
  }

  layouts[5] = {
    left: roundMetric(lastVisibleLeft + hiddenStep),
    top: roundMetric(lastVisibleTop + 4),
    rotate: `${roundMetric(lastVisibleRotate + hiddenRotateStep)}deg`,
    scale: roundMetric(Math.max(0.9, lastVisibleScale - hiddenScaleStep)),
    opacity: 0,
  }

  const lastVisibleDepth = Math.max(0, resolvedVisibleCount - 1) as DepthKey
  const shadowWidth = clamp(CARD_WIDTH - 24 + (layouts[lastVisibleDepth].left * 0.28), 178, Math.max(178, containerWidth - 42))
  const shadowLeft = clamp(
    ((CARD_WIDTH + layouts[lastVisibleDepth].left) - shadowWidth) / 2,
    18,
    Math.max(18, containerWidth - INDEX_RAIL_WIDTH - shadowWidth),
  )

  return {
    containerWidth,
    hiddenStep,
    layouts,
    shadowLeft: roundMetric(shadowLeft),
    shadowWidth: roundMetric(shadowWidth),
    spread: roundMetric(spread),
    visibleCount: resolvedVisibleCount,
  }
}

export const DEPTH_LAYOUTS = createDeckLayoutMetrics(VISIBLE_CARDS, DEFAULT_DECK_WIDTH).layouts

export function resolveDepthLayout(depth: DepthKey | 5, layoutMetrics?: DeckLayoutMetrics) {
  return layoutMetrics?.layouts[depth] ?? DEPTH_LAYOUTS[depth]
}

const DIM_OPACITY: Record<DepthKey, number> = {
  0: 0,
  1: 0.015,
  2: 0.035,
  3: 0.055,
  4: 0.075,
}

const TEXT_OPACITY: Record<DepthKey, number> = {
  0: 1,
  1: 0.96,
  2: 0.88,
  3: 0.76,
  4: 0.62,
}

export function modulo(index: number, length: number) {
  return ((index % length) + length) % length
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function interpolateNumber(value: number, inputRange: number[], outputRange: number[]) {
  if (inputRange.length !== outputRange.length || inputRange.length === 0) {
    throw new Error('inputRange and outputRange must have the same non-zero length')
  }

  if (value <= inputRange[0]) {
    return outputRange[0]
  }

  for (let index = 1; index < inputRange.length; index += 1) {
    if (value <= inputRange[index]) {
      const inputStart = inputRange[index - 1]
      const inputEnd = inputRange[index]
      const outputStart = outputRange[index - 1]
      const outputEnd = outputRange[index]
      const progress = (value - inputStart) / (inputEnd - inputStart)
      return outputStart + ((outputEnd - outputStart) * progress)
    }
  }

  return outputRange[outputRange.length - 1]
}

export function formatDeg(value: number) {
  return `${value}deg`
}

export function previewDepthMotion(depth: DepthKey) {
  return {
    shiftX: depth === 1 ? 30 : depth === 2 ? 18 : depth === 3 ? 12 : 7,
    shiftY: depth === 1 ? 20 : depth === 2 ? 12 : depth === 3 ? 8 : 5,
    scaleBoost: depth === 1 ? 0.068 : depth === 2 ? 0.026 : depth === 3 ? 0.016 : 0.01,
    rotateY: depth === 1 ? 11 : depth === 2 ? 5.5 : depth === 3 ? 4 : 3,
    rotateX: depth === 1 ? 7 : depth === 2 ? 4 : depth === 3 ? 2.5 : 2,
  }
}

export function getPreviewPose(
  depth: DepthKey,
  releaseOffsetX: number,
  releaseOffsetY: number,
  layoutMetrics?: DeckLayoutMetrics,
): CardReleasePose {
  const layout = resolveDepthLayout(depth, layoutMetrics)

  if (depth === 0) {
    return {
      left: layout.left,
      top: layout.top,
      rotate: layout.rotate,
      rotateX: '0deg',
      rotateY: '0deg',
      scale: layout.scale,
      opacity: layout.opacity,
    }
  }

  const clampedX = clamp(releaseOffsetX, -220, 220)
  const clampedY = clamp(releaseOffsetY, -220, 220)

  if (depth === 1) {
    const target = resolveDepthLayout(0, layoutMetrics)
    const motion = previewDepthMotion(1)
    const rotateY = motion.rotateY * 0.34
    const rotateX = motion.rotateX * 0.72
    const rotate = parseFloat(layout.rotate)

    return {
      left: interpolateNumber(
        clampedX,
        [-220, -132, 0, 132, 220],
        [target.left, target.left - 6, layout.left, target.left - 6, target.left],
      ),
      top:
        interpolateNumber(
          clampedX,
          [-220, -132, 0, 132, 220],
          [target.top, target.top - 3, layout.top, target.top - 3, target.top],
        ) + interpolateNumber(clampedY, [-220, 0, 220], [-12, 0, 14]),
      rotate: formatDeg(interpolateNumber(clampedX, [-220, -132, 0, 132, 220], [0, -1.8, rotate, -1.8, 0])),
      rotateY: formatDeg(interpolateNumber(clampedX, [-220, -132, 0, 132, 220], [0, rotateY, 0, -rotateY, 0])),
      rotateX: formatDeg(interpolateNumber(clampedY, [-220, 0, 220], [-rotateX, 0, rotateX])),
      scale: interpolateNumber(clampedX, [-220, -132, 0, 132, 220], [target.scale, 1.016, layout.scale, 1.016, target.scale]),
      opacity: interpolateNumber(clampedX, [-220, -132, 0, 132, 220], [target.opacity, 0.996, layout.opacity, 0.996, target.opacity]),
    }
  }

  const motion = previewDepthMotion(depth)

  return {
    left: interpolateNumber(
      clampedX,
      [-220, 0, 220],
      [layout.left - motion.shiftX * 0.72, layout.left, layout.left - motion.shiftX * 0.72],
    ),
    top:
      interpolateNumber(
        clampedX,
        [-220, 0, 220],
        [layout.top - motion.shiftY * 0.72, layout.top, layout.top - motion.shiftY * 0.72],
      ) + interpolateNumber(clampedY, [-220, 0, 220], [-5, 0, 7]),
    rotate: layout.rotate,
    rotateY: '0deg',
    rotateX: '0deg',
    scale: interpolateNumber(
      clampedX,
      [-220, -120, 0, 120, 220],
      [
        layout.scale + motion.scaleBoost * 0.44,
        layout.scale + motion.scaleBoost * 0.2,
        layout.scale,
        layout.scale + motion.scaleBoost * 0.2,
        layout.scale + motion.scaleBoost * 0.44,
      ],
    ),
    opacity: layout.opacity,
  }
}

export function getDraggablePose(
  releaseOffsetX: number,
  releaseOffsetY: number,
  layoutMetrics?: DeckLayoutMetrics,
): CardReleasePose {
  const layout = resolveDepthLayout(0, layoutMetrics)
  const clampedX = clamp(releaseOffsetX, -220, 220)
  const clampedY = clamp(releaseOffsetY, -220, 220)
  const scaleX = interpolateNumber(clampedX, [-220, -120, 0, 120, 220], [0.948, 0.978, 1, 0.978, 0.948])
  const scaleY = interpolateNumber(clampedY, [-220, 0, 220], [0.958, 1, 0.958])

  return {
    left: layout.left + clampedX,
    top:
      layout.top +
      interpolateNumber(clampedY, [-220, 0, 220], [-48, 0, 48]) +
      interpolateNumber(clampedX, [-220, 0, 220], [-22, 0, -22]),
    rotate: formatDeg(interpolateNumber(clampedX, [-220, 0, 220], [-7, 0, 7])),
    rotateY: formatDeg(interpolateNumber(clampedX, [-220, -120, 0, 120, 220], [22, 12, 0, -12, -22])),
    rotateX: formatDeg(interpolateNumber(clampedY, [-220, -120, 0, 120, 220], [-18, -10, 0, 10, 18])),
    scale: clamp(scaleX * scaleY, 0.9, 1),
    opacity: layout.opacity,
  }
}

export function buildRenderModels(cards: HomeCardItem[], activeIndex: number, visibleCount: number): RenderCardModel[] {
  if (cards.length === 0) {
    return []
  }

  return new Array(visibleCount).fill(null).map((_, offset) => {
    const index = modulo(activeIndex + offset, cards.length)
    return {
      key: `card-${cards[index].id}`,
      item: cards[index],
      depth: offset as DepthKey,
    }
  })
}

export function contentOpacityForDepth(depth: DepthKey) {
  return TEXT_OPACITY[depth]
}

export function overlayOpacityForDepth(depth: DepthKey) {
  return DIM_OPACITY[depth]
}

export function backgroundColorForDepth(item: HomeCardItem, depth: DepthKey) {
  return depth <= 1 ? item.surfaceColor : item.stackColor
}

export function resolveCardLayer(depth: DepthKey) {
  return 60 - depth
}

export function resolveCardElevation(depth: DepthKey) {
  return Math.max(2, 8 - depth)
}
