import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {flushSync} from 'react-dom'
import {Image, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import REFFO_LOGO from '@/assets/branding/reffo-logo.png'
import DETAIL_FOLDER from '@/assets/landing/detail-folder.svg'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import JobDescriptionFormH5 from '@/pages/create/components/JobDescriptionFormH5'
import CreatePrimaryActionH5 from '@/pages/create/components/CreatePrimaryActionH5'
import LandingAnalysisPage from '../landing-analysis'
import type {JobDescriptionStepState} from '@/pages/create/types'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {deriveCardPalette} from '@/components/business/HomeCardDeck/palette'
import {resolveH5CardScale} from '@/components/business/HomeCardDeck/motion.h5'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useResumeStore} from '@/store/resumeStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {sourceResumeApi} from '@/services/sourceResume'
import {apiClient} from '@/services/api'
import {useLandingFlowStore} from '@/store/landingFlowStore'
import {feedback} from '@/utils/feedback'
import {storage} from '@/utils/storage'
import {savePendingLandingSourceResume} from '@/utils/pending-landing-data'
import {navigation} from '@/utils/navigation'
import {
  formatResumeFileSize,
  isResumeFileUploadCancelled,
  pickAndParseResumeFile,
  type ParsedResumeUploadFile,
} from '@/utils/resume-file-upload'
import {
  createFallbackSharedElementSnapshot,
  createSharedElementSnapshot,
  scaleSharedElementSnapshot,
  type SharedElementSnapshot,
  writeSharedElementSnapshot,
} from '@/utils/shared-element-transition'
import {
  LANDING_PRESET_JOB_DESCRIPTIONS,
  type LandingJobDescription,
} from './constants/job-descriptions'
import {
  getLandingPresetResume,
  LANDING_RESUME_CARD_CONFIGS,
} from './constants/resumes'

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
const ONBOARDING_QUEUE_FAST_CYCLE_MS = 190
const ONBOARDING_QUEUE_POPULATE_PROGRESS = 1
const ONBOARDING_QUEUE_DECEL_MS = 2800
const ONBOARDING_QUEUE_SPIN_TOTAL_MS = ONBOARDING_QUEUE_FAST_MS + ONBOARDING_QUEUE_DECEL_MS
const ONBOARDING_QUEUE_STEADY_CYCLE_MS = 7000
const ONBOARDING_QUEUE_DRAG_ACTIVATE_PX = 8
const ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO = 1.18
const ONBOARDING_QUEUE_DRAG_PROGRESS_PER_PX = 1 / 118
const ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD = 48
const ONBOARDING_QUEUE_SNAP_LANE_INDEX = 3
const ONBOARDING_QUEUE_INERTIA_MS = 420
const ONBOARDING_QUEUE_SNAP_MS = 520
const ONBOARDING_QUEUE_MAX_INERTIA_PROGRESS = 1.32
const ONBOARDING_QUEUE_DISMISS_SELECTED_MIN_MS = 260
const ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS = 460
const ONBOARDING_QUEUE_DETAIL_EXIT_MS = 420
const ONBOARDING_QUEUE_UPLOAD_REMOVE_MS = 520
const ONBOARDING_QUEUE_FOLDER_EXIT_MS = 820
const ONBOARDING_JOB_FOLDER_OPEN_MS = 2200
const ONBOARDING_JOB_FOLDER_CLOSE_MS = 1450
const ONBOARDING_JOB_SWIPE_THRESHOLD = 46
const ONBOARDING_JOB_DRAG_RANGE = 138
const ONBOARDING_QUEUE_SELECTED_CLEARANCE_LEFT_X = 156
const ONBOARDING_QUEUE_SELECTED_CLEARANCE_RIGHT_X = 126
const ONBOARDING_QUEUE_SELECTED_CLEARANCE_Y = 28
const ONBOARDING_QUEUE_SELECTED_CLEARANCE_Z = -18
const ONBOARDING_QUEUE_SELECTED_CLEARANCE_SCALE = 0.84
const ONBOARDING_QUEUE_SELECTED_X = -118
const ONBOARDING_QUEUE_SELECTED_Z = 170
const ONBOARDING_QUEUE_SELECTED_SCALE = 0.832
const ONBOARDING_QUEUE_SELECTED_CENTER_Y = 191
const ONBOARDING_QUEUE_DETAIL_SCALE = 0.72
const ONBOARDING_QUEUE_DETAIL_Z = 210
const ONBOARDING_QUEUE_DETAIL_DROP_Y = 44
const ONBOARDING_QUEUE_CARD_ROTATE_X = '0deg'
const ONBOARDING_QUEUE_CARD_ROTATE_Y = '-15deg'
const ONBOARDING_QUEUE_CARD_ROTATE_Z = '0deg'
const ONBOARDING_JOB_CREATE_TRANSITION_MS = 1180
const resolveLandingVisualScale = () => resolveH5CardScale({amplification: 1})
type LandingPhase = 'splash' | 'onboarding'
type InlineLandingPhase = 'analysis' | 'result'
type OnboardingStep = 'target' | 'experience' | 'queue'
type QueueMotionPhase = 'idle' | 'entry' | 'spin' | 'steady' | 'manual' | 'settling' | 'selected' | 'detail' | 'folder' | 'folder-opening' | 'job-selecting' | 'creating' | 'folder-closing' | 'folder-returning' | 'dismissing'
type QueueDetailMode = 'resume' | 'upload'
type QueueSlotKind = 'slot-0' | 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'slot-5'

interface QueueSlot {
  kind: QueueSlotKind
  offset: number
  cardIndex?: number
}

type LandingQueueUploadFile = Omit<ParsedResumeUploadFile, 'extractedText'> & {
  sizeLabel: string
}

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>
  }
}

function runLandingViewTransition(update: () => void) {
  if (
    typeof document === 'undefined'
    || typeof (document as DocumentWithViewTransition).startViewTransition !== 'function'
  ) {
    update()
    return
  }

  const root = document.documentElement
  root.dataset.reffoViewTransition = 'landing-analysis'
  const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
    flushSync(update)
  })

  if (!transition) {
    delete root.dataset.reffoViewTransition
    update()
    return
  }

  void transition.finished.finally(() => {
    delete root.dataset.reffoViewTransition
  })
}

const ONBOARDING_CARD_SEEDS: Record<string, string> = {
  design: '#F0D45F',
  engineer: '#6DA9FF',
  medical: '#74D7A7',
  science: '#B95CFF',
  writing: '#FF8CA3',
  math: '#5ED1C6',
  product: '#8EA2FF',
  upload: '#1C77EB',
}

