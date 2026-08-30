/// <reference lib="dom" />
export const H5_RAIL_ITEM_HEIGHT = 58
export const H5_RAIL_HEIGHT = 406
export const H5_RAIL_BUFFER_COUNT = 8
export const H5_RAIL_ANIMATION_MS = 180
export const H5_RAIL_MINOR_MARK_COUNT = 5
export const H5_CARD_DESIGN_WIDTH = 210
export const H5_CARD_DESIGN_HEIGHT = 332
export const H5_CARD_SWIPE_DISTANCE = 44
export const H5_CARD_SWIPE_VELOCITY = 0.28
export const H5_CARD_EXIT_DURATION_MS = 420
export const H5_CARD_DRAG_MAX = 220

export type H5DeckDragPhase = 'idle' | 'dragging' | 'settling' | 'exiting'

export type H5DeckDragState = {
  x: number
  y: number
  phase: H5DeckDragPhase
}

export type H5DeckCardSnapshot = {
  transform: string
}

export function getViewportSize() {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null
  const documentElement = typeof document !== 'undefined' ? document.documentElement : null

  return {
    width: viewport?.width || documentElement?.clientWidth || 393,
    height: viewport?.height || documentElement?.clientHeight || 852,
  }
}

export type H5CardScaleOptions = {
  amplification?: number
}

export function resolveH5CardScale({amplification = 1.33}: H5CardScaleOptions = {}) {
  const {width, height} = getViewportSize()
  const pagePadX = Math.min(Math.max(width * 0.076, 24), 31)
  const deckWidth = Math.min(width - pagePadX * 1.48, 346)
  const availableHeight = height - 456
  const widthScale = (deckWidth * 0.72) / H5_CARD_DESIGN_WIDTH
  const heightScale = availableHeight / H5_CARD_DESIGN_HEIGHT
  const maxScale = width >= 768 ? 0.98 : 0.88
  const baseScale = Math.max(0.72, Math.min(widthScale, heightScale, maxScale))

  return Math.min(baseScale * amplification, width >= 768 ? 1.18 : 1.08)
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function modulo(value: number, length: number) {
  return ((value % length) + length) % length
}

export function interpolateClamped(value: number, input: [number, number, number], output: [number, number, number]) {
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

export function shouldAdvanceH5Deck(translationX: number, translationY: number, velocityX: number) {
  if (Math.abs(translationX) <= Math.abs(translationY) * 1.05) {
    return false
  }

  return (
    translationX < -H5_CARD_SWIPE_DISTANCE ||
    translationX > H5_CARD_SWIPE_DISTANCE ||
    velocityX < -H5_CARD_SWIPE_VELOCITY ||
    velocityX > H5_CARD_SWIPE_VELOCITY
  )
}

export function buildH5DeckDragVars(state: H5DeckDragState) {
  const dragMagnitude = Math.min(1, Math.abs(state.x) / H5_CARD_DRAG_MAX)

  return {
    '--card-drag-x': `${state.x}px`,
    '--card-drag-y': `${clamp(state.y, -H5_CARD_DRAG_MAX, H5_CARD_DRAG_MAX)}px`,
    '--card-drag-rotate': `${clamp(state.x / 31.4, -7, 7)}deg`,
    '--card-drag-rotate-y': `${clamp(-state.x / 10, -22, 22)}deg`,
    '--card-drag-rotate-x': `${clamp(state.y / 12.2, -18, 18)}deg`,
    '--card-drag-scale-x': String(1 - dragMagnitude * 0.052),
    '--card-drag-scale-y': String(1 - Math.min(1, Math.abs(state.y) / H5_CARD_DRAG_MAX) * 0.042),
    '--card-drag-lift-y': `${-Math.abs(state.x) * 0.1}px`,
    '--card-preview-progress': String(dragMagnitude),
  }
}

export function resolveH5DeckDragPresentation(state: H5DeckDragState, cardScale: number) {
  const magnitude = Math.min(1, Math.hypot(state.x, state.y) / H5_CARD_DRAG_MAX)
  const highlightDx = -state.x
  const highlightDy = -state.y
  const highlightAngle = Math.round((Math.atan2(highlightDy, highlightDx || 0.01) * 180) / Math.PI + 90)
  const highlightX = interpolateClamped(highlightDx, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [14, 50, 86])
  const highlightY = interpolateClamped(highlightDy, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [12, 50, 88])
  const verticalDrag = interpolateClamped(state.y, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [-48, 0, 48])
  const horizontalLift = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [-22, 0, -22])
  const textureX = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [18, 0, -18])
  const textureY = interpolateClamped(state.y, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [-14, 0, 14])
  const textureScale = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [1.05, 1, 1.05])
  const contentX = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [14, 0, -14])
  const contentLift = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [-5, 0, -5])
  const contentY = interpolateClamped(state.y, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [-16, 0, 16])
  const contentScale = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [1.02, 1, 1.02])
  const scaleX = interpolateClamped(state.x, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [0.948, 1, 0.948])
  const scaleY = interpolateClamped(state.y, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [0.958, 1, 0.958])
  const shadowOpacity = interpolateClamped(Math.abs(state.x), [0, 120, H5_CARD_DRAG_MAX], [0.16, 0.13, 0.11])
  const shadowBlur = interpolateClamped(Math.abs(state.x), [0, 120, H5_CARD_DRAG_MAX], [18, 20, 23])
  const shadowY = interpolateClamped(state.y, [-H5_CARD_DRAG_MAX, 0, H5_CARD_DRAG_MAX], [7, 12, 24])

  return {
    classState: state.phase,
    cssVars: {
      '--card-drag-x': `${state.x}px`,
      '--card-drag-y': `${verticalDrag}px`,
      '--card-drag-rotate': `${clamp(state.x / 31.4, -7, 7)}deg`,
      '--card-drag-rotate-y': `${clamp(-state.x / 10, -22, 22)}deg`,
      '--card-drag-rotate-x': `${clamp(state.y / 12.2, -18, 18)}deg`,
      '--card-drag-scale-x': String(scaleX),
      '--card-drag-scale-y': String(scaleY),
      '--card-drag-lift-y': `${horizontalLift}px`,
      '--card-preview-progress': String(magnitude),
      '--card-texture-x': `${textureX}px`,
      '--card-texture-y': `${textureY}px`,
      '--card-texture-scale': String(textureScale),
      '--card-content-x': `${contentX}px`,
      '--card-content-y': `${contentLift + contentY}px`,
      '--card-content-scale': String(contentScale),
    },
    activeCard: {
      highlightStrength: 0.26 + magnitude * 1.05,
      highlightAngle: `${highlightAngle}deg`,
      highlightX: `${highlightX}%`,
      highlightY: `${highlightY}%`,
      filter: `drop-shadow(${clamp(state.x * 0.08, -18, 18)}px ${shadowY}px ${shadowBlur}px rgba(21, 30, 46, ${shadowOpacity}))`,
      transform: (cardLeft: string, cardTop: string) => [
        'perspective(1280px)',
        `translate3d(calc(${cardLeft} + ${state.x}px), calc(${cardTop} + ${verticalDrag + horizontalLift}px), 0)`,
        `rotate(${clamp(state.x / 31.4, -7, 7)}deg)`,
        `rotateY(${clamp(-state.x / 10, -22, 22)}deg)`,
        `rotateX(${clamp(state.y / 12.2, -18, 18)}deg)`,
        `scale(${cardScale * scaleX * scaleY})`,
      ].join(' '),
    },
  }
}
