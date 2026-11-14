import {expect, test} from 'bun:test'
import {createDigest} from '@/harness/run-context'
import {createHistoricalV5ResultWithInterviewPreparation, FIXTURE_RESUME} from '@/v5/tests/fixtures'
import {interviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {toInterviewPreparation} from '@/v5/main/compatibility'
import {buildInterviewPresentation} from '@/v5/interview-presentation'
import {projectHistoryInterviewPresentation} from './interview-history-presentation'
import {publicResumeHistory} from '@/routes/resume-history'
import type {InterviewSuggestions, ResumeHistoryRecord} from '@/types'
import type {EvidenceAtom} from '@/v5/types'

function fixture() {
  const result = createHistoricalV5ResultWithInterviewPreparation()
  const preparation = result.interviewPreparation!
  const story = preparation.storyRecommendations[0]!
  const requirement = result.jobRequirementBundle.requirementAtoms[0]!
  story.requirementLinks = [{requirementId: requirement.requirementId, evidenceIds: [...story.evidenceIds], focus: '说明产品交付如何支持岗位规划职责。'}]
  const interview = toInterviewPreparation(preparation, result, {sourceText: FIXTURE_RESUME})
  const history = {id: 'history', position: '产品经理', company: '示例', name: '示例', created_at: '2026-11-14', updated_at: '2026-11-14',
    quality_score: 80, match_score: 70, tags: [], resume_content: FIXTURE_RESUME, jd_content: '岗位', optimized_content: result.artifact.markdown,
    process_result: {interview, server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(result)}}} satisfies ResumeHistoryRecord
  return {result, interview, history, preparation}
}
const interviewOf = (history: ResumeHistoryRecord) => (history.process_result as {interview: InterviewSuggestions}).interview

test('history read preserves same-source questions, explicit job links and stable IDs without mutating stored data', () => {
  const {history, interview} = fixture(), before = structuredClone(history)
  const projected = projectHistoryInterviewPresentation(history)
  expect(interviewOf(projected).presentation).toEqual(interview.presentation)
  expect(history).toEqual(before)
  expect(publicResumeHistory(history).process_result).not.toHaveProperty('server_interview_basis')
  expect(interviewOf(publicResumeHistory(history)).presentation).toEqual(interview.presentation)
})

test('legacy derived job and action IDs never become explicit links during a read', () => {
  const {history} = fixture()
  delete history.process_result.interview.presentation
  history.process_result.interview.story_recommendations[0]!.related_requirement_ids = ['anything']
  history.process_result.interview.story_recommendations[0]!.action_ids = ['anything']
  const projected = interviewOf(projectHistoryInterviewPresentation(history)).presentation!
  expect(projected.stories[0]!.jobReferences).toEqual([])
  expect(projected.stories[0]!.sourceGroups.length).toBeGreaterThan(0)
})

test('corrupt same-version presentation degrades locally instead of failing the whole history', () => {
  const {history} = fixture()
  Object.assign(history.process_result.interview, {presentation: {version: 'interview-presentation-v1', questions: [{}], stories: [{sourceGroups: null, jobReferences: null}]}})
  expect(() => projectHistoryInterviewPresentation(history)).not.toThrow()
  expect(interviewOf(projectHistoryInterviewPresentation(history)).questions).toHaveLength(4)
})

test('an older interview keeps its own user facts and links when the resume advances to another revision', () => {
  const {result, history, preparation} = fixture()
  const reference = {documentId: 'draft', revision: 1}, text = '用户测试发现入口理解困难', blockId = 'practice'
  const scope = preparation.storyRecommendations[0]!.scopeId
  const atom: EvidenceAtom = {evidenceId: `user:${createDigest([reference.documentId, reference.revision, blockId, text]).slice(0, 20)}`,
    sourceDocumentHash: createDigest([reference.documentId, reference.revision]), sourceScopeId: scope, sourceBlockId: blockId, sourceSpan: {start: 0, end: text.length},
    verbatimText: text, normalizedClaim: text, claimType: 'other', status: 'source_qualified', attributionLevel: 'unspecified', sourceActionVerb: null,
    qualifiers: ['用户本次补充，未经外部核验'], numericAtoms: [], riskFlags: [], provenance: {kind: 'user_edit', ...reference}}
  const current = structuredClone(result)
  current.resumeEvidenceBundle.evidenceAtoms.push(atom)
  preparation.storyRecommendations[0]!.evidenceIds.push(atom.evidenceId)
  preparation.storyRecommendations[0]!.requirementLinks![0]!.evidenceIds = [atom.evidenceId]
  preparation.questions[0]!.relatedEvidenceIds = [atom.evidenceId]
  const interview = toInterviewPreparation(preparation, current)
  // This saved interview refers to revision 1; the current draft has moved on to revision 2.
  interview.presentation = buildInterviewPresentation(preparation, current, {basedOnDocument: reference})
  const newer = {...history, process_result: {...history.process_result, interview, optimized: {completion_document: {...reference, revision: 2}}}}
  const reopened = interviewOf(projectHistoryInterviewPresentation(newer)).presentation!
  expect(reopened.basedOnDocument).toEqual(reference)
  expect(reopened.questions[0]!.preparationFocus).toBe(preparation.questions[0]!.preparationFocus)
  expect(reopened.stories[0]!.sourceGroups.some(group => group.sourceKind === 'user_fact' && group.paragraphs.includes(text))).toBe(true)
  expect(reopened.stories[0]!.jobReferences).toHaveLength(1)
  expect(reopened.userFactSnapshot).toEqual(interview.presentation.userFactSnapshot)
  const tampered = structuredClone(newer)
  tampered.process_result.interview.presentation!.userFactSnapshot!.facts[0]!.text = '改成另一项事实'
  const rejected = interviewOf(projectHistoryInterviewPresentation(tampered)).presentation!
  expect(rejected.questions[0]!.sourceEvidenceIds).not.toContain(atom.evidenceId)
  expect(rejected.stories[0]!.jobReferences).toHaveLength(0)
})
