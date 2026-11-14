import { jobFitMapTransportSchema, type JobFitMap } from './contracts'
import { prepareJobFitScopeRepair, validateJobFitMap } from './fit'
import type { JobTarget } from './profile'
import type { ResumeEvidenceBundle, ValidationIssue } from '@/v5/types'
import { writingIssue } from '@/v5/writing/facts'
import { V5WorkflowBlockedError } from '@/v5/errors'
import { compileV5Prompt, V5PromptBudgetError } from '@/v5/prompt-compiler'
import {MatchingResourceBudget, MATCHING_STEP_TIMEOUT_MS} from './matching-budget'

type FitPayload = { jobTargetingPolicy: string; jobSuccessProfile: unknown; targets: JobTarget[]; resumeContext: unknown }
type Envelope = (payload: unknown) => unknown
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Locate every invalid link from the full schema, not the truncated diagnostic summary. */
export function planJobFitRepair(input: {
  current: unknown; schemaValidated: boolean; issues: ValidationIssue[]; targets: JobTarget[]; resume: ResumeEvidenceBundle
}) {
  const current = record(input.current) && input.schemaValidated
    ? Object.fromEntries(Object.entries(input.current).filter(([key]) => key !== 'narrativeDiagnostics')) : input.current
  const parsed = jobFitMapTransportSchema.safeParse(current)
  const links = record(current) && Array.isArray(current.links) ? current.links : []
  const targetIds = new Set(input.targets.map(target => target.id))
  const seen = new Set<string>()
  const identifiable = links.length > 0 && links.every(link => record(link) && typeof link.targetId === 'string'
    && targetIds.has(link.targetId) && !seen.has(link.targetId) && !!seen.add(link.targetId))
  const invalidIndices = new Set<number>()
  let rebuild = !identifiable
  const issues = input.issues.filter(issue => issue.severity === 'error' && issue.code !== 'V5_SCHEMA_VALIDATION_FAILED')
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [field, index] = issue.path
      if (field !== 'links' || typeof index !== 'number' || index < 0 || index >= links.length) { rebuild = true; continue }
      invalidIndices.add(index)
      const link = links[index]
      if (record(link) && typeof link.targetId === 'string' && targetIds.has(link.targetId)) issues.push(
        writingIssue('V5_SCHEMA_VALIDATION_FAILED', link.targetId, [], `${issue.path.join('.')}: ${issue.message}`))
      else rebuild = true
    }
  }
  if (identifiable) {
    // A schema failure prevented business validation of the other links. Check
    // the structurally valid subset now so one repair can address both layers.
    const validLinks = links.filter((_, index) => !invalidIndices.has(index))
      .flatMap(link => {const checked = jobFitMapTransportSchema.shape.links.element.safeParse(link); return checked.success ? [checked.data] : []})
    const ids = new Set(validLinks.map(link => link.targetId))
    const checked = validateJobFitMap({contractVersion: parsed.success ? parsed.data.contractVersion : 'job-fit-map-v2',
      links: validLinks, narratives: [], questions: []}, input.targets.filter(target => ids.has(target.id)), input.resume)
    issues.push(...checked.issues.filter(issue => issue.severity === 'error'))
    for (const target of input.targets.filter(target => !seen.has(target.id))) issues.push(
      writingIssue('P03_TARGET_JUDGMENT_MISSING', target.id, [], '原稿遗漏此岗位目标；必须依据原文和真实证据补齐判断，不能隐式视为通过。'))
  }
  if (issues.some(issue => !issue.outputPath || !targetIds.has(issue.outputPath))) rebuild = true
  const affected = rebuild ? new Set(targetIds) : new Set(issues.map(issue => issue.outputPath!))
  if (!affected.size) rebuild = true
  const selected = rebuild ? input.targets : input.targets.filter(target => affected.has(target.id))
  return {current, parsed: parsed.success ? parsed.data : null, links, rebuild, issues, targets: selected}
}

