import {collectGaps, prepareResumeExport, validateCompletionDocument, type ResumeCompletionDocument} from '@/shared/resume-completion'
import type {ResumeActionReview, ResumeDeliveryState, ResumeIdentityState, ResolvedResumeActionPlan, ResumeChangeManifest} from '@/shared/resume-actions'

type Gate = ResumeDeliveryState['gates'][number]
type GateName = Gate['gate']
export const RESUME_DELIVERY_GATES: readonly GateName[] = ['fact', 'structure_identity', 'supplement', 'content_actions', 'safe_omission', 'pdf']
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** Unknown or unexecuted checks stay explicit; a complete document never implies six passed checks. */
export function assessResumeDelivery(input: {
  document?: ResumeCompletionDocument
  identity?: ResumeIdentityState
  review?: ResumeActionReview
  resolvedPlan?: ResolvedResumeActionPlan
  changeManifest?: ResumeChangeManifest
  previous?: unknown
  fact?: Gate['state']
  content?: Gate['state']
  supplementEvaluated?: boolean
  recoveredEntryIds?: string[]
  pdf?: Gate['state']
}): ResumeDeliveryState {
  const previous = object(input.previous)
  const priorGates = Array.isArray(previous.gates) ? previous.gates.map(object) : []
  const prior = (name: GateName): Gate['state'] => {
    const value = priorGates.find(gate => gate.gate === name)?.state
    return ['pass', 'warning', 'block', 'not_run'].includes(String(value)) ? value as Gate['state'] : 'not_run'
  }
  const checked = input.document ? validateCompletionDocument(input.document) : undefined
  const document = checked?.ok ? checked.document : undefined
  const exported = document ? prepareResumeExport(document) : undefined
  const gaps = document ? collectGaps(document) : []
  const pending = gaps.filter(gap => gap.fill.state === 'empty')
  const userFacts = document?.blocks.some(block => block.segments.some(segment => segment.kind === 'text'
    ? segment.origin === 'user' : segment.kind === 'optional_gap_clause' && segment.fill.state === 'filled')) ?? false
  const missingIdentity = input.identity?.name === 'missing' || gaps.some(gap => gap.kind === 'identity_gap' && gap.fill.state !== 'filled')
  const hasContact = exported?.ok && /(?:1[3-9]\d{9}|\b[^\s@]+@[^\s@]+\.[^\s@]+\b)/u.test(exported.markdown)
  const structureBasis = input.changeManifest?.structureBasis
  const structureChanges = input.changeManifest?.structureChanges
  const structureEvaluated = structureBasis?.version === 'resume-structure-basis-v1' && Array.isArray(structureBasis.nodes)
    && Array.isArray(structureBasis.sourceSectionTitles) && Array.isArray(structureChanges)
    && structureChanges.every(change => change && ['source_bound', 'needs_review'].includes(change.validation) && typeof change.description === 'string')
  const structureReview = structureEvaluated ? structureChanges!.filter(change => change.validation === 'needs_review') : []
  const fact = input.fact ?? prior('fact')
  const rawOutcomes = input.review?.outcomes
  const outcomes = Array.isArray(rawOutcomes) && rawOutcomes.every(outcome => outcome && typeof outcome === 'object'
    && ['adopted', 'partially_adopted', 'needs_material', 'not_adopted', 'pending_review'].includes(outcome.state)
    && ['deterministic', 'semantic_pass', 'pending', 'failed'].includes(outcome.validation)) ? rawOutcomes : undefined
  const actionable = (actionId: string) => {
    if (!input.resolvedPlan) return true
    if (!Array.isArray(input.resolvedPlan.actions) || !Array.isArray(input.resolvedPlan.bindings)) return true
    const action = input.resolvedPlan.actions.find(item => item?.actionId === actionId)
    const binding = input.resolvedPlan.bindings.find(item => item?.actionId === actionId)
    return Boolean(action && action.operation !== 'preparation_only' && action.eligibility !== 'not_applicable'
      && binding && ['selected', 'merged'].includes(binding.selection))
  }
  const actionPending = outcomes?.some(outcome => actionable(outcome.actionId)
    && (outcome.state !== 'adopted' || outcome.validation === 'pending' || outcome.validation === 'failed')) ?? false
  const omittedClaims = exported?.ok ? exported.omittedClaimCount ?? 0 : 0
  const recovered = Boolean(input.recoveredEntryIds?.length || previous.state === 'partial_recovery')
  const gates: Gate[] = [
    {gate: 'fact', state: fact === 'pass' && userFacts ? 'warning' : fact,
      reasons: userFacts ? ['用户补充属于本人陈述，尚未进行外部事实核验。'] : fact === 'not_run' ? ['尚未执行事实校验。'] : []},
    {gate: 'structure_identity', state: checked && !checked.ok ? 'block' : !document ? 'not_run' : missingIdentity || !hasContact || structureReview.length ? 'warning' : !structureEvaluated ? 'not_run' : 'pass',
      reasons: checked && !checked.ok ? checked.issues.map(issue => issue.message) : !document ? ['尚未校验填写结构。']
        : [...(missingIdentity ? ['姓名尚待本人填写；允许下载安全草稿。'] : []), ...(!hasContact ? ['尚未提供可用联系方式。'] : []),
          ...(!structureEvaluated ? ['尚未执行来源身份与当前结构的对照检查。'] : structureReview.map(change => change.description))]},
    {gate: 'supplement', state: !document ? 'not_run' : pending.length || omittedClaims ? 'warning'
      : input.supplementEvaluated || prior('supplement') !== 'not_run' || gaps.length ? 'pass' : 'not_run',
      reasons: pending.length || omittedClaims ? ['仍有待补事实或待确认断言；空白及其依赖内容会在导出时省略。']
        : !input.supplementEvaluated && prior('supplement') === 'not_run' && !gaps.length ? ['尚未执行补充有效性评估，零空位不等于评估通过。'] : []},
    {gate: 'content_actions', state: input.content === 'block' ? 'block' : !outcomes?.length ? 'not_run'
      : actionPending || input.content === 'warning' || recovered ? 'warning' : 'pass',
      reasons: !outcomes?.length ? ['尚无已执行的内容行动评估，不能以空评估认定通过。'] : actionPending ? ['部分优化行动仍待材料、未采用或待语义复核。']
        : recovered ? ['部分经历使用局部安全恢复，仍需本人检查。'] : []},
    {gate: 'safe_omission', state: !exported ? 'not_run' : exported.ok ? 'pass' : 'block',
      reasons: !exported ? ['尚未执行省略安全检查。'] : exported.ok ? [] : exported.issues.map(issue => issue.message)},
    {gate: 'pdf', state: input.pdf ?? 'not_run', reasons: input.pdf === 'pass' ? ['固定文本模板已渲染为PDF。']
      : input.pdf === 'block' ? ['PDF渲染或文件验证未通过；当前编辑稿保留。'] : ['尚未执行PDF渲染与文件验证。']},
  ]
  const blocked = gates.some(gate => gate.state === 'block')
  const incomplete = gates.some(gate => gate.gate !== 'pdf' && (gate.state === 'not_run' || (gate.gate !== 'fact' && gate.state === 'warning')))
  return {version: 'resume-delivery-state-v1', state: blocked ? 'blocked' : recovered ? 'partial_recovery' : incomplete ? 'draft_only' : 'application_ready',
    reasons: [...new Set(gates.filter(gate => gate.state === 'warning' || gate.state === 'block').flatMap(gate => gate.reasons))], gates}
}

export function withResumePdfGate(state: ResumeDeliveryState, pdf: Gate['state']): ResumeDeliveryState {
  const gates = RESUME_DELIVERY_GATES.map(name => name === 'pdf'
    ? {gate: name, state: pdf, reasons: pdf === 'pass' ? ['固定文本模板已渲染为PDF。'] : pdf === 'block' ? ['PDF渲染或文件验证未通过。'] : ['尚未执行PDF渲染与文件验证。']}
    : state.gates.find(gate => gate.gate === name) ?? {gate: name, state: 'not_run' as const, reasons: ['尚未执行此项检查。']})
  return {...state, ...(pdf === 'block' ? {state: 'blocked' as const} : {}), gates}
}
