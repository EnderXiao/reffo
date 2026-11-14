import { createDigest } from '@/harness/run-context'
import { freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions, buildChangeManifest,
  type OptimizationAction, type ResumeActionPlan, type ResolvedResumeActionPlan, type ResumeActionOutcome,
  type ActionReceipt, type ResumeActionAnchor } from '@/shared/resume-actions'
import { collectGaps, serializeDraft, type ResumeCompletionDocument } from '@/shared/resume-completion'
import type { ResumeEvidenceBundle, V5MatchAnalysis } from '@/v5/types'
import type { EntryWritingPlan } from './entries'
import { isWritingFocusPractice, type WritingFocus } from '@/v5/planning/writing-focus'
import { buildWritingFact } from './facts'
import { sourceUncertainties } from './source-uncertainties'
import {routeSourceInformation} from './information-routing'

const unique = (values: string[]) => [...new Set(values)].sort()
const id = (prefix: string, value: unknown) => `${prefix}:${createDigest(JSON.stringify(value)).slice(0, 20)}`
function action(input: Omit<OptimizationAction, 'actionId' | 'aspectIds' | 'successConditions' | 'planningState'> & {aspectIds?: string[]}): OptimizationAction {
  const actionId = id('action', [input.operation, input.analysisGapIds, input.evidenceIds, input.detailIds, input.title])
  const aspectIds = input.aspectIds?.length ? unique(input.aspectIds) : [id('aspect', actionId)]
  return {...input, actionId, aspectIds, successConditions: aspectIds.map(aspectId => ({aspectId, criterion: input.expectedEffect})), planningState: 'proposed'}
}

/** Frozen immediately after matching, before any selection or writing decision. */
export function buildEditorialActionLedger(input: {resume: ResumeEvidenceBundle; match: V5MatchAnalysis}): ResumeActionPlan {
  const {resume, match} = input
  const atoms = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const routing = routeSourceInformation({atoms: resume.evidenceAtoms})
  const uncertain = routing.uncertainEvidenceIds.filter(evidenceId => !routing.admittedTextByEvidence.has(evidenceId))
  const safe = (ids: string[]) => unique(ids.filter(evidenceId => {
    const atom = atoms.get(evidenceId)
    return atom && !uncertain.includes(evidenceId) && buildWritingFact({...atom, verbatimText: routing.admittedTextByEvidence.get(evidenceId) ?? atom.verbatimText}) && !atom.riskFlags.includes('conflicting')
  }))
  const scopeIds = (ids: string[]) => unique(ids.flatMap(evidenceId => atoms.get(evidenceId)?.sourceScopeId ?? []))
  const actions: OptimizationAction[] = []
  for (const strength of match.strengths) {
    const evidenceIds = safe(strength.evidenceIds)
    if (!evidenceIds.length) continue
    actions.push(action({title: strength.statement, requirementIds: strength.requirementIds, analysisGapIds: [],
      aspectIds: strength.requirementIds, operation: 'express_supported_aspect', sourceScopeIds: scopeIds(evidenceIds), evidenceIds, detailIds: [],
      expectedEffect: '以真实动作和交付呈现已支持优势，保留个人参与程度与项目阶段。', protectedBoundaries: [],
      eligibility: 'executable', intendedScopeIds: scopeIds(evidenceIds), origin: 'matching'}))
  }
  for (const gap of match.gaps) {
    const evidenceIds = safe(gap.evidenceIds)
    const scopes = scopeIds(evidenceIds)
    actions.push(action({title: gap.safeHandling, requirementIds: gap.requirementIds, analysisGapIds: [gap.gapId], aspectIds: gap.requirementIds,
      operation: evidenceIds.length ? 'express_supported_aspect' : 'preparation_only', sourceScopeIds: scopes, evidenceIds, detailIds: [],
      expectedEffect: gap.safeHandling, protectedBoundaries: [gap.impact, '表达改善不等于岗位经历或资格差距已消除。'],
      eligibility: evidenceIds.length ? 'executable' : 'needs_user_fact', intendedScopeIds: scopes, origin: 'matching'}))
  }
  // A useful safe project must enter the value comparison even when P03 produced no strength narrative.
  for (const scope of resume.timeline.filter(scope => ['experience', 'internship', 'project', 'research'].includes(scope.kind))) {
    const evidenceIds = safe(resume.evidenceAtoms.filter(atom => atom.sourceScopeId === scope.scopeId
      && ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)).map(atom => atom.evidenceId))
    if (!evidenceIds.length) continue
    if (!actions.some(item => item.sourceScopeIds.includes(scope.scopeId))) actions.push(action({title: `保留${scope.title ?? scope.organization ?? '该经历'}的实际实践`,
      requirementIds: [], analysisGapIds: [], operation: 'preserve_fact', sourceScopeIds: [scope.scopeId], evidenceIds, detailIds: [],
      expectedEffect: '保留具体业务对象、本人动作与实际交付；与摘要和技能去重后参与选材。',
      protectedBoundaries: scope.kind === 'internship' ? ['保持实习身份，不升级为全职或独立负责人。'] : [], eligibility: 'executable', intendedScopeIds: [scope.scopeId], origin: 'source_rule'}))
  }
  for (const scope of resume.timeline) for (const uncertainty of sourceUncertainties(resume.evidenceAtoms, scope.scopeId)) {
    const metadataOnly = uncertainty.readiness === 'metadata_missing' && !uncertainty.detailKinds.includes('implementation_stage')
    const linked = actions.filter(item => item.evidenceIds.includes(uncertainty.evidenceId) || item.sourceScopeIds.includes(scope.scopeId))
    actions.push(action({title: metadataOnly ? '准备指标解释与结果边界' : '隔离尚未证实的结果，保留安全行动',
      requirementIds: unique(linked.flatMap(item => item.requirementIds)), analysisGapIds: unique(linked.flatMap(item => item.analysisGapIds)),
      operation: metadataOnly ? 'preparation_only' : 'isolate_claim', sourceScopeIds: [scope.scopeId], evidenceIds: [uncertainty.evidenceId], detailIds: [],
      expectedEffect: metadataOnly ? '简历保留已有明确成果，指标定义、统计方式和人工介入细节移至面试准备。' : '争议结果不作为确定业绩，保留独立可支持的行动。',
      protectedBoundaries: ['不将准备主题或填写行为当作已证实成果。'], eligibility: metadataOnly ? 'needs_user_fact' : 'requires_evidence',
      intendedScopeIds: [scope.scopeId], origin: 'source_rule'}))
  }
  if (!resume.identity.name.value?.trim()) actions.push(action({title: '补充姓名', requirementIds: [], analysisGapIds: [], operation: 'retain_identity',
    sourceScopeIds: [], evidenceIds: [], detailIds: ['identity:name'], expectedEffect: '在页首补充本人姓名，便于招聘者识别与文件命名。',
    protectedBoundaries: ['不得从文件名猜测姓名。'], eligibility: 'needs_user_fact', intendedScopeIds: [], origin: 'source_rule'}))
  const sourceRevision = resume.sourceStructure?.sourceRevision ?? resume.sourceDocument.sha256
  return freezeActionPlan({planId: id('plan', [sourceRevision, match.requirementMatches]), sourceRevision,
    judgmentRevision: id('judgment', match.requirementMatches), actions})
}

