import {isCurrentActionAnchor, type ResumeActionAnchor, type ResumeActionOutcome, type ResumeActionReview} from '@/shared/resume-actions'
import {currentStrategyReview, resumeTextFingerprint} from '@/shared/resume-strategy'
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
  actionOutcome?: ResumeActionOutcome
  remainingAspects?: string[]
}

export interface OptimizationStrategyGroup {
  id: string
  title: string
  actionIds: string[]
  requirementIds: string[]
  relatedGapIds: string[]
  items: OptimizationStrategyViewItem[]
  priorityReason: string
}

/** 只按共享事实/细节/要求归组；不会用相似文案猜测两项能力属于同一主题。 */
export function buildOptimizationStrategyGroups(result: ProcessResult, items = buildOptimizationStrategyViewItems(result, Infinity)): OptimizationStrategyGroup[] {
  const plan = result.optimized.resolved_action_plan ?? result.optimized.action_plan ?? result.matching.action_plan
  const actions = new Map(plan?.actions.map(action => [action.actionId, action]) ?? [])
  const gaps = new Map(buildGapViewItems(result, Infinity).map(gap => [gap.id, gap]))
  const intersects = (left: string[], right: string[]) => left.some(id => right.includes(id))
  const family = (id: string) => {
    const operation = actions.get(id)?.operation
    return operation && ['express_supported_aspect', 'preserve_fact', 'use_source_answer', 'compress_duplicate'].includes(operation) ? 'expression' : operation ?? id
  }
  const related = (left: OptimizationStrategyViewItem, right: OptimizationStrategyViewItem) => {
    const a = actions.get(left.id), b = actions.get(right.id)
    if (!a || !b || family(left.id) !== family(right.id)) return false
    if (intersects(a.detailIds, b.detailIds)) return true
    const sameFacts = a.evidenceIds.length > 0 && a.evidenceIds.length === b.evidenceIds.length
      && a.evidenceIds.every(id => b.evidenceIds.includes(id))
    return sameFacts || (intersects(a.requirementIds, b.requirementIds) && intersects(a.sourceScopeIds, b.sourceScopeIds))
  }
  const groups: OptimizationStrategyViewItem[][] = []
  for (const item of items) {
    const matches = groups.filter(group => group.some(member => related(member, item)))
    if (!matches.length) groups.push([item])
    else {
      matches[0].push(item)
      for (const merged of matches.slice(1)) { matches[0].push(...merged); groups.splice(groups.indexOf(merged), 1) }
    }
  }
  const unique = (values: string[]) => [...new Set(values)]
  const rank = (group: OptimizationStrategyViewItem[]) => {
    const relatedGaps = group.flatMap(item => item.relatedGapIds.flatMap(id => gaps.get(id) ?? []))
    return relatedGaps.some(gap => gap.isRequired) ? 0 : relatedGaps.some(gap => gap.priority === 'high') ? 1
      : group.some(item => actions.get(item.id)?.eligibility === 'executable') ? 2
        : group.some(item => actions.get(item.id)?.eligibility === 'needs_user_fact') ? 3 : 4
  }
  return groups.map((members, order) => {
    const requirementIds = unique(members.flatMap(item => actions.get(item.id)?.requirementIds ?? []))
    const relatedGapIds = unique(members.flatMap(item => item.relatedGapIds))
    const priority = rank(members)
    return {id: `theme:${members.map(item => item.id).sort().join('|')}`, title: members.length > 1
      ? `围绕同一${family(members[0].id) === 'add_detail_gap' ? '补充事实' : '实践与能力'}统一优化` : members[0].strategyPoint,
      actionIds: members.map(item => item.id), requirementIds, relatedGapIds, items: members,
      priorityReason: ['先回应岗位必要条件', '优先处理岗位影响较大的差距', '已有事实可直接优化表达', '补充一项事实后继续完善', '作为后续准备，保留事实边界'][priority], priority, order}
  }).sort((a, b) => a.priority - b.priority || b.requirementIds.length - a.requirementIds.length || a.order - b.order)
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
  const plan = result.optimized.resolved_action_plan
  const actionPlan = plan ?? result.optimized.action_plan ?? result.matching.action_plan
  if (actionPlan) {
    const actionReview = currentActionReview(result)
    return actionPlan.actions.map(action => {
      const outcome = actionReview?.outcomes.find(item => item.actionId === action.actionId)
      return {
        id: action.actionId, relatedGapIds: [...action.analysisGapIds], strategyPoint: action.title,
        rationale: action.expectedEffect, sourceQuote: '', optimizedContent: '', structured: true,
        actionOutcome: outcome,
        remainingAspects: outcome?.remainingAspectIds.flatMap(id => action.successConditions.find(condition => condition.aspectId === id)?.criterion ?? []),
      }
    }).slice(0, limit)
  }
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
      relatedGapIds: cleanItems(detail.related_gap_ids, Infinity),
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
  if (result.optimized.action_review) return !currentActionReview(result)
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

export type ResumeReference = ResumeStrategyReference | ResumeActionAnchor

export function currentActionReview(result: ProcessResult): ResumeActionReview | undefined {
  const {completion_document: document, action_review: review, resolved_action_plan: plan} = result.optimized
  if (!document || !review || !plan || review.documentId !== document.documentId
    || review.revision !== document.revision || review.resolvedDigest !== plan.resolvedDigest
    || review.resumeFingerprint !== resumeTextFingerprint(result.optimized.optimized_resume)) return undefined
  return review
}

export function actionOutcomeLabel(outcome: ResumeActionOutcome | undefined): string {
  if (!outcome) return '等待正文处理'
  return {adopted: '已应用到正文', partially_adopted: '部分应用', needs_material: '待补充事实',
    not_adopted: '本次未采用', pending_review: '待核对落实'}[outcome.state]
}

export function strategyResumeReference(item: OptimizationStrategyViewItem, result: ProcessResult): ResumeReference | undefined {
  const document = result.optimized.completion_document
  if (item.actionOutcome && document) {
    return item.actionOutcome.anchors.find(anchor => isCurrentActionAnchor(anchor, document))
  }
  return representativeStrategyReference(item.outcome, result.optimized.optimized_resume)
}

export function isCurrentResumeReference(reference: ResumeReference, result: ProcessResult): boolean {
  if ('blockId' in reference) return Boolean(result.optimized.completion_document
    && isCurrentActionAnchor(reference, result.optimized.completion_document))
  return !hasStaleStrategyReview(result) && Boolean(findResumeReferenceLines(result.optimized.optimized_resume, reference.quote))
}
