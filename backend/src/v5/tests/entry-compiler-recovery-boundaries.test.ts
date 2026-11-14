import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {v4FixtureEntry} from './entry-skeleton-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, entryWritingOutputSchema, entryWritingPayload, entryWritingV4OutputSchema, type EntryBrief} from '@/v5/writing/entries'
import {GAP_TEMPLATES, inspectEntrySkeleton, normalizeDetailTemplateElements, normalizeOptionalGapPunctuation, projectFactSegments, renderEntrySegments, segmentEvidenceIds, type DetailAssessment, type EntrySegment} from '@/v5/writing/entry-skeleton'
import {SupportedWritingError} from '@/v5/writing/compiler'
import {writeValidatedEntries} from '@/v5/writing/entry-correction'
import {applyCompletionCommand, collectGaps, prepareResumeExport, serializeWithoutAllGapClauses} from '@/shared/resume-completion'

function fixture() {
  const result = createV5ResultFixture(), targeting = createTargetingFixture()
  const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = '参与团队设计门店辅导系统，梳理不同岗位的使用流程并形成辅导能力设计，交付页面原型和交互流程。'
  source.normalizedClaim = source.verbatimText
  source.numericAtoms = []
  const input = {resume: result.resumeEvidenceBundle, plan: result.resumePlan, policy: result.generationPolicy,
    job: result.jobRequirementBundle, match: result.matchAnalysis,
    targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit},
    editorialPolicy: 'document-editorial-v1' as const}
  const entryPlan = buildEntryWritingPlan({...input, base: buildWritingPlan(input)})
  const payload = entryWritingPayload(entryPlan)
  const output = entryWritingV4OutputSchema.parse({contractVersion: 'entry-writing-v4', entries: entryPlan.entries.map(entry => {
    const fact = entry.facts.find(item => entry.coreEvidenceIds.includes(item.evidenceId)) ?? entry.facts[0]
    return v4FixtureEntry({entryId: entry.entryId, paragraphs: [{role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId]}]}, payload.entries.find(item => item.entryId === entry.entryId)!)
  })})
  const brief = entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const written = output.entries.find(entry => entry.entryId === brief.entryId)!
  const detail = (id: string, kind: DetailAssessment['detailKind']): DetailAssessment => ({detailId: id, detailKind: kind,
    element: GAP_TEMPLATES[kind].element, subject: '门店辅导系统', anchorEvidenceIds: [source.evidenceId], targetTaskIds: [],
    sourceState: 'missing', answerEvidenceIds: [], expressionState: 'underspecified', decision: 'supplement',
    reason: '源材料保留真实实践，补明该实践对应的独立细节。', benefit: '明确岗位要求的个人分工与实际产出'})
  const compile = () => compileEntryWriting({output, entryPlan, resume: input.resume, policy: input.policy})
  return {input, entryPlan, output, brief, written, source, detail, compile}
}

test('server moves an existing inner comma across a short blank without changing facts or references', () => {
  const original: EntrySegment[] = [
    {kind: 'fact', text: '完成访谈，', evidenceIds: ['research']},
    {kind: 'optional_gap_clause', detailId: 'finding', template: 'research_finding', candidates: []},
    {kind: 'fact', text: '形成研究材料。', evidenceIds: ['deliverable']},
  ]
  const normalized = normalizeOptionalGapPunctuation(original)
  expect(projectFactSegments(normalized)).toBe('完成访谈，形成研究材料。')
  expect(segmentEvidenceIds(normalized)).toEqual(segmentEvidenceIds(original))
  expect(renderEntrySegments(normalized, new Set())).toBe(projectFactSegments(original))
  expect(renderEntrySegments(normalized)).not.toContain('访谈，，')
  expect(normalizeOptionalGapPunctuation(normalized)).toEqual(normalized)
  expect(original[0]).toMatchObject({text: '完成访谈，'})
})

test('adjacent independent blanks preserve every fill and omission combination through compiled export', () => {
  const f = fixture()
  f.written.detailAssessments = [f.detail('role', 'role_detail'), f.detail('deliverable', 'design_deliverable')]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: 'role', template: 'role_detail', candidates: []},
    {kind: 'optional_gap_clause', detailId: 'deliverable', template: 'design_deliverable', candidates: []},
  ]
  const result = f.compile(), initial = result.completionDocument
  const gaps = collectGaps(initial)
  expect(gaps).toHaveLength(2)
  expect(serializeWithoutAllGapClauses(initial)).toBe(result.artifact.markdown)
  for (const mask of [0, 1, 2, 3]) {
    let document = initial
    for (const [index, gap] of gaps.entries()) if (mask & (1 << index)) {
      const edited = applyCompletionCommand(document, {type: 'fill', documentId: document.documentId,
        baseRevision: document.revision, gapId: gap.gapId, value: index ? '门店交互流程图' : '辅导流程梳理'})
      expect(edited.ok).toBe(true)
      if (edited.ok) document = edited.document
    }
    const exported = prepareResumeExport(document)
    expect(exported.ok).toBe(true)
    if (!exported.ok) continue
    expect(exported.markdown).not.toMatch(/待完善|，，|，。/u)
    expect(exported.markdown).toContain(f.source.verbatimText.slice(0, -1))
    expect(exported.markdown.includes('辅导流程梳理')).toBe(Boolean(mask & 1))
    expect(exported.markdown.includes('门店交互流程图')).toBe(Boolean(mask & 2))
  }
})