/** Rebuild only rejected target judgments; all source evidence remains available. */
export async function repairJobFitMap(input: {
  current: unknown; schemaValidated: boolean; issues: ValidationIssue[]; payload: FitPayload; resume: ResumeEvidenceBundle
  envelope: Envelope; execute: (envelope: unknown, context: {signal: AbortSignal}) => Promise<JobFitMap>; signal?: AbortSignal
  resourceBudget?: MatchingResourceBudget
  observe?: (diagnostic: {targetIds: string[]; rebuilt: boolean; estimatedInputTokens: number; maxOutputTokens: number;
    batchIndex: number; batchCount: number; physicalCalls: number; remainingCalls: number; remainingMs: number}) => Promise<void>
}): Promise<JobFitMap> {
  const plan = planJobFitRepair({...input, targets: input.payload.targets})
  const budget = input.resourceBudget ?? new MatchingResourceBudget({timeoutMs: MATCHING_STEP_TIMEOUT_MS, signal: input.signal})
  const candidates: JobFitMap[] = []
  const buildEnvelope = (targets: JobTarget[], discardDraft = false) => {
    const ids = new Set(targets.map(target => target.id))
    const issues = plan.issues.filter(issue => issue.outputPath && ids.has(issue.outputPath))
    const scoped = plan.parsed && !plan.rebuild ? prepareJobFitScopeRepair(plan.parsed, targets, issues) : null
    // Requirement boundaries belong to their target even when another target
    // has a schema/reference error and prevents a whole-batch isolated repair.
    const sourceBoundaries = targets.filter(target => target.kind === 'requirement').flatMap(target => {
      const gateIssues = issues.filter(issue => issue.outputPath === target.id
        && /JOB_FIT_(?:FOREIGN_DOMAIN|INVENTED_OWNERSHIP|INVENTED_SPECIALTY|INVENTED_PROFICIENCY|INVENTED_SCOPE)_GATE/u.test(issue.code))
      if (!gateIssues.length) return []
      const repair = prepareJobFitScopeRepair({contractVersion: 'job-fit-map-v2', links: [], narratives: [], questions: []}, [target], gateIssues)
      return repair && record(repair.currentOutput) && Array.isArray(repair.currentOutput.sourceBoundaries)
        ? repair.currentOutput.sourceBoundaries : []
    })
    const currentOutput = discardDraft || plan.rebuild ? {previousJudgmentsRejected: true,
      instruction: '旧稿结构无效或超出修复预算。仅依据本次目标原文和完整源证据重新判断，不沿用旧状态或补造事实。'}
      : scoped?.currentOutput ?? {contractVersion: 'job-fit-map-v2',
        links: plan.links.filter(link => record(link) && ids.has(String(link.targetId))), narratives: [], questions: []}
    return input.envelope({originalEnvelope: input.envelope({...input.payload,
      jobSuccessProfile: {assessmentScope: 'exact_target_quotes_only'}, targets,
      repairScope: {mode: 'target_links_only', targetIds: targets.map(target => target.id)}, sourceBoundaries}), currentOutput,
      validationIssues: issues})
  }
  const batches: Array<{targets: JobTarget[]; envelope: unknown; compiled: ReturnType<typeof compileV5Prompt>}> = []
  const prepare = (targets: JobTarget[], discardDraft = false): void => {
    const envelope = buildEnvelope(targets, discardDraft)
    try {
      batches.push({targets, envelope, compiled: compileV5Prompt({component: 'P03R', envelope, repairAttempt: 1})})
    } catch (error) {
      if (!(error instanceof V5PromptBudgetError)) throw error
      if (targets.length > 1) {
        const middle = Math.ceil(targets.length / 2)
        prepare(targets.slice(0, middle), discardDraft); prepare(targets.slice(middle), discardDraft)
      } else if (!discardDraft) prepare(targets, true)
      else throw error
    }
  }
  // Preflight every batch before any paid repair call. Never truncate evidence
  // or enlarge the context window to make an oversized request appear valid.
  prepare(plan.targets)
  budget.preflightRepairs(batches.length)
  for (const [index, batch] of batches.entries()) {
    input.signal?.throwIfAborted()
    await input.observe?.({targetIds: batch.targets.map(target => target.id), rebuilt: plan.rebuild,
      estimatedInputTokens: batch.compiled.estimatedInputTokens, maxOutputTokens: batch.compiled.maxOutputTokens,
      batchIndex: index, batchCount: batches.length, physicalCalls: budget.physicalCalls,
      remainingCalls: budget.remainingCalls, remainingMs: budget.remainingMs()})
    const repaired = await budget.runRepairBatch(batches.length - index,
      signal => input.execute(batch.envelope, {signal}))
    const ids = new Set(batch.targets.map(target => target.id))
    if (repaired.links.length !== ids.size || new Set(repaired.links.map(link => link.targetId)).size !== ids.size
      || repaired.links.some(link => !ids.has(link.targetId))
      || repaired.narratives.some(item => item.targetIds.some(id => !ids.has(id)))) throw new V5WorkflowBlockedError({
      code: 'P03_REPAIR_SCOPE_INVALID', state: 'blocked_fact_validation', message: '岗位匹配修复返回了范围外、重复或缺失的目标。',
    })
    candidates.push(repaired)
  }
  const replacements = new Map(candidates.flatMap(candidate => candidate.links).map(link => [link.targetId, link]))
  const repairedIds = new Set(replacements.keys())
  const base = plan.parsed ?? (record(plan.current) ? plan.current : {})
  const originalLinks = new Map(plan.links.flatMap(link => record(link) && typeof link.targetId === 'string' ? [[link.targetId, link] as const] : []))
  const merged = plan.rebuild ? {contractVersion: 'job-fit-map-v2',
    links: input.payload.targets.map(target => replacements.get(target.id)),
    narratives: candidates.flatMap(candidate => candidate.narratives), questions: []}
    : {...base, links: input.payload.targets.map(target => replacements.get(target.id) ?? originalLinks.get(target.id)),
      narratives: [...(Array.isArray(base.narratives) ? base.narratives.filter(item => record(item)
        && Array.isArray(item.targetIds) && item.targetIds.every(id => typeof id === 'string' && !repairedIds.has(id))) : []),
        ...candidates.flatMap(candidate => candidate.narratives)]}
  const checked = jobFitMapTransportSchema.safeParse(merged)
  if (!checked.success) throw new V5WorkflowBlockedError({code: 'P03_REPAIR_SCHEMA_INVALID', state: 'blocked_fact_validation',
    message: '局部修复合并后仍未通过完整结构校验。', issues: checked.error.issues.map(issue =>
      writingIssue('V5_SCHEMA_VALIDATION_FAILED', issue.path.join('.'), [], issue.message))})
  return checked.data
}
