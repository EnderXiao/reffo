import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {
  deriveCardPalette,
  deriveSeedColorFromString,
  normalizeHexColor,
} from '@/components/business/HomeCardDeck/palette'
import type {ResumeHistory, ResumeHistorySummary} from '@/types'
import {toResumeHistorySummaryFromHistory} from '@/utils/history-summary'
import {resolveTextInitial} from '@/utils/text-initial'
import type {GenerationTask} from '@/services/backgroundGeneration'

interface CardSeedInput {
  id: string
  company: string
  personName?: string
  indexLabel?: string
  location: string
  role: string
  dateLabel: string
  score: number
  strategyBody: string
  strategyTitle?: string
  seedColor?: string
}

const COMPANY_COLOR_OVERRIDES: Array<{matcher: RegExp; color: string}> = [
  {matcher: /小米/, color: '#FF6900'},
]

const DEMO_CARD_INPUTS: CardSeedInput[] = [
  {
    id: 'demo-f',
    company: '飞书科技',
    location: '深圳',
    role: 'AI 工作台产品经理',
    dateLabel: '生成日期 2025.12.12',
    score: 89,
    strategyBody: '优先强调 AI 能力如何落进工作流，展示你对工具链和复杂协同的理解。\n\n减少空泛产品方法论，多写可量化的效率收益。',
  },
  {
    id: 'demo-c',
    company: '携程旅行网',
    location: '上海',
    role: '增长策略产品经理',
    dateLabel: '生成日期 2025.11.20',
    score: 84,
    strategyBody: '强化增长闭环与国际化业务经验，优先展示指标拆解和策略迭代。\n\n弱化泛化执行描述，突出复杂项目中的推进与拿结果能力。',
  },
  {
    id: 'demo-d',
    company: '滴滴出行',
    location: '北京',
    role: '用户平台产品经理',
    dateLabel: '生成日期 2025.12.02',
    score: 85,
    strategyBody: '先写平台化能力、效率提升与跨团队协作，再补充用户体验优化案例。\n\n让招聘方先看到你在复杂协作场景里的判断与推进能力。',
  },
  {
    id: 'demo-e',
    company: '饿了么',
    location: '杭州',
    role: '商家增长产品经理',
    dateLabel: '生成日期 2025.12.09',
    score: 71,
    strategyBody: '突出商家侧转化提升、工具化方案与经营效率优化，弱化泛流量叙事。\n\n把案例写成“策略判断 → 功能动作 → 结果提升”的顺序。',
  },
  {
    id: 'demo-h',
    company: '华为技术有限公司',
    location: '东莞',
    role: '终端智能体产品经理',
    dateLabel: '生成日期 2025.12.14',
    score: 76,
    strategyBody: '先写端侧智能、系统协同与性能平衡，再写需求洞察与体验提升。\n\n把技术约束下的产品判断写得更具体，会更贴近岗位预期。',
  },
  {
    id: 'demo-x',
    company: '小米集团有限公司',
    location: '武汉',
    role: 'AI 产品经理',
    dateLabel: '生成日期 2025.12.15',
    score: 88,
    strategyBody: '强调“效率提升”和“工具”，淡化 C 端产品增长部分，突出出海音视频产品优化。\n\n与研发团队紧密合作，兼顾用户体验。',
  },
]

function resolveCompanySeedColor(company: string, seedColor?: string) {
  if (typeof seedColor === 'string' && seedColor.trim()) {
    return normalizeHexColor(seedColor)
  }

  const override = COMPANY_COLOR_OVERRIDES.find(item => item.matcher.test(company))
  if (override) {
    return override.color
  }

  return null
}

function resolveCardSeedColor(seed: string, company: string, seedColor?: string) {
  return (
    resolveCompanySeedColor(company, seedColor) ??
    deriveSeedColorFromString(`${seed}:${company}`)
  )
}

function resolveHistorySeed(summary: ResumeHistorySummary) {
  const generationJobId = summary.id.startsWith('JD-') ? summary.id.slice(3) : summary.id
  return `${generationJobId}:${summary.company}:${summary.position}`
}

function readPersistedCardColor(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)
    ? normalizeHexColor(normalized)
    : null
}

