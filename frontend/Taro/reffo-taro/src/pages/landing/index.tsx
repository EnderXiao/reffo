import {useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {Image, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import REFFO_LOGO from '@/assets/branding/reffo-logo.png'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {deriveCardPalette} from '@/components/business/HomeCardDeck/palette'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {storage} from '@/utils/storage'
import {navigation} from '@/utils/navigation'
import {
  createFallbackSharedElementSnapshot,
  createSharedElementSnapshot,
  scaleSharedElementSnapshot,
  type SharedElementSnapshot,
  writeSharedElementSnapshot,
} from '@/utils/shared-element-transition'

import './index.scss'

const HOME_URL = '/pages/index/index'
const LANDING_SEEN_STORAGE_KEY = 'reffo.landing.seen'
const LANDING_TO_HOME_STORAGE_KEY = 'reffo.landingToHome'
const START_LANDING_QUERY_KEY = 'startLanding'
const MIN_SPLASH_MS = 880
const EXIT_TRANSITION_MS = 80
const ONBOARDING_LOGO_TRANSITION_MS = 780
const ONBOARDING_SWIPE_THRESHOLD = 54
const ONBOARDING_SWIPE_DIRECTION_RATIO = 1.35
const ONBOARDING_QUEUE_ENTRY_MS = 960
const ONBOARDING_QUEUE_FAST_MS = 1100
const ONBOARDING_QUEUE_FAST_CYCLE_MS = 320
const ONBOARDING_QUEUE_DECEL_MS = 2800
const ONBOARDING_QUEUE_SPIN_TOTAL_MS = ONBOARDING_QUEUE_FAST_MS + ONBOARDING_QUEUE_DECEL_MS
const ONBOARDING_QUEUE_STEADY_CYCLE_MS = 11000
const ONBOARDING_QUEUE_MAX_MOTION_BLUR = 1.35
const ONBOARDING_QUEUE_CARD_ROTATE_X = '0deg'
const ONBOARDING_QUEUE_CARD_ROTATE_Y = '-15deg'
const ONBOARDING_QUEUE_CARD_ROTATE_Z = '0deg'

type LandingPhase = 'splash' | 'onboarding'
type OnboardingStep = 'target' | 'experience' | 'queue'
type QueueMotionPhase = 'idle' | 'entry' | 'spin' | 'steady'
type QueueSlotKind = 'slot-0' | 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'slot-5'

interface QueueSlot {
  kind: QueueSlotKind
  offset: number
  cardIndex?: number
}

const ONBOARDING_CARD_SEEDS = {
  experienceLeft: '#74D7A7',
  target: '#B95CFF',
  experienceRight: '#F0D45F',
  queueIncoming: '#6DA9FF',
  queueFar: '#C4E1FF',
}

function createOnboardingCard(
  id: string,
  seedColor: string,
  input: Pick<HomeCardItem, 'company' | 'indexLabel' | 'location' | 'role' | 'dateLabel' | 'score' | 'strategyBody'>,
): HomeCardItem {
  const palette = deriveCardPalette(seedColor)

  return {
    id,
    primaryColor: palette.primaryColor,
    surfaceColor: palette.surfaceColor,
    stackColor: palette.stackColor,
    logoColor: palette.logoColor,
    borderColor: palette.borderColor,
    tone: palette.tone,
    ...input,
  }
}

const ONBOARDING_CARDS: HomeCardItem[] = [
  createOnboardingCard('landing-card-network', ONBOARDING_CARD_SEEDS.experienceLeft, {
    company: 'Reffo',
    indexLabel: '03',
    location: 'Remote',
    role: 'Career Coach',
    dateLabel: '2026.07',
    score: 90,
    strategyBody: '',
  }),
  createOnboardingCard('landing-card-product', ONBOARDING_CARD_SEEDS.target, {
    company: 'Reffo',
    indexLabel: '01',
    location: 'Remote',
    role: 'Product Designer',
    dateLabel: '2026.07',
    score: 92,
    strategyBody: '',
  }),
  createOnboardingCard('landing-card-growth', ONBOARDING_CARD_SEEDS.experienceRight, {
    company: 'Reffo',
    indexLabel: '02',
    location: 'Shanghai',
    role: 'Growth Analyst',
    dateLabel: '2026.07',
    score: 88,
    strategyBody: '',
  }),
]

const ONBOARDING_QUEUE_CARDS: HomeCardItem[] = [
  ...ONBOARDING_CARDS,
  createOnboardingCard('landing-card-frontend', ONBOARDING_CARD_SEEDS.queueIncoming, {
    company: 'Reffo',
    indexLabel: '04',
    location: 'Hangzhou',
    role: 'Frontend Engineer',
    dateLabel: '2026.07',
    score: 91,
    strategyBody: '',
  }),
  createOnboardingCard('landing-card-brand', ONBOARDING_CARD_SEEDS.queueFar, {
    company: 'Reffo',
    indexLabel: '05',
    location: 'Shenzhen',
    role: 'Brand Strategist',
    dateLabel: '2026.07',
    score: 87,
    strategyBody: '',
  }),
]

interface QueueTrackFrame {
  phase: number
  x: number
  y: number
  z: number
  scale: number
  opacity: number
  zIndex: number
}

const ONBOARDING_QUEUE_ENTRY_SLOTS: QueueSlot[] = [
  {kind: 'slot-0', offset: 0, cardIndex: 0},
  {kind: 'slot-1', offset: 1, cardIndex: 1},
  {kind: 'slot-2', offset: 2, cardIndex: 2},
  {kind: 'slot-3', offset: 3, cardIndex: 3},
  {kind: 'slot-4', offset: 4, cardIndex: 4},
]
const ONBOARDING_QUEUE_FLOW_SLOTS: QueueSlot[] = [
  ...ONBOARDING_QUEUE_ENTRY_SLOTS,
  {kind: 'slot-5', offset: 5},
]
const ONBOARDING_QUEUE_TRACK: QueueTrackFrame[] = [
  {phase: 0, x: 238, y: -156, z: -150, scale: 0.868, opacity: 1, zIndex: 5},
  {phase: 0.166667, x: 136, y: -118, z: -110, scale: 0.858, opacity: 1, zIndex: 5},
  {phase: 0.333333, x: 34, y: -80, z: -50, scale: 0.84, opacity: 1, zIndex: 6},
  {phase: 0.5, x: -68, y: -42, z: 10, scale: 0.816, opacity: 1, zIndex: 7},
  {phase: 0.666667, x: -170, y: -4, z: 68, scale: 0.788, opacity: 1, zIndex: 8},
  {phase: 0.833333, x: -272, y: 34, z: 124, scale: 0.756, opacity: 1, zIndex: 9},
  {phase: 1, x: -374, y: 72, z: 176, scale: 0.722, opacity: 1, zIndex: 10},
]

function wait(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function interpolateQueueValue(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

function resolveQueueLaneFrame(index: number, progress: number): QueueTrackFrame {
  const from = ONBOARDING_QUEUE_TRACK[index]
  const to = ONBOARDING_QUEUE_TRACK[index + 1] ?? from

  return {
    phase: progress,
    x: interpolateQueueValue(from.x, to.x, progress),
    y: interpolateQueueValue(from.y, to.y, progress),
    z: interpolateQueueValue(from.z, to.z, progress),
    scale: interpolateQueueValue(from.scale, to.scale, progress),
    opacity: interpolateQueueValue(from.opacity, to.opacity, progress),
    zIndex: Math.round(interpolateQueueValue(from.zIndex, to.zIndex, progress)),
  }
}

function resolveQueueTransform(frame: QueueTrackFrame) {
  return `translate3d(${frame.x}px, ${frame.y}px, ${frame.z}PX) rotateZ(var(--queue-rotate-z, -1deg)) rotateY(var(--queue-rotate-y, -6deg)) rotateX(var(--queue-rotate-x, 0deg)) scale(${frame.scale})`
}

function resolveQueueProgress(elapsedMs: number) {
  const fastSpeed = 1 / ONBOARDING_QUEUE_FAST_CYCLE_MS
  const steadySpeed = 1 / ONBOARDING_QUEUE_STEADY_CYCLE_MS

  if (elapsedMs <= ONBOARDING_QUEUE_FAST_MS) {
    return elapsedMs * fastSpeed
  }

  const fastProgress = ONBOARDING_QUEUE_FAST_MS * fastSpeed
  const decelElapsed = Math.min(elapsedMs - ONBOARDING_QUEUE_FAST_MS, ONBOARDING_QUEUE_DECEL_MS)

  if (elapsedMs <= ONBOARDING_QUEUE_SPIN_TOTAL_MS) {
    const decelProgress = decelElapsed / ONBOARDING_QUEUE_DECEL_MS
    const easedDistance = (1 - Math.pow(1 - decelProgress, 4)) / 4

    return fastProgress
      + (decelElapsed * steadySpeed)
      + ((fastSpeed - steadySpeed) * ONBOARDING_QUEUE_DECEL_MS * easedDistance)
  }

  const spinProgress = fastProgress
    + (ONBOARDING_QUEUE_DECEL_MS * steadySpeed)
    + ((fastSpeed - steadySpeed) * ONBOARDING_QUEUE_DECEL_MS / 4)

  return spinProgress
    + ((elapsedMs - ONBOARDING_QUEUE_SPIN_TOTAL_MS) / ONBOARDING_QUEUE_STEADY_CYCLE_MS)
}

function resolveQueueMotionBlur(elapsedMs: number) {
  if (elapsedMs <= ONBOARDING_QUEUE_FAST_MS) {
    return ONBOARDING_QUEUE_MAX_MOTION_BLUR
  }

  if (elapsedMs <= ONBOARDING_QUEUE_SPIN_TOTAL_MS) {
    const decelProgress = (elapsedMs - ONBOARDING_QUEUE_FAST_MS) / ONBOARDING_QUEUE_DECEL_MS

    return ONBOARDING_QUEUE_MAX_MOTION_BLUR * Math.pow(1 - decelProgress, 3)
  }

  return 0
}

function resolveQueueCardStyle(offset: number, progress = 0): CSSProperties {
  const frame = resolveQueueLaneFrame(offset, progress)

  return {
    opacity: frame.opacity,
    zIndex: frame.zIndex,
    transform: resolveQueueTransform(frame),
  }
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function resolveQueueFlowCardIndex(cursor: number, offset: number) {
  return positiveModulo(offset - cursor, ONBOARDING_QUEUE_CARDS.length)
}

async function hasSeenLanding() {
  try {
    return await storage.getItem(LANDING_SEEN_STORAGE_KEY) === '1'
  } catch (error) {
    console.warn('[LandingPage] Failed to read landing seen flag:', error)
    return false
  }
}

async function markLandingSeen() {
  try {
    await storage.setItem(LANDING_SEEN_STORAGE_KEY, '1')
  } catch (error) {
    console.warn('[LandingPage] Failed to save landing seen flag:', error)
  }
}

function shouldStartLandingByQuery() {
  if (typeof window === 'undefined') {
    return false
  }

  const hasStartLanding = (query: string) => (
    new URLSearchParams(query).get(START_LANDING_QUERY_KEY) === 'true'
  )

  if (hasStartLanding(window.location.search)) {
    return true
  }

  const hashQueryIndex = window.location.hash.indexOf('?')

  return hashQueryIndex >= 0
    ? hasStartLanding(window.location.hash.slice(hashQueryIndex + 1))
    : false
}

async function preloadHomeData() {
  const homeRoutePromise = preloadHomeRoute()

  await useAuthStore.getState().restoreSession()

  await Promise.all([
    homeRoutePromise,
    useHistoryStore.getState().loadHistories({skipIfLoaded: true}),
    useSourceResumeStore.getState().loadLatestSourceResume({skipIfLoaded: true}),
  ].map(promise => promise.catch(error => {
    console.warn('[LandingPage] Failed to preload home data:', error)
  })))
}

async function preloadHomeRoute() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  await import('../index/index')
}

function captureLogoSnapshot(selector = '.reffo-landing__logo'): SharedElementSnapshot {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return createFallbackSharedElementSnapshot(160, 42)
  }

  try {
    const logo = document.querySelector(selector)
    const rect = logo?.getBoundingClientRect()

    return rect && rect.width > 0 && rect.height > 0
      ? createSharedElementSnapshot(rect)
      : createFallbackSharedElementSnapshot(160, 42)
  } catch (error) {
    console.warn('[LandingPage] Failed to capture landing logo:', error)
    return createFallbackSharedElementSnapshot(160, 42)
  }
}

function resolveOnboardingLogoStyle(snapshot: SharedElementSnapshot): CSSProperties | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null
  }

  const targetLogo = document.querySelector('.reffo-landing-onboarding__logo')
  const targetRect = targetLogo?.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 393
  const targetWidth = targetRect && targetRect.width > 0 ? targetRect.width : 88
  const targetLeft = targetRect && targetRect.width > 0
    ? targetRect.left
    : Math.min(Math.max(viewportWidth * 0.079, 30), 42)
  const targetTop = targetRect && targetRect.height > 0 ? targetRect.top : 136
  const startSnapshot = scaleSharedElementSnapshot(snapshot, {
    left: (viewportWidth - 160) / 2,
    top: ((window.innerHeight || document.documentElement.clientHeight || 852) - 42) / 2,
    width: 160,
    height: 42,
  })

  return {
    '--reffo-onboarding-logo-start-x': `${startSnapshot.left}px`,
    '--reffo-onboarding-logo-start-y': `${startSnapshot.top}px`,
    '--reffo-onboarding-logo-start-width': `${startSnapshot.width}px`,
    '--reffo-onboarding-logo-start-height': `${startSnapshot.height}px`,
    '--reffo-onboarding-logo-target-x': `${targetLeft}px`,
    '--reffo-onboarding-logo-target-y': `${targetTop}px`,
    '--reffo-onboarding-logo-target-scale': String(targetWidth / startSnapshot.width),
  } as CSSProperties
}

function recordLandingTransition(selector = '.reffo-landing__logo') {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  try {
    const logo = document.querySelector(selector)
    const rect = logo?.getBoundingClientRect()
    const fallbackWidth = 160
    const fallbackHeight = 42
    const snapshot = rect && rect.width > 0 && rect.height > 0
      ? createSharedElementSnapshot(rect)
      : createFallbackSharedElementSnapshot(fallbackWidth, fallbackHeight)

    writeSharedElementSnapshot(LANDING_TO_HOME_STORAGE_KEY, snapshot, '封面到首页 logo')
  } catch (error) {
    console.warn('[LandingPage] Failed to record landing transition:', error)
  }
}

async function enterHome(selector?: string) {
  recordLandingTransition(selector)
  await wait(EXIT_TRANSITION_MS)
  void navigation.reLaunch(HOME_URL)
}

export default function LandingPage() {
  const [phase, setPhase] = useState<LandingPhase>('splash')
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>('target')
  const [isLeaving, setIsLeaving] = useState(false)
  const [shouldForceStartLanding] = useState(() => shouldStartLandingByQuery())
  const [onboardingLogoSnapshot, setOnboardingLogoSnapshot] = useState<SharedElementSnapshot | null>(null)
  const [onboardingLogoStyle, setOnboardingLogoStyle] = useState<CSSProperties | null>(null)
  const [hasOnboardingLogoSettled, setHasOnboardingLogoSettled] = useState(false)
  const [queueMotionPhase, setQueueMotionPhase] = useState<QueueMotionPhase>('idle')
  const [queueCursor, setQueueCursor] = useState(0)
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const onboardingLogoTimerRef = useRef<number | null>(null)
  const queueTimersRef = useRef<number[]>([])
  const queueAnimationFrameRef = useRef<number | null>(null)
  const queueCursorRef = useRef(0)

  const clearQueueTimers = () => {
    queueTimersRef.current.forEach(timer => {
      window.clearTimeout(timer)
    })
    queueTimersRef.current = []
  }

  const clearQueueAnimationFrame = () => {
    if (queueAnimationFrameRef.current != null) {
      window.cancelAnimationFrame(queueAnimationFrameRef.current)
      queueAnimationFrameRef.current = null
    }
  }

  useEffect(() => {
    let mounted = true

    const bootstrap = async () => {
      const startedAt = Date.now()
      const seenLandingPromise = shouldForceStartLanding ? Promise.resolve(false) : hasSeenLanding()

      await preloadHomeData()
      const seenLanding = await seenLandingPromise
      await wait(Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt)))

      if (!mounted) {
        return
      }

      if (seenLanding) {
        setIsLeaving(true)
        await enterHome()
        return
      }

      setHasOnboardingLogoSettled(false)
      setOnboardingStep('target')
      setQueueMotionPhase('idle')
      queueCursorRef.current = 0
      setQueueCursor(0)
      setOnboardingLogoSnapshot(captureLogoSnapshot())
      setPhase('onboarding')
    }

    void bootstrap()

    return () => {
      mounted = false
    }
  }, [shouldForceStartLanding])

  useLayoutEffect(() => {
    if (phase !== 'onboarding' || !onboardingLogoSnapshot) {
      return undefined
    }

    const updateLogoTransition = () => {
      const nextStyle = resolveOnboardingLogoStyle(onboardingLogoSnapshot)
      if (nextStyle) {
        setOnboardingLogoStyle(nextStyle)
      }
    }

    updateLogoTransition()
    const raf = window.requestAnimationFrame(updateLogoTransition)

    if (onboardingLogoTimerRef.current != null) {
      window.clearTimeout(onboardingLogoTimerRef.current)
    }

    onboardingLogoTimerRef.current = window.setTimeout(() => {
      onboardingLogoTimerRef.current = null
      setOnboardingLogoSnapshot(null)
      setOnboardingLogoStyle(null)
      setHasOnboardingLogoSettled(true)
    }, ONBOARDING_LOGO_TRANSITION_MS)

    return () => {
      window.cancelAnimationFrame(raf)
      if (onboardingLogoTimerRef.current != null) {
        window.clearTimeout(onboardingLogoTimerRef.current)
        onboardingLogoTimerRef.current = null
      }
    }
  }, [onboardingLogoSnapshot, phase])

  useEffect(() => () => {
    if (onboardingLogoTimerRef.current != null) {
      window.clearTimeout(onboardingLogoTimerRef.current)
    }
    clearQueueTimers()
    clearQueueAnimationFrame()
  }, [])

  useEffect(() => {
    clearQueueTimers()
    clearQueueAnimationFrame()

    if (phase !== 'onboarding' || onboardingStep !== 'queue' || isLeaving) {
      setQueueMotionPhase('idle')
      queueCursorRef.current = 0
      setQueueCursor(0)
      return undefined
    }

    setQueueMotionPhase('entry')
    queueCursorRef.current = 0
    setQueueCursor(0)

    const entryTimer = window.setTimeout(() => {
      setQueueMotionPhase('spin')

      const startedAt = performance.now()
      const tick = (timestamp: number) => {
        const elapsedMs = timestamp - startedAt
        const progress = resolveQueueProgress(elapsedMs)
        const nextCursor = Math.floor(progress)
        const laneProgress = progress - nextCursor
        const motionBlur = resolveQueueMotionBlur(elapsedMs)
        const filter = motionBlur > 0.02 ? `blur(${motionBlur.toFixed(3)}PX)` : 'none'
        const queueCards = typeof document === 'undefined'
          ? []
          : Array.from(document.querySelectorAll<HTMLElement>('[data-queue-offset]'))

        if (queueCursorRef.current !== nextCursor) {
          queueCursorRef.current = nextCursor
          setQueueCursor(nextCursor)
        }

        queueCards.forEach(element => {
          const offset = Number(element.dataset.queueOffset ?? 0)
          const frameStyle = resolveQueueCardStyle(offset, laneProgress)
          element.style.opacity = String(frameStyle.opacity ?? 1)
          element.style.zIndex = String(frameStyle.zIndex ?? 1)
          element.style.transform = String(frameStyle.transform ?? '')
          element.style.filter = filter
        })

        queueAnimationFrameRef.current = window.requestAnimationFrame(tick)
      }

      queueAnimationFrameRef.current = window.requestAnimationFrame(tick)

      const steadyStartTimer = window.setTimeout(() => {
        setQueueMotionPhase('steady')
      }, ONBOARDING_QUEUE_SPIN_TOTAL_MS)

      queueTimersRef.current.push(steadyStartTimer)
    }, ONBOARDING_QUEUE_ENTRY_MS)

    queueTimersRef.current.push(entryTimer)

    return () => {
      clearQueueTimers()
      clearQueueAnimationFrame()
    }
  }, [isLeaving, onboardingStep, phase])

  const completeOnboarding = async () => {
    if (phase !== 'onboarding' || isLeaving) {
      return
    }

    setIsLeaving(true)
    await markLandingSeen()
    await enterHome('.reffo-landing-onboarding__logo')
  }

  const advanceOnboarding = () => {
    if (phase !== 'onboarding' || isLeaving) {
      return
    }

    if (onboardingStep === 'target') {
      setOnboardingStep('experience')
      return
    }

    if (onboardingStep === 'experience') {
      setOnboardingStep('queue')
      return
    }

    void completeOnboarding()
  }

  const handleTouchStart = (event: any) => {
    if (phase !== 'onboarding') {
      return
    }

    const touch = event.touches?.[0] ?? event.changedTouches?.[0]

    if (!touch) {
      return
    }

    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  const handleTouchEnd = (event: any) => {
    if (phase !== 'onboarding') {
      return
    }

    const start = touchStartRef.current
    const touch = event.changedTouches?.[0]
    touchStartRef.current = null

    if (!start || !touch) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y

    if (
      deltaX >= ONBOARDING_SWIPE_THRESHOLD &&
      Math.abs(deltaX) > Math.abs(deltaY) * ONBOARDING_SWIPE_DIRECTION_RATIO
    ) {
      advanceOnboarding()
    }
  }

  if (phase === 'onboarding') {
    const isQueueStep = onboardingStep === 'queue'
    const isQueueFlow = queueMotionPhase === 'spin' || queueMotionPhase === 'steady'
    const queueCycleStyle = isQueueStep
      ? ({
        '--queue-rotate-x': ONBOARDING_QUEUE_CARD_ROTATE_X,
        '--queue-rotate-y': ONBOARDING_QUEUE_CARD_ROTATE_Y,
        '--queue-rotate-z': ONBOARDING_QUEUE_CARD_ROTATE_Z,
      } as CSSProperties)
      : undefined
    const queueSlots = isQueueFlow ? ONBOARDING_QUEUE_FLOW_SLOTS : ONBOARDING_QUEUE_ENTRY_SLOTS

    return (
      <View
        className={classNames('reffo-landing-onboarding', {
          'reffo-landing-onboarding--leaving': isLeaving,
          'reffo-landing-onboarding--logo-transition': Boolean(onboardingLogoSnapshot),
          'reffo-landing-onboarding--logo-settled': hasOnboardingLogoSettled,
          'reffo-landing-onboarding--step-target': onboardingStep === 'target',
          'reffo-landing-onboarding--step-experience': onboardingStep === 'experience',
          'reffo-landing-onboarding--step-queue': onboardingStep === 'queue',
          'reffo-landing-onboarding--queue-entry': queueMotionPhase === 'entry',
          'reffo-landing-onboarding--queue-spin': queueMotionPhase === 'spin',
          'reffo-landing-onboarding--queue-steady': queueMotionPhase === 'steady',
        })}
        style={queueCycleStyle}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          touchStartRef.current = null
        }}
      >
        <Image src={REFFO_LOGO} className='reffo-landing-onboarding__logo' mode='aspectFit' />
        {onboardingLogoSnapshot && onboardingLogoStyle ? (
          <Image
            src={REFFO_LOGO}
            className='reffo-landing-onboarding__logo-flight'
            style={onboardingLogoStyle}
            mode='aspectFit'
          />
        ) : null}

        <View className='reffo-landing-onboarding__cards reffo-home-deck-wrap--enhanced'>
          {isQueueStep ? (
            queueSlots.map(({kind, offset, cardIndex}) => {
              const resolvedCardIndex = isQueueFlow
                ? resolveQueueFlowCardIndex(queueCursor, offset)
                : cardIndex ?? offset
              const card = ONBOARDING_QUEUE_CARDS[resolvedCardIndex]

              return (
                <View
                  key={`${isQueueFlow ? 'flow' : 'entry'}-${kind}`}
                  data-queue-offset={isQueueFlow ? offset : undefined}
                  className={classNames(
                    'reffo-landing-onboarding__card',
                    'reffo-landing-onboarding__card--queue',
                    {
                      'reffo-landing-onboarding__card--queue-flow': isQueueFlow,
                      [`reffo-landing-onboarding__card--queue-flow-${offset}`]: isQueueFlow,
                      [`reffo-landing-onboarding__card--queue-${kind}`]: !isQueueFlow,
                    },
                  )}
                  style={isQueueFlow ? resolveQueueCardStyle(offset) : undefined}
                >
                  <HomeScoreCard
                    card={card}
                    depth={0}
                    active={false}
                    visualTier='enhanced'
                    presentation='queue3d'
                    className='reffo-landing-onboarding__home-card'
                    style={{
                      '--card-responsive-scale': 1,
                      '--card-left': '0px',
                      '--card-top': '0px',
                      '--card-rotate': '0deg',
                      '--card-depth-scale': 1,
                      zIndex: 1,
                    }}
                  />
                </View>
              )
            })
          ) : (
            ONBOARDING_CARDS.map((card, cardIndex) => {
              const legacyClass = cardIndex === 0
                ? 'reffo-landing-onboarding__card--experience-left'
                : cardIndex === 1
                  ? 'reffo-landing-onboarding__card--target'
                  : 'reffo-landing-onboarding__card--experience-right'

              return (
                <View
                  key={card.id}
                  className={classNames(
                    'reffo-landing-onboarding__card',
                    legacyClass,
                  )}
                >
                  <HomeScoreCard
                    card={card}
                    depth={0}
                    active={false}
                    visualTier='enhanced'
                    className='reffo-landing-onboarding__home-card'
                    style={{
                      '--card-responsive-scale': cardIndex === 0 ? 0.72 : 0.7,
                      '--card-left': '0px',
                      '--card-top': '0px',
                      '--card-rotate': '0deg',
                      '--card-depth-scale': 1,
                      zIndex: cardIndex === 2 ? 5 : cardIndex + 1,
                    }}
                  />
                </View>
              )
            })
          )}
        </View>

        <View className='reffo-landing-onboarding__queue-top'>
          <View
            className='reffo-landing-onboarding__skip reffo-landing-onboarding__skip--queue'
            onClick={() => {
              void completeOnboarding()
            }}
          >
            <Text>跳过教程</Text>
          </View>
          <View className='reffo-landing-onboarding__pager' aria-label='教程页码'>
            <View className='reffo-landing-onboarding__pager-dot reffo-landing-onboarding__pager-dot--active' />
            <View className='reffo-landing-onboarding__pager-dot' />
            <View className='reffo-landing-onboarding__pager-dot' />
          </View>
        </View>

        {onboardingStep !== 'queue' ? (
          <View className='reffo-landing-onboarding__headline reffo-landing-onboarding__headline--target'>
            <Text>一个</Text>
            <Text className='reffo-landing-onboarding__accent'>岗位</Text>
            <Text>{'\n'}一份专门准备的</Text>
            <Text className='reffo-landing-onboarding__accent'>简历</Text>
          </View>
        ) : null}

        <View className='reffo-landing-onboarding__headline reffo-landing-onboarding__headline--experience'>
          <Text>开启</Text>
          <Text className='reffo-landing-onboarding__accent'>全新体验</Text>
        </View>

        <View className='reffo-landing-onboarding__body'>
          <Text>reffo会结合工作经历和目标岗位，重新组织简历重点，并准备针对性的面试建议。</Text>
        </View>

        <View
          className='reffo-landing-onboarding__headline reffo-landing-onboarding__headline--queue'
        >
          <Text>谁是</Text>
          <Text className='reffo-landing-onboarding__accent'>求职者</Text>
          <Text>?</Text>
        </View>

        <View
          className='reffo-landing-onboarding__skip reffo-landing-onboarding__skip--experience'
          onClick={() => {
            if (onboardingStep === 'experience') {
              void completeOnboarding()
            }
          }}
        >
          <Text>跳过</Text>
        </View>

        <View
          className='reffo-landing-onboarding__continue'
          onClick={() => {
            advanceOnboarding()
          }}
        >
          <View className='reffo-landing-onboarding__continue-label'>
            <Text className='reffo-landing-onboarding__continue-text reffo-landing-onboarding__continue-text--target'>
              右滑 继续
            </Text>
            <Text className='reffo-landing-onboarding__continue-text reffo-landing-onboarding__continue-text--experience'>
              进入教程
            </Text>
          </View>
          <Text className='reffo-landing-onboarding__arrow'>→</Text>
        </View>

        <View
          className='reffo-landing-onboarding__queue-next'
          onClick={() => {
            advanceOnboarding()
          }}
        >
          <Text className='reffo-landing-onboarding__queue-arrow'>↑</Text>
        </View>
      </View>
    )
  }

  return (
    <View className={`reffo-landing${isLeaving ? ' reffo-landing--leaving' : ''}`}>
      <Image src={REFFO_LOGO} className='reffo-landing__logo' mode='aspectFit' />
      <View className='reffo-landing__loading' aria-label='正在加载首页数据'>
        <View className='reffo-landing__loading-dot' />
        <View className='reffo-landing__loading-dot' />
        <View className='reffo-landing__loading-dot' />
      </View>
    </View>
  )
}