function createOnboardingCard(
  id: string,
  seedColor: string,
  input: Pick<HomeCardItem, 'company' | 'indexLabel' | 'location' | 'role' | 'dateLabel' | 'score' | 'strategyBody'>
    & Pick<HomeCardItem, 'queueCardKind'>
    & Pick<HomeCardItem, 'resumeProfile'>,
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

const ONBOARDING_QUEUE_CARDS: HomeCardItem[] = LANDING_RESUME_CARD_CONFIGS.map(({seedKey, ...card}) => (
  createOnboardingCard(card.id, ONBOARDING_CARD_SEEDS[seedKey], card)
))
const ONBOARDING_CARDS = ONBOARDING_QUEUE_CARDS.slice(0, 3)

interface QueueTrackFrame {
  phase: number
  x: number
  y: number
  z: number
  scale: number
  opacity: number
  zIndex: number
}

interface QueueCardStyleOptions {
  selectedSourceOffset?: number | null
  clearanceSourceOffset?: number | null
  isSelectedExpanded?: boolean
  isSelectedDetail?: boolean
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
  {phase: 1, x: -374, y: 72, z: 176, scale: 0.722, opacity: 0, zIndex: 1},
  {phase: 1.166667, x: -476, y: 110, z: 220, scale: 0.692, opacity: 0, zIndex: 1},
  {phase: 1.333333, x: 320, y: -184, z: -190, scale: 0.884, opacity: 0, zIndex: 1},
]

function wait(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function wrapJobIndex(index: number) {
  const count = LANDING_PRESET_JOB_DESCRIPTIONS.length
  return ((index % count) + count) % count
}

function resolveCircularJobPosition(index: number, selectedIndex: number) {
  const count = LANDING_PRESET_JOB_DESCRIPTIONS.length
  const forwardDistance = wrapJobIndex(index - selectedIndex)
  return forwardDistance > count / 2 ? forwardDistance - count : forwardDistance
}

function resolveJobCardStyle(
  job: LandingJobDescription,
  index: number,
  selectedIndex: number,
  dragOffset: number,
) {
  const collapsedFolderFrames = [
    {x: -48, y: -19, rotate: -3, scale: 0.6},
    {x: 0, y: -41, rotate: -1, scale: 0.6},
    {x: 48, y: -22, rotate: 4, scale: 0.6},
  ]
  const collapsedFrame = collapsedFolderFrames[index] ?? collapsedFolderFrames[1]
  const relativePosition = resolveCircularJobPosition(index, selectedIndex)
    + (dragOffset / ONBOARDING_JOB_DRAG_RANGE)
  const absoluteDistance = Math.abs(relativePosition)
  const distance = Math.min(2, absoluteDistance)
  // Keep the side cards separated on both the 393px H5 canvas and wider desktop previews.
  const translateX = relativePosition * 235
  const translateY = Math.min(52, distance * 30)
  const scale = Math.max(0.58, 1 - (distance * 0.28))
  const rotate = relativePosition * 7
  const opacity = absoluteDistance > 2.15
    ? 0
    : Math.max(0.24, 1 - (Math.max(0, distance - 1) * 0.58))

  return {
    '--job-accent': job.accent,
    '--job-folder-x': `${collapsedFrame.x}px`,
    '--job-folder-y': `${collapsedFrame.y}px`,
    '--job-folder-rotate': `${collapsedFrame.rotate}deg`,
    '--job-folder-scale': collapsedFrame.scale,
    '--job-folder-opacity': index < collapsedFolderFrames.length ? 1 : 0,
    '--job-folder-z': index === 0 ? 3 : index === 2 ? 2 : 1,
    '--job-card-x': `${translateX}px`,
    '--job-card-y': `${translateY}px`,
    '--job-card-scale': scale,
    '--job-card-rotate': `${rotate}deg`,
    '--job-card-opacity': opacity,
    '--job-card-z': Math.round(20 - (distance * 5)),
    '--job-card-exit-x': relativePosition < 0 ? '-115vw' : '115vw',
  } as CSSProperties
}

function selectLandingResumeCard(card: HomeCardItem) {
  if (card.queueCardKind === 'upload') {
    useLandingFlowStore.getState().clearResume()
    return
  }

  const preset = getLandingPresetResume(card.id)
  if (!preset) {
    useLandingFlowStore.getState().clearResume()
    console.warn(`[LandingPage] Preset resume not found: ${card.id}`)
    return
  }

  useLandingFlowStore.getState().selectResume({
    source: 'preset',
    id: preset.id,
    title: preset.title,
    markdown: preset.markdown,
  })
}

function interpolateQueueValue(from: number, to: number, progress: number) {
  return from + (to - from) * progress
}

function quantizeQueueValue(value: number, step = 0.5) {
  return Math.round(value / step) * step
}

function resolveQueueLaneFrame(index: number, progress: number): QueueTrackFrame {
  const from = ONBOARDING_QUEUE_TRACK[index]
  const to = ONBOARDING_QUEUE_TRACK[index + 1] ?? from

  return {
    phase: progress,
    x: quantizeQueueValue(interpolateQueueValue(from.x, to.x, progress)),
    y: quantizeQueueValue(interpolateQueueValue(from.y, to.y, progress)),
    z: quantizeQueueValue(interpolateQueueValue(from.z, to.z, progress), 1),
    scale: interpolateQueueValue(from.scale, to.scale, progress),
    opacity: interpolateQueueValue(from.opacity, to.opacity, progress),
    zIndex: Math.round(interpolateQueueValue(from.zIndex, to.zIndex, progress)),
  }
}

function resolveQueueTransform(frame: QueueTrackFrame) {
  return `translate3d(${frame.x}px, ${frame.y}px, ${frame.z}PX) rotateZ(var(--queue-rotate-z, -1deg)) rotateY(var(--queue-rotate-y, -6deg)) rotateX(var(--queue-rotate-x, 0deg)) scale(${frame.scale})`
}

function resolveSelectedQueueY() {
  const viewportHeight = typeof window === 'undefined'
    ? 852
    : window.innerHeight || document.documentElement.clientHeight || 852
  const queueBaseTop = Math.min(viewportHeight * 0.412, 352)

  return quantizeQueueValue((viewportHeight / 2) - queueBaseTop - ONBOARDING_QUEUE_SELECTED_CENTER_Y)
}

function resolveSelectedQueueTransform() {
  return `translate3d(${ONBOARDING_QUEUE_SELECTED_X}px, ${resolveSelectedQueueY()}px, ${ONBOARDING_QUEUE_SELECTED_Z}PX) rotateZ(0deg) rotateY(0deg) rotateX(0deg) scale(${ONBOARDING_QUEUE_SELECTED_SCALE})`
}

function resolveSelectedDetailQueueTransform() {
  const detailY = resolveSelectedQueueY() + ONBOARDING_QUEUE_DETAIL_DROP_Y

  return `translate3d(${ONBOARDING_QUEUE_SELECTED_X}px, ${detailY}px, ${ONBOARDING_QUEUE_DETAIL_Z}PX) rotateZ(0deg) rotateY(0deg) rotateX(0deg) scale(${ONBOARDING_QUEUE_DETAIL_SCALE})`
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

function resolveQueueCardStyle(
  offset: number,
  progress = 0,
  options: QueueCardStyleOptions = {},
): CSSProperties {
  const {
    selectedSourceOffset = null,
    clearanceSourceOffset = selectedSourceOffset,
    isSelectedExpanded = false,
    isSelectedDetail = false,
  } = options
  const frame = resolveQueueLaneFrame(offset, progress)
  const selectedFrame = clearanceSourceOffset == null
    ? null
    : resolveQueueLaneFrame(clearanceSourceOffset, progress)
  const shouldClearSelectedCard = selectedFrame && offset !== clearanceSourceOffset
  const clearanceDirection = shouldClearSelectedCard
    ? frame.x < selectedFrame.x ? -1 : 1
    : 0
  const isSelectedSourceCard = isSelectedExpanded
    && selectedSourceOffset != null
    && offset === selectedSourceOffset
  const isSelectedDetailCard = isSelectedDetail
    && selectedSourceOffset != null
    && offset === selectedSourceOffset
  const detailFrameStyle = shouldClearSelectedCard
    ? {
      ...frame,
      x: frame.x + (clearanceDirection < 0 ? -680 : 680),
      y: frame.y + (clearanceDirection < 0 ? 86 : -96),
      z: frame.z - 120,
      scale: frame.scale * 0.68,
      opacity: 0,
    }
    : frame
  const selectedFrameStyle = shouldClearSelectedCard
    ? {
      ...frame,
      x: frame.x + (clearanceDirection < 0
        ? -ONBOARDING_QUEUE_SELECTED_CLEARANCE_LEFT_X
        : ONBOARDING_QUEUE_SELECTED_CLEARANCE_RIGHT_X),
      y: frame.y - (clearanceDirection * ONBOARDING_QUEUE_SELECTED_CLEARANCE_Y),
      z: frame.z + ONBOARDING_QUEUE_SELECTED_CLEARANCE_Z,
      scale: frame.scale * ONBOARDING_QUEUE_SELECTED_CLEARANCE_SCALE,
    }
    : frame
  const resolvedFrameStyle = isSelectedDetailCard
    ? {
      ...detailFrameStyle,
      transform: resolveSelectedDetailQueueTransform(),
      opacity: 1,
      zIndex: 17,
    }
    : isSelectedDetail
      ? detailFrameStyle
      : selectedFrameStyle

  return {
    opacity: isSelectedDetailCard ? 1 : isSelectedSourceCard ? 1 : resolvedFrameStyle.opacity,
    zIndex: isSelectedDetailCard ? 17 : isSelectedSourceCard ? 16 : resolvedFrameStyle.zIndex,
    transform: isSelectedDetailCard
      ? resolveSelectedDetailQueueTransform()
      : isSelectedSourceCard
        ? resolveSelectedQueueTransform()
        : resolveQueueTransform(resolvedFrameStyle),
  }
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor
}

function resolveQueueFlowCardIndex(cursor: number, offset: number) {
  return positiveModulo(offset - cursor, ONBOARDING_QUEUE_CARDS.length)
}

function resolveQueueFlowCardPosition(cardIndex: number, progress: number) {
  const lanePosition = positiveModulo(cardIndex + progress, ONBOARDING_QUEUE_CARDS.length)
  const offset = Math.floor(lanePosition)

  return {
    offset,
    progress: lanePosition - offset,
  }
}

function clampQueueValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function resolveSelectedDismissDurationMs(pixelVelocity: number) {
  const normalizedVelocity = clampQueueValue(pixelVelocity, 0, 2.4) / 2.4

  return Math.round(
    ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS
    - ((ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS - ONBOARDING_QUEUE_DISMISS_SELECTED_MIN_MS) * normalizedVelocity),
  )
}

function easeOutQueueValue(progress: number) {
  return 1 - Math.pow(1 - progress, 3)
}

function easeInOutQueueValue(progress: number) {
  return progress < 0.5
    ? 4 * progress * progress * progress
    : 1 - Math.pow(-2 * progress + 2, 3) / 2
}

function resolveClosestQueueOffset(progress: number) {
  const laneProgress = progress - Math.floor(progress)

  return ONBOARDING_QUEUE_FLOW_SLOTS.reduce((closestOffset, slot) => {
    const currentDistance = Math.abs((slot.offset + laneProgress) - ONBOARDING_QUEUE_SNAP_LANE_INDEX)
    const closestDistance = Math.abs((closestOffset + laneProgress) - ONBOARDING_QUEUE_SNAP_LANE_INDEX)

    return currentDistance < closestDistance ? slot.offset : closestOffset
  }, ONBOARDING_QUEUE_FLOW_SLOTS[0].offset)
}

function resolveQueueSnapTargetProgress(progress: number) {
  const cursor = Math.floor(progress)
  const closestOffset = resolveClosestQueueOffset(progress)

  return cursor + ONBOARDING_QUEUE_SNAP_LANE_INDEX - closestOffset
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

  const authState = useAuthStore.getState()
  const session = await authState.restoreSession()
  const shouldLoadUserData = Boolean(session) || useAuthStore.getState().initialized !== true
  const loadProfile = useAuthStore.getState().loadProfile

  await Promise.all([
    homeRoutePromise,
    ...(shouldLoadUserData ? [
      useHistoryStore.getState().loadHistories({skipIfLoaded: true}),
      useSourceResumeStore.getState().loadLatestSourceResume({skipIfLoaded: true}),
      ...(typeof loadProfile === 'function' ? [loadProfile()] : []),
    ] : []),
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
  const [landingVisualScale, setLandingVisualScale] = useState(resolveLandingVisualScale)
  const [queueMotionPhase, setQueueMotionPhase] = useState<QueueMotionPhase>('idle')
  const [isQueueFlowPopulated, setIsQueueFlowPopulated] = useState(false)
  const [selectedQueueCardIndex, setSelectedQueueCardIndex] = useState<number | null>(null)
  const [selectedQueueSourceOffset, setSelectedQueueSourceOffset] = useState<number | null>(null)
  const [queueClearanceSourceOffset, setQueueClearanceSourceOffset] = useState<number | null>(null)
  const [isQueueSelectionExpanded, setIsQueueSelectionExpanded] = useState(false)
  const [isQueueSelectionDetail, setIsQueueSelectionDetail] = useState(false)
  const [isQueueDetailLeaving, setIsQueueDetailLeaving] = useState(false)
  const [isQueueDetailRestored, setIsQueueDetailRestored] = useState(false)
  const [selectedQueueDetailMode, setSelectedQueueDetailMode] = useState<QueueDetailMode | null>(null)
  const [isQueueUploadComplete, setIsQueueUploadComplete] = useState(false)
  const [isQueueUploadRemoving, setIsQueueUploadRemoving] = useState(false)
  const [isQueueUploading, setIsQueueUploading] = useState(false)
  const [queueUploadProgress, setQueueUploadProgress] = useState(0)
  const [queueUploadedFile, setQueueUploadedFile] = useState<LandingQueueUploadFile | null>(null)
  const [selectedJobIndex, setSelectedJobIndex] = useState(0)
  const [jobDragOffset, setJobDragOffset] = useState(0)
  const [isJobDragging, setIsJobDragging] = useState(false)
  const [isJobFolderRestored, setIsJobFolderRestored] = useState(false)
  const [isCreatingJob, setIsCreatingJob] = useState(false)
  const [isReturningFromCreatingJob, setIsReturningFromCreatingJob] = useState(false)
  const [inlineLandingPhase, setInlineLandingPhase] = useState<InlineLandingPhase | null>(null)
  const [isLandingResultComplete, setIsLandingResultComplete] = useState(false)
  const [creatingJobSourceStyle, setCreatingJobSourceStyle] = useState<CSSProperties | undefined>()
  const [creatingJobDraft, setCreatingJobDraft] = useState<JobDescriptionStepState>({
    content: '',
    companyName: '',
    positionName: '',
    baseLocation: '',
    inputMode: 'upload',
    attachmentStatus: 'idle',
    attachmentProgress: 0,
    attachment: null,
    attachmentErrorMessage: null,
  })

  useEffect(() => {
    let frameId = 0
    const refreshScale = () => {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        setLandingVisualScale(resolveLandingVisualScale())
      })
    }

    refreshScale()
    window.addEventListener('resize', refreshScale)
    window.addEventListener('orientationchange', refreshScale)
    window.visualViewport?.addEventListener('resize', refreshScale)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', refreshScale)
      window.removeEventListener('orientationchange', refreshScale)
      window.visualViewport?.removeEventListener('resize', refreshScale)
    }
  }, [])
  const [selectedDismissDurationMs, setSelectedDismissDurationMs] = useState(ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS)
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const onboardingLogoTimerRef = useRef<number | null>(null)
  const queueTimersRef = useRef<number[]>([])
  const queueAnimationFrameRef = useRef<number | null>(null)
  const queueSelectionExpandFrameRef = useRef<number | null>(null)
  const queueProgressRef = useRef(0)
  const isQueueFlowPopulatedRef = useRef(false)
  const queueDragRef = useRef<{
    startX: number
    startY: number
    startProgress: number
    lastProgress: number
    lastTimestamp: number
    velocity: number
    isDraggingQueue: boolean
    dismissedSelected: boolean
  } | null>(null)
  const queueSuppressClickUntilRef = useRef(0)
  const selectedDismissTimerRef = useRef<number | null>(null)
  const queueDetailExitTimerRef = useRef<number | null>(null)
  const queueFolderExitTimerRef = useRef<number | null>(null)
  const selectedDismissStartedAtRef = useRef<number | null>(null)
  const selectedDismissDurationMsRef = useRef(ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS)
  const queueUploadRequestRef = useRef(0)
  const queueUploadRemoveTimerRef = useRef<number | null>(null)
  const jobFolderTimerRef = useRef<number | null>(null)
  const creatingJobReturnTimerRef = useRef<number | null>(null)
  const creatingJobAttachmentRequestRef = useRef(0)
  const creatingJobAttachmentProgressTimerRef = useRef<number | null>(null)
  const landingResultCompleteRef = useRef<(() => void) | null>(null)
  const jobDragRef = useRef<{startX: number; startOffset: number; isDragging: boolean} | null>(null)
  const isInlineLandingActive = inlineLandingPhase != null
  const handleLandingResultCompleteReady = useCallback((handler: (() => void) | null) => {
    landingResultCompleteRef.current = handler
  }, [])
  const handleLandingResultCompletionChange = useCallback((isComplete: boolean) => {
    setIsLandingResultComplete(isComplete)
  }, [])

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

  const clearQueueSelectionExpandFrame = () => {
    if (queueSelectionExpandFrameRef.current != null) {
      window.cancelAnimationFrame(queueSelectionExpandFrameRef.current)
      queueSelectionExpandFrameRef.current = null
    }
  }

  const clearSelectedDismissTimer = () => {
    if (selectedDismissTimerRef.current != null) {
      window.clearTimeout(selectedDismissTimerRef.current)
      selectedDismissTimerRef.current = null
    }
  }

  const clearQueueDetailExitTimer = () => {
    if (queueDetailExitTimerRef.current != null) {
      window.clearTimeout(queueDetailExitTimerRef.current)
      queueDetailExitTimerRef.current = null
    }
  }

  const clearQueueFolderExitTimer = () => {
    if (queueFolderExitTimerRef.current != null) {
      window.clearTimeout(queueFolderExitTimerRef.current)
      queueFolderExitTimerRef.current = null
    }
  }

  const clearQueueUploadRemoveTimer = () => {
    if (queueUploadRemoveTimerRef.current != null) {
      window.clearTimeout(queueUploadRemoveTimerRef.current)
      queueUploadRemoveTimerRef.current = null
    }
  }

  const clearJobFolderTimer = () => {
    if (jobFolderTimerRef.current != null) {
      window.clearTimeout(jobFolderTimerRef.current)
      jobFolderTimerRef.current = null
    }
  }

  const clearCreatingJobReturnTimer = () => {
    if (creatingJobReturnTimerRef.current != null) {
      window.clearTimeout(creatingJobReturnTimerRef.current)
      creatingJobReturnTimerRef.current = null
    }
  }

  const clearCreatingJobAttachmentProgress = () => {
    if (creatingJobAttachmentProgressTimerRef.current != null) {
      window.clearInterval(creatingJobAttachmentProgressTimerRef.current)
      creatingJobAttachmentProgressTimerRef.current = null
    }
  }

  const startCreatingJobAttachmentProgress = (requestId: number) => {
    clearCreatingJobAttachmentProgress()
    creatingJobAttachmentProgressTimerRef.current = window.setInterval(() => {
      if (creatingJobAttachmentRequestRef.current !== requestId) {
        clearCreatingJobAttachmentProgress()
        return
      }

      setCreatingJobDraft(previous => {
        if (previous.attachmentStatus !== 'uploading') {
          return previous
        }

        return {
          ...previous,
          attachmentProgress: Math.min(
            92,
            Math.round(previous.attachmentProgress + Math.max(2, (92 - previous.attachmentProgress) * 0.18)),
          ),
        }
      })
    }, 260)
  }


  const hasSelectedDismissFinished = () => {
    if (!selectedDismissStartedAtRef.current) {
      return true
    }

    return performance.now() - selectedDismissStartedAtRef.current >= selectedDismissDurationMsRef.current
  }

  const finishSelectedDismiss = (nextPhase?: QueueMotionPhase) => {
    clearSelectedDismissTimer()
    selectedDismissStartedAtRef.current = null
    setSelectedQueueCardIndex(null)
    setSelectedQueueSourceOffset(null)
    setQueueClearanceSourceOffset(null)
    setIsQueueSelectionExpanded(false)
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(false)
    setIsQueueDetailRestored(false)
    setSelectedQueueDetailMode(null)

    if (nextPhase) {
      setQueueMotionPhase(currentPhase => currentPhase === 'dismissing' ? nextPhase : currentPhase)
    }
  }

  const enterSelectedQueueDetail = (detailMode: QueueDetailMode) => {
    if (selectedQueueSourceOffset == null || selectedQueueCardIndex == null) {
      return
    }

    const selectedCard = ONBOARDING_QUEUE_CARDS[selectedQueueCardIndex]
    if (selectedCard && selectedCard.queueCardKind !== 'upload') {
      selectLandingResumeCard(selectedCard)
    }

    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    setSelectedQueueDetailMode(detailMode)
    setIsQueueSelectionDetail(true)
    setIsQueueDetailLeaving(false)
    setIsQueueDetailRestored(false)
    setIsQueueSelectionExpanded(false)
    setQueueMotionPhase('detail')
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: selectedQueueSourceOffset,
      isSelectedExpanded: false,
      isSelectedDetail: true,
    })
  }

  const enterQueueFolder = () => {
    if (selectedQueueSourceOffset == null || selectedQueueCardIndex == null) {
      return
    }

    if (selectedQueueDetailMode === 'upload' && !isQueueUploadComplete) {
      return
    }

    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    clearJobFolderTimer()
    setSelectedJobIndex(0)
    setJobDragOffset(0)
    setIsJobFolderRestored(false)
    setIsQueueSelectionDetail(true)
    setIsQueueDetailLeaving(false)
    setIsQueueDetailRestored(false)
    setIsQueueSelectionExpanded(false)
    setQueueMotionPhase('folder')
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: selectedQueueSourceOffset,
      isSelectedExpanded: false,
      isSelectedDetail: true,
    })
  }

  const openJobFolder = () => {
    if (queueMotionPhase !== 'folder') {
      return
    }

    clearJobFolderTimer()
    setJobDragOffset(0)
    setIsJobFolderRestored(false)
    setQueueMotionPhase('folder-opening')
    jobFolderTimerRef.current = window.setTimeout(() => {
      jobFolderTimerRef.current = null
      setQueueMotionPhase('job-selecting')
    }, ONBOARDING_JOB_FOLDER_OPEN_MS)
  }

  const closeJobFolder = () => {
    if (queueMotionPhase !== 'job-selecting') {
      return
    }

    clearJobFolderTimer()
    setJobDragOffset(0)
    setQueueMotionPhase('folder-closing')
    jobFolderTimerRef.current = window.setTimeout(() => {
      jobFolderTimerRef.current = null
      setIsJobFolderRestored(true)
      setQueueMotionPhase('folder')
    }, ONBOARDING_JOB_FOLDER_CLOSE_MS)
  }

  const enterLandingJobDescription = (job: LandingJobDescription, sourceElement?: HTMLElement | null) => {
    const draft: JobDescriptionStepState = {
      content: [job.summary, ...job.responsibilities.map(item => `- ${item}`)].join('\n'),
      companyName: job.company,
      positionName: job.title,
      baseLocation: job.location,
      inputMode: 'manual',
      attachmentStatus: 'idle',
      attachmentProgress: 0,
      attachment: null,
      attachmentErrorMessage: null,
    }
    const sourceRect = sourceElement?.getBoundingClientRect()
    const formCard = sourceElement?.querySelector<HTMLElement>('.reffo-create-job')

    if (sourceRect && typeof window !== 'undefined') {
      const targetCenterY = (window.innerHeight / 2) - 10
      const targetWidth = formCard?.offsetWidth || Math.min(350, window.innerWidth - 60)
      const targetHeight = formCard?.offsetHeight || 492

      setCreatingJobSourceStyle({
        '--job-flip-end-x': `${(window.innerWidth / 2) - (sourceRect.left + (sourceRect.width / 2))}px`,
        '--job-flip-end-y': `${targetCenterY - (sourceRect.top + (sourceRect.height / 2))}px`,
        '--job-flip-grow-x': targetWidth / sourceRect.width,
        '--job-flip-grow-y': targetHeight / sourceRect.height,
      } as CSSProperties)
    } else {
      setCreatingJobSourceStyle(undefined)
    }

    creatingJobAttachmentRequestRef.current += 1
    clearCreatingJobAttachmentProgress()
    useLandingFlowStore.getState().startJobDescription({...draft, id: job.id})
    setCreatingJobDraft(draft)
    setIsReturningFromCreatingJob(false)
    setIsCreatingJob(true)
    setQueueMotionPhase('creating')
  }

  const returnFromLandingJobDescription = () => {
    if (!isCreatingJob || isReturningFromCreatingJob) {
      return
    }

    clearCreatingJobReturnTimer()
    creatingJobAttachmentRequestRef.current += 1
    clearCreatingJobAttachmentProgress()
    setIsReturningFromCreatingJob(true)
    creatingJobReturnTimerRef.current = window.setTimeout(() => {
      creatingJobReturnTimerRef.current = null
      setIsCreatingJob(false)
      setIsReturningFromCreatingJob(false)
      setCreatingJobSourceStyle(undefined)
      setQueueMotionPhase('job-selecting')
    }, ONBOARDING_JOB_CREATE_TRANSITION_MS)
  }

  const continueLandingJobDescription = () => {
    if (creatingJobDraft.attachmentStatus === 'uploading') {
      return
    }

    useLandingFlowStore.getState().startJobDescription({
      ...creatingJobDraft,
      id: LANDING_PRESET_JOB_DESCRIPTIONS[selectedJobIndex]?.id,
    })
    setIsLandingResultComplete(false)
    runLandingViewTransition(() => {
      setInlineLandingPhase('analysis')
    })
  }

  const exitQueueFolder = () => {
    if (selectedQueueSourceOffset == null || queueMotionPhase !== 'folder') {
      return
    }

    clearQueueFolderExitTimer()
    clearJobFolderTimer()
    setIsJobFolderRestored(false)
    setQueueMotionPhase('folder-returning')
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: selectedQueueSourceOffset,
      isSelectedExpanded: false,
      isSelectedDetail: true,
    })

    queueFolderExitTimerRef.current = window.setTimeout(() => {
      queueFolderExitTimerRef.current = null
      setIsQueueDetailRestored(true)
      setQueueMotionPhase('detail')
    }, ONBOARDING_QUEUE_FOLDER_EXIT_MS)
  }

  const exitSelectedQueueDetail = () => {
    if (selectedQueueSourceOffset == null) {
      return
    }

    clearQueueSelectionExpandFrame()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    if (isQueueUploading) {
      queueUploadRequestRef.current += 1
      setIsQueueUploading(false)
      setQueueUploadProgress(0)
      setQueueUploadedFile(null)
    }
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(true)
    setIsQueueDetailRestored(false)
    setIsQueueSelectionExpanded(true)
    setQueueClearanceSourceOffset(selectedQueueSourceOffset)
    setQueueMotionPhase('selected')
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: selectedQueueSourceOffset,
      isSelectedExpanded: true,
      isSelectedDetail: false,
    })

    queueDetailExitTimerRef.current = window.setTimeout(() => {
      queueDetailExitTimerRef.current = null
      setIsQueueDetailLeaving(false)
      setSelectedQueueDetailMode(null)
    }, ONBOARDING_QUEUE_DETAIL_EXIT_MS)
  }

  const handleRemoveQueueResumeUpload = () => {
    if (isQueueUploadRemoving || !queueUploadedFile) {
      return
    }

    queueUploadRequestRef.current += 1
    setIsQueueUploading(false)
    setIsQueueUploadRemoving(true)
    useResumeStore.getState().setResumeContent('')
    useLandingFlowStore.getState().clearResume()

    clearQueueUploadRemoveTimer()
    queueUploadRemoveTimerRef.current = window.setTimeout(() => {
      queueUploadRemoveTimerRef.current = null
      setIsQueueUploadRemoving(false)
      setIsQueueUploadComplete(false)
      setQueueUploadProgress(0)
      setQueueUploadedFile(null)
    }, ONBOARDING_QUEUE_UPLOAD_REMOVE_MS)
  }

  const handleQueueResumeUpload = async () => {
    if (
      queueMotionPhase !== 'detail'
      || selectedQueueDetailMode !== 'upload'
      || isQueueUploadComplete
      || isQueueUploadRemoving
      || isQueueUploading
    ) {
      return
    }

    const requestId = queueUploadRequestRef.current + 1
    queueUploadRequestRef.current = requestId

    try {
      const parsedFile = await pickAndParseResumeFile({
        allowGuest: true,
        isActive: () => queueUploadRequestRef.current === requestId,
        onFileSelected: selectedFile => {
          setQueueUploadedFile({
            ...selectedFile,
            sizeLabel: formatResumeFileSize(selectedFile.size),
          })
          setQueueUploadProgress(0)
          setIsQueueUploading(true)
        },
        onProgress: setQueueUploadProgress,
      })

      if (!parsedFile || queueUploadRequestRef.current !== requestId) {
        return
      }

      setQueueUploadedFile({
        name: parsedFile.name,
        path: parsedFile.path,
        size: parsedFile.size,
        extension: parsedFile.extension,
        file: parsedFile.file,
        sizeLabel: formatResumeFileSize(parsedFile.size),
      })
      setQueueUploadProgress(100)
      useResumeStore.getState().setResumeContent(parsedFile.extractedText)
      useLandingFlowStore.getState().selectResume({
        source: 'upload',
        id: 'landing-upload',
        title: parsedFile.name,
        fileName: parsedFile.name,
        markdown: parsedFile.extractedText,
      })

      if (apiClient.getAuthToken()) {
        const savedSourceResume = await sourceResumeApi.saveSourceResume({
          title: parsedFile.name,
          resume_markdown: parsedFile.extractedText,
          source_type: 'file',
          original_file_name: parsedFile.name,
        })
        await useSourceResumeStore.getState().setLatestSourceResume(savedSourceResume)
      } else {
        const now = new Date().toISOString()
        await savePendingLandingSourceResume({
          id: `landing-source-${Date.now()}`,
          title: parsedFile.name,
          resumeMarkdown: parsedFile.extractedText,
          sourceType: 'file',
          originalFileName: parsedFile.name,
          sourcePath: parsedFile.path,
          sizeBytes: parsedFile.size,
          createdAt: now,
          updatedAt: now,
        })
      }

      setIsQueueUploadComplete(true)
      setIsQueueUploadRemoving(false)
      feedback.success(`${parsedFile.name} 已上传`)
    } catch (error) {
      if (isResumeFileUploadCancelled(error)) {
        return
      }

      const message = error instanceof Error ? error.message : '上传失败，请重试'
      console.error('[LandingPage] Resume upload failed:', error)
      setQueueUploadProgress(0)
      setQueueUploadedFile(null)
      setIsQueueUploadRemoving(false)
      feedback.error(message)
    } finally {
      if (queueUploadRequestRef.current === requestId) {
        setIsQueueUploading(false)
      }
    }
  }

  const applyQueueProgress = (
    progress: number,
    styleOptions: QueueCardStyleOptions = {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: queueClearanceSourceOffset,
      isSelectedExpanded: queueMotionPhase === 'selected' && isQueueSelectionExpanded,
      isSelectedDetail: (
        queueMotionPhase === 'detail'
        || queueMotionPhase === 'folder'
        || queueMotionPhase === 'folder-returning'
      ) && isQueueSelectionDetail,
    },
  ) => {
    queueProgressRef.current = progress
    const queueCards = typeof document === 'undefined'
      ? []
      : Array.from(document.querySelectorAll<HTMLElement>('[data-queue-card-index]'))

    queueCards.forEach(element => {
      const cardIndex = Number(element.dataset.queueCardIndex ?? 0)
      const position = resolveQueueFlowCardPosition(cardIndex, progress)
      const frameStyle = resolveQueueCardStyle(position.offset, position.progress, styleOptions)

      element.dataset.queueOffset = String(position.offset)
      element.style.opacity = String(frameStyle.opacity ?? 1)
      element.style.zIndex = String(frameStyle.zIndex ?? 1)
      element.style.transform = String(frameStyle.transform ?? '')
    })
  }

  const populateQueueFlow = () => {
    if (isQueueFlowPopulatedRef.current) {
      return
    }

    isQueueFlowPopulatedRef.current = true
    setIsQueueFlowPopulated(true)
  }

  const stopQueueAutoMotion = () => {
    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    setQueueMotionPhase('manual')
    applyQueueProgress(queueProgressRef.current)
  }

  const dismissSelectedQueueCard = (pixelVelocity = 0) => {
    if (selectedQueueCardIndex == null && selectedQueueSourceOffset == null) {
      return false
    }

    const dismissDurationMs = resolveSelectedDismissDurationMs(pixelVelocity)

    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueFolderExitTimer()
    selectedDismissDurationMsRef.current = dismissDurationMs
    selectedDismissStartedAtRef.current = performance.now()
    setSelectedDismissDurationMs(dismissDurationMs)
    setQueueMotionPhase('dismissing')
    setQueueClearanceSourceOffset(null)
    setIsQueueSelectionExpanded(false)
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(false)
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: null,
      isSelectedExpanded: false,
      isSelectedDetail: false,
    })

    selectedDismissTimerRef.current = window.setTimeout(() => {
      finishSelectedDismiss('manual')
    }, dismissDurationMs)

    return true
  }

  const animateQueueProgress = (
    fromProgress: number,
    toProgress: number,
    durationMs: number,
    easing: (progress: number) => number,
    onComplete?: () => void,
  ) => {
    clearQueueAnimationFrame()

    const startedAt = performance.now()
    const tick = (timestamp: number) => {
      const elapsed = timestamp - startedAt
      const progress = clampQueueValue(elapsed / durationMs, 0, 1)
      const easedProgress = easing(progress)

      applyQueueProgress(fromProgress + ((toProgress - fromProgress) * easedProgress))

      if (progress < 1) {
        queueAnimationFrameRef.current = window.requestAnimationFrame(tick)
        return
      }

      queueAnimationFrameRef.current = null
      onComplete?.()
    }

    queueAnimationFrameRef.current = window.requestAnimationFrame(tick)
  }

  const selectQueueCardAtProgress = (progress: number) => {
    const cursor = Math.floor(progress)
    const selectedCardIndex = resolveQueueFlowCardIndex(cursor, ONBOARDING_QUEUE_SNAP_LANE_INDEX)
    const selectedCard = ONBOARDING_QUEUE_CARDS[selectedCardIndex]

    if (selectedCard) {
      selectLandingResumeCard(selectedCard)
    }

    queueProgressRef.current = progress
    setSelectedQueueCardIndex(selectedCardIndex)
    setSelectedQueueSourceOffset(ONBOARDING_QUEUE_SNAP_LANE_INDEX)
    setQueueClearanceSourceOffset(null)
    setIsQueueSelectionExpanded(false)
    setQueueMotionPhase('selected')
    applyQueueProgress(progress, {
      selectedSourceOffset: ONBOARDING_QUEUE_SNAP_LANE_INDEX,
      clearanceSourceOffset: null,
      isSelectedExpanded: false,
    })

    clearQueueSelectionExpandFrame()
    queueSelectionExpandFrameRef.current = window.requestAnimationFrame(() => {
      queueSelectionExpandFrameRef.current = window.requestAnimationFrame(() => {
        queueSelectionExpandFrameRef.current = null
        setQueueClearanceSourceOffset(ONBOARDING_QUEUE_SNAP_LANE_INDEX)
        setIsQueueSelectionExpanded(true)
        applyQueueProgress(progress, {
          selectedSourceOffset: ONBOARDING_QUEUE_SNAP_LANE_INDEX,
          clearanceSourceOffset: ONBOARDING_QUEUE_SNAP_LANE_INDEX,
          isSelectedExpanded: true,
        })
      })
    })
  }

  const settleQueueToSelection = (velocity = 0, sourceProgress = queueProgressRef.current) => {
    clearQueueTimers()
    clearQueueAnimationFrame()
    setQueueMotionPhase('settling')

    const inertiaDistance = clampQueueValue(
      velocity * ONBOARDING_QUEUE_INERTIA_MS,
      -ONBOARDING_QUEUE_MAX_INERTIA_PROGRESS,
      ONBOARDING_QUEUE_MAX_INERTIA_PROGRESS,
    )
    const inertiaTarget = sourceProgress + inertiaDistance
    const snapTarget = resolveQueueSnapTargetProgress(inertiaTarget)

    animateQueueProgress(sourceProgress, inertiaTarget, ONBOARDING_QUEUE_INERTIA_MS, easeOutQueueValue, () => {
      animateQueueProgress(inertiaTarget, snapTarget, ONBOARDING_QUEUE_SNAP_MS, easeInOutQueueValue, () => {
        applyQueueProgress(snapTarget)
        selectQueueCardAtProgress(snapTarget)
      })
    })
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
      setSelectedQueueCardIndex(null)
      setSelectedQueueSourceOffset(null)
      setQueueClearanceSourceOffset(null)
      setIsQueueSelectionExpanded(false)
      setIsQueueSelectionDetail(false)
      setIsQueueDetailLeaving(false)
      setIsQueueDetailRestored(false)
      setSelectedQueueDetailMode(null)
      queueProgressRef.current = 0
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
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    clearQueueUploadRemoveTimer()
    clearJobFolderTimer()
    clearCreatingJobReturnTimer()
    clearCreatingJobAttachmentProgress()
    queueUploadRequestRef.current += 1
    creatingJobAttachmentRequestRef.current += 1
  }, [])

  useEffect(() => {
    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueDetailExitTimer()
    clearQueueFolderExitTimer()
    clearQueueUploadRemoveTimer()
    clearJobFolderTimer()
    clearCreatingJobReturnTimer()

    if (phase !== 'onboarding' || onboardingStep !== 'queue' || isLeaving) {
      setQueueMotionPhase('idle')
      setSelectedQueueCardIndex(null)
      setSelectedQueueSourceOffset(null)
      setQueueClearanceSourceOffset(null)
      setIsQueueSelectionExpanded(false)
      setIsQueueSelectionDetail(false)
      setIsQueueDetailLeaving(false)
      setIsQueueDetailRestored(false)
      setSelectedQueueDetailMode(null)
      setIsQueueUploadComplete(false)
      setIsQueueUploadRemoving(false)
      setIsQueueUploading(false)
      setQueueUploadProgress(0)
      setQueueUploadedFile(null)
      setSelectedJobIndex(0)
      setJobDragOffset(0)
      setIsJobFolderRestored(false)
      setIsCreatingJob(false)
      setIsReturningFromCreatingJob(false)
      setCreatingJobSourceStyle(undefined)
      queueUploadRequestRef.current += 1
      queueProgressRef.current = 0
      isQueueFlowPopulatedRef.current = false
      setIsQueueFlowPopulated(false)
      return undefined
    }

    setQueueMotionPhase('entry')
    setSelectedQueueCardIndex(null)
    setSelectedQueueSourceOffset(null)
    setQueueClearanceSourceOffset(null)
    setIsQueueSelectionExpanded(false)
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(false)
    setIsQueueDetailRestored(false)
    setSelectedQueueDetailMode(null)
    queueProgressRef.current = 0
    isQueueFlowPopulatedRef.current = false
    setIsQueueFlowPopulated(false)

    const entryTimer = window.setTimeout(() => {
      setQueueMotionPhase('spin')

      const startedAt = performance.now()
      const tick = (timestamp: number) => {
        const elapsedMs = timestamp - startedAt
        const progress = resolveQueueProgress(elapsedMs)

        if (progress >= ONBOARDING_QUEUE_POPULATE_PROGRESS) {
          populateQueueFlow()
        }

        applyQueueProgress(progress)

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
      clearQueueSelectionExpandFrame()
    }
  }, [isLeaving, onboardingStep, phase])

  useLayoutEffect(() => {
    const isQueueFlowPhase = queueMotionPhase === 'spin'
      || queueMotionPhase === 'steady'
      || queueMotionPhase === 'manual'
      || queueMotionPhase === 'settling'
      || queueMotionPhase === 'selected'
      || queueMotionPhase === 'detail'
      || queueMotionPhase === 'folder'
      || queueMotionPhase === 'folder-opening'
      || queueMotionPhase === 'job-selecting'
      || queueMotionPhase === 'folder-closing'
      || queueMotionPhase === 'folder-returning'
      || queueMotionPhase === 'creating'
      || queueMotionPhase === 'dismissing'

    if (phase !== 'onboarding' || onboardingStep !== 'queue' || !isQueueFlowPhase) {
      return
    }

    applyQueueProgress(queueProgressRef.current)
  }, [
    isQueueSelectionExpanded,
    onboardingStep,
    phase,
    queueMotionPhase,
    selectedQueueSourceOffset,
    queueClearanceSourceOffset,
    isQueueSelectionDetail,
    isQueueDetailLeaving,
  ])

  const completeOnboarding = async () => {
    if (phase !== 'onboarding' || isLeaving) {
      return
    }

    setIsLeaving(true)
    useLandingFlowStore.getState().clear()
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

    jobDragRef.current = queueMotionPhase === 'job-selecting'
      ? {startX: touch.clientX, startOffset: jobDragOffset, isDragging: false}
      : null

    if (queueMotionPhase === 'creating') {
      queueDragRef.current = null
      return
    }

    if (queueMotionPhase === 'job-selecting') {
      queueDragRef.current = null
      return
    }

    if (
      onboardingStep === 'queue'
      && (queueMotionPhase === 'entry' || queueMotionPhase === 'spin' || queueMotionPhase === 'steady')
    ) {
      populateQueueFlow()
    }

    queueDragRef.current = onboardingStep === 'queue'
      ? {
        startX: touch.clientX,
        startY: touch.clientY,
        startProgress: queueProgressRef.current,
        lastProgress: queueProgressRef.current,
        lastTimestamp: performance.now(),
        velocity: 0,
        isDraggingQueue: false,
        dismissedSelected: false,
      }
      : null
  }

  const handleTouchMove = (event: any) => {
    if (phase !== 'onboarding' || onboardingStep !== 'queue') {
      return
    }

    const touch = event.touches?.[0] ?? event.changedTouches?.[0]
    const jobDrag = jobDragRef.current

    if (queueMotionPhase === 'job-selecting' && touch && jobDrag) {
      const deltaX = touch.clientX - jobDrag.startX

      if (!jobDrag.isDragging && Math.abs(deltaX) < ONBOARDING_QUEUE_DRAG_ACTIVATE_PX) {
        return
      }

      jobDrag.isDragging = true
      setIsJobDragging(true)
      event.preventDefault?.()
      setJobDragOffset(Math.max(-ONBOARDING_JOB_DRAG_RANGE, Math.min(ONBOARDING_JOB_DRAG_RANGE, jobDrag.startOffset + deltaX)))
      return
    }

    const drag = queueDragRef.current

    if (!touch || !drag) {
      return
    }

    if (
      queueMotionPhase === 'detail'
      || queueMotionPhase === 'folder'
      || queueMotionPhase === 'folder-opening'
      || queueMotionPhase === 'folder-closing'
      || queueMotionPhase === 'folder-returning'
      || queueMotionPhase === 'creating'
      || isQueueDetailLeaving
    ) {
      event.preventDefault?.()
      return
    }

    const deltaX = touch.clientX - drag.startX
    const deltaY = touch.clientY - drag.startY
    const timestamp = performance.now()
    const elapsed = Math.max(1, timestamp - drag.lastTimestamp)
    const isHorizontalDrag = Math.abs(deltaX) >= ONBOARDING_QUEUE_DRAG_ACTIVATE_PX
      && Math.abs(deltaX) > Math.abs(deltaY) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO

    if (!drag.isDraggingQueue && !isHorizontalDrag) {
      return
    }

    if (!drag.isDraggingQueue) {
      drag.isDraggingQueue = true
      drag.dismissedSelected = dismissSelectedQueueCard(Math.abs(deltaX) / elapsed)

      if (drag.dismissedSelected) {
        event.preventDefault?.()
        drag.lastTimestamp = timestamp
        return
      }

      if (!drag.dismissedSelected) {
        setSelectedQueueCardIndex(null)
        setSelectedQueueSourceOffset(null)
        setIsQueueSelectionExpanded(false)
        stopQueueAutoMotion()
      }
    }

    event.preventDefault?.()

    if (drag.dismissedSelected) {
      if (!hasSelectedDismissFinished()) {
        drag.lastTimestamp = timestamp
        return
      }

      finishSelectedDismiss('manual')
      drag.dismissedSelected = false
      drag.isDraggingQueue = false
      drag.startX = touch.clientX
      drag.startY = touch.clientY
      drag.startProgress = queueProgressRef.current
      drag.lastProgress = queueProgressRef.current
      drag.lastTimestamp = timestamp
      drag.velocity = 0
      return
    }

    const nextProgress = drag.startProgress - (deltaX * ONBOARDING_QUEUE_DRAG_PROGRESS_PER_PX)

    drag.velocity = (nextProgress - drag.lastProgress) / elapsed
    drag.lastProgress = nextProgress
    drag.lastTimestamp = timestamp
    applyQueueProgress(nextProgress)
  }

  const handleTouchEnd = (event: any) => {
    if (phase !== 'onboarding') {
      return
    }

    const queueDrag = queueDragRef.current
    const jobDrag = jobDragRef.current
    const start = touchStartRef.current
    const touch = event.changedTouches?.[0]
    queueDragRef.current = null
    jobDragRef.current = null

    if (onboardingStep === 'queue') {
      touchStartRef.current = null
      if (queueMotionPhase === 'job-selecting' && start && touch) {
        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        const isHorizontalJobSwipe = Math.abs(deltaX) >= ONBOARDING_JOB_SWIPE_THRESHOLD
          && Math.abs(deltaX) > Math.abs(deltaY) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO

        if (jobDrag?.isDragging && isHorizontalJobSwipe) {
          event.preventDefault?.()
          event.stopPropagation?.()
          setSelectedJobIndex(currentIndex => wrapJobIndex(currentIndex + (deltaX < 0 ? 1 : -1)))
        }

        setJobDragOffset(0)
        setIsJobDragging(false)
        return
      }

      if (queueMotionPhase === 'folder-opening' || queueMotionPhase === 'folder-closing') {
        return
      }

      if ((queueMotionPhase === 'folder' || queueMotionPhase === 'folder-returning') && start && touch) {
        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        const isHorizontalBackSwipe = Math.abs(deltaX) >= ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD
          && Math.abs(deltaX) > Math.abs(deltaY) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO
        const isDownFolderSwipe = deltaY >= ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD
          && Math.abs(deltaY) > Math.abs(deltaX) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO

        if (isHorizontalBackSwipe && queueMotionPhase === 'folder') {
          event.preventDefault?.()
          exitQueueFolder()
          return
        }

        if (isDownFolderSwipe && queueMotionPhase === 'folder') {
          event.preventDefault?.()
          void completeOnboarding()
        }

        return
      }

      if ((queueMotionPhase === 'detail' || isQueueDetailLeaving) && start && touch) {
        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        const isHorizontalBackSwipe = Math.abs(deltaX) >= ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD
          && Math.abs(deltaX) > Math.abs(deltaY) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO
        const isDownDetailSwipe = deltaY >= ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD
          && Math.abs(deltaY) > Math.abs(deltaX) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO

        if (isHorizontalBackSwipe && !isQueueDetailLeaving) {
          event.preventDefault?.()
          exitSelectedQueueDetail()
          return
        }

        if (isDownDetailSwipe && !isQueueDetailLeaving) {
          event.preventDefault?.()

          if (selectedQueueDetailMode === 'upload' && !isQueueUploadComplete) {
            return
          }

          enterQueueFolder()
          return
        }

        return
      }

      if (queueDrag?.isDraggingQueue) {
        queueSuppressClickUntilRef.current = performance.now() + 420
        if (queueDrag.dismissedSelected) {
          queueSuppressClickUntilRef.current = performance.now() + selectedDismissDurationMsRef.current
        } else {
          settleQueueToSelection(queueDrag.velocity, queueProgressRef.current)
        }
        return
      }

      if (start && touch) {
        const deltaX = touch.clientX - start.x
        const deltaY = touch.clientY - start.y
        const isDownSelectSwipe = deltaY >= ONBOARDING_QUEUE_SELECT_SWIPE_THRESHOLD
          && Math.abs(deltaY) > Math.abs(deltaX) * ONBOARDING_QUEUE_DRAG_DIRECTION_RATIO

        if (isDownSelectSwipe && selectedQueueCardIndex == null) {
          event.preventDefault?.()
          stopQueueAutoMotion()
          populateQueueFlow()

          const currentProgress = queueProgressRef.current
          const targetProgress = resolveQueueSnapTargetProgress(currentProgress)

          setQueueMotionPhase('settling')
          animateQueueProgress(currentProgress, targetProgress, ONBOARDING_QUEUE_SNAP_MS, easeInOutQueueValue, () => {
            applyQueueProgress(targetProgress)
            selectQueueCardAtProgress(targetProgress)
          })
          return
        }

        if (
          isDownSelectSwipe
          && selectedQueueCardIndex != null
          && !isQueueSelectionDetail
          && !isQueueDetailLeaving
        ) {
          event.preventDefault?.()
          const selectedCard = ONBOARDING_QUEUE_CARDS[selectedQueueCardIndex]
          enterSelectedQueueDetail(
            selectedCard?.queueCardKind === 'upload' ? 'upload' : 'resume',
          )
        }
      }
      return
    }

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
    const isQueueFlow = queueMotionPhase === 'spin'
      || queueMotionPhase === 'steady'
      || queueMotionPhase === 'manual'
      || queueMotionPhase === 'settling'
      || queueMotionPhase === 'selected'
      || queueMotionPhase === 'detail'
      || queueMotionPhase === 'folder'
      || queueMotionPhase === 'folder-opening'
      || queueMotionPhase === 'job-selecting'
      || queueMotionPhase === 'folder-closing'
      || queueMotionPhase === 'folder-returning'
      || queueMotionPhase === 'creating'
      || queueMotionPhase === 'dismissing'
    const selectedQueueCard = selectedQueueCardIndex == null ? null : ONBOARDING_QUEUE_CARDS[selectedQueueCardIndex]
    const isQueueFolderStep = queueMotionPhase === 'folder'
      || queueMotionPhase === 'folder-opening'
      || queueMotionPhase === 'job-selecting'
      || queueMotionPhase === 'folder-closing'
      || queueMotionPhase === 'creating'
    const isSelectedUploadCard = selectedQueueCard?.queueCardKind === 'upload'
    const isQueueUploadPending = selectedQueueDetailMode === 'upload'
      && !isQueueUploadComplete
      && !isQueueUploadRemoving
    const canActivateQueueUpload = queueMotionPhase === 'detail'
      && isQueueUploadPending
      && !isQueueUploading
    const shouldShowDetailProgress = selectedQueueDetailMode === 'resume' || isQueueUploadComplete
    const queueCycleStyle = isQueueStep
      ? ({
        '--queue-rotate-x': ONBOARDING_QUEUE_CARD_ROTATE_X,
        '--queue-rotate-y': ONBOARDING_QUEUE_CARD_ROTATE_Y,
        '--queue-rotate-z': ONBOARDING_QUEUE_CARD_ROTATE_Z,
        '--queue-selected-x': `${ONBOARDING_QUEUE_SELECTED_X}px`,
        '--queue-selected-y': `${resolveSelectedQueueY()}px`,
        '--queue-selected-z': `${ONBOARDING_QUEUE_SELECTED_Z}PX`,
        '--queue-selected-scale': ONBOARDING_QUEUE_SELECTED_SCALE,
        '--queue-dismiss-ms': `${selectedDismissDurationMs}ms`,
      } as CSSProperties)
      : undefined
    const queueCards = isQueueFlow
      ? ONBOARDING_QUEUE_CARDS
        .slice(0, isQueueFlowPopulated ? undefined : ONBOARDING_QUEUE_ENTRY_SLOTS.length)
        .map((card, cardIndex) => ({
          key: `queue-${card.id}`,
          card,
          cardIndex,
          kind: null,
          position: resolveQueueFlowCardPosition(cardIndex, queueProgressRef.current),
        }))
      : ONBOARDING_QUEUE_ENTRY_SLOTS.map(({kind, offset, cardIndex}) => ({
        key: `queue-${ONBOARDING_QUEUE_CARDS[cardIndex ?? offset].id}`,
        card: ONBOARDING_QUEUE_CARDS[cardIndex ?? offset],
        cardIndex: cardIndex ?? offset,
        kind,
        position: null,
      }))

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
          'reffo-landing-onboarding--queue-manual': queueMotionPhase === 'manual',
          'reffo-landing-onboarding--queue-settling': queueMotionPhase === 'settling',
          'reffo-landing-onboarding--queue-selected': queueMotionPhase === 'selected',
          'reffo-landing-onboarding--queue-detail': queueMotionPhase === 'detail',
          'reffo-landing-onboarding--queue-folder': queueMotionPhase === 'folder',
          'reffo-landing-onboarding--queue-folder-step': isQueueFolderStep,
          'reffo-landing-onboarding--job-folder-restored': isJobFolderRestored,
          'reffo-landing-onboarding--queue-folder-opening': queueMotionPhase === 'folder-opening',
          'reffo-landing-onboarding--job-selecting': queueMotionPhase === 'job-selecting' || isCreatingJob,
          'reffo-landing-onboarding--job-dragging': isJobDragging,
          'reffo-landing-onboarding--queue-folder-closing': queueMotionPhase === 'folder-closing',
          'reffo-landing-onboarding--queue-folder-returning': queueMotionPhase === 'folder-returning',
          'reffo-landing-onboarding--creating-job': isCreatingJob,
          'reffo-landing-onboarding--returning-from-job': isReturningFromCreatingJob,
          'reffo-landing-onboarding--queue-detail-restored': isQueueDetailRestored,
          'reffo-landing-onboarding--queue-detail-leaving': isQueueDetailLeaving,
          'reffo-landing-onboarding--queue-detail-upload': selectedQueueDetailMode === 'upload',
          'reffo-landing-onboarding--queue-upload-pending': isQueueUploadPending,
          'reffo-landing-onboarding--queue-uploading': isQueueUploading,
          'reffo-landing-onboarding--queue-upload-removing': isQueueUploadRemoving,
          'reffo-landing-onboarding--queue-detail-uploaded': isQueueUploadComplete,
          'reffo-landing-onboarding--queue-dismissing': queueMotionPhase === 'dismissing',
          'reffo-landing-onboarding--analysis-active': isInlineLandingActive,
          'reffo-landing-onboarding--result-active': inlineLandingPhase === 'result',
        })}
        style={queueCycleStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          touchStartRef.current = null
          queueDragRef.current = null
          jobDragRef.current = null
          setJobDragOffset(0)
          setIsJobDragging(false)
        }}
      >
        <img src={REFFO_LOGO} className='reffo-landing-onboarding__logo' alt='Reffo' />
        {onboardingLogoSnapshot && onboardingLogoStyle ? (
          <img
            src={REFFO_LOGO}
            className='reffo-landing-onboarding__logo-flight'
            style={onboardingLogoStyle}
            alt='Reffo'
          />
        ) : null}

        <View
          className={classNames('reffo-landing-onboarding__visual-scale', {
            'reffo-landing-onboarding__visual-scale--folder': isQueueFolderStep,
          })}
          style={{'--landing-visual-scale': landingVisualScale} as CSSProperties}
        >
        <View className='reffo-landing-onboarding__cards reffo-home-deck-wrap--enhanced'>
          {isQueueStep ? (
            queueCards.map(({key, card, cardIndex, kind, position}) => {
              const isSelectedSourceCard = isQueueFlow
                && selectedQueueCardIndex === cardIndex
                && selectedQueueCard != null
              const isDetailSourceCard = isSelectedSourceCard
                && (isQueueSelectionDetail || isQueueDetailLeaving)
              const queueCardFaceStyle = {
                '--card-responsive-scale': 1,
                '--card-left': '0px',
                '--card-top': '0px',
                '--card-rotate': '0deg',
                '--card-depth-scale': 1,
                zIndex: 1,
              } as CSSProperties

              return (
                <View
                  key={key}
                  data-queue-offset={isQueueFlow ? position?.offset : undefined}
                  data-queue-card-index={isQueueFlow ? cardIndex : undefined}
                  data-queue-card-kind={isQueueFlow ? card.queueCardKind : undefined}
                  className={classNames(
                    'reffo-landing-onboarding__card',
                    'reffo-landing-onboarding__card--queue',
                    {
                      'reffo-landing-onboarding__card--queue-flow': isQueueFlow,
                      'reffo-landing-onboarding__card--queue-selected-source':
                        isSelectedSourceCard,
                      'reffo-landing-onboarding__card--queue-detail-source':
                        isDetailSourceCard,
                      [`reffo-landing-onboarding__card--queue-flow-${position?.offset}`]: isQueueFlow,
                      [`reffo-landing-onboarding__card--queue-${kind}`]: !isQueueFlow && kind != null,
                    },
                  )}
                  style={isQueueFlow && position
                    ? resolveQueueCardStyle(position.offset, position.progress, {
                      selectedSourceOffset: selectedQueueSourceOffset,
                      clearanceSourceOffset: queueClearanceSourceOffset,
                      isSelectedExpanded: queueMotionPhase === 'selected' && isQueueSelectionExpanded,
                      isSelectedDetail: (
                        queueMotionPhase === 'detail'
                        || queueMotionPhase === 'folder'
                        || queueMotionPhase === 'folder-returning'
                      ) && isQueueSelectionDetail,
                    })
                    : undefined}
                >
                  <View className='reffo-landing-onboarding__queue-flipper'>
                    <View className='reffo-landing-onboarding__queue-original'>
                      <HomeScoreCard
                        card={card}
                        depth={0}
                        active={false}
                        visualTier='enhanced'
                        presentation='queue3d'
                        className='reffo-landing-onboarding__home-card'
                        style={queueCardFaceStyle}
                        uploadStatus={isQueueUploadComplete
                          ? 'success'
                          : isQueueUploading
                            ? 'uploading'
                            : 'idle'}
                        uploadFile={queueUploadedFile}
                        uploadProgress={queueUploadProgress}
                        uploadRemoving={isQueueUploadRemoving}
                        onUploadRemove={handleRemoveQueueResumeUpload}
                      />
                    </View>
                    {isDetailSourceCard ? (
                      <View
                        className={classNames('reffo-landing-onboarding__queue-detail-back', {
                          'reffo-landing-onboarding__queue-detail-back--upload-action': canActivateQueueUpload,
                        })}
                        role={canActivateQueueUpload ? 'button' : undefined}
                        aria-label={canActivateQueueUpload ? '上传简历文件' : undefined}
                        onClick={canActivateQueueUpload ? () => {
                          void handleQueueResumeUpload()
                        } : undefined}
                      >
                        <HomeScoreCard
                          card={card}
                          depth={0}
                          active={false}
                          visualTier='enhanced'
                          presentation='queue3d'
                          className='reffo-landing-onboarding__home-card'
                          style={queueCardFaceStyle}
                          uploadStatus={isQueueUploadComplete
                            ? 'success'
                            : isQueueUploading
                              ? 'uploading'
                              : 'idle'}
                          uploadFile={queueUploadedFile}
                          uploadProgress={queueUploadProgress}
                          uploadRemoving={isQueueUploadRemoving}
                          onUploadRemove={handleRemoveQueueResumeUpload}
                        />
                      </View>
                    ) : null}
                  </View>
                  {isDetailSourceCard && shouldShowDetailProgress ? (
                    <View className='reffo-landing-onboarding__detail-card-arrow' />
                  ) : null}
                  {isSelectedSourceCard ? (
                    <View className='reffo-landing-onboarding__selected-shadow' />
                  ) : null}
                  {isSelectedSourceCard ? (
                    <View className='reffo-landing-onboarding__selected-card-guide' aria-hidden='true'>
                      <Text>下滑查看详情</Text>
                      <View className='reffo-landing-onboarding__selected-card-guide-arrow' />
                    </View>
                  ) : null}
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
            <View className={classNames('reffo-landing-onboarding__pager-dot', {
              'reffo-landing-onboarding__pager-dot--active': !isQueueFolderStep && !isInlineLandingActive,
            })} />
            <View className={classNames('reffo-landing-onboarding__pager-dot', {
              'reffo-landing-onboarding__pager-dot--active': isQueueFolderStep && inlineLandingPhase !== 'result',
            })} />
            <View className={classNames('reffo-landing-onboarding__pager-dot', {
              'reffo-landing-onboarding__pager-dot--active': inlineLandingPhase === 'result',
            })} />
          </View>
        </View>

        {(isQueueSelectionDetail || isQueueDetailLeaving) && selectedQueueDetailMode ? (
          <>
            <View className='reffo-landing-onboarding__detail-chrome'>
              <View
                className={classNames('reffo-landing-onboarding__detail-return', {
                  'reffo-landing-onboarding__detail-return--completion': inlineLandingPhase === 'result',
                  'reffo-landing-onboarding__detail-return--completion-ready':
                    inlineLandingPhase === 'result' && isLandingResultComplete,
                })}
                role='button'
                aria-disabled={inlineLandingPhase === 'result' && !isLandingResultComplete}
                onClick={event => {
                  event.stopPropagation?.()

                  if (inlineLandingPhase === 'result') {
                    landingResultCompleteRef.current?.()
                    return
                  }

                  if (inlineLandingPhase === 'analysis') {
                    runLandingViewTransition(() => {
                      setInlineLandingPhase(null)
                    })
                    return
                  }

                  if (queueMotionPhase === 'job-selecting') {
                    closeJobFolder()
                    return
                  }

                  if (queueMotionPhase === 'folder') {
                    exitQueueFolder()
                    return
                  }

                  if (queueMotionPhase === 'detail') {
                    exitSelectedQueueDetail()
                  }

                  if (queueMotionPhase === 'creating') {
                    returnFromLandingJobDescription()
                  }
                }}
              >
                <Text>{inlineLandingPhase === 'result' ? '完成' : '返回'}</Text>
              </View>
            </View>
            {shouldShowDetailProgress ? (
              <View
                className='reffo-landing-onboarding__detail-folder'
                role={queueMotionPhase === 'folder' ? 'button' : undefined}
                aria-label={queueMotionPhase === 'folder' ? '展开岗位文件' : undefined}
                onClick={queueMotionPhase === 'folder' ? event => {
                  event.stopPropagation?.()
                  openJobFolder()
                } : undefined}
              >
                <View className='reffo-landing-onboarding__detail-folder-front'>
                  <View className='reffo-landing-onboarding__detail-folder-front-plane'>
                    <Image
                      className='reffo-landing-onboarding__detail-folder-shape'
                      src={DETAIL_FOLDER}
                      mode='scaleToFill'
                    />
                  </View>
                </View>
                <View className='reffo-landing-onboarding__target-folder-back' />
                <View className='reffo-landing-onboarding__target-files'>
                  {LANDING_PRESET_JOB_DESCRIPTIONS.map((file, index) => {
                    const isSelectedJob = index === selectedJobIndex
                    const jobCardStyle = resolveJobCardStyle(file, index, selectedJobIndex, jobDragOffset)

                    return (
                    <View
                      key={file.id}
                      className={classNames(
                        'reffo-landing-onboarding__target-file',
                        `reffo-landing-onboarding__target-file--${file.id}`,
                        {'reffo-landing-onboarding__target-file--selected': isSelectedJob},
                      )}
                      data-job-id={file.id}
                      data-job-index={index}
                      style={isSelectedJob && creatingJobSourceStyle
                        ? {...jobCardStyle, ...creatingJobSourceStyle}
                        : jobCardStyle}
                      onClick={queueMotionPhase === 'job-selecting' ? event => {
                        event.stopPropagation?.()
                        if (isSelectedJob) {
                          enterLandingJobDescription(file, event.currentTarget as unknown as HTMLElement)
                          return
                        }
                        setSelectedJobIndex(index)
                        setJobDragOffset(0)
                      } : undefined}
                    >
                      <View className='reffo-landing-onboarding__target-file-front'>
                        <Text className='reffo-landing-onboarding__target-file-title'>{file.title}</Text>
                        <View className='reffo-landing-onboarding__target-file-preview'>
                          <View className='reffo-landing-onboarding__target-file-line reffo-landing-onboarding__target-file-line--short' />
                          <View className='reffo-landing-onboarding__target-file-line' />
                          <View className='reffo-landing-onboarding__target-file-line reffo-landing-onboarding__target-file-line--medium' />
                        </View>
                        <View className='reffo-landing-onboarding__job-detail'>
                          <View className='reffo-landing-onboarding__job-meta'>
                            <Text>{file.company}</Text>
                            <Text>{file.location}</Text>
                            <Text>{file.experience} · {file.salary}</Text>
                          </View>
                          <Text className='reffo-landing-onboarding__job-summary'>{file.summary}</Text>
                          <Text className='reffo-landing-onboarding__job-section-title'>岗位职责</Text>
                          <View className='reffo-landing-onboarding__job-responsibilities'>
                            {file.responsibilities.map(responsibility => (
                              <View key={responsibility} className='reffo-landing-onboarding__job-responsibility'>
                                <View className='reffo-landing-onboarding__job-bullet' />
                                <Text>{responsibility}</Text>
                              </View>
                            ))}
                          </View>
                          <Text className='reffo-landing-onboarding__job-overflow'>•••</Text>
                        </View>
                      </View>
                      {isSelectedJob ? (
                        <View className='reffo-landing-onboarding__target-file-back'>
                          <JobDescriptionFormH5
                            state={creatingJobDraft}
                            onCompanyNameChange={undefined}
                            onPositionNameChange={undefined}
                            onLocationChange={undefined}
                            onContentChange={undefined}
                            onPickAttachment={undefined}
                            isFormReadOnly
                          />
                        </View>
                      ) : null}
                    </View>
                    )
                  })}
                </View>
                <View className='reffo-landing-onboarding__target-folder-copy'>
                  <Text className='reffo-landing-onboarding__target-folder-owner'>我</Text>
                  <Text className='reffo-landing-onboarding__target-folder-label'>可投递的岗位</Text>
                  <View className='reffo-landing-onboarding__target-folder-count'>
                    <Text className='reffo-landing-onboarding__target-folder-count-value'>{LANDING_PRESET_JOB_DESCRIPTIONS.length}</Text>
                    <Text className='reffo-landing-onboarding__target-folder-count-label'>份岗位描述</Text>
                  </View>
                </View>
              </View>
            ) : null}
            {isCreatingJob ? (
              <View className='reffo-landing-create-page'>
                <CreatePrimaryActionH5
                  label='开始生成最佳简历'
                  disabled={creatingJobDraft.attachmentStatus === 'uploading'}
                  onClick={continueLandingJobDescription}
                />
              </View>
            ) : null}
            {queueMotionPhase === 'job-selecting' ? (
              <View
                className='reffo-landing-onboarding__job-selection-dismiss'
                aria-label='收起岗位文件'
                onClick={closeJobFolder}
              />
            ) : null}
          </>
        ) : null}
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

        {selectedQueueCard && !isQueueSelectionDetail && !isQueueDetailLeaving ? (
          <View className='reffo-landing-onboarding__queue-guidance'>
            <Text>
              {isSelectedUploadCard
                ? '已经准备好了简历？可以上传自己的简历以开始。'
                : '简历还没准备好？可以选择一位虚构的求职者以开始。'}
            </Text>
          </View>
        ) : null}

        {selectedQueueDetailMode
        && (isQueueSelectionDetail || isQueueDetailLeaving) ? (
          <View className='reffo-landing-onboarding__queue-detail-guidance'>
            <Text>
              {selectedQueueDetailMode === 'upload'
                ? '上传的信息越详细，reffo 就能为您生成一份与目标职位越契合的简历。'
                : '选中求职者后，恭喜你现在已经准备好进入下一步！'}
            </Text>
          </View>
        ) : null}

        <View className='reffo-landing-onboarding__folder-copy'>
          <View className='reffo-landing-onboarding__folder-headline'>
            <Text>选择</Text>
            <Text className='reffo-landing-onboarding__folder-accent'>目标岗位</Text>
          </View>
          <Text className='reffo-landing-onboarding__folder-description'>
            选择一份目标岗位，reffo 会重新匹配简历与岗位的价值。
          </Text>
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

        {selectedQueueDetailMode === 'upload'
        && isQueueUploadPending
        && (isQueueSelectionDetail || isQueueDetailLeaving) ? (
          <View className='reffo-landing-onboarding__queue-upload-instruction' aria-busy={isQueueUploading}>
            <Text>{isQueueUploading ? '正在读取简历...' : '上传文件以下一步'}</Text>
          </View>
        ) : null}

        {isInlineLandingActive ? (
          <LandingAnalysisPage
            useSharedHeader
            onPhaseChange={setInlineLandingPhase}
            onResultCompleteReady={handleLandingResultCompleteReady}
            onResultCompletionChange={handleLandingResultCompletionChange}
            onExit={() => {
              setIsLandingResultComplete(false)
              runLandingViewTransition(() => {
                setInlineLandingPhase(null)
              })
            }}
          />
        ) : null}
      </View>
    )
  }

  return (
    <View className={`reffo-landing${isLeaving ? ' reffo-landing--leaving' : ''}`}>
      <img src={REFFO_LOGO} className='reffo-landing__logo' alt='Reffo' />
      <View className='reffo-landing__loading' aria-label='正在加载首页数据'>
        <View className='reffo-landing__loading-dot' />
        <View className='reffo-landing__loading-dot' />
        <View className='reffo-landing__loading-dot' />
      </View>
    </View>
  )
}
