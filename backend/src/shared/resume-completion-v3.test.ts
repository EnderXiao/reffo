import {expect, test} from 'bun:test'
import {createCompletionDocument, attachIdentityCompletion, applyCompletionCommand, collectGaps, COMPLETION_TEMPLATES,
  prepareResumeExport, resolveCompletionClaim, beginRowEdit, reconcileRowEdit, replayCompletionOperation,
  validateCompletionDocument, serializeDraft, type ResumeCompletionDocument, type ResumeDependentClaim} from './resume-completion'
import {freezeActionPlan, freezeResolvedActionPlan, reconcileEditorialActions, validateActionPlan} from './resume-actions'
import {prepareResumeHistorySnapshot} from '@/services/resume-completion-snapshot'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'
function document(): ResumeCompletionDocument {
  const claim: ResumeDependentClaim = {kind: 'dependent_claim', claimId: 'result', sourceEvidenceIds: ['ev'],
    sourceSpans: [{sourceBlockId: 'source', start: 1, end: 30}], readiness: 'metadata_missing', qualifiers: ['待补证'],
    parts: [{kind: 'text', segmentId: 'r', markdown: '，待补证有效率95%', origin: 'generated'},
      {kind: 'required_detail_gap', gapId: 'period', detailId: 'detail-period', template: 'metric_period', ...COMPLETION_TEMPLATES.metric_period,
        candidates: [], fill: {state: 'empty'}}, {kind: 'text', segmentId: 'end', markdown: '。', origin: 'generated'}],
    requiredGapIds: ['period'], fillPolicy: 'all_required'}
  return createCompletionDocument({schemaVersion: 'resume-completion-v3', documentId: 'v3', blocks: [{blockId: 'body', kind: 'bullet', prefix: '- ',
    entryId: 'entry:0', unitId: 'unit', outputPath: 'experience.test.bullets[0]', segments: [
      {kind: 'text', segmentId: 'safe', markdown: '设计四类辅导能力', origin: 'generated'}, claim]}]})
}
function fill(doc: ResumeCompletionDocument) {
  const r = applyCompletionCommand(doc, {documentId: doc.documentId, baseRevision: doc.revision, type: 'fill', gapId: 'period', value: '2026年8月'})
  if (!r.ok) throw new Error('fixture')
  return r
}
function markdown(doc: ResumeCompletionDocument) {
  const r = prepareResumeExport(doc)
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.markdown
}
test('v3 filled metadata requires attributable explicit resolution', () => {
  const source = document(), edit = fill(source)
  expect(markdown(edit.document)).not.toContain('95%')
  const resolved = resolveCompletionClaim(edit.document, {kind: 'resolve_claim', documentId: source.documentId,
    baseRevision: edit.document.revision, claimId: 'result', resolution: {state: 'confirmed', note: '本人依据试点记录核对有效率与统计口径。', origin: 'user'}})
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) return
  expect(markdown(resolved.document)).toContain('95%')
  const replay = replayCompletionOperation(edit.document, resolved.operation!)
  expect(replay.ok && replay.document).toEqual(resolved.document)
  expect(source.revision).toBe(0)
})
test('v3 whole-row replacement retains lineage and excludes unconfirmed rewrite', () => {
  const source = document(), session = beginRowEdit(source, 'body')!
  const rewrite = reconcileRowEdit(source, session, '本人核对后确认该项目效果为94%。')
  expect(rewrite.ok).toBe(true)
  if (!rewrite.ok) return
  expect(rewrite.document.claimLineage?.[0].claimId).toBe('result')
  expect(rewrite.document.blocks.flatMap(b => b.segments).some(s => s.kind === 'text' && s.replacedClaimIds?.includes('result'))).toBe(true)
  expect(markdown(rewrite.document)).not.toContain('94%')
  expect(validateCompletionDocument(rewrite.document).ok).toBe(true)
  const replay = replayCompletionOperation(source, rewrite.operation!)
  expect(replay.ok && replay.document).toEqual(rewrite.document)
})
test('v3 missing name has inline identity and safe neutral export', () => {
  const source = attachIdentityCompletion(document()), exported = prepareResumeExport(source)
  const identity = collectGaps(source).find(g => g.kind === 'identity_gap')!
  expect(identity.detailId).toBe('identity:name')
  expect(exported.ok && exported.identityMissing).toBe(true)
  expect(exported.ok && exported.markdown).not.toContain('待完善')
  const edit = applyCompletionCommand(source, {documentId: source.documentId, baseRevision: 0, gapId: identity.gapId, type: 'fill', value: '测试姓名'})
  expect(edit.ok && markdown(edit.document)).toContain('# 测试姓名')
})
function plan() {
  const base = freezeActionPlan({planId: 'p', sourceRevision: 's', judgmentRevision: 'j', actions: [{actionId: 'a', title: '补充发现',
    requirementIds: ['requirement'], analysisGapIds: ['gap-analysis'], aspectIds: ['finding'], operation: 'add_detail_gap', sourceScopeIds: ['scope'],
    evidenceIds: ['ev'], detailIds: ['detail-period'], expectedEffect: '写明实际发现', successConditions: [{aspectId: 'finding', criterion: '具体事实'}],
    protectedBoundaries: ['不是采纳或收益'], eligibility: 'needs_user_fact', planningState: 'proposed', intendedScopeIds: ['scope'], origin: 'matching'}]})
  const resolved = freezeResolvedActionPlan({resolvedPlanId: 'rp', revision: 0, basePlanId: base.planId, baseDigest: base.baseDigest,
    actions: base.actions, bindings: [{actionId: 'a', selection: 'selected', selectionReason: null, destination: {entryId: 'entry:0', unitIds: ['unit']}}]})
  return {base, resolved}
}
test('empty detail needs material; filling changes execution only, preserving analysis gap', () => {
  const p = plan(), doc = document(), before = reconcileEditorialActions({resolvedPlan: p.resolved, document: doc})
  expect(before.outcomes[0].state).toBe('needs_material')
  const after = reconcileEditorialActions({resolvedPlan: p.resolved, document: fill(doc).document, previousReview: before})
  expect(after.outcomes[0].state).toBe('pending_review')
  expect(after.outcomes[0].coveredAspectIds).toEqual([])
  expect(p.base.actions[0].analysisGapIds).toEqual(['gap-analysis'])
})
test('immutable action bases and exactly-one bindings are enforced', () => {
  const p = plan()
  expect(validateActionPlan(p.base, p.resolved)).toEqual([])
  const duplicate = freezeResolvedActionPlan({...p.resolved, bindings: [...p.resolved.bindings, p.resolved.bindings[0]]})
  expect(validateActionPlan(p.base, duplicate)).not.toEqual([])
  const forged = freezeResolvedActionPlan({...p.resolved, actions: p.resolved.actions.map(a => ({...a, expectedEffect: '冒称满足资格'}))})
  expect(validateActionPlan(p.base, forged)).toContain('BASE_ACTION_MUTATED')
})

