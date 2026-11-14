import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {currentInterviewSnapshot, interviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {V5SingleStepAdapter} from '@/v5/single-step-adapter'
import {V5CheckpointRepository} from '@/repositories/v5-checkpoint-repository'
import {prepareResumeHistorySnapshot} from '@/services/resume-completion-snapshot'
import {publicResumeHistory} from '@/routes/resume-history'
import {COMPLETION_TEMPLATES, applyCompletionCommand, beginRowEdit, createCompletionDocument, reconcileRowEdit, serializeDraft} from '@/shared/resume-completion'
import type {ResumeHistoryRecord} from '@/types'
import {resumeStageCacheKey} from '@/v5/stage-fingerprints'
import {buildInterviewContext} from '@/v5/interview-context'

function setup() {
  const generated = createV5ResultFixture()
  const atom = generated.resumeEvidenceBundle.evidenceAtoms.find(a => a.claimType === 'deliverable')!
  const uncertain = {...atom, evidenceId: 'uncertain-outcome', verbatimText: '待补证辅导有效率95%', riskFlags: ['uncertain'] as typeof atom.riskFlags}
  generated.resumeEvidenceBundle.evidenceAtoms.push(uncertain)
  generated.artifact.claims = [{claimId: 'original', outputPath: 'experience.current.bullets[0]', outputText: atom.verbatimText,
    evidenceIds: [atom.evidenceId, uncertain.evidenceId], transformation: 'safe_paraphrase', attributionLevel: 'contributed'}]
  const doc = createCompletionDocument({schemaVersion: 'resume-completion-v3', documentId: 'current-draft', blocks: [{blockId: 'practice', kind: 'bullet', prefix: '- ', outputPath: 'experience.current.bullets[0]', segments: [
    {kind: 'text', segmentId: 'safe', markdown: '设计四类辅导能力', origin: 'generated'},
    {kind: 'optional_gap_clause', gapId: 'finding', detailId: 'finding-detail', template: 'problem', ...COMPLETION_TEMPLATES.problem, candidates: [], retainedFacts: [], fill: {state: 'empty'}},
    {kind: 'text', segmentId: 'boundary', markdown: '。', origin: 'generated'},
    {kind: 'dependent_claim', claimId: 'unsafe', sourceEvidenceIds: [uncertain.evidenceId], sourceSpans: [{sourceBlockId: atom.sourceBlockId, start: 0, end: 8}], readiness: 'context_incomplete', qualifiers: ['待补证'],
      parts: [{kind: 'text', segmentId: 'percent', markdown: '，待补证辅导有效率95%', origin: 'generated'},
        {kind: 'required_detail_gap', gapId: 'period', detailId: 'period-detail', template: 'metric_period', ...COMPLETION_TEMPLATES.metric_period, candidates: [], fill: {state: 'empty'}}, {kind: 'text', segmentId: 'end', markdown: '。', origin: 'generated'}],
      requiredGapIds: ['period'], fillPolicy: 'all_required'},
  ]}]})
  const history = (document = doc) => ({optimized_content: serializeDraft(document), process_result: {optimized: {completion_document: document}}}) as ResumeHistoryRecord
  return {generated, doc, history, atom}
}

test('current interview omits unanswered claims and retains immutable original matching', () => {
  const f = setup(), baseline = structuredClone(f.generated)
  const current = currentInterviewSnapshot(f.generated, f.history())
  expect(current.deliveryMarkdown).toContain('设计四类辅导能力')
  expect(current.deliveryMarkdown).not.toContain('95%')
  expect(current.resumeEvidenceBundle.evidenceAtoms.find(a => a.evidenceId === 'uncertain-outcome')?.status).toBe('excluded')
  expect(current.artifact.usedEvidenceIds).not.toContain('uncertain-outcome')
  expect(current.interviewSnapshot?.pendingDetailIds).toContain('finding-detail')
  expect(current.matchAnalysis).toEqual(f.generated.matchAnalysis)
  expect(f.generated).toEqual(baseline)
})

test('a saved cloze answer becomes attributable current user material, never source evidence', () => {
  const f = setup()
  const filled = applyCompletionCommand(f.doc, {documentId: f.doc.documentId, baseRevision: 0, type: 'fill', gapId: 'finding', value: '用户测试发现入口理解困难'})
  expect(filled.ok).toBe(true)
  if (!filled.ok) return
  const current = currentInterviewSnapshot(f.generated, f.history(filled.document))
  const user = current.resumeEvidenceBundle.evidenceAtoms.find(a => a.provenance?.kind === 'user_edit')!
  expect(user.verbatimText).toContain('用户测试发现入口理解困难')
  expect(user.provenance).toEqual({kind: 'user_edit', documentId: f.doc.documentId, revision: 1})
  expect(user.qualifiers).toContain('用户本次补充，未经外部核验')
  expect(user.sourceScopeId).toBe(f.atom.sourceScopeId)
  expect(current.artifact.usedEvidenceIds).toContain(user.evidenceId)
  expect(current.interviewSnapshot?.pendingDetailIds).not.toContain('finding-detail')
  expect(current.deliveryMarkdown).not.toContain('95%')
})

test('whole-line rewording cannot smuggle an unresolved metric into interview facts', () => {
  const f = setup(), session = beginRowEdit(f.doc, 'practice')!
  const edited = reconcileRowEdit(f.doc, session, '辅导方案已实现94%的有效率。')
  expect(edited.ok).toBe(true)
  if (!edited.ok) return
  const current = currentInterviewSnapshot(f.generated, f.history(edited.document))
  expect(current.deliveryMarkdown).not.toContain('94%')
  expect(current.artifact.claims.some(c => c.outputText.includes('94%'))).toBe(false)
  expect(current.resumeEvidenceBundle.evidenceAtoms.some(a => a.provenance?.kind === 'user_edit' && a.verbatimText.includes('94%'))).toBe(false)
})

test('owned saved interview basis works after the temporary checkpoint is unavailable', async () => {
  const f = setup()
  let receivedRevision: number | undefined
  const history = {...f.history(), process_result: {optimized: {completion_document: f.doc},
    server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(f.generated)}}} as ResumeHistoryRecord
  const adapter = new V5SingleStepAdapter(new V5CheckpointRepository('expired'), () => ({
    extractResume: async () => {throw new Error('unexpected extraction')},
    matchResume: async () => {throw new Error('unexpected matching')},
    generateResume: async () => {throw new Error('unexpected generation')},
    prepareInterview: async current => {
      receivedRevision = current.interviewSnapshot?.revision
      return {runId: 'durable-interview', stepStatuses: [], preparation: {schemaVersion: '5.0.0',
        questions: [], storyRecommendations: [], followUpQuestions: [], strategyAdvice: [], risksToVerify: []}}
    },
  }), undefined, {resolve: async input => ({value: await input.compute({timeoutMs:205000,signal:new AbortController().signal}), cacheStatus: 'miss' as const})})
  const result = await adapter.interview({}, {}, history.optimized_content, 'owned-history-user', {history})
  expect(result.runId).toBe('durable-interview')
  expect(receivedRevision).toBe(f.doc.revision)
  expect(publicResumeHistory(history).process_result).not.toHaveProperty('server_interview_basis')
})

