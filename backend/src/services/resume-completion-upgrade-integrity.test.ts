import {expect, test} from 'bun:test'
import {upgradeResumeCompletion} from './resume-completion-upgrade'
import {createV5ResultFixture} from '@/v5/tests/fixtures'
import {currentInterviewSnapshot, interviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {COMPLETION_TEMPLATES, applyCompletionCommand, collectGaps, createCompletionDocument, prepareResumeExport,
  serializeDraft, type ResumeCompletionDocument, type ResumeDependentClaim, type ResumeRequiredDetailGap} from '@/shared/resume-completion'
import {actionContentDigest} from '@/shared/resume-actions'
import type {ResumeHistoryRecord} from '@/types'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'
import type {InterviewGenerationBasis} from '@/v5/types'

function gap(id: string, template: ResumeRequiredDetailGap['template'] = 'metric_definition', value?: string): ResumeRequiredDetailGap {
  return {kind: 'required_detail_gap', gapId: id, detailId: id, template, ...COMPLETION_TEMPLATES[template],
    candidates: [], fill: value ? {state: 'filled', value, origin: 'user'} : {state: 'empty'}}
}
function claim(id: string, text: string, parts: ResumeDependentClaim['parts'], rejected = false): ResumeDependentClaim {
  return {kind: 'dependent_claim', claimId: id, sourceEvidenceIds: ['mixed'], sourceSpans: [{sourceBlockId: 'source', start: 0, end: 100}],
    readiness: 'metadata_missing', qualifiers: [], fillPolicy: 'all_required', requiredGapIds: parts.flatMap(part => part.kind === 'required_detail_gap' ? [part.gapId] : []),
    parts: [{kind: 'text', segmentId: `${id}-result`, markdown: text, origin: 'generated'}, ...parts,
      {kind: 'text', segmentId: `${id}-end`, markdown: '。', origin: 'generated'}],
    ...(rejected ? {resolution: {state: 'rejected', note: '该结果不可使用', origin: 'user'}} : {})}
}
function fixture(claims: ResumeDependentClaim[], text = '搭建内容审核流程；有效率95%；月均1,800+篇；定义与周期待补证。') {
  const doc = createCompletionDocument({schemaVersion: 'resume-completion-v3', documentId: 'integrity', blocks: [{blockId: 'row',
    outputPath: 'experience.test.bullets[0]', kind: 'bullet', prefix: '- ', segments: [
      {kind: 'text', segmentId: 'safe', markdown: '搭建内容审核流程。', origin: 'generated'}, ...claims]}]})
  const result = createV5ResultFixture(), source = result.resumeEvidenceBundle.evidenceAtoms[0]
  result.resumeEvidenceBundle.evidenceAtoms = [{...source, evidenceId: 'mixed', sourceBlockId: 'source', sourceSpan: {start: 0, end: text.length},
    verbatimText: text, normalizedClaim: text, riskFlags: /待补/u.test(text) ? ['uncertain'] : []}]
  const history = {id: 'integrity', position: '产品经理', company: '测试', name: '测试姓名', created_at: '2026-11-13T00:00:00Z', updated_at: '2026-11-13T00:00:00Z',
    quality_score: 70, match_score: 60, tags: [], resume_content: text, jd_content: '产品经理', optimized_content: serializeDraft(doc),
    process_result: {optimized: {optimized_resume: serializeDraft(doc), completion_document: doc},
      server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(result)}}} satisfies ResumeHistoryRecord
  return {history, doc, expected: {documentId: doc.documentId, revision: doc.revision, digest: actionContentDigest(doc)}}
}
const projection = (history: ResumeHistoryRecord) => history.process_result as {optimized: {completion_document: ResumeCompletionDocument; preparation_topics: InterviewPreparationTopic[]};
  server_interview_basis: {result: InterviewGenerationBasis}}

test('retiring one claim never imports a rejected sibling metric from the same source atom', () => {
  const f = fixture([claim('rate', '有效率95%', [gap('rate-definition')]), claim('volume', '月均1,800+篇', [gap('volume-period', 'metric_period')], true)])
  const upgraded = upgradeResumeCompletion(f.history, f.expected), result = projection(upgraded)
  expect(upgraded.optimized_content).toContain('95%')
  expect(upgraded.optimized_content).not.toContain('1,800')
  expect(upgraded.optimized_content.match(/搭建内容审核流程/gu)).toHaveLength(1)
  expect(upgraded.optimized_content).not.toMatch(/。；|。，|；；/u)
  expect(result.server_interview_basis.result.artifact.claims.find(item => item.outputPath === 'experience.test.bullets[0]')?.evidenceIds).toContain('mixed')
  expect(result.optimized.preparation_topics.some(topic => topic.sourceAssertionStatus === 'conflicted')).toBe(true)
  expect(result.optimized.completion_document.claimLineage?.some(item => item.claimId === 'volume' && item.resolution?.state === 'rejected')).toBe(true)
})