test('trusted partial recovery survives the first and later saves', () => {
  const p = plan(), doc = document()
  const markdown = serializeDraft(doc)
  const input: SaveResumeHistoryInput = {id: 'partial-history', position: '产品经理', company: '测试公司', name: '测试姓名', created_at: '2026-11-12T00:00:00.000Z',
    quality_score: 70, match_score: null, tags: [], resume_content: '原材料', jd_content: '岗位描述', optimized_content: markdown,
    completion_baseline: doc,
    action_baseline: {actionPlan: p.base, resolvedPlan: p.resolved, identityState: {name: 'known'},
      deliveryState: {version: 'resume-delivery-state-v1', state: 'partial_recovery', reasons: ['一条经历局部恢复'], gates: []}},
    process_result: {optimized: {optimized_resume: markdown, completion_document: doc, delivery_state: {state: 'application_ready'}}}}
  const saved = prepareResumeHistorySnapshot(input, null)
  expect((saved.process_result as {optimized: {delivery_state: {state: string}}}).optimized.delivery_state.state).toBe('partial_recovery')
  const next = prepareResumeHistorySnapshot({...saved, action_baseline: undefined,
    expected_document: {documentId: doc.documentId, revision: doc.revision, resolvedDigest: p.resolved.resolvedDigest}}, saved as ResumeHistoryRecord)
  expect((next.process_result as {optimized: {delivery_state: {state: string}}}).optimized.delivery_state.state).toBe('partial_recovery')
})

test('client change-manifest structure cannot replace the server source baseline on first or later saves', () => {
  const p = plan(), doc = document()
  const trustedBasis = {version: 'resume-structure-basis-v1' as const, sourceRevision: 'trusted-source',
    sourceSectionTitles: ['工作经历'], nodes: [{scopeId: 'scope', kind: 'employment', label: '原始公司', sourceOrder: 0,
      parentScopeId: null, beforeQuote: '### 原始公司', blockIds: ['body'], entryIds: ['entry:0'], protectedValues: []}]}
  const forgedBasis = {...trustedBasis, sourceRevision: 'client-forged-source', nodes: []}
  const input: SaveResumeHistoryInput = {id: 'structure-history', position: '产品经理', company: '测试公司', name: '测试姓名', created_at: '2026-11-12T00:00:00.000Z',
    quality_score: 70, match_score: null, tags: [], resume_content: '原材料', jd_content: '岗位描述', optimized_content: serializeDraft(doc), completion_baseline: doc,
    action_baseline: {actionPlan: p.base, resolvedPlan: p.resolved, identityState: {name: 'known'},
      changeManifest: {version: 'resume-change-manifest-v1', documentId: doc.documentId, revision: doc.revision, items: [], structureBasis: trustedBasis}},
    process_result: {optimized: {optimized_resume: serializeDraft(doc), completion_document: doc,
      change_manifest: {structureBasis: forgedBasis}}}}
  const first = prepareResumeHistorySnapshot(input, null)
  const projection = (snapshot: SaveResumeHistoryInput) => (snapshot.process_result as {optimized: {change_manifest: {structureBasis: typeof trustedBasis}}}).optimized.change_manifest.structureBasis
  expect(projection(first)).toEqual(trustedBasis)
  const clientResult = first.process_result as {optimized: Record<string, unknown>}
  const later = prepareResumeHistorySnapshot({...first, action_baseline: undefined,
    expected_document: {documentId: doc.documentId, revision: doc.revision, resolvedDigest: p.resolved.resolvedDigest},
    process_result: {...clientResult, optimized: {...clientResult.optimized, change_manifest: {structureBasis: forgedBasis}}}}, first as ResumeHistoryRecord)
  expect(projection(later)).toEqual(trustedBasis)
})
