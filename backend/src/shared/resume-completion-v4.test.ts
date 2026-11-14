import {expect, test} from 'bun:test'
import {applyCompletionCommand, attachIdentityCompletion, beginRowEdit, collectGaps, COMPLETION_TEMPLATES,
  completionVersion, createCompletionDocument, hasLinkedCompletion, isCompletionV4, prepareResumeExport,
  reconcileRowEdit, renderCompletionHint, replayCompletionOperation, resolveCompletionClaim, serializeDraft,
  validateCompletionDocument, type ResumeCompletionDocument, type ResumeDependentClaim} from './resume-completion'
import {freezeActionPlan, freezeResolvedActionPlan} from './resume-actions'
import {assertResumeCompletionSnapshot, prepareResumeHistorySnapshot} from '@/services/resume-completion-snapshot'
import {acceptsLinkedResume, requireLinkedResumeCapability} from '@/services/completion-capabilities'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'

function document(readiness: ResumeDependentClaim['readiness'] = 'metadata_missing') {
  return createCompletionDocument({schemaVersion: 'resume-completion-v4', documentId: 'v4', blocks: [{blockId: 'body',
    kind: 'bullet', prefix: '- ', entryId: 'entry', unitId: 'unit', segments: [
      {kind: 'text', segmentId: 'safe', markdown: '设计门店辅导流程', origin: 'generated'},
      {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: ['evidence'], sourceSpans: [{start: 0, end: 28}],
        readiness, qualifiers: [], requiredGapIds: ['endpoint'], fillPolicy: 'all_required', parts: [
          {kind: 'text', segmentId: 'result', markdown: '，完成率由60%', origin: 'generated'},
          {kind: 'required_detail_gap', gapId: 'endpoint', detailId: 'detail', template: 'metric_detail',
            ...COMPLETION_TEMPLATES.metric_detail, prefix: '，优化后为', candidates: [], fill: {state: 'empty'}},
          {kind: 'text', segmentId: 'tail', markdown: '。', origin: 'generated'}]},
    ]}]})
}
function filled(doc = document()) {
  const result = applyCompletionCommand(doc, {documentId: doc.documentId, baseRevision: doc.revision, type: 'fill',
    gapId: 'endpoint', value: '88%'})
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result
}
function markdown(doc: ResumeCompletionDocument) {
  const result = prepareResumeExport(doc)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.markdown
}

test('v4 requires one hint and never serializes stacked help or export policies', () => {
  const doc = document(), gap = collectGaps(doc)[0]
  expect(validateCompletionDocument(doc).ok).toBe(true)
  expect(renderCompletionHint(gap)).toBe(gap.hint!)
  expect(serializeDraft(doc)).toContain(`【待完善：${gap.hint}】`)
  expect(serializeDraft(doc)).not.toContain('下载省略')
  delete gap.hint
  expect(validateCompletionDocument(doc).ok).toBe(false)
  gap.hint = '补上数值。再核对结果。'
  expect(validateCompletionDocument(doc).ok).toBe(false)
})

test('constructing v4 from legacy blocks never mutates the source document or archive', () => {
  const source = createCompletionDocument({...document(), schemaVersion: 'resume-completion-v3'})
  delete collectGaps(source)[0].hint
  const legacy = createCompletionDocument(source), original = JSON.stringify(legacy)
  const upgraded = createCompletionDocument({...legacy, schemaVersion: 'resume-completion-v4'})
  expect(JSON.stringify(legacy)).toBe(original)
  expect(validateCompletionDocument(legacy).ok).toBe(true)
  expect(collectGaps(upgraded)[0].hint).toBeTruthy()
})

test('v4 valid short answer exports immediately and replays without a resolution operation', () => {
  const doc = document(), edited = filled(doc)
  expect(markdown(doc)).not.toContain('60%')
  expect(markdown(edited.document)).toContain('88%')
  expect(markdown(edited.document)).not.toContain('待完善')
  expect(prepareResumeExport(edited.document)).toMatchObject({ok: true, omittedClaimCount: 0, omittedClaimIds: []})
  const replay = replayCompletionOperation(doc, edited.operation!)
  expect(replay.ok && replay.document).toEqual(edited.document)
  const resolution = resolveCompletionClaim(edited.document, {kind: 'resolve_claim', documentId: doc.documentId,
    baseRevision: edited.document.revision, claimId: 'claim', resolution: {state: 'confirmed', note: '重复确认', origin: 'user'}})
  expect(resolution.ok).toBe(false)
})

test.each(['conflicted', 'context_incomplete'] as const)('v4 does not convert %s into an admitted fact', readiness => {
  const doc = filled(document(readiness)).document
  const claim = doc.blocks[0].segments[1] as ResumeDependentClaim
  claim.resolution = {state: 'confirmed', note: '历史确认', origin: 'user'}
  expect(markdown(doc)).not.toContain('88%')
})

test('v4 row rewrite exports without another confirmation while retaining provenance and replay', () => {
  const doc = document(), session = beginRowEdit(doc, 'body')!
  const edited = reconcileRowEdit(doc, session, '优化门店辅导流程，完成率达到94%。')
  expect(edited.ok).toBe(true)
  if (!edited.ok) return
  expect(edited.document.claimLineage?.[0].claimId).toBe('claim')
  expect(markdown(edited.document)).toContain('94%')
  const replay = replayCompletionOperation(doc, edited.operation!)
  expect(replay.ok && replay.document).toEqual(edited.document)
})