function buildCardItem(input: CardSeedInput): HomeCardItem {
  const seedColor = resolveCardSeedColor(input.id, input.company, input.seedColor)
  const palette = deriveCardPalette(seedColor)

  return {
    ...input,
    indexLabel: input.indexLabel ?? getIndexLabel(input.company, 0),
    primaryColor: palette.primaryColor,
    surfaceColor: palette.surfaceColor,
    stackColor: palette.stackColor,
    logoColor: palette.logoColor,
    borderColor: palette.borderColor,
    tone: palette.tone,
  }
}

function getIndexLabel(company: string, fallbackIndex: number) {
  return resolveTextInitial(company) ?? String.fromCharCode(65 + (fallbackIndex % 26))
}

function formatDateLabel(dateInput: string) {
  const date = new Date(dateInput)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `生成日期 ${year}.${month}.${day}`
}

export const DEMO_CARDS: HomeCardItem[] = DEMO_CARD_INPUTS.map((input, index) =>
  buildCardItem({
    ...input,
    indexLabel: getIndexLabel(input.company, index),
  }),
)

export function toHistorySummaryCardItem(
  summary: ResumeHistorySummary,
  index = 0,
  seedColor?: string,
): HomeCardItem {
  return buildCardItem({
    id: summary.id || `history-${index}`,
    company: summary.company || '--',
    personName: summary.name || undefined,
    indexLabel: getIndexLabel(summary.company || '', index),
    location: summary.location || '--',
    role: summary.position || '--',
    dateLabel: formatDateLabel(summary.createdAt),
    score: summary.matchScore,
    strategyBody: summary.strategyBody,
    strategyTitle: summary.strategyTitle || '优化建议',
    seedColor: readPersistedCardColor(seedColor)
      || readPersistedCardColor(summary.cardColor)
      || deriveSeedColorFromString(resolveHistorySeed(summary)),
  })
}

export function toHistoryCardItem(history: ResumeHistory, index = 0): HomeCardItem {
  return toHistorySummaryCardItem(toResumeHistorySummaryFromHistory(history), index)
}

export function toHistoryCardItems(histories: ResumeHistory[]): HomeCardItem[] {
  return histories
    .slice(0, 10)
    .map(toHistoryCardItem)
}

export function toHistorySummaryCardItems(
  summaries: ResumeHistorySummary[],
): HomeCardItem[] {
  return summaries
    .slice(0, 10)
    .map(toHistorySummaryCardItem)
}

export function toGenerationTaskCard(task: GenerationTask, summary?: ResumeHistorySummary): HomeCardItem {
  const stageLabels = {analysis: '正在理解你的经历', matching: '正在匹配目标岗位', optimized: '正在生成相契简历',
    interview: '正在准备面试建议', saving: '正在保存生成结果'}
  const status = task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'failed' : 'generating'
  const taskSeedColor = readPersistedCardColor(summary?.cardColor) || deriveSeedColorFromString(
    `${task.id}:${task.company}:${task.position}`,
  )
  const card = summary ? toHistorySummaryCardItem(summary, 0, taskSeedColor) : buildCardItem({
    id: task.id, company: task.company, role: task.position, location: task.location || '--',
    dateLabel: formatDateLabel(task.created_at), score: task.score ?? 0,
    seedColor: taskSeedColor, strategyBody: '',
  })
  return {...card, id: task.id, historyId: task.history_id || undefined, generationTaskId: task.id,
    generationStatus: status, unread: status === 'completed' && !task.read_at,
    generationLabel: task.status === 'queued' ? '正在排队，即将开始' : stageLabels[task.stage],
    ...(status === 'generating' ? {strategyTitle: '你的新申请，正在准备',
      strategyBody: `${task.company} · ${task.position}\n可以先看看其他申请，准备好后会在这里提醒你。`} : {}),
    ...(status === 'failed' ? {strategyTitle: '生成暂未完成', strategyBody: task.error || '轻触工卡重新尝试。'} : {}),
    ...(status === 'completed' && !summary ? {strategyTitle: '你的新简历已就绪',
      strategyBody: '岗位分析、相契简历和面试建议已准备好。\n轻触闪卡，查看这份新申请。'} : {}),
  }
}
