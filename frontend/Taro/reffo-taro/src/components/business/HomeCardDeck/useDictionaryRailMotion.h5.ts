/// <reference lib="dom" />
import {useEffect, useMemo, useRef, useState} from 'react'
import {
  DICTIONARY_RAIL_MINOR_STEPS,
  buildDictionaryRailStops,
  clamp,
  exponentialApproach,
  majorIndexFromPosition,
  majorPosition,
  positionFromRatio,
  ratioFromPosition,
  rubberBand,
  smoothstep,
} from './dictionaryRailMath'
import {DictionaryRailFeedback} from './railFeedback.h5'

export interface DictionaryRailItem {
  id: string
  label: string
}

interface UseDictionaryRailMotionOptions {
  items: DictionaryRailItem[]
  activeIndex: number
  disabled?: boolean
  minorSteps?: number
  onActiveIndexChange?: (index: number) => void
  onFirstInteraction?: () => void
}

export interface DictionaryRailMotion {
  activeLabel: string
  isFineMode: boolean
  rootRef: React.RefObject<HTMLDivElement>
  trackRef: React.RefObject<HTMLDivElement>
  markerRef: React.RefObject<HTMLDivElement>
}

interface PointerDragState {
  pointerId: number
  startY: number
  startPosition: number
  moved: boolean
  touch: boolean
}

const EDGE_PADDING = 22
const LONG_PRESS_MOUSE_MS = 650
const LONG_PRESS_TOUCH_MS = 900
const FINE_STEP_PIXELS_MIN = 12
const FINE_STEP_PIXELS_MAX = 24

