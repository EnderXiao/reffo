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

type LandingPhase = 'splash' | 'onboarding'
type OnboardingStep = 'target' | 'experience' | 'queue'
type QueueMotionPhase = 'idle' | 'entry' | 'spin' | 'steady' | 'manual' | 'settling' | 'selected' | 'detail' | 'dismissing'
type QueueDetailMode = 'resume' | 'upload'
type QueueSlotKind = 'slot-0' | 'slot-1' | 'slot-2' | 'slot-3' | 'slot-4' | 'slot-5'

interface QueueSlot {
  kind: QueueSlotKind
  offset: number
  cardIndex?: number
}

const ONBOARDING_CARD_SEEDS = {
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

const ONBOARDING_CARDS: HomeCardItem[] = [
  createOnboardingCard('landing-resume-design', ONBOARDING_CARD_SEEDS.design, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '01',
    location: '应届生',
    role: '视觉传达设计',
    dateLabel: '2026.07',
    score: 86,
    strategyBody: '校园品牌项目和插画实践经历较集中，适合设计助理、品牌视觉等岗位。',
    resumeProfile: {
      name: '小A',
      age: 22,
      gender: '女',
      avatarPrimary: '#ffd96a',
      avatarAccent: '#f4b53f',
      avatarVariant: 0,
      tags: ['本科学历', '视觉传达设计', '有实习', '插画/品牌'],
      summary: '参与校园视觉系统和公益海报项目，审美敏感，表达直接，适合从作品集切入。',
    },
  }),
  createOnboardingCard('landing-resume-engineer', ONBOARDING_CARD_SEEDS.engineer, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '02',
    location: '应届生',
    role: '计算机科学',
    dateLabel: '2026.07',
    score: 91,
    strategyBody: '有前端实习和开源组件实践，工程习惯较好，适合前端研发、全栈实习转正岗位。',
    resumeProfile: {
      name: '小B',
      age: 24,
      gender: '男',
      avatarPrimary: '#7bb7ff',
      avatarAccent: '#1c77eb',
      avatarVariant: 1,
      tags: ['硕士学历', '计算机科学', '有实习', '工程化/全栈'],
      summary: '做过低代码组件和数据看板，喜欢拆解复杂问题，代码风格稳定，沟通偏结果导向。',
    },
  }),
  createOnboardingCard('landing-resume-medical', ONBOARDING_CARD_SEEDS.medical, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '03',
    location: '社招生',
    role: '临床医学',
    dateLabel: '2026.07',
    score: 89,
    strategyBody: '临床轮转和科室协作经历完整，适合医疗运营、临床项目协调、医学内容岗位。',
    resumeProfile: {
      name: '小C',
      age: 27,
      gender: '女',
      avatarPrimary: '#7ee0ad',
      avatarAccent: '#28b879',
      avatarVariant: 2,
      tags: ['硕士学历', '临床医学', '规培经历', '细致/共情'],
      summary: '完成三甲医院轮转和病例随访项目，耐心细致，能把专业信息转成用户可理解表达。',
    },
  }),
]