test('detail failures retain precise cause and paragraph/segment location without changing source state', () => {
  const f = fixture(), detail = f.detail('known', 'design_deliverable')
  detail.sourceState = 'known'
  detail.answerEvidenceIds = [f.source.evidenceId]
  detail.targetTaskIds = ['foreign-task']
  const segments: EntrySegment[] = [{kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: detail.detailId, template: detail.detailKind, candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]}]
  const issues = inspectEntrySkeleton({coverage: f.written.coverage, requireDetails: true, detailAssessments: [detail],
    paragraphs: [{segments, text: projectFactSegments(segments), evidenceIds: segmentEvidenceIds(segments)}],
    facts: f.brief.facts, gapContextFacts: f.brief.gapContextFacts, targetTaskIds: [], atoms: f.input.resume.evidenceAtoms,
    business: true, scopeId: f.brief.scopeId, outputPath: f.brief.slot.outputPath})
  expect(issues).toContainEqual(expect.objectContaining({code: 'WRITER_DETAIL_INVALID', subcode: 'KNOWN_INFORMATION_BLANKED',
    detailId: 'known', paragraphIndex: 0, segmentIndex: 1}))
  expect(issues).toContainEqual(expect.objectContaining({code: 'WRITER_DETAIL_INVALID', subcode: 'TASK_REFERENCE_INVALID', detailId: 'known'}))
  expect(issues.find(issue => issue.subcode === 'TASK_REFERENCE_INVALID')).toMatchObject({paragraphIndex: 0, segmentIndex: 1})
  expect(new Set(issues.map(issue => issue.issueId)).size).toBe(issues.length)
  expect(detail.sourceState).toBe('known')
})

test('template-owned elements normalize without changing source judgments, answers or the input', () => {
  const f = fixture(), detail = {...f.detail('deliverable', 'design_deliverable'), element: 'responsibility' as const}
  f.written.detailAssessments = [detail]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: detail.detailId, template: detail.detailKind, candidates: []},
  ]
  const before = structuredClone(f.output)
  const compiled = f.compile()
  const normalized = compiled.entryAudits.find(entry => entry.entryId === f.brief.entryId)!.detailAssessments[0]
  expect(normalized).toEqual({...detail, element: GAP_TEMPLATES.design_deliverable.element})
  expect(f.output).toEqual(before)
  expect(serializeWithoutAllGapClauses(compiled.completionDocument)).toBe(compiled.artifact.markdown)
  expect(collectGaps(compiled.completionDocument)).toHaveLength(1)
  detail.sourceState = 'known'
  detail.answerEvidenceIds = [f.source.evidenceId]
  expect(f.compile).toThrow(SupportedWritingError)
  expect(detail.sourceState).toBe('known')
  expect(detail.decision).toBe('supplement')
})

test('ambiguous identifiers and conflicting gap templates are not mechanically reinterpreted', () => {
  const f = fixture(), detail = {...f.detail('shared', 'design_deliverable'), element: 'responsibility' as const}
  const paragraphs = [{segments: [{kind: 'optional_gap_clause' as const, detailId: 'shared', template: 'method' as const, candidates: []}]}]
  expect(normalizeDetailTemplateElements([detail], paragraphs)).toEqual([detail])
  expect(normalizeDetailTemplateElements([detail, detail], [])).toEqual([detail, detail])
})

test.each(['，', '；', '。', '！', ',', ';', '.', '!'])('punctuation transfer preserves numbers and attribution for %s', punctuation => {
  const original: EntrySegment[] = [
    {kind: 'fact', text: `参与团队访谈12人${punctuation}`, evidenceIds: ['action']},
    {kind: 'optional_gap_clause', detailId: 'finding', template: 'research_finding', candidates: []},
    {kind: 'fact', text: '形成方案原型，尚未上线。', evidenceIds: ['outcome']},
  ]
  const normalized = normalizeOptionalGapPunctuation(original)
  expect(projectFactSegments(normalized)).toBe(projectFactSegments(original))
  expect(segmentEvidenceIds(normalized)).toEqual(segmentEvidenceIds(original))
  expect(renderEntrySegments(normalized, new Set())).toBe(projectFactSegments(original))
  expect(normalizeOptionalGapPunctuation(normalized)).toEqual(normalized)
})