export default function useDictionaryRailMotion({
  items,
  activeIndex,
  disabled = false,
  minorSteps = DICTIONARY_RAIL_MINOR_STEPS,
  onActiveIndexChange,
  onFirstInteraction,
}: UseDictionaryRailMotionOptions): DictionaryRailMotion {
  const rootRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const feedbackRef = useRef<DictionaryRailFeedback | null>(null)
  const onActiveIndexChangeRef = useRef(onActiveIndexChange)
  const onFirstInteractionRef = useRef(onFirstInteraction)
  const activeIndexRef = useRef(activeIndex)
  const [isFineMode, setIsFineMode] = useState(false)
  const isFineModeRef = useRef(false)
  const visualRefs = useRef<{
    roots: HTMLElement[]
    ticks: HTMLElement[]
    labels: HTMLElement[]
  }>({roots: [], ticks: [], labels: []})
  const frameRef = useRef<number | null>(null)
  const syncExternalIndexRef = useRef<(index: number) => void>(() => undefined)
  const stops = useMemo(() => buildDictionaryRailStops(items.map(item => item.label), minorSteps), [items, minorSteps])
  const activeLabel = items[clamp(activeIndex, 0, Math.max(0, items.length - 1))]?.label ?? ''

  if (!feedbackRef.current) {
    feedbackRef.current = new DictionaryRailFeedback()
  }

  useEffect(() => {
    onActiveIndexChangeRef.current = onActiveIndexChange
  }, [onActiveIndexChange])

  useEffect(() => {
    onFirstInteractionRef.current = onFirstInteraction
  }, [onFirstInteraction])

  useEffect(() => {
    activeIndexRef.current = activeIndex
    syncExternalIndexRef.current?.(activeIndex)
  }, [activeIndex])

  useEffect(() => {
    return () => feedbackRef.current?.dispose()
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root) {
      return undefined
    }

    const reducedMotionQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null
    let reducedMotion = reducedMotionQuery?.matches ?? false
    let railHeight = root.clientHeight || 406
    let railTop = root.getBoundingClientRect().top
    let position = majorPosition(clamp(activeIndexRef.current, 0, Math.max(0, items.length - 1)), minorSteps)
    let targetPosition = position
    let hover = 0
    let hoverTarget = 0
    let fineAmount = 0
    let fineTarget = 0
    let pointerY: number | null = null
    let lastFrameAt = performance.now()
    let idleUntil = 0
    let drag: PointerDragState | null = null
    let longPressTimer: number | null = null
    let lastSoundStop = Math.round(position)

    const notifyFirstInteraction = () => {
      onFirstInteractionRef.current?.()
    }

    const collectVisualRefs = () => {
      visualRefs.current.roots = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-stop]'))
      visualRefs.current.ticks = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-tick]'))
      visualRefs.current.labels = Array.from(root.querySelectorAll<HTMLElement>('[data-rail-label]'))
    }

    const measure = () => {
      const rect = root.getBoundingClientRect()
      railHeight = rect.height || root.clientHeight || railHeight
      railTop = rect.top || railTop
      render()
    }

    const positionToY = (value: number) => {
      const usableHeight = Math.max(1, railHeight - EDGE_PADDING * 2)
      return EDGE_PADDING + ratioFromPosition(value, items.length, minorSteps) * usableHeight
    }

    const yToPosition = (clientY: number) => {
      const usableHeight = Math.max(1, railHeight - EDGE_PADDING * 2)
      return positionFromRatio((clientY - railTop - EDGE_PADDING) / usableHeight, items.length, minorSteps)
    }

    const setFineMode = (next: boolean) => {
      if (next === isFineModeRef.current) {
        return
      }
      isFineModeRef.current = next
      setIsFineMode(next)
      fineTarget = next ? 1 : 0
      idleUntil = performance.now() + 520
      ensureFrame()
    }

    const commitIndex = (nextIndex: number) => {
      const normalized = clamp(Math.round(nextIndex), 0, Math.max(0, items.length - 1))
      if (normalized !== activeIndexRef.current) {
        activeIndexRef.current = normalized
        onActiveIndexChangeRef.current?.(normalized)
      }
    }

    const playStopSound = (nextPosition: number, kind: 'step' | 'fine') => {
      const nextStop = Math.round(nextPosition)
      if (nextStop === lastSoundStop) {
        return
      }
      lastSoundStop = nextStop
      feedbackRef.current?.play(kind, kind === 'fine' ? 0.8 : 1)
    }

    const render = () => {
      if (!root.isConnected) {
        return
      }

      const markerY = positionToY(position)
      const hoverEase = smoothstep(hover)
      const fineEase = smoothstep(fineAmount)
      const edgePull = rubberBand(position, 0, (items.length - 1) * (minorSteps + 1), 1.2) - position
      const pointerLean = pointerY == null
        ? 0
        : clamp((pointerY - railTop - markerY) / Math.max(1, railHeight), -1, 1)
      root.classList.toggle('held', hoverTarget > 0 || drag != null)
      root.classList.toggle('fine', fineEase > 0.02)
      root.style.setProperty('--rail-hover', hoverEase.toFixed(3))
      root.style.setProperty('--rail-fine', fineEase.toFixed(3))
      root.style.setProperty('--rail-pull-x', `${(edgePull * 8 + hoverEase * 3 + pointerLean * 4).toFixed(2)}px`)

      if (markerRef.current) {
        markerRef.current.style.transform = `translate3d(${(edgePull * 7).toFixed(2)}px, ${markerY.toFixed(2)}px, 0) scale(${(1 + hoverEase * 0.08 + fineEase * 0.12).toFixed(3)})`
        markerRef.current.style.opacity = String(0.35 + hoverEase * 0.65)
      }

      if (visualRefs.current.roots.length !== stops.length) {
        collectVisualRefs()
      }

      stops.forEach((stop, index) => {
        const stopRoot = visualRefs.current.roots[index]
        const tick = visualRefs.current.ticks[index]
        const label = visualRefs.current.labels[index]
        if (!stopRoot || !tick || !label) {
          return
        }

        const distance = position - stop.position
        const proximity = Math.exp(-Math.pow(distance / (fineEase > 0.5 ? 1.8 : 2.6), 2))
        const activeStrength = Math.max(proximity, Math.abs(distance) < 0.45 ? 1 : 0)
        const isMajor = stop.kind === 'major'
        const tickLength = (isMajor ? 2.5 : 1.5) + proximity * (isMajor ? 8.5 : 5.5) + fineEase * (isMajor ? 1.5 : 3)
        const tickWidth = (isMajor ? 3 : 2) + proximity * (isMajor ? 3.5 : 1.5)
        const labelOpacity = isMajor
          ? Math.max(0.16, 0.16 + activeStrength * 0.84)
          : fineEase * proximity * 0.92
        const labelScale = 0.84 + activeStrength * 0.22 + fineEase * 0.08
        const pull = Math.sin(distance * 0.72) * hoverEase * 3.4 + pointerLean * 2.8
        stopRoot.style.transform = `translate3d(${pull.toFixed(2)}px, ${positionToY(stop.position).toFixed(2)}px, 0)`
        tick.style.width = `${tickWidth.toFixed(2)}px`
        tick.style.height = `${tickLength.toFixed(2)}px`
        tick.style.opacity = String(Math.max(isMajor ? 0.14 : 0.08, (isMajor ? 0.14 : 0.08) + proximity * (isMajor ? 0.86 : 0.7)))
        tick.style.background = activeStrength > 0.72
          ? 'var(--rail-hot, #ff9f0a)'
          : 'var(--rail-ink, #aeb2bf)'
        label.style.opacity = labelOpacity.toFixed(3)
        label.style.transform = `translate3d(0, 0, 0) scale(${labelScale.toFixed(3)})`
        label.classList.toggle('is-current', Math.abs(distance) < 0.45)
      })
    }

    const requestFrame = () => {
      if (frameRef.current != null) {
        return
      }
      frameRef.current = requestAnimationFrame(frame)
    }

    const ensureFrame = () => {
      idleUntil = performance.now() + 420
      requestFrame()
    }

    function frame(timestamp: number) {
      frameRef.current = null
      const elapsed = Math.min(64, Math.max(1, timestamp - lastFrameAt))
      lastFrameAt = timestamp

      if (reducedMotion) {
        position = targetPosition
        hover = hoverTarget
        fineAmount = fineTarget
      } else {
        position = exponentialApproach(position, targetPosition, elapsed, drag?.moved ? 32 : 58)
        hover = exponentialApproach(hover, hoverTarget, elapsed, 80)
        fineAmount = exponentialApproach(fineAmount, fineTarget, elapsed, 110)
      }

      render()
      const activeMajor = majorIndexFromPosition(position, items.length, minorSteps)
      if (activeMajor !== activeIndexRef.current) {
        commitIndex(activeMajor)
      }

      const moving = Math.abs(position - targetPosition) > 0.001
        || Math.abs(hover - hoverTarget) > 0.001
        || Math.abs(fineAmount - fineTarget) > 0.001
        || performance.now() < idleUntil
        || drag != null
        || hoverTarget > 0
      if (moving) {
        requestFrame()
      }
    }

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const enterFineMode = () => {
      if (!drag || disabled) {
        return
      }
      setFineMode(true)
      targetPosition = Math.round(targetPosition)
      feedbackRef.current?.play('fine')
      ensureFrame()
    }

    const updateDragPosition = (clientY: number) => {
      if (!drag) {
        return
      }
      const deltaY = clientY - drag.startY
      if (Math.abs(deltaY) > 6) {
        drag.moved = true
        clearLongPress()
      }

      if (!drag.moved) {
        return
      }

      if (isFineModeRef.current) {
        const finePixels = clamp(railHeight / Math.max(1, (items.length - 1) * (minorSteps + 1)), FINE_STEP_PIXELS_MIN, FINE_STEP_PIXELS_MAX)
        targetPosition = rubberBand(drag.startPosition + deltaY / finePixels, 0, (items.length - 1) * (minorSteps + 1), 1.8)
        playStopSound(targetPosition, 'fine')
      } else {
        const majorPixels = Math.max(32, railHeight / Math.max(1, items.length))
        const nextIndex = majorIndexFromPosition(drag.startPosition + deltaY / majorPixels * (minorSteps + 1), items.length, minorSteps)
        targetPosition = majorPosition(nextIndex, minorSteps)
        playStopSound(targetPosition, 'step')
        commitIndex(nextIndex)
      }
      ensureFrame()
    }

    const handlePointerEnter = (event: PointerEvent) => {
      hoverTarget = 1
      pointerY = event.clientY
      ensureFrame()
    }

    const handlePointerMove = (event: PointerEvent) => {
      pointerY = event.clientY
      if (drag && drag.pointerId === event.pointerId) {
        updateDragPosition(event.clientY)
      } else {
        hoverTarget = 1
        ensureFrame()
      }
    }

    const handlePointerLeave = () => {
      if (!drag) {
        hoverTarget = 0
        pointerY = null
        ensureFrame()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (disabled || (event.button != null && event.button !== 0)) {
        return
      }
      event.preventDefault()
      notifyFirstInteraction()
      feedbackRef.current?.unlock()
      hoverTarget = 1
      pointerY = event.clientY
      drag = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startPosition: position,
        moved: false,
        touch: event.pointerType === 'touch',
      }
      try {
        root.setPointerCapture?.(event.pointerId)
      } catch {
      }
      clearLongPress()
      longPressTimer = window.setTimeout(enterFineMode, drag.touch ? LONG_PRESS_TOUCH_MS : LONG_PRESS_MOUSE_MS)
      ensureFrame()
    }

    const finishDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) {
        return
      }
      clearLongPress()
      const wasFine = isFineModeRef.current
      if (wasFine) {
        feedbackRef.current?.play('close')
      }
      setFineMode(false)
      targetPosition = drag.moved
        ? majorPosition(majorIndexFromPosition(targetPosition, items.length, minorSteps), minorSteps)
        : majorPosition(majorIndexFromPosition(yToPosition(event.clientY), items.length, minorSteps), minorSteps)
      commitIndex(majorIndexFromPosition(targetPosition, items.length, minorSteps))
      try {
        root.releasePointerCapture?.(event.pointerId)
      } catch {
      }
      drag = null
      hoverTarget = root.matches(':hover') ? 1 : 0
      ensureFrame()
    }

    const handleWheel = (event: WheelEvent) => {
      if (disabled || Math.abs(event.deltaY) < 4) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      notifyFirstInteraction()
      feedbackRef.current?.unlock()
      const current = majorIndexFromPosition(targetPosition, items.length, minorSteps)
      const next = clamp(current + (event.deltaY > 0 ? 1 : -1), 0, items.length - 1)
      targetPosition = majorPosition(next, minorSteps)
      playStopSound(targetPosition, 'step')
      commitIndex(next)
      ensureFrame()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const current = majorIndexFromPosition(targetPosition, items.length, minorSteps)
      let next = current
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next -= 1
      else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next += 1
      else if (event.key === 'PageUp') next -= 3
      else if (event.key === 'PageDown') next += 3
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = items.length - 1
      else return
      event.preventDefault()
      notifyFirstInteraction()
      feedbackRef.current?.unlock()
      next = clamp(next, 0, items.length - 1)
      targetPosition = majorPosition(next, minorSteps)
      playStopSound(targetPosition, 'step')
      commitIndex(next)
      ensureFrame()
    }

    const handleFocus = () => {
      hoverTarget = 1
      ensureFrame()
    }

    const handleBlur = () => {
      hoverTarget = 0
      ensureFrame()
    }

    const handleMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      ensureFrame()
    }

    syncExternalIndexRef.current = (index: number) => {
      if (drag || isFineModeRef.current) {
        return
      }
      const next = clamp(index, 0, Math.max(0, items.length - 1))
      targetPosition = majorPosition(next, minorSteps)
      ensureFrame()
    }

    root.addEventListener('pointerenter', handlePointerEnter)
    root.addEventListener('pointermove', handlePointerMove)
    root.addEventListener('pointerleave', handlePointerLeave)
    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('pointerup', finishDrag)
    root.addEventListener('pointercancel', finishDrag)
    root.addEventListener('wheel', handleWheel, {passive: false})
    root.addEventListener('keydown', handleKeyDown)
    root.addEventListener('focus', handleFocus)
    root.addEventListener('blur', handleBlur)
    reducedMotionQuery?.addEventListener?.('change', handleMotionChange)

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resizeObserver?.observe(root)
    window.addEventListener('resize', measure)
    measure()
    render()

    return () => {
      clearLongPress()
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
      root.removeEventListener('pointerenter', handlePointerEnter)
      root.removeEventListener('pointermove', handlePointerMove)
      root.removeEventListener('pointerleave', handlePointerLeave)
      root.removeEventListener('pointerdown', handlePointerDown)
      root.removeEventListener('pointerup', finishDrag)
      root.removeEventListener('pointercancel', finishDrag)
      root.removeEventListener('wheel', handleWheel)
      root.removeEventListener('keydown', handleKeyDown)
      root.removeEventListener('focus', handleFocus)
      root.removeEventListener('blur', handleBlur)
      reducedMotionQuery?.removeEventListener?.('change', handleMotionChange)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [disabled, items, minorSteps, stops])

  return {
    activeLabel,
    isFineMode,
    rootRef,
    trackRef,
    markerRef,
  }
}
