/// <reference lib="dom" />
import {useEffect, useMemo, useRef, useState} from 'react'
import {
  clamp,
  clampEndpointTargets,
  edgeFade,
  exponentialApproach,
  gaussian,
  interpolateIndex,
  rubberBand,
  samplePositions,
  smoothstep,
  visibleRatio,
} from './referenceTimelineMath'
import {ReferenceTimelineAudio} from './referenceTimelineAudio.h5'
import {resetTimelineDate, updateTimelineDate} from './referenceTimelineReel.h5'

export interface ReferenceTimelineItem {
  id: string
  timestamp: number
  label: string
  fineLabel: string
  group?: string
  width?: number
}

interface UseReferenceTimelineOptions {
  items: ReferenceTimelineItem[]
  activeIndex: number
  disabled?: boolean
  locale?: string
  onActiveIndexChange?: (index: number) => void
  onScroll?: (scrollLeft: number) => void
  onFirstInteraction?: () => void
}

export interface ReferenceTimelineController {
  activeFineLabel: string
  isFineMode: boolean
  rootRef: React.RefObject<HTMLDivElement>
}

interface ItemGeometry {
  left: number
  width: number
  center: number
  target: number
}

interface PointerState {
  pointerId: number
  startX: number
  startY: number
  startScroll: number
  moved: boolean
  touch: boolean
}

const MINOR_STEPS = 5
const LONG_PRESS_MOUSE_MS = 700
const LONG_PRESS_TOUCH_MS = 1000