test('client supplied private interview basis is stripped even on legacy history saves', () => {
  const f = setup(), unsafe = {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(f.generated)}
  const input = {id: 'legacy', position: '测试', company: '测试', name: '', created_at: '2026-11-12', quality_score: 1,
    match_score: null, tags: [], resume_content: '', jd_content: '', optimized_content: '', process_result: {server_interview_basis: unsafe}}
  const saved = prepareResumeHistorySnapshot(input, null)
  expect(saved.process_result).not.toHaveProperty('server_interview_basis')
})

test('topic-only changes invalidate interview dependency and survive outside the four questions', async () => {
  const f = setup()
  f.generated.preparationTopics = [{topicId: 'topic', scopeId: f.atom.sourceScopeId, subject: '辅导效果', dimensions: ['definition'],
    sourceEvidenceIds: ['uncertain-outcome'], sourceSpans: [{sourceBlockId: f.atom.sourceBlockId, start: 0, end: 8}],
    requirementIds: [], actionIds: [], sourceAssertionStatus: 'meaning_incomplete', sourceStatement: '有效率待确认',
    prompt: '如何界定有效辅导？', preparationFocus: '准备实际判断标准。'}]
  const dependencies: unknown[] = []
  const adapter = new V5SingleStepAdapter(new V5CheckpointRepository('topics'), () => ({
    extractResume: async () => {throw new Error('unexpected extraction')}, matchResume: async () => {throw new Error('unexpected match')},
    generateResume: async () => {throw new Error('unexpected generation')}, prepareInterview: async () => ({runId: 'topics', stepStatuses: [],
      preparation: {schemaVersion: '5.0.0', questions: [], storyRecommendations: [], followUpQuestions: []}}),
  }), undefined, {resolve: async input => {dependencies.push(input.dependency); return {value: await input.compute({timeoutMs: 60000, signal: new AbortController().signal}), cacheStatus: 'miss' as const}}})
  const history = () => ({...f.history(), process_result: {optimized: {completion_document: f.doc},
    server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(f.generated)}}}) as ResumeHistoryRecord
  const first = await adapter.interview({}, {}, f.history().optimized_content, 'owner', {history: history()})
  f.generated.preparationTopics[0]!.preparationFocus = '准备具体定义与取数来源。'
  const second = await adapter.interview({}, {}, f.history().optimized_content, 'owner', {history: history()})
  expect(first.data.questions).toHaveLength(0)
  expect(second.data.preparation_topics?.[0]?.preparationFocus).toContain('取数来源')
  expect(resumeStageCacheKey('interview', 'owner', dependencies[0])).not.toBe(resumeStageCacheKey('interview', 'owner', dependencies[1]))
  const context = buildInterviewContext(currentInterviewSnapshot(f.generated, history()))
  expect(context.preparationTopics).toHaveLength(1)
  expect(context.resumeEvidenceBundle.evidenceAtoms.some(atom => atom.evidenceId === 'uncertain-outcome')).toBe(false)
})
