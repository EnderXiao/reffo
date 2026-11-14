import { resumeTextFingerprint } from './resume-strategy'
import { collectGaps, renderCompletionSegment, serializeDraft, type ResumeCompletionDocument } from './resume-completion'

export type OptimizationOperation = 'retain_identity' | 'preserve_fact' | 'express_supported_aspect' | 'use_source_answer'
  | 'add_detail_gap' | 'isolate_claim' | 'compress_duplicate' | 'preparation_only'
export interface OptimizationAction {
  actionId: string
  title: string
  requirementIds: string[]
  analysisGapIds: string[]
  aspectIds: string[]
  operation: OptimizationOperation
  sourceScopeIds: string[]
  evidenceIds: string[]
  detailIds: string[]
  expectedEffect: string
  successConditions: Array<{ aspectId: string; criterion: string }>
  protectedBoundaries: string[]
  eligibility: 'executable' | 'needs_user_fact' | 'requires_evidence' | 'not_applicable'
  planningState: 'proposed'
  intendedScopeIds: string[]
  origin: 'matching' | 'source_rule' | 'generation'
}
export interface ResumeActionPlan {
  version: 'resume-action-plan-v1'
  planId: string
  sourceRevision: string
  judgmentRevision: string
  baseDigest: string
  actions: OptimizationAction[]
}
export interface ResolvedActionBinding {
  actionId: string
  selection: 'selected' | 'merged' | 'deferred' | 'omitted_with_reason'
  selectionReason: string | null
  mergedIntoActionId?: string
  destination?: { entryId: string; unitIds: string[] }
}
export interface ResolvedResumeActionPlan {
  version: 'resume-resolved-action-plan-v1'
  resolvedPlanId: string
  revision: number
  basePlanId: string
  baseDigest: string
  resolvedDigest: string
  actions: OptimizationAction[]
  bindings: ResolvedActionBinding[]
}
export interface ResumeActionAnchor {
  blockId: string
  unitId?: string
  segmentId?: string
  gapId?: string
  detailId?: string
  claimId?: string
  entryId?: string
  outputPath?: string
  location: string
  quote: string
}
export interface ActionReceipt {
  actionId: string
  entryId: string
  unitIds: string[]
  evidenceIds: string[]
  detailIds: string[]
  coveredAspectIds: string[]
  explanation: string
}
export type ActionExecutionState = 'adopted' | 'partially_adopted' | 'needs_material' | 'not_adopted' | 'pending_review'
export interface ResumeActionOutcome {
  actionId: string
  state: ActionExecutionState
  explanation: string
  anchors: ResumeActionAnchor[]
  coveredAspectIds: string[]
  remainingAspectIds: string[]
  validation: 'deterministic' | 'semantic_pass' | 'pending' | 'failed'
  source: 'compiler' | 'edit' | 'semantic_review'
}
export interface ResumeActionReview {
  version: 'resume-action-review-v1'
  basePlanId: string
  basePlanDigest: string
  resolvedPlanId: string
  resolvedDigest: string
  documentId: string
  revision: number
  resumeFingerprint: string
  reviewRevision: number
  inputDigest: string
  outcomes: ResumeActionOutcome[]
}
export interface ResumeChangeManifest {
  version: 'resume-change-manifest-v1'
  documentId: string
  revision: number
  items: Array<{ actionId: string; category: 'adopted' | 'partial' | 'awaiting_material' | 'omitted' | 'isolated' | 'pending_review'; description: string; anchors: ResumeActionAnchor[] }>
  structureBasis?: ResumeStructureBasis
  structureChanges?: ResumeStructureChange[]
}
export interface ResumeStructureBasis {
  version: 'resume-structure-basis-v1'
  sourceRevision: string
  nodes: Array<{scopeId: string; kind: string; label: string; sourceOrder: number; parentScopeId: string | null;
    beforeQuote?: string; blockIds: string[]; entryIds: string[]; protectedValues: string[]}>
  sourceSectionTitles: string[]
}
export interface ResumeStructureChange {
  changeId: string
  kind: 'added' | 'removed' | 'reordered' | 'identity_boundary' | 'regrouped'
  description: string
  sourceScopeIds: string[]
  beforeQuotes: string[]
  anchors: ResumeActionAnchor[]
  validation: 'source_bound' | 'needs_review'
}
export interface ResumeIdentityState { name: 'known' | 'missing' | 'user_provided'; school?: string }
export interface ResumeDeliveryState {
  version: 'resume-delivery-state-v1'
  state: 'application_ready' | 'draft_only' | 'partial_recovery' | 'blocked'
  reasons: string[]
  gates: Array<{ gate: 'fact' | 'structure_identity' | 'supplement' | 'content_actions' | 'safe_omission' | 'pdf'; state: 'pass' | 'warning' | 'block' | 'not_run'; reasons: string[] }>
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${stableValue((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
/** Content identity only. Authorization always comes from the server-owned baseline. */
export const actionContentDigest = (value: unknown): string => resumeTextFingerprint(stableValue(value)).replace('text-v1:', 'action-v1:')

export function freezeActionPlan(input: Omit<ResumeActionPlan, 'version' | 'baseDigest'>): ResumeActionPlan {
  const plan = {version: 'resume-action-plan-v1' as const, ...JSON.parse(JSON.stringify(input))}
  return {...plan, baseDigest: actionContentDigest(plan)}
}
export function freezeResolvedActionPlan(input: Omit<ResolvedResumeActionPlan, 'version' | 'resolvedDigest'>): ResolvedResumeActionPlan {
  const plan = {version: 'resume-resolved-action-plan-v1' as const, ...JSON.parse(JSON.stringify(input))}
  return {...plan, resolvedDigest: actionContentDigest(plan)}
}
export function validateActionPlan(plan: ResumeActionPlan, resolved?: ResolvedResumeActionPlan): string[] {
  const errors: string[] = []
  const {baseDigest, ...base} = plan
  if (baseDigest !== actionContentDigest(base)) errors.push('BASE_DIGEST_MISMATCH')
  const ids = new Set<string>()
  for (const action of plan.actions) {
    if (ids.has(action.actionId)) errors.push(`DUPLICATE_ACTION:${action.actionId}`)
    ids.add(action.actionId)
    if (action.planningState !== 'proposed' || !action.successConditions.length
      || action.successConditions.some(item => !action.aspectIds.includes(item.aspectId))) errors.push(`INVALID_ACTION:${action.actionId}`)
  }
  if (resolved) {
    const {resolvedDigest, ...value} = resolved
    if (resolvedDigest !== actionContentDigest(value) || resolved.baseDigest !== baseDigest || resolved.basePlanId !== plan.planId) errors.push('RESOLVED_DIGEST_MISMATCH')
    if (plan.actions.some(action => !resolved.actions.some(item => actionContentDigest(item) === actionContentDigest(action)))) errors.push('BASE_ACTION_MUTATED')
    const resolvedIds = resolved.actions.map(action => action.actionId)
    if (new Set(resolvedIds).size !== resolvedIds.length) errors.push('DUPLICATE_RESOLVED_ACTION')
    for (const action of resolved.actions) {
      if (resolved.bindings.filter(binding => binding.actionId === action.actionId).length !== 1) errors.push(`UNBOUND_ACTION:${action.actionId}`)
      if (!ids.has(action.actionId) && action.origin !== 'generation') errors.push(`INVALID_NEW_ACTION:${action.actionId}`)
      if (action.aspectIds.length !== new Set(action.aspectIds).size || !action.aspectIds.length
        || action.successConditions.length !== action.aspectIds.length || action.successConditions.some(item => !action.aspectIds.includes(item.aspectId))) errors.push(`INVALID_ACTION_ASPECTS:${action.actionId}`)
    }
    for (const binding of resolved.bindings) if (!resolved.actions.some(action => action.actionId === binding.actionId)
      || (binding.selection === 'selected' && !binding.destination) || (binding.selection !== 'selected' && !binding.selectionReason?.trim())) errors.push(`INVALID_BINDING:${binding.actionId}`)
  }
  return errors
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value))
function segmentIds(segment: unknown): string[] {
  if (!record(segment)) return []
  return ['segmentId', 'gapId', 'detailId', 'claimId', 'unitId'].flatMap(key => typeof segment[key] === 'string' ? [segment[key] as string] : [])
    .concat(Array.isArray(segment.parts) ? segment.parts.flatMap(segmentIds) : [])
}
export function isCurrentActionAnchor(anchor: ResumeActionAnchor, document: ResumeCompletionDocument): boolean {
  const block = document.blocks.find(item => item.blockId === anchor.blockId)
  if (!block) return false
  const ids = [...(block.unitId ? [block.unitId] : []), ...block.segments.flatMap(segmentIds)]
  if ([anchor.unitId, anchor.segmentId, anchor.gapId, anchor.detailId, anchor.claimId].some(id => id && !ids.includes(id))) return false
  const text = block.segments.map(segment => renderCompletionSegment(segment)).join('')
  return Boolean(anchor.quote.trim() && text.includes(anchor.quote))
}

/** Rechecks stable locations and invalidates only changed actions; it never upgrades a capability judgment. */
export function reconcileEditorialActions(input: {
  resolvedPlan: ResolvedResumeActionPlan
  document: ResumeCompletionDocument
  previousReview?: ResumeActionReview
  outcomes?: ResumeActionOutcome[]
}): ResumeActionReview {
  const {document, resolvedPlan} = input
  const prior = input.outcomes ?? (input.previousReview?.resolvedDigest === resolvedPlan.resolvedDigest ? input.previousReview.outcomes : []) ?? []
  const gaps = collectGaps(document)
  const outcomes = resolvedPlan.actions.map((action): ResumeActionOutcome => {
    const old = prior.find(item => item.actionId === action.actionId)
    const binding = resolvedPlan.bindings.find(item => item.actionId === action.actionId)
    const valid = (old?.anchors ?? []).filter(anchor => isCurrentActionAnchor(anchor, document))
    const aspects = action.successConditions.map(item => item.aspectId)
    const pending = gaps.filter(gap => gap.detailId && action.detailIds.includes(gap.detailId) && gap.fill.state !== 'filled')
    const covered = (old?.coveredAspectIds ?? []).filter(id => aspects.includes(id))
    if (binding?.selection !== 'selected') return {actionId: action.actionId, state: action.eligibility === 'needs_user_fact' ? 'needs_material' : 'not_adopted',
      explanation: binding?.selectionReason ?? action.expectedEffect, anchors: valid, coveredAspectIds: [], remainingAspectIds: aspects, validation: 'deterministic', source: 'compiler'}
    if (['add_detail_gap', 'retain_identity'].includes(action.operation) && pending.length) return {actionId: action.actionId, state: 'needs_material', explanation: '待补充这一最小事实；已有动作和交付物不等于补充项已完成。',
      anchors: valid, coveredAspectIds: [], remainingAspectIds: aspects, validation: 'deterministic', source: 'edit'}
    if (old && valid.length === old.anchors.length && valid.length && !pending.length) return {...old, anchors: valid,
      coveredAspectIds: covered, remainingAspectIds: aspects.filter(id => !covered.includes(id))}
    return {actionId: action.actionId, state: 'pending_review', explanation: '当前表达或补充已变化，待核对对应事实与策略；原岗位差距判断保留。', anchors: valid,
      coveredAspectIds: [], remainingAspectIds: aspects, validation: 'pending', source: 'edit'}
  })
  const fingerprint = resumeTextFingerprint(serializeDraft(document))
  return {version: 'resume-action-review-v1', basePlanId: resolvedPlan.basePlanId, basePlanDigest: resolvedPlan.baseDigest,
    resolvedPlanId: resolvedPlan.resolvedPlanId, resolvedDigest: resolvedPlan.resolvedDigest, documentId: document.documentId, revision: document.revision,
    resumeFingerprint: fingerprint, reviewRevision: (input.previousReview?.reviewRevision ?? -1) + 1,
    inputDigest: actionContentDigest({documentId: document.documentId, revision: document.revision, fingerprint, resolvedDigest: resolvedPlan.resolvedDigest}), outcomes}
}
export function buildStructureChanges(basis: ResumeStructureBasis, document: ResumeCompletionDocument): ResumeStructureChange[] {
  const changes: ResumeStructureChange[] = []
  const text = (block: ResumeCompletionDocument['blocks'][number]) => block.segments.map(segment => renderCompletionSegment(segment)).join('')
  const anchor = (block: ResumeCompletionDocument['blocks'][number]): ResumeActionAnchor => ({blockId: block.blockId, entryId: block.entryId,
    unitId: block.unitId, location: '简历结构', quote: text(block)})
  const add = (kind: ResumeStructureChange['kind'], description: string, nodes: ResumeStructureBasis['nodes'],
    blocks: ResumeCompletionDocument['blocks'], validation: ResumeStructureChange['validation'] = 'source_bound') => {
    changes.push({changeId: `structure:${kind}:${nodes.map(node => node.scopeId).join('|') || blocks.map(block => block.blockId).join('|')}`,
      kind, description, sourceScopeIds: nodes.map(node => node.scopeId), beforeQuotes: [...new Set(nodes.flatMap(node => node.beforeQuote ? [node.beforeQuote] : []))],
      anchors: blocks.filter(block => text(block).trim()).map(anchor), validation})
  }
  const rows = basis.nodes.map(node => ({node, blocks: document.blocks.filter(block => text(block).trim() && (
    node.blockIds.includes(block.blockId) || (block.entryId && node.entryIds.includes(block.entryId))))}))
  for (const {node, blocks} of rows) {
    if (!blocks.length) {add('removed', `本版未保留「${node.label}」；源履历仍在原始材料中，未将其改成不存在的经历。`, [node], []); continue}
    if (node.kind === 'internal_phase' && node.parentScopeId) {
      const parent = basis.nodes.find(item => item.scopeId === node.parentScopeId)
      if (parent) add('regrouped', `将内部阶段「${node.label}」归于「${parent.label}」任职，避免把阶段日期当成另一段任职。`, [node, parent], [blocks[0]])
    }
    if (node.protectedValues.length) {
      const first = document.blocks.indexOf(blocks[0])
      let start = first
      while (start > 0 && !['heading2', 'heading3'].includes(document.blocks[start].kind)) start -= 1
      let section = start
      while (section > 0 && document.blocks[section].kind !== 'heading2') section -= 1
      const region = [document.blocks[section]?.kind === 'heading2' ? text(document.blocks[section]) : '',
        ...(blocks[0].outputPath?.startsWith('timeline.') ? [text(blocks[0])] : document.blocks.slice(start, first + 1).map(text))].join('\n')
      const missing = node.protectedValues.filter(value => !region.includes(value))
      add('identity_boundary', missing.length ? `核对「${node.label}」的身份表达：当前标题范围未完整呈现${missing.map(value => `「${value}」`).join('、')}；来源身份边界仍保留，不能据此升级任职。`
        : `保留「${node.label}」的雇主、岗位及实习等来源身份边界。`, [node], [blocks[0]], missing.length ? 'needs_review' : 'source_bound')
    }
  }
  const retained = rows.filter(row => row.blocks.length && row.node.kind !== 'internal_phase')
  const original = [...retained].sort((a, b) => a.node.sourceOrder - b.node.sourceOrder)
  const current = [...retained].sort((a, b) => document.blocks.indexOf(a.blocks[0]) - document.blocks.indexOf(b.blocks[0]))
  if (original.some((row, index) => row.node.scopeId !== current[index]?.node.scopeId)) add('reordered',
    `按当前简历重点重排经历：${current.map(row => row.node.label).join(' → ')}。原始任职时间和身份依据不随顺序改变。`,
    original.map(row => row.node), current.map(row => row.blocks[0]))
  for (const block of document.blocks.filter(block => block.kind === 'heading2')) {
    const title = text(block).trim()
    const sectionKey = (value: string) => {
      const compact = value.replace(/\s/gu, '').toLowerCase()
      const aliases = [['代表项目', '项目经历', '项目经验', 'projects'], ['教育背景', '教育经历', 'education'],
        ['工作经历', '工作经验', 'workexperience'], ['实习经历', '实习经验', 'internships'], ['专业技能', '技能', 'skills']]
      return aliases.find(group => group.includes(compact))?.[0] ?? compact
    }
    if (!basis.sourceSectionTitles.some(source => sectionKey(source) === sectionKey(title))) add('added', `新增「${title}」板块组织已有材料；新增板块不代表新增个人经历。`, [], [block])
  }
  const nameGap = collectGaps(document).find(gap => gap.kind === 'identity_gap')
  if (nameGap) {
    const block = document.blocks.find(block => block.segments.some(segment => segment.kind === 'identity_gap' && segment.gapId === nameGap.gapId))
    if (block) add('identity_boundary', nameGap.fill.state === 'filled' ? '姓名由本人补充，保留用户来源；不从文件名或项目内容推断身份。'
      : '来源未明确姓名，页首新增姓名填写位置；未填写时仅下载安全草稿。', [], [block])
  }
  return changes
}
export function buildChangeManifest(review: ResumeActionReview, plan: ResolvedResumeActionPlan,
  options: {previous?: ResumeChangeManifest; document?: ResumeCompletionDocument; structureBasis?: ResumeStructureBasis} = {}): ResumeChangeManifest {
  const structureBasis = options.structureBasis ?? options.previous?.structureBasis
  return {version: 'resume-change-manifest-v1', documentId: review.documentId, revision: review.revision,
    ...(structureBasis ? {structureBasis, structureChanges: options.document ? buildStructureChanges(structureBasis, options.document) : options.previous?.structureChanges ?? []} : {}),
    items: review.outcomes.map(outcome => ({actionId: outcome.actionId,
    category: plan.actions.find(action => action.actionId === outcome.actionId)?.operation === 'isolate_claim' ? 'isolated'
      : outcome.state === 'adopted' ? 'adopted' : outcome.state === 'partially_adopted' ? 'partial' : outcome.state === 'needs_material' ? 'awaiting_material'
        : outcome.state === 'pending_review' ? 'pending_review' : 'omitted', description: outcome.explanation, anchors: outcome.anchors}))}
}
export function changeManifestDescriptions(manifest: ResumeChangeManifest): string[] {
  return [...new Set([...(manifest.structureChanges?.map(change => change.description) ?? []), ...manifest.items.map(item => item.description)])]
}
