import {expect, test} from 'bun:test'
import {upgradeResumeCompletion} from './resume-completion-upgrade'
import {createV5ResultFixture} from '@/v5/tests/fixtures'
import {interviewGenerationBasis, currentInterviewSnapshot, savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {COMPLETION_TEMPLATES, createCompletionDocument, collectGaps, prepareResumeExport, serializeDraft, beginRowEdit, reconcileRowEdit, type ResumeCompletionDocument} from '@/shared/resume-completion'
import {actionContentDigest} from '@/shared/resume-actions'
import type {ResumeHistoryRecord} from '@/types'
import type {InterviewPreparationTopic} from '@/v5/writing/information-routing'
interface UpgradedProjection {optimized: {completion_document: ResumeCompletionDocument; preparation_topics: InterviewPreparationTopic[]}; server_completion_upgrade_archive: {originalDocument: ResumeCompletionDocument}}

function fixture(rejected = false) {
  const result = createV5ResultFixture()
  const base = result.resumeEvidenceBundle.evidenceAtoms[0]!
  const atom = {...base, evidenceId: 'metric', verbatimText: '搭建内容审核流程；月均1,800+篇，有效率95%；有效定义、统计周期与人工介入待补证。',
    riskFlags: ['uncertain'] as typeof base.riskFlags}
  result.resumeEvidenceBundle.evidenceAtoms = [atom]
  const gap = {kind: 'required_detail_gap' as const, gapId: 'definition', detailId: 'definition-detail', template: 'metric_definition' as const,
    ...COMPLETION_TEMPLATES.metric_definition, candidates: [], fill: {state: 'filled' as const, value: '按审核通过率统计', origin: 'user' as const}}
  const doc = createCompletionDocument({schemaVersion: 'resume-completion-v3', documentId: 'legacy', blocks: [
    {blockId: 'row', outputPath: 'experience.current.bullets[0]', kind: 'bullet', prefix: '- ', segments: [
      {kind: 'text', segmentId: 'action', origin: 'generated', markdown: '搭建内容审核流程。'},
      {kind: 'dependent_claim', claimId: 'claim', sourceEvidenceIds: [atom.evidenceId], sourceSpans: [{sourceBlockId: atom.sourceBlockId, start: 0, end: 10}],
        readiness: 'metadata_missing', qualifiers: [], parts: [{kind: 'text', segmentId: 'value', origin: 'generated', markdown: '月均1,800+篇，有效率95%'}, gap,
          {kind: 'text', segmentId: 'end', origin: 'generated', markdown: '。'}], requiredGapIds: [gap.gapId], fillPolicy: 'all_required',
        ...(rejected ? {resolution: {state: 'rejected' as const, note: '这项结果不能使用', origin: 'user' as const}} : {})},
    ]},
  ]})
  const history = {id: 'history', optimized_content: serializeDraft(doc), process_result: {optimized: {optimized_resume: serializeDraft(doc), completion_document: doc},
    server_interview_basis: {version: 'interview-generation-basis-v1', result: interviewGenerationBasis(result)}}} as ResumeHistoryRecord
  return {history, doc, expected: {documentId: doc.documentId, revision: doc.revision, digest: actionContentDigest(doc)}}
}
test('upgrade retires methodological blanks, keeps recorded monthly outcomes and filled notes without confirmation', () => {
  const f = fixture(), upgraded = upgradeResumeCompletion(f.history, f.expected)
  const result = upgraded.process_result as UpgradedProjection, doc = result.optimized.completion_document
  expect(doc.schemaVersion).toBe('resume-completion-v4')
  expect(doc.documentId).toBe(f.doc.documentId)
  expect(doc.revision).toBe(1)
  expect(collectGaps(doc)).toHaveLength(0)
  expect(prepareResumeExport(doc)).toMatchObject({ok: true})
  expect(upgraded.optimized_content).toContain('1,800+')
  expect(upgraded.optimized_content).not.toContain('待补证')
  expect(upgraded.optimized_content).not.toContain('指标判断标准')
  expect(result.optimized.preparation_topics.flatMap(topic => topic.userNotes ?? []).map(note => note.text)).toContain('按审核通过率统计')
  expect(result.server_completion_upgrade_archive.originalDocument).toEqual(f.doc)
  expect(upgradeResumeCompletion(upgraded, f.expected)).toBe(upgraded)
  expect(f.history.optimized_content).toContain('指标判断标准')
})
test('upgrade rejects stale or forged input identity before changing any document', () => {
  const f = fixture()
  expect(() => upgradeResumeCompletion(f.history, {...f.expected, revision: 2})).toThrow('当前稿已更新')
  expect(() => upgradeResumeCompletion(f.history, {...f.expected, digest: 'forged'})).toThrow('当前稿已更新')
})
test('legacy explicit rejection stays omitted and unknown provenance never certifies a source result', () => {
  const rejected = fixture(true), kept = upgradeResumeCompletion(rejected.history, rejected.expected)
  expect(kept.optimized_content).not.toContain('95%')
  const f = fixture(), {server_interview_basis: _, ...publicResult} = f.history.process_result as Record<string, unknown>
  const noBasis = upgradeResumeCompletion({...f.history, process_result: publicResult}, f.expected)
  expect(noBasis.optimized_content).toContain('搭建内容审核流程')
  expect(noBasis.optimized_content).not.toContain('95%')
})
test('legacy user row rewrite is preserved byte for byte through upgrade', () => {
  const f = fixture(), edit = reconcileRowEdit(f.doc, beginRowEdit(f.doc, 'row')!, '本人设计审核方案，已交付流程文档。')
  expect(edit.ok).toBe(true)
  if (!edit.ok) return
  const history = {...f.history, optimized_content: serializeDraft(edit.document), process_result: {...f.history.process_result as object,
    optimized: {optimized_resume: serializeDraft(edit.document), completion_document: edit.document}}}
  const upgraded = upgradeResumeCompletion(history, {documentId: edit.document.documentId, revision: edit.document.revision, digest: actionContentDigest(edit.document)})
  expect(upgraded.optimized_content).toBe(history.optimized_content)
})
test('independent preparation themes survive snapshot isolation without restoring uncertain atoms', () => {
  const f = fixture(), upgraded = upgradeResumeCompletion(f.history, f.expected)
  const basis = savedInterviewGenerationBasis(upgraded)!
  const current = currentInterviewSnapshot(basis, upgraded)
  expect(current.preparationTopics?.length).toBeGreaterThan(0)
  expect(current.interviewSnapshot?.preparationTopicsDigest).toBeTruthy()
})
