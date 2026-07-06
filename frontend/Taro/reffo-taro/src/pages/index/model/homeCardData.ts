import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {
  deriveCardPalette,
  deriveSeedColorFromString,
  normalizeHexColor,
} from '@/components/business/HomeCardDeck/palette'
import type {ResumeHistory} from '@/types'

interface CardSeedInput {
  id: string
  company: string
  indexLabel: string
  location: string
  role: string
  dateLabel: string
  score: number
  strategyBody: string
  seedColor?: string
}

const COMPANY_COLOR_OVERRIDES: Array<{matcher: RegExp; color: string}> = [
  {matcher: /小米/, color: '#FF6900'},
]

const CHINESE_INITIALS: Record<string, string> = {
  携: 'C',
  程: 'C',
  滴: 'D',
  饿: 'E',
  飞: 'F',
  高: 'G',
  华: 'H',
  美: 'M',
  小: 'X',
  百: 'B',
  阿: 'A',
  京: 'J',
  微: 'W',
  拼: 'P',
}

const DEMO_CARD_INPUTS: CardSeedInput[] = [
  {
    id: 'demo-f',
    company: '飞书科技',
    indexLabel: 'F',
    location: '深圳',
    role: 'AI 工作台产品经理',
    dateLabel: '生成日期 2025.12.12',
    score: 89,
    strategyBody: '优先强调 AI 能力如何落进工作流，展示你对工具链和复杂协同的理解。\n\n减少空泛产品方法论，多写可量化的效率收益。',
  },
  {
    id: 'demo-c',
    company: '携程旅行网',
    indexLabel: 'C',
    location: '上海',
    role: '增长策略产品经理',
    dateLabel: '生成日期 2025.11.20',
    score: 84,
    strategyBody: '强化增长闭环与国际化业务经验，优先展示指标拆解和策略迭代。\n\n弱化泛化执行描述，突出复杂项目中的推进与拿结果能力。',
  },
  {
    id: 'demo-d',
    company: '滴滴出行',
    indexLabel: 'D',
    location: '北京',
    role: '用户平台产品经理',
    dateLabel: '生成日期 2025.12.02',
    score: 85,
    strategyBody: '先写平台化能力、效率提升与跨团队协作，再补充用户体验优化案例。\n\n让招聘方先看到你在复杂协作场景里的判断与推进能力。',
  },
  {
    id: 'demo-e',
    company: '饿了么',
    indexLabel: 'E',
    location: '杭州',
    role: '商家增长产品经理',
    dateLabel: '生成日期 2025.12.09',
    score: 71,
    strategyBody: '突出商家侧转化提升、工具化方案与经营效率优化，弱化泛流量叙事。\n\n把案例写成“策略判断 → 功能动作 → 结果提升”的顺序。',
  },
  {
    id: 'demo-h',
    company: '华为技术有限公司',
    indexLabel: 'H',
    location: '东莞',
    role: '终端智能体产品经理',
    dateLabel: '生成日期 2025.12.14',
    score: 76,
    strategyBody: '先写端侧智能、系统协同与性能平衡，再写需求洞察与体验提升。\n\n把技术约束下的产品判断写得更具体，会更贴近岗位预期。',
  },
  {
    id: 'demo-x',
    company: '小米集团有限公司',
    indexLabel: 'X',
    location: '武汉',
    role: 'AI 产品经理',
    dateLabel: '生成日期 2025.12.15',
    score: 88,
    strategyBody: '强调“效率提升”和“工具”，淡化 C 端产品增长部分，突出出海音视频产品优化。\n\n与研发团队紧密合作，兼顾用户体验。',
  },
]

function resolveCompanySeedColor(company: string, seedColor?: string) {
  if (seedColor) {
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

function buildCardItem(input: CardSeedInput): HomeCardItem {
  const seedColor = resolveCardSeedColor(input.id, input.company, input.seedColor)
  const palette = deriveCardPalette(seedColor)

  return {
    ...input,
    primaryColor: palette.primaryColor,
    surfaceColor: palette.surfaceColor,
    stackColor: palette.stackColor,
    logoColor: palette.logoColor,
    borderColor: palette.borderColor,
    tone: palette.tone,
  }
}

function getIndexLabel(company: string, fallbackIndex: number) {
  const trimmed = company.trim()
  const firstChar = trimmed.charAt(0)

  if (CHINESE_INITIALS[firstChar]) {
    return CHINESE_INITIALS[firstChar]
  }

  const latinMatch = trimmed.match(/[A-Za-z]/)
  if (latinMatch) {
    return latinMatch[0].toUpperCase()
  }

  return String.fromCharCode(65 + (fallbackIndex % 26))
}

function formatDateLabel(dateInput: string) {
  const date = new Date(dateInput)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `生成日期 ${year}.${month}.${day}`
}

function buildHistoryStrategyBody(history: ResumeHistory) {
  const company = history.company || '目标公司'
  const role = history.position || '目标岗位'

  return `优先突出与${company}相关的经验，把最贴近${role}的案例放到前面。\n\n弱化泛化职责描述，强化效率提升、跨团队协同和可量化结果。`
}

export const DEMO_CARDS: HomeCardItem[] = DEMO_CARD_INPUTS.map(buildCardItem)

export function toHistoryCardItem(history: ResumeHistory, index = 0): HomeCardItem {
  return buildCardItem({
    id: history.id || `history-${index}`,
    company: history.company || '--',
    indexLabel: getIndexLabel(history.company || '', index),
    location: '--',
    role: history.position || '--',
    dateLabel: formatDateLabel(history.createdAt),
    score: history.matchScore,
    strategyBody: buildHistoryStrategyBody(history),
    seedColor: history.cardColor,
  })
}

export function toHistoryCardItems(histories: ResumeHistory[]): HomeCardItem[] {
  return histories
    .slice(0, 10)
    .map(toHistoryCardItem)
}