export function actionEvidenceScores(base: ReadonlyMap<string, number> | undefined, plan: ResumeActionPlan): Map<string, number> {
  const scores = new Map(base)
  for (const item of plan.actions) if (item.eligibility === 'executable') for (const evidenceId of item.evidenceIds) {
    scores.set(evidenceId, Math.max(scores.get(evidenceId) ?? 0, item.operation === 'express_supported_aspect' ? 18 : 10))
  }
  return scores
}
export function actionWritingFocus(base: WritingFocus[] | undefined, plan: ResumeActionPlan, resume: ResumeEvidenceBundle): WritingFocus[] | undefined {
  const result = [...(base ?? [])]
  const atoms = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  for (const item of plan.actions.filter(item => item.eligibility === 'executable' && item.evidenceIds.length)) {
    const evidenceIds = item.evidenceIds.filter(evidenceId => {
      const atom = atoms.get(evidenceId)
      return atom && isWritingFocusPractice(atom)
    })
    if (!evidenceIds.length || result.some(focus => evidenceIds.every(evidenceId => focus.evidenceIds.includes(evidenceId)))) continue
    result.push({focusId: `focus:${item.actionId}`, targetId: item.actionId, targetKind: 'task', title: item.title,
      priority: item.operation === 'express_supported_aspect' ? 'core' : 'supporting', selectionBasis: 'partial_practice',
      evidenceIds, requirementIds: item.requirementIds, taskIds: [], coverageKey: id('coverage', evidenceIds),
      limitation: item.protectedBoundaries.join('；').trim() || '仅表达已引用实践，不扩展责任或资格。'})
  }
  return result
}