test('an independently detectable fact failure is collected alongside a cloze failure', () => {
  const f = fixture(), detail = f.detail('unfinished', 'role_detail')
  f.written.detailAssessments = [detail]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: `${f.source.verbatimText}负责`, evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: detail.detailId, template: detail.detailKind, candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]
  f.written.paragraphs.push({role: 'detail', segments: [
    {kind: 'fact', text: `${f.source.verbatimText}提升转化率99%。`, evidenceIds: [f.source.evidenceId]},
  ]})
  try {f.compile(); throw new Error('expected validation failure')}
  catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    const codes = (error as SupportedWritingError).issues.map(issue => issue.code)
    expect(codes).toContain('WRITER_GAP_BOUNDARY_INVALID')
    expect(codes).toContain('WRITER_NUMBER_CHANGED')
  }
})

test('a trusted entry set exposes skill duplication together with another entry cloze error', () => {
  const f = fixture(), detail = f.detail('unfinished', 'role_detail')
  f.written.detailAssessments = [detail]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: `${f.source.verbatimText}负责`, evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: detail.detailId, template: 'role_detail', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]
  const skillBrief: EntryBrief = {...structuredClone(f.brief), entryId: 'entry:duplicate-skill', section: 'skills', scopeId: null,
    slot: {...f.brief.slot, slotId: 'duplicate-skill', kind: 'skill', sectionKey: 'skills', scopeId: null, outputPath: 'skills[9]'}}
  f.entryPlan.entries.push(skillBrief)
  f.output.entries.push({...structuredClone(f.written), entryId: skillBrief.entryId, detailAssessments: [],
    paragraphs: [{role: 'detail', segments: [{kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]}]})
  try {f.compile(); throw new Error('expected validation failure')}
  catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    const codes = (error as SupportedWritingError).issues.map(issue => issue.code)
    expect(codes).toContain('WRITER_GAP_BOUNDARY_INVALID')
    expect(codes).toContain('WRITER_SKILL_CASE_REPEATED')
  }
  expect(entryWritingOutputSchema.parse(f.output).entries).toHaveLength(f.output.entries.length)
})

test('a missing cloze is corrected at its actual second-paragraph anchor without preserving the omission', async () => {
  const f = fixture(), detail = f.detail('missing-in-second', 'role_detail')
  const other = {...f.brief.facts[0], evidenceId: 'separate-practice', text: '参与团队梳理门店辅导流程。'}
  f.brief.facts.push(other)
  f.entryPlan.base.facts.push(other)
  f.entryPlan.base.expandedEvidenceIds[other.evidenceId] = [other.evidenceId]
  f.input.resume.evidenceAtoms.push({...structuredClone(f.source), evidenceId: other.evidenceId,
    verbatimText: other.text, normalizedClaim: other.text})
  f.written.detailAssessments = [detail]
  f.written.paragraphs = [
    {role: 'scope', segments: [{kind: 'fact', text: other.text, evidenceIds: [other.evidenceId]}]},
    {role: 'detail', segments: [{kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]},
  ]
  const corrected = structuredClone(f.output)
  corrected.entries.find(entry => entry.entryId === f.brief.entryId)!.paragraphs[1].segments = [
    {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: detail.detailId, template: detail.detailKind, candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]
  const result = await writeValidatedEntries({plan: f.entryPlan, write: async payload => {
    if (payload.correction) {
      const issue = payload.correction.issues.find(issue => issue.subcode === 'DECISION_GAP_MISMATCH')!
      expect(issue.paragraphIndices).toEqual([1])
      expect(issue.preserveParagraphIndices).toEqual([0])
    }
    const output = payload.correction ? corrected : f.output
    return {...output, entries: output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}
  }, validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy})})
  expect(result.repairAttempts).toBe(1)
  expect(collectGaps(result.result.completionDocument)).toHaveLength(1)
  expect(result.result.artifact.markdown).toContain(other.text)
})

test('a missing cloze with several rendered anchors remains entry-scoped instead of selecting the first bullet', () => {
  const f = fixture(), detail = f.detail('ambiguous-anchor', 'role_detail')
  f.written.detailAssessments = [detail]
  f.written.paragraphs = [0, 1].map(() => ({role: 'detail', segments: [
    {kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]},
  ]}))
  try {f.compile(); throw new Error('expected validation failure')}
  catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    const failure = error as SupportedWritingError
    const issue = failure.issues.find(issue => issue.subcode === 'DECISION_GAP_MISMATCH')!
    expect(issue.outputPath).toBe(f.brief.entryId)
    expect(issue.paragraphIndex).toBeUndefined()
    expect(failure.sourceParagraphIndicesByPath.has(issue.outputPath!)).toBe(false)
  }
})