test('an unflagged source atom cannot revive a rejected sibling result in the interview snapshot', () => {
  const f = fixture([claim('rate', '有效率95%', [gap('rate-definition')]), claim('volume', '月均1,800+篇', [gap('volume-period', 'metric_period')], true)],
    '搭建内容审核流程；有效率95%；月均1,800+篇。')
  const upgraded = upgradeResumeCompletion(f.history, f.expected), basis = projection(upgraded).server_interview_basis.result
  expect(upgraded.optimized_content).toContain('95%')
  expect(upgraded.optimized_content).not.toContain('1,800')
  const snapshot = currentInterviewSnapshot(basis, upgraded)
  const atom = snapshot.resumeEvidenceBundle.evidenceAtoms.find(item => item.evidenceId === 'mixed')
  expect(atom?.status === 'excluded' || !atom?.verbatimText.includes('1,800')).toBe(true)
})

test('retired answers for distinct metrics in one atom keep separate topic identities and provenance', () => {
  const f = fixture([claim('rate', '有效率95%', [gap('rate-definition', 'metric_definition', '审核通过的内容占比')]),
    claim('volume', '月均1,800+篇', [gap('volume-period', 'metric_period', '2026年8月至10月')])])
  const topics = projection(upgradeResumeCompletion(f.history, f.expected)).optimized.preparation_topics
  const rate = topics.find(topic => topic.userNotes?.some(note => note.detailId === 'rate-definition'))!
  const volume = topics.find(topic => topic.userNotes?.some(note => note.detailId === 'volume-period'))!
  expect(rate.topicId).not.toBe(volume.topicId)
  expect(rate.userNotes?.[0].provenance?.gapId).toBe('rate-definition')
  expect(volume.userNotes?.[0].text).toBe('2026年8月至10月')
})

test('a uniquely shortened legacy metric label joins its routed topic without duplicating it', () => {
  const definition = {...gap('review-definition', 'metric_definition', '按每篇案例记录审核耗时'), label: '单篇审核｜指标定义'}
  const f = fixture([claim('review', '单篇审核由人工约40分钟降至近乎零人工干预', [definition])],
    '搭建内容审核流程；有效率95%；月均1,800+篇；单篇审核由人工约40分钟降至近乎零人工干预；定义与周期待补证。')
  const topics = projection(upgradeResumeCompletion(f.history, f.expected)).optimized.preparation_topics
  expect(topics).toHaveLength(3)
  const review = topics.find(topic => topic.subject.startsWith('单篇审核'))!
  expect(review.userNotes?.[0].text).toBe('按每篇案例记录审核耗时')
  expect(review.userNotes?.[0].provenance?.gapId).toBe('review-definition')
  expect(topics.filter(topic => topic.subject.startsWith('单篇审核'))).toHaveLength(1)
})

test('retiring metadata removes only generated subject scaffolding while an answerable stage gap still exports after filling', () => {
  const stage = gap('stage', 'implementation_stage')
  const f = fixture([claim('rate', '有效率95%', [
    {kind: 'text', segmentId: 'rate:subject:1', markdown: '；关于有效率', origin: 'generated'}, gap('definition'), stage])],
    '搭建内容审核流程；有效率95%。')
  const upgraded = upgradeResumeCompletion(f.history, f.expected), doc = projection(upgraded).optimized.completion_document
  expect(collectGaps(doc).map(item => item.gapId)).toEqual(['stage'])
  expect(serializeDraft(doc)).not.toContain('关于有效率')
  const edited = applyCompletionCommand(doc, {documentId: doc.documentId, baseRevision: doc.revision, type: 'fill', gapId: 'stage', value: '已上线'})
  expect(edited.ok).toBe(true)
  if (!edited.ok) return
  const exported = prepareResumeExport(edited.document)
  expect(exported.ok && exported.markdown).toContain('95%')
  expect(exported.ok && exported.markdown).toContain('已上线')
})

test('missing trusted evidence cannot leave a numeric result unlockable by a legacy stage answer', () => {
  const f = fixture([claim('rate', '有效率95%', [gap('stage', 'implementation_stage', '已上线')])])
  const {server_interview_basis: _basis, ...publicResult} = f.history.process_result
  const upgraded = upgradeResumeCompletion({...f.history, process_result: publicResult}, f.expected), result = projection(upgraded)
  expect(upgraded.optimized_content).not.toContain('95%')
  expect(upgraded.optimized_content).toContain('搭建内容审核流程')
  expect(collectGaps(result.optimized.completion_document)).toHaveLength(0)
  expect(result.optimized.preparation_topics.flatMap(topic => topic.userNotes ?? []).map(note => note.text)).toContain('已上线')
})