export function bindEditorialActionsToEntries(base: ResumeActionPlan, plan: EntryWritingPlan): ResolvedResumeActionPlan {
  return freezeResolvedActionPlan({resolvedPlanId: id('resolved', [base.baseDigest, plan.entries.map(entry => [entry.entryId, entry.facts.map(fact => fact.evidenceId)])]),
    revision: 0, basePlanId: base.planId, baseDigest: base.baseDigest, actions: base.actions,
    bindings: base.actions.map(item => {
      const entries = plan.entries.filter(entry => item.sourceScopeIds.includes(entry.scopeId ?? '')
        && (entry.slot.kind === 'business_bullet' || ['education', 'certifications', 'awards'].includes(entry.section)
          && (entry.facts.some(fact => item.evidenceIds.includes(fact.evidenceId))
            || entry.projectIdentity?.evidenceIds.some(id => item.evidenceIds.includes(id)))))
      const entry = entries.sort((a, b) => b.facts.filter(fact => item.evidenceIds.includes(fact.evidenceId)).length
        - a.facts.filter(fact => item.evidenceIds.includes(fact.evidenceId)).length || a.order - b.order)[0]
      if (entry) return {actionId: item.actionId, selection: 'selected' as const, selectionReason: null, destination: {entryId: entry.entryId, unitIds: []}}
      if (item.operation === 'retain_identity') return {actionId: item.actionId, selection: 'selected' as const, selectionReason: null, destination: {entryId: 'identity', unitIds: ['identity:name']}}
      return {actionId: item.actionId, selection: (item.eligibility === 'executable' ? 'omitted_with_reason' : 'deferred') as 'omitted_with_reason' | 'deferred',
        selectionReason: item.operation === 'preparation_only' ? '材料尚未证明这一经历，仅作为准备建议，不在正文制造事实或空位。' : '相关独立经历未选入本版正文；保留此处置供核对，不宣称策略已采用。'}
    })})
}

/** Receipts are checked against actual safe units, not evidence coincidence alone. */
export function buildCompiledActionReview(input: {base: ResumeActionPlan; resolved: ResolvedResumeActionPlan; document: ResumeCompletionDocument;
  receipts: ActionReceipt[]; references: Array<{entryId: string; outputPath: string; location: string}>}) {
  const {document} = input
  const gaps = collectGaps(document)
  const outcomes = input.resolved.actions.map((item): ResumeActionOutcome => {
    const receipts = input.receipts.filter(receipt => receipt.actionId === item.actionId)
    const anchors: ResumeActionAnchor[] = []
    for (const receipt of receipts) for (const reference of input.references.filter(reference => reference.entryId === receipt.entryId)) {
      const block = document.blocks.find(block => (block as typeof block & {outputPath?: string}).outputPath === reference.outputPath)
      if (!block) continue
      const blockUnit = (block as typeof block & {unitId?: string}).unitId
      if (!blockUnit || !receipt.unitIds.includes(blockUnit)) continue
      const safeText = block.segments.filter(segment => segment.kind === 'text').map(segment => segment.markdown).join('')
      const detail = gaps.find(gap => gap.detailId && item.detailIds.includes(gap.detailId) && block.segments.some(segment => segment.kind === 'optional_gap_clause' && segment.gapId === gap.gapId))
      if (safeText.trim() || detail) anchors.push({blockId: block.blockId, unitId: blockUnit, entryId: receipt.entryId,
        ...(detail ? {gapId: detail.gapId, detailId: detail.detailId} : {}), outputPath: reference.outputPath, location: reference.location,
        quote: safeText.trim() || serializeDraft({...document, blocks: [block]}).slice(block.prefix.length)})
    }
    const binding = input.resolved.bindings.find(candidate => candidate.actionId === item.actionId)
    if (binding?.selection === 'selected') for (const block of document.blocks) {
      if (block.unitId && binding.destination?.unitIds.includes(block.unitId)) {
        const quote = block.segments.filter(segment => segment.kind === 'text').map(segment => segment.markdown).join('').trim()
        if (quote && !anchors.some(anchor => anchor.blockId === block.blockId)) anchors.push({blockId: block.blockId,
          unitId: block.unitId, entryId: block.entryId, outputPath: block.outputPath, location: item.title, quote})
      }
      if (!item.sourceScopeIds.some(scopeId => ['education', 'other'].some(section => block.outputPath === `scope_heading.${section}.${scopeId}`))) continue
      const quote = block.segments.filter(segment => segment.kind === 'text').map(segment => segment.markdown).join('').trim()
      if (quote) anchors.push({blockId: block.blockId, outputPath: block.outputPath, location: item.title, quote})
    }
    for (const gap of gaps.filter(gap => gap.detailId && item.detailIds.includes(gap.detailId))) {
      const block = document.blocks.find(block => block.segments.some(segment => segment.kind === 'identity_gap' || segment.kind === 'optional_gap_clause'
        ? segment.gapId === gap.gapId : segment.kind === 'dependent_claim' && segment.parts.some(part => part.kind === 'required_detail_gap' && part.gapId === gap.gapId)))
      if (block) anchors.push({blockId: block.blockId, unitId: block.unitId, gapId: gap.gapId, detailId: gap.detailId, location: gap.label,
        quote: block.segments.map(segment => serializeDraft({...document, blocks: [{...block, prefix: '', segments: [segment]}]})).join('')})
    }
    const covered = unique(receipts.flatMap(receipt => receipt.coveredAspectIds)).filter(aspect => item.aspectIds.includes(aspect))
    const unresolved = gaps.some(gap => gap.detailId && item.detailIds.includes(gap.detailId) && gap.fill.state !== 'filled')
    const canCertify = item.operation === 'preserve_fact' || item.operation === 'use_source_answer' || item.operation === 'isolate_claim'
    const adopted = anchors.length > 0 && covered.length === item.aspectIds.length && canCertify
    return {actionId: item.actionId, state: unresolved || item.operation === 'retain_identity' ? 'needs_material' : adopted ? 'adopted'
      : anchors.length ? 'pending_review' : item.eligibility === 'needs_user_fact' ? 'needs_material' : 'not_adopted',
      explanation: unresolved ? '已定位最小填写处，补充这一事实后再核对；原始能力判断保留。' : adopted ? '对应真实行动和交付已呈现在本版正文。'
        : anchors.length ? '对应实践已写入；尚有方面需要核对，不能据此认定资格差距已消除。' : input.resolved.bindings.find(binding => binding.actionId === item.actionId)?.selectionReason ?? '本版尚未找到通过核对的实际表达。',
      anchors, coveredAspectIds: adopted ? covered : [], remainingAspectIds: adopted ? [] : item.aspectIds,
      validation: anchors.length && !adopted && !unresolved && item.operation !== 'retain_identity' ? 'pending' : 'deterministic', source: 'compiler'}
  })
  const review = reconcileEditorialActions({resolvedPlan: input.resolved, document, outcomes})
  return {actionReview: review, changeManifest: buildChangeManifest(review, input.resolved)}
}

