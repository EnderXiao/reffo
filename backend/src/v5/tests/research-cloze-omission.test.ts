import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, ENTRY_WRITING_POLICY, type WrittenEntry} from '@/v5/writing/entries'
import {buildDetailSeeds, inspectDetailLedger, safeRecoveredEntry} from '@/v5/writing/detail-ledger'
import {writeValidatedEntries} from '@/v5/writing/entry-correction'
import {normalizeOptionalGapPunctuation, projectFactSegments, segmentEvidenceIds} from '@/v5/writing/entry-skeleton'
import {collectGaps, prepareResumeExport} from '@/shared/resume-completion'

const ABSENCE_REASONS = [
  '来源只记录共创与问卷的数量和交付需求数，未记录任何具体观察或结论，无法在不推断的前提下补出研究发现。',
  '来源记录竞品分析周期、访谈参与和共创组织，但未记录任何具体研究结论，补写会变成推断。',
  '来源只记录研究规模与形成的材料类型，未记录任何具体使用发现，无法在不推断的前提下补出结论。',
  '来源记录跟岗、问卷与需求条数，但未记录任何具体研究观察或结论，补写会变成推断。',
] as const

function fixture(reason: string = ABSENCE_REASONS[0]) {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  const source = r.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = '参与线下门店访谈与问卷研究，回收367份问卷，形成产品研究报告。'
  source.normalizedClaim = source.verbatimText; source.numericAtoms = []
  const input = {resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle, match: r.matchAnalysis, plan: r.resumePlan, policy: r.generationPolicy,
    targeting: {profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit}, editorialPolicy: 'document-editorial-v1' as const}
  const plan = buildEntryWritingPlan({...input, base: buildWritingPlan(input)})
  const entry = plan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  entry.taskIds = ['task:research']
  entry.detailSeeds = buildDetailSeeds(entry, input.resume.evidenceAtoms)
  const seed = entry.detailSeeds.find(seed => seed.detailKind === 'research_finding')!
  const written = safeRecoveredEntry(entry)
  written.detailAssessments = [{detailId: seed.detailId, element: 'result', detailKind: 'research_finding', subject: seed.subject,
    anchorEvidenceIds: seed.anchorEvidenceIds, targetTaskIds: ['task:research'], sourceState: 'missing', answerEvidenceIds: [],
    expressionState: 'not_used', decision: 'omit', reason, benefit: '体现用户研究如何支持方案判断。'}]
  return {input, plan, entry, seed, written, source}
}

test.each([...ABSENCE_REASONS])('absence of a research answer is not by itself a valid reason to omit a relevant short blank: %s', reason => {
  const f = fixture(reason)
  expect(inspectDetailLedger(f).map(issue => issue.code)).toEqual(['WRITER_GAP_OMISSION_INVALID'])
})

test.each(['incomplete_context', 'no_related_task', 'known_answer', 'no_actual_practice'] as const)('the omission check does not impose blanks for %s', condition => {
  const f = fixture()
  if (condition === 'incomplete_context') f.entry.gapContextComplete = false
  if (condition === 'no_related_task') f.written.detailAssessments![0].targetTaskIds = []
  if (condition === 'known_answer') {f.written.detailAssessments![0].sourceState = 'known'; f.written.detailAssessments![0].answerEvidenceIds = [f.source.evidenceId]}
  if (condition === 'no_actual_practice') f.entry.facts.forEach(fact => {fact.text = '形成方案材料。'})
  expect(inspectDetailLedger(f).some(issue => issue.code === 'WRITER_GAP_OMISSION_INVALID')).toBe(false)
})

test('a grounded low-relevance reason can still omit the candidate', () => {
  const f = fixture('来源未记录研究结论，但这项线下门店设施访谈与目标岗位推荐算法建模任务无关，补充设施偏好无法说明模型实践。')
  expect(inspectDetailLedger(f)).toEqual([])
})

