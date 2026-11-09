import type {
  JobShareCardSnapshot,
  ShareSnapshot,
  BlankShareCardSnapshot,
} from '@/types/share-link'
import type { ResumeHistoryRecord } from '@/types'
import { buildResumeValueSummary } from '@/shared/resume-strategy'

const SHARE_LANDING_COPY = {
  brand: 'Reffo',
  teaser_title: '一个岗位',
  teaser_subtitle: '一份专门准备的简历',
  teaser_hint: '尝试 Reffo，开启全新求职体验',
  revealed_title: '用 Reffo 量身定制你的新简历',
  revealed_body: '智能弥合简历和工作岗位之间的差距，提高在就业市场的竞争力。',
  cta: '即刻体验',
} as const

function sanitizeText(value: string | undefined | null, maxLength: number) {
  const normalized = (value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized
}

function formatShareDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '--'

  return `${part('year')}.${part('month')}.${part('day')}`
}

export function extractShareLocation(history: ResumeHistoryRecord) {
  const contextLocation = history.result_context?.location?.trim()
  if (contextLocation) return sanitizeText(contextLocation, 24)

  const match = history.jd_content.match(
    /(?:工作地点|工作地|办公地点|办公地|地点|城市|Base地|base地|Base|base)[：:]\s*(.+?)(?:\n|\r|$)/i,
  )

  return sanitizeText(match?.[1], 24) || '--'
}

function buildSummaryLines(history: ResumeHistoryRecord) {
  const processResult = history.process_result as {
    matching?: {optimization_suggestions?: string[]}
    optimized?: {strategy_review?: unknown}
    analysis?: {suggestions?: string[]}
  } | undefined
  const summary = buildResumeValueSummary({
    markdown: history.optimized_content,
    review: processResult?.optimized?.strategy_review,
    advice: [
      history.optimization_suggestions,
      processResult?.matching?.optimization_suggestions,
      processResult?.analysis?.suggestions,
    ].flatMap(values => Array.isArray(values) ? values : []),
  })

  return summary.body
    .split(/\n+/)
    .map(line => sanitizeText(line, 180))
    .filter(Boolean)
    .slice(0, 3)
}

export class ShareHistoryIncompleteError extends Error {
  constructor() {
    super('岗位信息不完整，无法创建携带岗位信息的分享')
    this.name = 'ShareHistoryIncompleteError'
  }
}

function buildJobCard(history: ResumeHistoryRecord): JobShareCardSnapshot {
  const company = sanitizeText(history.company, 32)
  const position = sanitizeText(history.position, 40)
  const displayName = sanitizeText(history.name, 24)

  if (!company || company === '--' || !position || position === '--') {
    throw new ShareHistoryIncompleteError()
  }

  return {
    kind: 'job',
    display_name: displayName || '--',
    company,
    position,
    location: extractShareLocation(history),
    generated_date: formatShareDate(history.created_at),
    match_score: Math.max(0, Math.min(100, Math.round(history.match_score || 0))),
    summary_lines: buildSummaryLines(history),
    ...(history.card_color ? {card_color: sanitizeText(history.card_color, 16)} : {}),
    ...(history.card_pattern ? {card_pattern: sanitizeText(history.card_pattern, 24)} : {}),
  }
}

function buildBlankCard(): BlankShareCardSnapshot {
  return {
    kind: 'blank',
    title: '新的申请',
    prompt: '从描述你的目标岗位',
    action: '开始',
  }
}

export function buildShareSnapshot(history: ResumeHistoryRecord, mode: 'job' | 'blank'): ShareSnapshot {
  return {
    schema_version: 1,
    mode,
    theme: mode === 'job' ? 'green' : 'blue',
    card: mode === 'job' ? buildJobCard(history) : buildBlankCard(),
    landing: SHARE_LANDING_COPY,
  }
}