/** New semantic details are validated by the entry compiler before becoming versioned generation actions. */
export function resolveGeneratedDetailActions(input: {base: ResumeActionPlan; resolved: ResolvedResumeActionPlan; document: ResumeCompletionDocument;
  entryAudits: Array<{entryId: string; detailAssessments: import('./entry-skeleton').DetailAssessment[]}>; entryPlan: EntryWritingPlan}): ResolvedResumeActionPlan {
  const actions = [...input.resolved.actions]
  const bindings = input.resolved.bindings.map(binding => {
    const action = input.resolved.actions.find(item => item.actionId === binding.actionId)
    const entries = action ? input.entryPlan.entries.filter(entry => entry.entryId === binding.destination?.entryId
      || (entry.scopeId && action.sourceScopeIds.includes(entry.scopeId) || entry.section === 'languages')
        && [...entry.facts.map(fact => fact.evidenceId), ...entry.projectIdentity?.evidenceIds ?? []].some(id => action.evidenceIds.includes(id))
        && !['summary', 'skills'].includes(entry.section)).map(entry => entry.entryId) : []
    return {...binding, ...(binding.destination ? {destination: {...binding.destination,
      unitIds: unique(input.document.blocks.filter(block => entries.includes(block.entryId ?? '')).flatMap(block => block.unitId ? [block.unitId] : []))}} : {})}
  })
  for (const audit of input.entryAudits) for (const detail of audit.detailAssessments.filter(detail => detail.decision === 'supplement')) {
    const entry = input.entryPlan.entries.find(entry => entry.entryId === audit.entryId)
    const gap = collectGaps(input.document).find(gap => gap.detailId === detail.detailId)
    if (!entry || !gap) continue
    const parentActions = entry.editorialActions?.filter(item => item.evidenceIds.some(evidenceId => detail.anchorEvidenceIds.includes(evidenceId))) ?? []
    const added = action({title: `补充${detail.subject}的${gap.label}`, operation: 'add_detail_gap',
      requirementIds: unique(parentActions.flatMap(item => item.requirementIds)), analysisGapIds: unique(parentActions.flatMap(item => item.analysisGapIds)),
      sourceScopeIds: entry.scopeId ? [entry.scopeId] : [], evidenceIds: detail.anchorEvidenceIds, detailIds: [detail.detailId], expectedEffect: detail.benefit,
      protectedBoundaries: ['用户补充只改变当前文档，不自动更新原岗位判断。'], eligibility: 'needs_user_fact', intendedScopeIds: entry.scopeId ? [entry.scopeId] : [], origin: 'generation'})
    if (actions.some(item => item.actionId === added.actionId)) continue
    actions.push(added); bindings.push({actionId: added.actionId, selection: 'selected', selectionReason: null, destination: {entryId: entry.entryId, unitIds: gap.unitId ? [gap.unitId] : []}})
  }
  return freezeResolvedActionPlan({resolvedPlanId: input.resolved.resolvedPlanId, revision: input.resolved.revision + 1,
    basePlanId: input.base.planId, baseDigest: input.base.baseDigest, actions, bindings})
}