test('v4 preserves explicit legacy rejection in both dependent and replaced claims', () => {
  const doc = filled().document
  ;(doc.blocks[0].segments[1] as ResumeDependentClaim).resolution = {state: 'rejected', note: '来源记录不可靠', origin: 'user'}
  expect(markdown(doc)).not.toContain('88%')
  const edited = reconcileRowEdit(doc, beginRowEdit(doc, 'body')!, '优化门店辅导流程，完成率达到94%。')
  expect(edited.ok).toBe(true)
  if (edited.ok) expect(markdown(edited.document)).not.toContain('94%')
})

test('v4 identity shares the short hint contract and supports version capabilities', () => {
  const doc = attachIdentityCompletion(document())
  expect(collectGaps(doc).find(gap => gap.kind === 'identity_gap')?.hint).toBe('填写姓名，便于招聘方识别。')
  expect(prepareResumeExport(doc)).toMatchObject({ok: true, identityMissing: true})
  expect(completionVersion(doc)).toBe(4)
  expect(hasLinkedCompletion('resume-completion-v3')).toBe(true)
  expect(hasLinkedCompletion(doc)).toBe(true)
  expect(isCompletionV4(doc)).toBe(true)
  expect(acceptsLinkedResume({'x-reffo-completion-schema': 'resume-completion-v3'})).toBe(true)
  expect(() => requireLinkedResumeCapability({'x-reffo-completion-schema': 'resume-completion-v3'})).toThrow('客户端需要更新')
  expect(() => requireLinkedResumeCapability({'x-reffo-completion-schema': 'resume-completion-v4'})).not.toThrow()
})

test('v4 cannot be downgraded and the journal remains mandatory for edits', () => {
  const source = document(), edited = filled(source)
  const snapshot = (doc: ResumeCompletionDocument): SaveResumeHistoryInput => ({id: 'test', position: '产品经理', company: '', name: '测试',
    created_at: '2026-11-13T00:00:00Z', quality_score: 0, match_score: null, tags: [], resume_content: '源简历', jd_content: '岗位',
    optimized_content: serializeDraft(doc), process_result: {optimized: {optimized_resume: serializeDraft(doc), completion_document: doc}}})
  const previous = snapshot(source)
  expect(() => assertResumeCompletionSnapshot(snapshot(createCompletionDocument({...source, schemaVersion: 'resume-completion-v3'})), previous)).toThrow('不能降级')
  expect(() => assertResumeCompletionSnapshot({...snapshot(edited.document), expected_document: {documentId: source.documentId, revision: 0}}, previous)).toThrow('操作记录缺失')
  expect(() => assertResumeCompletionSnapshot({...snapshot(edited.document), expected_document: {documentId: source.documentId, revision: 0},
    completion_edit: {documentId: source.documentId, baseRevision: 0, operations: [edited.operation!]}}, previous)).not.toThrow()
})

test('client cannot replace server preparation topics or upgrade archive on a normal save', () => {
  const doc = document()
  const plan = freezeActionPlan({planId: 'plan', sourceRevision: 'source', judgmentRevision: 'judgment', actions: []})
  const resolved = freezeResolvedActionPlan({resolvedPlanId: 'resolved', revision: 0, basePlanId: plan.planId, baseDigest: plan.baseDigest,
    actions: [], bindings: []})
  const topics: InterviewPreparationTopic[] = [{topicId: 'server-topic', scopeId: 'scope', subject: '完成率', dimensions: ['definition'],
    sourceEvidenceIds: ['evidence'], sourceSpans: [{sourceBlockId: 'source', start: 0, end: 12}], requirementIds: ['requirement'],
    actionIds: [], sourceAssertionStatus: 'recorded', sourceStatement: '完成率提升至88%', prompt: '解释完成率的计算方法',
    preparationFocus: '准备统计定义'}]
  const input: SaveResumeHistoryInput = {id: 'topics', position: '产品经理', company: '', name: '测试', created_at: '2026-11-13T00:00:00Z',
    quality_score: 0, match_score: null, tags: [], resume_content: '源简历', jd_content: '岗位', optimized_content: serializeDraft(doc),
    completion_baseline: doc, action_baseline: {actionPlan: plan, resolvedPlan: resolved,
      interviewBasis: {preparationTopics: topics} as import('@/v5/types').InterviewGenerationBasis},
    process_result: {server_completion_upgrade_archive: {forged: true}, optimized: {optimized_resume: serializeDraft(doc), completion_document: doc,
      preparation_topics: [{topicId: 'forged'}]}, interview: {preparation_topics: [{topicId: 'forged'}]}}}
  const saved = prepareResumeHistorySnapshot(input, null)
  const result = saved.process_result as {server_completion_upgrade_archive?: unknown; optimized: {preparation_topics: unknown}; interview: {preparation_topics: unknown}}
  expect(result.server_completion_upgrade_archive).toBeUndefined()
  expect(result.optimized.preparation_topics).toEqual(topics)
  expect(result.interview.preparation_topics).toEqual(topics)
  const previous = {...saved, updated_at: '2026-11-13T00:00:01Z', process_result: {...saved.process_result as object,
    server_completion_upgrade_archive: {migrationId: 'trusted'}}} as ResumeHistoryRecord
  const later = prepareResumeHistorySnapshot({...input, action_baseline: undefined, expected_document: {documentId: doc.documentId, revision: 0,
    resolvedDigest: resolved.resolvedDigest}}, previous)
  expect((later.process_result as {server_completion_upgrade_archive: unknown}).server_completion_upgrade_archive).toEqual({migrationId: 'trusted'})
})
