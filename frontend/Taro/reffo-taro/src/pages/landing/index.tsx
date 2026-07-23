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

type LandingPhase = 'splash' | 'onboarding'
type OnboardingStep = 'target' | 'experience'

const ONBOARDING_CARD_SEEDS = {
  experienceLeft: '#74D7A7',
  target: '#B95CFF',
  experienceRight: '#F0D45F',
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

function wait(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
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
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const onboardingLogoTimerRef = useRef<number | null>(null)

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
  }, [])

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
    return (
      <View
        className={classNames('reffo-landing-onboarding', {
          'reffo-landing-onboarding--leaving': isLeaving,
          'reffo-landing-onboarding--logo-transition': Boolean(onboardingLogoSnapshot),
          'reffo-landing-onboarding--logo-settled': hasOnboardingLogoSettled,
          'reffo-landing-onboarding--step-target': onboardingStep === 'target',
          'reffo-landing-onboarding--step-experience': onboardingStep === 'experience',
        })}
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
          <View
            className='reffo-landing-onboarding__card reffo-landing-onboarding__card--experience-left'
          >
            <HomeScoreCard
              card={ONBOARDING_CARDS[0]}
              depth={0}
              active={false}
              visualTier='enhanced'
              className='reffo-landing-onboarding__home-card'
              style={{
                '--card-responsive-scale': 0.72,
                '--card-left': '0px',
                '--card-top': '0px',
                '--card-rotate': '0deg',
                '--card-depth-scale': 1,
                zIndex: 1,
              }}
            />
          </View>
          <View
            className='reffo-landing-onboarding__card reffo-landing-onboarding__card--target'
          >
            <HomeScoreCard
              card={ONBOARDING_CARDS[1]}
              depth={0}
              active={false}
              visualTier='enhanced'
              className='reffo-landing-onboarding__home-card'
              style={{
                '--card-responsive-scale': 0.7,
                '--card-left': '0px',
                '--card-top': '0px',
                '--card-rotate': '0deg',
                '--card-depth-scale': 1,
                zIndex: 2,
              }}
            />
          </View>
          <View
            className='reffo-landing-onboarding__card reffo-landing-onboarding__card--experience-right'
          >
            <HomeScoreCard
              card={ONBOARDING_CARDS[2]}
              depth={0}
              active={false}
              visualTier='enhanced'
              className='reffo-landing-onboarding__home-card'
              style={{
                '--card-responsive-scale': 0.7,
                '--card-left': '0px',
                '--card-top': '0px',
                '--card-rotate': '0deg',
                '--card-depth-scale': 1,
                zIndex: 5,
              }}
            />
          </View>
        </View>

        <View className='reffo-landing-onboarding__headline reffo-landing-onboarding__headline--target'>
          <Text>一个</Text>
          <Text className='reffo-landing-onboarding__accent'>岗位</Text>
          <Text>{'\n'}一份专门准备的</Text>
          <Text className='reffo-landing-onboarding__accent'>简历</Text>
        </View>

        <View className='reffo-landing-onboarding__headline reffo-landing-onboarding__headline--experience'>
          <Text>开启</Text>
          <Text className='reffo-landing-onboarding__accent'>全新体验</Text>
        </View>

        <View className='reffo-landing-onboarding__body'>
          <Text>reffo会结合工作经历和目标岗位，重新组织简历重点，并准备针对性的面试建议。</Text>
        </View>

        {onboardingStep === 'experience' ? (
          <View
            className='reffo-landing-onboarding__skip'
            onClick={() => {
              void completeOnboarding()
            }}
          >
            <Text>跳过</Text>
          </View>
        ) : null}

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
