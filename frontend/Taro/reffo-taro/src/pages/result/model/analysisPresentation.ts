import {currentStrategyReview, resumeTextFingerprint} from '../../../../../../../shared/resume-strategy'
import type {
  MatchGapPriority,
  ProcessResult,
  ResumeStrategyOutcome,
  ResumeStrategyReference,
  WeaknessEvidenceType,
} from '@/types'

export interface GapViewItem {
  id: string
  priority?: MatchGapPriority
  evidenceType?: WeaknessEvidenceType
  title: string
  isRequired: boolean
  keepVisible: boolean
  jdRequirement: string
  evidence: string
  impact: string
  suggestion: string
}

export interface OptimizationStrategyViewItem {
  id: string
  relatedGapIds: string[]
  strategyPoint: string
  rationale: string
  sourceQuote: string
  optimizedContent: string
  structured: boolean
  outcome?: ResumeStrategyOutcome
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function cleanItems(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []

  return value
    .map(clean)
    .filter(Boolean)
    .slice(0, limit)
}

export function buildGapViewItems(result: ProcessResult, limit = 4): GapViewItem[] {
  const details = result.matching.weakness_details ?? []
  const structuredItems = details
    .filter(detail => clean(detail.weakness).length > 0)
    .slice(0, limit)
    .map((detail, index) => ({
      id: clean(detail.id) || `G${index + 1}`,
      priority: detail.priority,
      evidenceType: detail.evidence_type,
      title: clean(detail.weakness),
      isRequired: detail.is_required === true,
      keepVisible: detail.is_required === true || (detail.is_required === undefined && detail.priority === 'high'),
      jdRequirement: clean(detail.jd_requirement),
      evidence: clean(detail.evidence),
      impact: clean(detail.impact),
      suggestion: clean(detail.suggestion),
    }))

  if (structuredItems.length > 0) {
    return structuredItems
  }

  const fallbackItems = cleanItems(result.matching.weaknesses, limit)
  return fallbackItems.map((title, index) => ({
    id: `G${index + 1}`,
    title,
    isRequired: false,
    keepVisible: false,
    jdRequirement: '',
    evidence: '',
    impact: '',
    suggestion: '',
  }))
}

/** 新记录以必要条件标记为准；旧记录保留已知高优先项，避免折叠重要提醒。 */
export function selectGapPreview(items: GapViewItem[], count = 3): GapViewItem[] {
  const priority = {high: 0, medium: 1, low: 2}
  const sorted = [...items].sort((left, right) =>
    Number(right.isRequired) - Number(left.isRequired)
    || priority[left.priority ?? 'medium'] - priority[right.priority ?? 'medium'])
  return sorted.filter((item, index) => index < count || item.keepVisible)
}

export function buildOptimizationStrategyViewItems(
  result: ProcessResult,
  limit = 4,
): OptimizationStrategyViewItem[] {
  const review = currentStrategyReview(result.optimized.strategy_review, result.optimized.optimized_resume)
  const details = result.matching.optimization_strategy_details ?? []
  const orderedGaps = selectGapPreview(buildGapViewItems(result, Infinity), Infinity)
  const gapRank = (ids: string[]) => {
    const rank = orderedGaps.findIndex(gap => ids.includes(gap.id))
    return rank < 0 ? Infinity : rank
  }
  const structuredItems = details
    .filter(detail => clean(detail.strategy_point).length > 0)
    .map((detail, index) => ({
      id: clean(detail.id) || `S${index + 1}`,
      relatedGapIds: cleanItems(detail.related_gap_ids, 4),
      strategyPoint: clean(detail.strategy_point),
      rationale: clean(detail.rationale),
      sourceQuote: clean(detail.optimization_example?.source_quote),
      optimizedContent: clean(detail.optimization_example?.optimized_content),
      structured: true,
      outcome: review?.items.find(item => item.strategyId === (clean(detail.id) || `S${index + 1}`)),
    }))

  if (structuredItems.length > 0) {
    return structuredItems.sort((left, right) => review
      ? Number(right.outcome?.status === 'linked') - Number(left.outcome?.status === 'linked')
      : gapRank(left.relatedGapIds) - gapRank(right.relatedGapIds)).slice(0, limit)
  }

  return cleanItems(result.matching.optimization_suggestions, limit)
    .map((strategyPoint, index) => ({
      id: `S${index + 1}`,
      relatedGapIds: [],
      strategyPoint,
      rationale: '',
      sourceQuote: '',
      optimizedContent: '',
      structured: false,
    }))
}

export function hasStaleStrategyReview(result: ProcessResult): boolean {
  const review = result.optimized.strategy_review
  return Boolean(review?.version === 'resume-strategy-v1'
    && typeof review.resumeFingerprint === 'string'
    && review.resumeFingerprint !== resumeTextFingerprint(result.optimized.optimized_resume))
}

/** Only a unique exact quote is safe to navigate to; no fuzzy matching or guessed locations. */
export function findResumeReferenceLines(markdown: string, quote: string): {start: number; end: number} | undefined {
  if (!quote.trim()) return undefined
  const offset = markdown.indexOf(quote)
  if (offset < 0 || markdown.indexOf(quote, offset + 1) >= 0) return undefined
  return {
    start: markdown.slice(0, offset).split('\n').length - 1,
    end: markdown.slice(0, offset + quote.length).split('\n').length - 1,
  }
}

export function representativeStrategyReference(
  outcome: ResumeStrategyOutcome | undefined,
  markdown: string,
): ResumeStrategyReference | undefined {
  if (outcome?.status !== 'linked' || !Array.isArray(outcome.references)) return undefined
  return outcome.references.find(reference => reference.quote.trim() && markdown.includes(reference.quote))
}