const ONBOARDING_QUEUE_CARDS: HomeCardItem[] = [
  ...ONBOARDING_CARDS,
  createOnboardingCard('landing-resume-biology', ONBOARDING_CARD_SEEDS.science, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '04',
    location: '社招生',
    role: '生物统计',
    dateLabel: '2026.07',
    score: 93,
    strategyBody: '科研论文、临床数据分析和统计建模经验扎实，适合医药数据分析、生统岗位。',
    resumeProfile: {
      name: '小D',
      age: 31,
      gender: '男',
      avatarPrimary: '#c990ff',
      avatarAccent: '#7d32e8',
      avatarVariant: 0,
      tags: ['博士学历', '生物统计', '科研项目', '建模/严谨'],
      summary: '主导真实世界研究数据清洗和模型验证，习惯用证据说话，文档和复盘能力强。',
    },
  }),
  createOnboardingCard('landing-resume-writing', ONBOARDING_CARD_SEEDS.writing, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '05',
    location: '社招生',
    role: '汉语言文学',
    dateLabel: '2026.07',
    score: 87,
    strategyBody: '内容策划、社群活动和知识库搭建经验丰富，适合品牌内容、用户运营岗位。',
    resumeProfile: {
      name: '小E',
      age: 35,
      gender: '女',
      avatarPrimary: '#ff9bb2',
      avatarAccent: '#ef5d7a',
      avatarVariant: 1,
      tags: ['本科学历', '汉语言文学', '社招经验', '内容/组织'],
      summary: '做过年度栏目策划和用户访谈沉淀，文字敏感，推进稳，擅长把松散信息组织成体系。',
    },
  }),
  createOnboardingCard('landing-resume-math', ONBOARDING_CARD_SEEDS.math, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '06',
    location: '社招生',
    role: '应用数学',
    dateLabel: '2026.07',
    score: 90,
    strategyBody: '推荐系统实验和指标分析经验较完整，适合数据分析、策略产品、算法工程方向。',
    resumeProfile: {
      name: '小F',
      age: 29,
      gender: '男',
      avatarPrimary: '#76ddd3',
      avatarAccent: '#21a8a0',
      avatarVariant: 2,
      tags: ['硕士学历', '应用数学', '社招经验', '抽象/建模'],
      summary: '参与推荐实验和经营指标拆解，逻辑强，偏安静型协作，适合复杂业务中的分析任务。',
    },
  }),
  createOnboardingCard('landing-resume-product', ONBOARDING_CARD_SEEDS.product, {
    queueCardKind: 'resume',
    company: '预设简历',
    indexLabel: '07',
    location: '社招生',
    role: '工业设计',
    dateLabel: '2026.07',
    score: 92,
    strategyBody: '硬件产品、用户研究和跨团队项目管理经验完整，适合产品经理、体验策略岗位。',
    resumeProfile: {
      name: '小G',
      age: 41,
      gender: '女',
      avatarPrimary: '#9baaff',
      avatarAccent: '#5967d8',
      avatarVariant: 0,
      tags: ['MBA学历', '工业设计', '社招经验', '产品/协同'],
      summary: '从工业设计转到产品管理，带过从调研到量产的项目，判断稳，擅长跨团队推进。',
    },
  }),
  createOnboardingCard('landing-resume-upload', ONBOARDING_CARD_SEEDS.upload, {
    queueCardKind: 'upload',
    company: '上传简历',
    indexLabel: '08',
    location: '自定义',
    role: '新的申请',
    dateLabel: '2026.07',
    score: 88,
    strategyBody: '上传自己的简历后，Reffo 会基于真实经历生成更贴近目标岗位的版本。',
    resumeProfile: undefined,
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
  const [selectedQueueCardIndex, setSelectedQueueCardIndex] = useState<number | null>(null)
  const [selectedQueueSourceOffset, setSelectedQueueSourceOffset] = useState<number | null>(null)
  const [queueClearanceSourceOffset, setQueueClearanceSourceOffset] = useState<number | null>(null)
  const [isQueueSelectionExpanded, setIsQueueSelectionExpanded] = useState(false)
  const [isQueueSelectionDetail, setIsQueueSelectionDetail] = useState(false)
  const [isQueueDetailLeaving, setIsQueueDetailLeaving] = useState(false)
  const [selectedQueueDetailMode, setSelectedQueueDetailMode] = useState<QueueDetailMode | null>(null)
  const [isQueueUploadComplete, setIsQueueUploadComplete] = useState(false)
  const [selectedDismissDurationMs, setSelectedDismissDurationMs] = useState(ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS)
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const onboardingLogoTimerRef = useRef<number | null>(null)
  const queueTimersRef = useRef<number[]>([])
  const queueAnimationFrameRef = useRef<number | null>(null)
  const queueSelectionExpandFrameRef = useRef<number | null>(null)
  const queueProgressRef = useRef(0)
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
  const selectedDismissStartedAtRef = useRef<number | null>(null)
  const selectedDismissDurationMsRef = useRef(ONBOARDING_QUEUE_DISMISS_SELECTED_MAX_MS)

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
    setSelectedQueueDetailMode(null)
    setIsQueueUploadComplete(false)

    if (nextPhase) {
      setQueueMotionPhase(currentPhase => currentPhase === 'dismissing' ? nextPhase : currentPhase)
    }
  }

  const enterSelectedQueueDetail = (detailMode: QueueDetailMode) => {
    if (selectedQueueSourceOffset == null || selectedQueueCardIndex == null) {
      return
    }

    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearQueueDetailExitTimer()
    setSelectedQueueDetailMode(detailMode)
    setIsQueueUploadComplete(false)
    setIsQueueSelectionDetail(true)
    setIsQueueDetailLeaving(false)
    setIsQueueSelectionExpanded(false)
    setQueueMotionPhase('detail')
    applyQueueProgress(queueProgressRef.current, {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: selectedQueueSourceOffset,
      isSelectedExpanded: false,
      isSelectedDetail: true,
    })
  }

  const exitSelectedQueueDetail = () => {
    if (selectedQueueSourceOffset == null) {
      return
    }

    clearQueueSelectionExpandFrame()
    clearQueueDetailExitTimer()
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(true)
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
      setIsQueueUploadComplete(false)
    }, ONBOARDING_QUEUE_DETAIL_EXIT_MS)
  }

  const applyQueueProgress = (
    progress: number,
    styleOptions: QueueCardStyleOptions = {
      selectedSourceOffset: selectedQueueSourceOffset,
      clearanceSourceOffset: queueClearanceSourceOffset,
      isSelectedExpanded: queueMotionPhase === 'selected' && isQueueSelectionExpanded,
      isSelectedDetail: queueMotionPhase === 'detail' && isQueueSelectionDetail,
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

  const stopQueueAutoMotion = () => {
    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueDetailExitTimer()
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
      setSelectedQueueDetailMode(null)
      setIsQueueUploadComplete(false)
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
  }, [])

  useEffect(() => {
    clearQueueTimers()
    clearQueueAnimationFrame()
    clearQueueSelectionExpandFrame()
    clearSelectedDismissTimer()
    clearQueueDetailExitTimer()

    if (phase !== 'onboarding' || onboardingStep !== 'queue' || isLeaving) {
      setQueueMotionPhase('idle')
      setSelectedQueueCardIndex(null)
      setSelectedQueueSourceOffset(null)
      setQueueClearanceSourceOffset(null)
      setIsQueueSelectionExpanded(false)
      setIsQueueSelectionDetail(false)
      setIsQueueDetailLeaving(false)
      setSelectedQueueDetailMode(null)
      setIsQueueUploadComplete(false)
      queueProgressRef.current = 0
      return undefined
    }

    setQueueMotionPhase('entry')
    setSelectedQueueCardIndex(null)
    setSelectedQueueSourceOffset(null)
    setQueueClearanceSourceOffset(null)
    setIsQueueSelectionExpanded(false)
    setIsQueueSelectionDetail(false)
    setIsQueueDetailLeaving(false)
    setSelectedQueueDetailMode(null)
    setIsQueueUploadComplete(false)
    queueProgressRef.current = 0

    const entryTimer = window.setTimeout(() => {
      setQueueMotionPhase('spin')

      const startedAt = performance.now()
      const tick = (timestamp: number) => {
        const elapsedMs = timestamp - startedAt
        const progress = resolveQueueProgress(elapsedMs)
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
    const drag = queueDragRef.current

    if (!touch || !drag) {
      return
    }

    if (queueMotionPhase === 'detail' || isQueueDetailLeaving) {
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
    const start = touchStartRef.current
    const touch = event.changedTouches?.[0]
    queueDragRef.current = null

    if (onboardingStep === 'queue') {
      touchStartRef.current = null
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
          void completeOnboarding()
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
      || queueMotionPhase === 'dismissing'
    const selectedQueueCard = selectedQueueCardIndex == null ? null : ONBOARDING_QUEUE_CARDS[selectedQueueCardIndex]
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
      ? ONBOARDING_QUEUE_CARDS.map((card, cardIndex) => ({
        key: `flow-${card.id}`,
        card,
        cardIndex,
        kind: null,
        position: resolveQueueFlowCardPosition(cardIndex, queueProgressRef.current),
      }))
      : ONBOARDING_QUEUE_ENTRY_SLOTS.map(({kind, offset, cardIndex}) => ({
        key: `entry-${kind}`,
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
          'reffo-landing-onboarding--queue-detail-leaving': isQueueDetailLeaving,
          'reffo-landing-onboarding--queue-detail-uploaded': isQueueUploadComplete,
          'reffo-landing-onboarding--queue-dismissing': queueMotionPhase === 'dismissing',
        })}
        style={queueCycleStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={() => {
          touchStartRef.current = null
          queueDragRef.current = null
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
            queueCards.map(({key, card, cardIndex, kind, position}) => {
              const isSelectedSourceCard = isQueueFlow
                && selectedQueueCardIndex === cardIndex
                && selectedQueueCard != null

              return (
                <View
                  key={key}
                  data-queue-offset={isQueueFlow ? position?.offset : undefined}
                  data-queue-card-index={isQueueFlow ? cardIndex : undefined}
                  className={classNames(
                    'reffo-landing-onboarding__card',
                    'reffo-landing-onboarding__card--queue',
                    {
                      'reffo-landing-onboarding__card--queue-flow': isQueueFlow,
                      'reffo-landing-onboarding__card--queue-selected-source':
                        isSelectedSourceCard,
                      'reffo-landing-onboarding__card--queue-detail-source':
                        isSelectedSourceCard && (isQueueSelectionDetail || isQueueDetailLeaving),
                      [`reffo-landing-onboarding__card--queue-flow-${position?.offset}`]: isQueueFlow,
                      [`reffo-landing-onboarding__card--queue-${kind}`]: !isQueueFlow && kind != null,
                    },
                  )}
                  style={isQueueFlow && position
                    ? resolveQueueCardStyle(position.offset, position.progress, {
                      selectedSourceOffset: selectedQueueSourceOffset,
                      clearanceSourceOffset: queueClearanceSourceOffset,
                      isSelectedExpanded: queueMotionPhase === 'selected' && isQueueSelectionExpanded,
                      isSelectedDetail: queueMotionPhase === 'detail' && isQueueSelectionDetail,
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
                    {isSelectedSourceCard
                    && (isQueueSelectionDetail || isQueueDetailLeaving)
                    && selectedQueueDetailMode ? (
                      <View
                        className={classNames(
                          'reffo-landing-onboarding__detail-card',
                          `reffo-landing-onboarding__detail-card--${selectedQueueDetailMode}`,
                          {
                            'reffo-landing-onboarding__detail-card--uploaded': isQueueUploadComplete,
                          },
                        )}
                      >
                        {selectedQueueDetailMode === 'upload' ? (
                          <View className='reffo-landing-onboarding__detail-upload'>
                            <View className='reffo-landing-onboarding__detail-file-icon' />
                            <Text className='reffo-landing-onboarding__detail-file-title'>
                              {isQueueUploadComplete ? '已读取简历' : '上传简历'}
                            </Text>
                            <Text className='reffo-landing-onboarding__detail-file-size'>
                              {isQueueUploadComplete ? 'Resume_MelvinKuffour.pdf' : 'PDF / DOCX'}
                            </Text>
                          </View>
                        ) : (
                          <View className='reffo-landing-onboarding__detail-resume'>
                            <Text className='reffo-landing-onboarding__detail-name'>
                              {selectedQueueCard?.resumeProfile?.name}
                            </Text>
                            <Text className='reffo-landing-onboarding__detail-meta'>
                              {selectedQueueCard?.resumeProfile?.age}岁 · {selectedQueueCard?.resumeProfile?.gender}
                            </Text>
                            <View className='reffo-landing-onboarding__detail-tags'>
                              {(selectedQueueCard?.resumeProfile?.tags ?? []).map(tag => (
                                <Text key={tag} className='reffo-landing-onboarding__detail-tag'>{tag}</Text>
                              ))}
                            </View>
                            <Text className='reffo-landing-onboarding__detail-summary'>
                              {selectedQueueCard?.resumeProfile?.summary}
                            </Text>
                            <Text className='reffo-landing-onboarding__detail-experience'>
                              {selectedQueueCard?.strategyBody}
                            </Text>
                          </View>
                        )}
                      </View>
                    ) : null}
                  </View>
                  {isSelectedSourceCard ? (
                    <View className='reffo-landing-onboarding__selected-shadow' />
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
            <View className='reffo-landing-onboarding__pager-dot reffo-landing-onboarding__pager-dot--active' />
            <View className='reffo-landing-onboarding__pager-dot' />
            <View className='reffo-landing-onboarding__pager-dot' />
          </View>
        </View>

        {(isQueueSelectionDetail || isQueueDetailLeaving) && selectedQueueDetailMode ? (
          <>
            <View className='reffo-landing-onboarding__detail-chrome'>
              <View
                className='reffo-landing-onboarding__detail-return'
                onClick={() => {
                  exitSelectedQueueDetail()
                }}
              >
                <Text>返回</Text>
              </View>
            </View>
            <View
              className='reffo-landing-onboarding__detail-folder'
            >
              <View className='reffo-landing-onboarding__detail-folder-arrow' />
            </View>
          </>
        ) : null}

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

        {selectedQueueCard && !isQueueSelectionDetail && !isQueueDetailLeaving ? (
          <View
            className='reffo-landing-onboarding__queue-next'
            onClick={() => {
              advanceOnboarding()
            }}
          >
            <View className='reffo-landing-onboarding__selected-next-copy'>
              <Text className='reffo-landing-onboarding__selected-next-title'>还没准备好简历？</Text>
              <Text className='reffo-landing-onboarding__selected-next-subtitle'>下滑选择本次体验的求职者</Text>
            </View>
          </View>
        ) : null}
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