test('a missing source answer cannot be relabeled as needing new research without source support', () => {
  const f = fixture('门店访谈与问卷未记录研究发现，必须重新调研才能补充，不应虚构。')
  expect(inspectDetailLedger(f).some(issue => issue.code === 'WRITER_GAP_OMISSION_INVALID')).toBe(true)
  f.entry.gapContextFacts.push({evidenceId: 'lost-notes', scopeId: f.entry.scopeId!, text: '门店访谈记录已经遗失，无法访问原始材料。'})
  expect(inspectDetailLedger(f)).toEqual([])
})

function withFindingBlank(f: ReturnType<typeof fixture>): WrittenEntry {
  const written = structuredClone(f.written)
  const detail = written.detailAssessments![0]
  Object.assign(detail, {decision: 'supplement', expressionState: 'underspecified', reason: '有实际研究且关联目标任务，用户补一项发现即可解释方案判断。'})
  const paragraph = written.paragraphs.find(paragraph => paragraph.evidenceIds.some(id => detail.anchorEvidenceIds.includes(id)))!
  const segments = normalizeOptionalGapPunctuation([...paragraph.segments!, {kind: 'optional_gap_clause', detailId: detail.detailId,
    template: 'research_finding', hint: '补一项影响方案选择的用户发现，体现岗位要求的研究与产品判断能力。', candidates: []}])
  Object.assign(paragraph, {segments, text: projectFactSegments(segments), evidenceIds: segmentEvidenceIds(segments)})
  return written
}

test('bounded correction turns the mistaken omission into a useful cloze without inventing a result', async () => {
  const f = fixture()
  const baseEntries = f.plan.entries.map(entry => entry.entryId === f.entry.entryId ? f.written : safeRecoveredEntry(entry))
  const calls: string[][] = []
  const result = await writeValidatedEntries({plan: f.plan, write: async payload => {
    calls.push(payload.requiredEntryIds)
    if (payload.correction) {
      expect(payload.correction.issues.some(issue => issue.code === 'WRITER_GAP_OMISSION_INVALID')).toBe(true)
      return {contractVersion: ENTRY_WRITING_POLICY, entries: [withFindingBlank(f)]}
    }
    return {contractVersion: ENTRY_WRITING_POLICY, entries: baseEntries}
  }, validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual([f.entry.entryId])
  const gaps = collectGaps(result.result.completionDocument)
  expect(gaps).toHaveLength(1)
  expect(gaps[0].template).toBe('research_finding')
  expect(gaps[0].hint).toContain('补一项')
  expect(result.result.artifact.markdown).toContain('367份')
  expect(result.result.artifact.markdown).not.toContain('待完善')
  const exported = prepareResumeExport(result.result.completionDocument)
  expect(exported.ok).toBe(true)
  if (exported.ok) expect(exported.markdown).toBe(result.result.artifact.markdown)
})

test('exhausted omission assessment adds the justified finding blank while retaining existing blanks and exact facts', () => {
  const f = fixture()
  const paragraph = f.written.paragraphs[0]
  paragraph.segments = normalizeOptionalGapPunctuation([...paragraph.segments!, {kind: 'optional_gap_clause', detailId: 'role-detail',
    template: 'role_detail', hint: '补上你负责的具体环节，让招聘者看清个人贡献。', candidates: []}])
  const original = structuredClone(f.written)
  const recovered = safeRecoveredEntry(f.entry, {written: f.written, issues: inspectDetailLedger(f)})
  expect(recovered.paragraphs[0].text).toBe(original.paragraphs[0].text)
  const segments = recovered.paragraphs[0].segments!
  expect(segments.filter(segment => segment.kind === 'optional_gap_clause').map(segment => segment.detailId)).toEqual(['role-detail', f.seed.detailId])
  expect(recovered.detailAssessments![0].decision).toBe('supplement')
  expect(recovered.detailAssessments![0].sourceState).toBe('missing')
  expect(inspectDetailLedger({entry: f.entry, written: recovered})).toEqual([])
})