export default function useReferenceTimeline({
  items,
  activeIndex,
  disabled = false,
  locale = 'zh-Hans',
  onActiveIndexChange,
  onScroll,
  onFirstInteraction,
}: UseReferenceTimelineOptions): ReferenceTimelineController {
  const rootRef = useRef<HTMLDivElement>(null)
  const activeIndexRef = useRef(activeIndex)
  const onActiveIndexChangeRef = useRef(onActiveIndexChange)
  const onScrollRef = useRef(onScroll)
  const onFirstInteractionRef = useRef(onFirstInteraction)
  const audioRef = useRef<ReferenceTimelineAudio | null>(null)
  const previousRootRef = useRef<HTMLElement | null>(null)
  const previousMarksRef = useRef<Array<{x: number; width: number; height: number; opacity: number}>>([])
  const frameRef = useRef<number | null>(null)
  const [isFineMode, setIsFineMode] = useState(false)
  const isFineModeRef = useRef(false)
  const activeFineLabel = items[clamp(activeIndex, 0, Math.max(0, items.length - 1))]?.fineLabel ?? ''
  const itemSignature = useMemo(() => items.map(item => `${item.id}:${item.timestamp}:${item.label}`).join('|'), [items])

  if (!audioRef.current) {
    audioRef.current = new ReferenceTimelineAudio()
  }

  useEffect(() => {
    onActiveIndexChangeRef.current = onActiveIndexChange
    onScrollRef.current = onScroll
    onFirstInteractionRef.current = onFirstInteraction
  }, [onActiveIndexChange, onFirstInteraction, onScroll])

  useEffect(() => {
    activeIndexRef.current = activeIndex
  }, [activeIndex])

  useEffect(() => {
    return () => audioRef.current?.dispose()
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
    const tickElements = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-tick]'))
    const separatorElements = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-separator]'))
    const labelElements = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-label]'))
    const monthLabelElements = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-month-label]'))
    const capElements = Array.from(root.querySelectorAll<HTMLElement>('[data-timeline-cap]'))
    const dateElement = root.querySelector<HTMLElement>('[data-timeline-date]')
    let viewportWidth = root.clientWidth || 544
    let geometry: ItemGeometry[] = []
    let separators: number[] = []
    let monthPositions: number[] = []
    let maxScroll = 0
    let scrollLeft = 0
    let targetScroll = 0
    let hoverAmount = 0
    let hoverTarget = 0
    let hoverX = viewportWidth / 2
    let hoverPop = 0
    let hoverPopVelocity = 0
    let hoverLean = 0
    let pullX = 0
    let pullY = 0
    let edgeStrain = 0
    let edgeVelocity = 0
    let fineAmount = 0
    let fineTarget = 0
    let glideAmount = 0
    let marker = activeIndexRef.current
    let markerTarget = activeIndexRef.current
    let lastActiveIndex = activeIndexRef.current
    let lastFrameAt = performance.now()
    let idleUntil = 0
    let pointer: PointerState | null = null
    let longPressTimer: number | null = null

    const notifyFirstInteraction = () => {
      onFirstInteractionRef.current?.()
    }

    const measure = () => {
      const rect = root.getBoundingClientRect()
      viewportWidth = rect.width || root.clientWidth || viewportWidth
      const gap = 24
      let left = 0
      geometry = items.map(item => {
        const width = item.width ?? 260
        const entry = {
          left,
          width,
          center: left + width / 2,
          target: left + width / 2 - viewportWidth / 2,
        }
        left += width + gap
        return entry
      })
      maxScroll = Math.max(0, left - gap - viewportWidth)
      const targets = geometry.map(entry => entry.target)
      clampEndpointTargets(targets, maxScroll)
      geometry.forEach((entry, index) => {
        entry.target = targets[index]
      })
      separators = []
      monthPositions = [0]
      for (let index = 1; index < items.length; index += 1) {
        if (items[index].group && items[index].group !== items[index - 1].group) {
          separators.push(index - 0.5)
          monthPositions.push(index)
        }
      }
      scrollLeft = clamp(scrollLeft, 0, maxScroll)
      targetScroll = clamp(targetScroll, 0, maxScroll)
      render()
    }

    const positionFromScroll = (value: number) => {
      if (geometry.length < 2) {
        return 0
      }
      const raw = geometry.map(entry => entry.target)
      return interpolateIndex(raw, value)
    }

    const render = () => {
      if (!root.isConnected) {
        return
      }

      const hoverEase = smoothstep(hoverAmount)
      const fineEase = smoothstep(fineAmount)
      const glideEase = smoothstep(glideAmount)
      const center = viewportWidth / 2
      root.classList.toggle('held', hoverTarget > 0 || pointer != null)
      root.classList.toggle('fine', fineEase > 0.01)
      root.style.setProperty('--tl-field-x', `${Math.max(0, 22 + pullX * 0.2).toFixed(2)}px`)

      tickElements.forEach((element, index) => {
        const entry = geometry[index]
        if (!entry) {
          return
        }
        const rawX = entry.target + viewportWidth / 2 - scrollLeft
        const distance = Math.abs(rawX - center) / 32
        const proximity = gaussian(rawX - center, 2.2 * 32)
        const ratio = visibleRatio(entry.left, entry.width, scrollLeft, viewportWidth)
        const hoverStrength = ratio * hoverEase
        const edge = edgeFade(distance)
        const pullStrength = gaussian(rawX - center, 2.2 * 32)
        const x = rawX + edgeStrain * pullStrength + pullX * pullStrength * 7.5 + Math.sin((rawX - center) / 20) * hoverEase * 2
        const y = 58 - 24 * hoverStrength + pullY * 4.5
        const width = 3 + hoverEase * 1
        const height = 8 + 24 * hoverStrength * (1.5 + 4.5 * proximity) + 18 * edge + fineEase * 6
        const opacity = clamp(0.14 + 0.86 * hoverStrength + 0.2 * edge + 0.5 * fineEase * proximity + 0.12 * glideEase * edge, 0.14, 1)
        element.style.transform = `translate3d(${(x - width / 2).toFixed(2)}px, ${(y - height / 2).toFixed(2)}px, 0)`
        element.style.width = `${width.toFixed(2)}px`
        element.style.height = `${height.toFixed(2)}px`
        element.style.opacity = opacity.toFixed(3)
        element.style.background = ratio > 0.15
          ? `color-mix(in oklch, var(--tl-hot) ${Math.round(20 * hoverStrength + 65 * fineEase * proximity)}%, var(--color-text, #111))`
          : ''
      })

      separatorElements.forEach((element, index) => {
        const position = separators[index]
        if (position == null) {
          return
        }
        const x = samplePositions(geometry.map(entry => entry.target + viewportWidth / 2), position) - scrollLeft
        const ratio = x >= -8 && x <= viewportWidth + 8 ? 1 : 0
        const height = 14 * (0.45 + 0.55 * hoverEase) * ratio
        element.style.transform = `translate3d(${(x - 1.5).toFixed(2)}px, ${(58 - height / 2).toFixed(2)}px, 0)`
        element.style.height = `${height.toFixed(2)}px`
        element.style.opacity = String(0.28 * ratio)
      })

      labelElements.forEach((element, index) => {
        const entry = geometry[index]
        if (!entry) {
          return
        }
        const x = entry.target + viewportWidth / 2 - scrollLeft + pullX * 2
        const distance = Math.abs(x - center) / 32
        const current = Math.round(markerTarget) === index
        const opacity = fineEase * edgeFade(distance) * (current ? 1 : 0.42)
        element.style.transform = `translate3d(${x.toFixed(2)}px, 58px, 0) scale(${(current ? 1.1 : 0.93).toFixed(3)})`
        element.style.opacity = opacity.toFixed(3)
        element.classList.toggle('is-current', current)
      })

      monthLabelElements.forEach((element, index) => {
        const itemIndex = monthPositions[index]
        if (itemIndex == null) {
          return
        }
        const entry = geometry[itemIndex]
        if (!entry) {
          return
        }
        const x = entry.target + viewportWidth / 2 - scrollLeft + pullX * 2
        const distance = Math.abs(x - center) / 32
        element.style.transform = `translate3d(${x.toFixed(2)}px, 72px, 0) scale(${(0.82 + 0.18 * fineEase).toFixed(3)})`
        element.style.opacity = (fineEase * edgeFade(distance) * 0.78).toFixed(3)
      })

      const renderActiveIndex = clamp(Math.round(markerTarget), 0, Math.max(0, items.length - 1))
      const activeEntry = geometry[renderActiveIndex]
      if (activeEntry) {
        const activeX = activeEntry.target + viewportWidth / 2 - scrollLeft + pullX * 2
        const capHeight = 10 + 4 * fineEase
        capElements.forEach((element, index) => {
          element.style.transform = `translate3d(${(activeX - 2.5).toFixed(2)}px, ${index === 0 ? 58 - capHeight - 20 : 58 + 20}px, 0)`
          element.style.width = '5px'
          element.style.height = `${capHeight.toFixed(2)}px`
          element.style.opacity = String((0.45 + 0.55 * hoverEase) * (1 - fineEase * 0.15))
        })
      }

      if (dateElement && activeEntry) {
        const activeX = activeEntry.target + viewportWidth / 2 - scrollLeft + pullX
        dateElement.style.transform = `translate3d(${activeX.toFixed(2)}px, ${(28 + pullY * 2).toFixed(2)}px, 0) translate(-50%, -100%)`
        dateElement.style.opacity = String(hoverEase * (1 - fineEase))
      }

      root.setAttribute('aria-valuenow', String(renderActiveIndex + 1))
      root.setAttribute('aria-valuetext', `${items[renderActiveIndex]?.label ?? ''}${items[renderActiveIndex]?.fineLabel ? ` ${items[renderActiveIndex]?.fineLabel}日` : ''}`)
    }

    const requestFrame = () => {
      if (frameRef.current == null) {
        frameRef.current = requestAnimationFrame(frame)
      }
    }

    const ensureFrame = (duration = 420) => {
      idleUntil = performance.now() + duration
      requestFrame()
    }

    function frame(timestamp: number) {
      frameRef.current = null
      const elapsed = Math.min(64, Math.max(1, timestamp - lastFrameAt))
      lastFrameAt = timestamp
      const time = elapsed / 1000

      if (reducedMotion) {
        scrollLeft = targetScroll
        hoverAmount = hoverTarget
        fineAmount = fineTarget
        marker = markerTarget
      } else {
        scrollLeft = exponentialApproach(scrollLeft, targetScroll, elapsed, pointer?.moved ? 32 : 64)
        hoverAmount = exponentialApproach(hoverAmount, hoverTarget, elapsed, 90)
        fineAmount = exponentialApproach(fineAmount, fineTarget, elapsed, 110)
        marker = exponentialApproach(marker, markerTarget, elapsed, 70)
        hoverPopVelocity += (484 * (hoverTarget - hoverPop) - 2 * 22 * hoverPopVelocity) * time
        hoverPop += hoverPopVelocity * time
        edgeVelocity += (-1156 * edgeStrain - 34 * edgeVelocity) * time
        edgeStrain += edgeVelocity * time
        pullX = exponentialApproach(pullX, 0, elapsed, 60)
        pullY = exponentialApproach(pullY, hoverLean, elapsed, 60)
        glideAmount = exponentialApproach(glideAmount, pointer || targetScroll !== scrollLeft ? 1 : 0, elapsed, pointer ? 60 : 120)
      }

      markerTarget = positionFromScroll(targetScroll)
      render()
      const nextActive = clamp(Math.round(markerTarget), 0, Math.max(0, items.length - 1))
      if (nextActive !== lastActiveIndex) {
        const previous = items[lastActiveIndex]
        const next = items[nextActive]
        if (previous && next) {
          audioRef.current?.play(previous.group && previous.group === next.group ? 'line' : 'month', Math.abs(nextActive - lastActiveIndex) > 1 ? 0.75 : 1)
          if (dateElement) {
            updateTimelineDate(dateElement, new Date(next.timestamp), locale, Math.sign(nextActive - lastActiveIndex))
          }
        }
        lastActiveIndex = nextActive
        activeIndexRef.current = nextActive
        onActiveIndexChangeRef.current?.(nextActive)
        onScrollRef.current?.(targetScroll)
      }

      const moving = Math.abs(scrollLeft - targetScroll) > 0.01
        || Math.abs(hoverAmount - hoverTarget) > 0.002
        || Math.abs(fineAmount - fineTarget) > 0.002
        || Math.abs(marker - markerTarget) > 0.002
        || Math.abs(edgeStrain) > 0.01
        || hoverTarget > 0
        || pointer != null
        || performance.now() < idleUntil
      if (moving) {
        requestFrame()
      }
    }

    const setFineMode = (next: boolean) => {
      if (next === isFineModeRef.current) {
        return
      }
      isFineModeRef.current = next
      setIsFineMode(next)
      root.classList.toggle('fine', next)
      fineTarget = next ? 1 : 0
      if (next) {
        audioRef.current?.play('fine')
      }
      ensureFrame(620)
    }

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer)
        longPressTimer = null
      }
    }

    const jumpToIndex = (index: number, mode: 'step' | 'jump' | 'scrub') => {
      const next = clamp(Math.round(index), 0, Math.max(0, items.length - 1))
      targetScroll = geometry[next]?.target ?? 0
      if (mode === 'jump') {
        audioRef.current?.playTravel(next, 0.8)
      } else {
        audioRef.current?.play('line')
      }
      if (next !== lastActiveIndex) {
        const previous = items[lastActiveIndex]
        const item = items[next]
        if (previous && item) {
          updateTimelineDate(
            dateElement ?? root,
            new Date(item.timestamp),
            locale,
            Math.sign(next - lastActiveIndex),
          )
        }
        lastActiveIndex = next
        activeIndexRef.current = next
        onScrollRef.current?.(targetScroll)
      }
      onActiveIndexChangeRef.current?.(next)
      ensureFrame(mode === 'scrub' ? 280 : 700)
    }

    const handlePointerEnter = (event: PointerEvent) => {
      hoverTarget = 1
      hoverX = event.clientX
      audioRef.current?.play('line')
      ensureFrame()
    }

    const handlePointerMove = (event: PointerEvent) => {
      hoverTarget = 1
      const rect = root.getBoundingClientRect()
      hoverX = event.clientX - rect.left
      if (pointer && pointer.pointerId === event.pointerId) {
        const deltaX = event.clientX - pointer.startX
        const deltaY = event.clientY - pointer.startY
        if (Math.hypot(deltaX, deltaY) > 6) {
          pointer.moved = true
          clearLongPress()
        }
        if (pointer.moved) {
          if (isFineModeRef.current) {
            targetScroll = clamp(pointer.startScroll + deltaX, -28, maxScroll + 28)
            const nextActive = clamp(Math.round(positionFromScroll(targetScroll)), 0, items.length - 1)
            audioRef.current?.playTravel(nextActive, 0.7)
          } else {
            const nextActive = clamp(Math.round(positionFromScroll(pointer.startScroll + deltaX)), 0, items.length - 1)
            if (nextActive !== lastActiveIndex) {
              audioRef.current?.play(items[nextActive]?.group && items[nextActive]?.group === items[lastActiveIndex]?.group ? 'line' : 'month')
            }
            targetScroll = geometry[nextActive]?.target ?? targetScroll
          }
          onScrollRef.current?.(targetScroll)
        }
      } else {
        const distance = hoverX - viewportWidth / 2
        pullX = rubberBand(distance, 14)
        hoverLean = clamp((event.clientY - root.getBoundingClientRect().top - 58) / 32, -1, 1)
      }
      ensureFrame()
    }

    const handlePointerLeave = () => {
      if (!pointer) {
        hoverTarget = 0
        pullX = 0
        ensureFrame()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (disabled || (event.button != null && event.button !== 0)) {
        return
      }
      event.preventDefault()
      notifyFirstInteraction()
      audioRef.current?.unlock()
      pointer = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startScroll: targetScroll,
        moved: false,
        touch: event.pointerType === 'touch',
      }
      hoverTarget = 1
      try {
        root.setPointerCapture?.(event.pointerId)
      } catch {
      }
      clearLongPress()
      longPressTimer = window.setTimeout(() => {
        if (pointer && !pointer.moved) {
          setFineMode(true)
        }
      }, pointer.touch ? LONG_PRESS_TOUCH_MS : LONG_PRESS_MOUSE_MS)
      ensureFrame()
    }

    const finishPointer = (event: PointerEvent) => {
      if (!pointer || pointer.pointerId !== event.pointerId) {
        return
      }
      clearLongPress()
      const wasFine = isFineModeRef.current
      if (wasFine) {
        audioRef.current?.play('close')
      }
      setFineMode(false)
      const index = clamp(Math.round(positionFromScroll(targetScroll)), 0, Math.max(0, items.length - 1))
      targetScroll = geometry[index]?.target ?? targetScroll
      if (index !== lastActiveIndex) {
        audioRef.current?.play('line')
      }
      try {
        root.releasePointerCapture?.(event.pointerId)
      } catch {
      }
      pointer = null
      hoverTarget = root.matches(':hover') ? 1 : 0
      ensureFrame(700)
    }

    const handleWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (disabled || Math.abs(delta) < 2) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      notifyFirstInteraction()
      audioRef.current?.unlock()
      const current = Math.round(positionFromScroll(targetScroll))
      const next = clamp(current + Math.sign(delta), 0, Math.max(0, items.length - 1))
      jumpToIndex(next, 'scrub')
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      const current = Math.round(positionFromScroll(targetScroll))
      let next = current
      let mode: 'step' | 'jump' = 'step'
      if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 1
      else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 1
      else if (event.key === 'PageUp') {
        next -= MINOR_STEPS
        mode = 'jump'
      } else if (event.key === 'PageDown') {
        next += MINOR_STEPS
        mode = 'jump'
      } else if (event.key === 'Home') {
        next = 0
        mode = 'jump'
      } else if (event.key === 'End') {
        next = items.length - 1
        mode = 'jump'
      } else return
      event.preventDefault()
      notifyFirstInteraction()
      audioRef.current?.unlock()
      jumpToIndex(next, mode)
    }

    const handleContextMenu = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }

    const handleMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches
      ensureFrame()
    }

    const captureMarks = () => {
      previousMarksRef.current = tickElements.map(element => ({
        x: Number.parseFloat(element.style.transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? '0'),
        width: Number.parseFloat(element.style.width || '3'),
        height: Number.parseFloat(element.style.height || '8'),
        opacity: Number.parseFloat(element.style.opacity || '0'),
      }))
      previousRootRef.current = root.cloneNode(true) as HTMLElement
      previousRootRef.current.classList.add('tl-ghost')
      previousRootRef.current.removeAttribute('data-timeline-root')
    }

    const playRebuildFlight = () => {
      const previousRoot = previousRootRef.current
      const previousMarks = previousMarksRef.current
      if (!previousRoot || previousMarks.length === 0) {
        return
      }
      root.after(previousRoot)
      previousRoot.style.opacity = '1'
      previousRoot.animate([{opacity: 1}, {opacity: 0}], {duration: 200, easing: 'ease-out', fill: 'forwards'})
        .finished.then(() => previousRoot.remove(), () => previousRoot.remove())

      const overlay = document.createElement('div')
      overlay.className = 'tl-flight'
      overlay.setAttribute('aria-hidden', 'true')
      root.parentElement?.append(overlay)
      const animations: Animation[] = []
      tickElements.forEach((tick, index) => {
        const previous = previousMarks[index]
        const width = Number.parseFloat(tick.style.width || '3')
        const height = Number.parseFloat(tick.style.height || '8')
        const x = Number.parseFloat(tick.style.transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? '0')
        const flyer = document.createElement('div')
        flyer.className = 'tl-flyer'
        flyer.innerHTML = '<div></div>'
        overlay.append(flyer)
        animations.push(flyer.animate([
          {transform: `translate(${previous.x}px, 50px)`, width: `${previous.width}px`, height: `${previous.height}px`, opacity: previous.opacity},
          {transform: `translate(${x}px, 50px)`, width: `${width}px`, height: `${height}px`, opacity: Number.parseFloat(tick.style.opacity || '1')},
        ], {duration: 480, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'both'}))
      })
      window.setTimeout(() => {
        animations.forEach(animation => animation.finish())
        overlay.remove()
      }, 520)
    }

    root.addEventListener('pointerenter', handlePointerEnter)
    root.addEventListener('pointermove', handlePointerMove)
    root.addEventListener('pointerleave', handlePointerLeave)
    root.addEventListener('pointerdown', handlePointerDown)
    root.addEventListener('pointerup', finishPointer)
    root.addEventListener('pointercancel', finishPointer)
    root.addEventListener('wheel', handleWheel, {passive: false})
    root.addEventListener('keydown', handleKeyDown)
    root.addEventListener('contextmenu', handleContextMenu)
    reducedMotionQuery?.addEventListener?.('change', handleMotionChange)
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    resizeObserver?.observe(root)
    window.addEventListener('resize', measure)
    measure()
    if (previousMarksRef.current.length) {
      playRebuildFlight()
    }
    root.classList.add('is-ready')
    const initialItem = items[activeIndexRef.current]
    if (dateElement && initialItem) {
      resetTimelineDate(dateElement, new Date(initialItem.timestamp), locale)
    }
    captureMarks()

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
      root.removeEventListener('pointerup', finishPointer)
      root.removeEventListener('pointercancel', finishPointer)
      root.removeEventListener('wheel', handleWheel)
      root.removeEventListener('keydown', handleKeyDown)
      root.removeEventListener('contextmenu', handleContextMenu)
      reducedMotionQuery?.removeEventListener?.('change', handleMotionChange)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [disabled, itemSignature, items, locale])

  return {
    activeFineLabel,
    isFineMode,
    rootRef,
  }
}
