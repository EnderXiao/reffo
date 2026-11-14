import { expect, test } from 'bun:test'
import { createV5ResultFixture } from './fixtures'
import { createTargetingFixture } from './targeting-fixtures'
import { v3FixtureEntry } from './entry-skeleton-fixtures'
import { buildWritingPlan } from '@/v5/writing/plan'
import { buildEntryWritingPlan, compileEntryWriting, entryWritingPayload, entryWritingV2OutputSchema, entryWritingV3OutputSchema, entryWritingOutputSchema,
  materializeWrittenEntry, type WrittenEntry } from '@/v5/writing/entries'
import { EntryJsonStream } from '@/v5/writing/entry-stream'
import { writeValidatedEntries } from '@/v5/writing/entry-correction'
import { FIVE_ELEMENTS, inspectEntrySkeleton, projectFactSegments, renderEntrySegments,
  type EntryCoverage, type EntrySegment } from '@/v5/writing/entry-skeleton'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { SupportedWritingError } from '@/v5/writing/compiler'

const ENTRY_WRITING_POLICY = 'entry-writing-v3' as const

function fixture(text = '参与团队设计辅导系统，形成辅导能力设计。') {
  const result = createV5ResultFixture(), targeting = createTargetingFixture()
  const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = text
  source.normalizedClaim = text
  source.numericAtoms = []
  const input = {resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis,
    plan: result.resumePlan, policy: result.generationPolicy,
    targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit},
    editorialPolicy: 'document-editorial-v1' as const}
  const base = buildWritingPlan(input)
  const plan = buildEntryWritingPlan({...input, base})
  const payload = entryWritingPayload(plan)
  const output = {contractVersion: ENTRY_WRITING_POLICY, entries: plan.entries.map(entry => {
    const fact = entry.facts.find(item => entry.coreEvidenceIds.includes(item.evidenceId)) ?? entry.facts[0]
    return v3FixtureEntry({entryId: entry.entryId, paragraphs: [{role: 'detail' as const, text: fact.text, evidenceIds: [fact.evidenceId]}]},
      payload.entries.find(item => item.entryId === entry.entryId)!)
  })}
  // Parse the real provider shape, so assertions cannot accidentally rely on a
  // replay-only legacy paragraph or a free-form display string.
  const wire = entryWritingV3OutputSchema.parse(output)
  const brief = plan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const written = wire.entries.find(entry => entry.entryId === brief.entryId)!
  const id = written.paragraphs[0].segments[0].kind === 'fact' ? written.paragraphs[0].segments[0].evidenceIds[0] : ''
  const compile = () => compileEntryWriting({output: wire, entryPlan: plan, resume: input.resume, policy: input.policy})
  return {input, base, plan, wire, brief, written, id, compile}
}

function addGap(f: ReturnType<typeof fixture>, template: Extract<EntrySegment, {kind: 'optional_gap_clause'}>['template'] = 'problem') {
  const element = template === 'design_deliverable' ? 'result' : template === 'method' ? 'solution'
    : template === 'role_detail' ? 'responsibility' : template === 'project_name' ? 'project' : 'problem'
  const coverage = f.written.coverage.find(item => item.element === element)!
  coverage.status = 'missing'; coverage.evidenceIds = []
  f.written.gapDecisions = [{element, action: 'supplement', purpose: element === 'result' ? 'identify_deliverable' : element === 'responsibility' ? 'clarify_contribution' : element === 'project' ? 'identify_object' : 'explain_key_action', contextEvidenceIds: [f.id], targetTaskIds: []}]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: '参与团队设计辅导系统，形成辅导能力设计', evidenceIds: [f.id]},
    {kind: 'optional_gap_clause', template, candidates: template === 'design_deliverable' ? [{kind: 'design_deliverables'}] : []},
    {kind: 'fact', text: '。', evidenceIds: [f.id]},
  ]
}

function identifyProject(f: ReturnType<typeof fixture>, section: 'project' | 'research' = 'project') {
  f.brief.section = section; f.brief.slot.sectionKey = section
  f.brief.projectIdentity = {text: '真实辅导项目', evidenceIds: [f.id]}
  f.written.coverage.find(item => item.element === 'project')!.evidenceIds = [f.id]
  f.input.resume.timeline.find(item => item.scopeId === f.brief.scopeId)!.kind = section
  f.plan.renderingPlan.scopePlans.find(item => item.scopeId === f.brief.scopeId)!.scopeType = section
  f.input.policy.sectionOrder = [...new Set([...f.input.policy.sectionOrder, section])]
  f.plan.base.blueprint.sectionOrder = [...new Set([...f.plan.base.blueprint.sectionOrder, section])]
}

function expectCode(run: () => unknown, code: string) {
  try { run(); throw new Error('EXPECTED_ERROR') }
  catch (error) { expect(error).toBeInstanceOf(SupportedWritingError); expect((error as SupportedWritingError).issues.map(issue => issue.code)).toContain(code) }
}

test('complete facts and five-element coverage do not automatically create blanks', () => {
  const f = fixture(), compiled = f.compile()
  expect(compiled.deliveryMarkdown).toBe(compiled.artifact.markdown)
  expect(compiled.gapOutputPaths.size).toBe(0)
  expect(compiled.deliveryParagraphs.get(f.brief.entryId)).toEqual(['参与团队设计辅导系统，形成辅导能力设计。'])
  expect(compiled.artifact.usedEvidenceIds).toContain(f.id)
  expect(compiled.completionDocument.revision).toBe(0)
  expect(compiled.completionDocument.blocks.flatMap(block => block.segments)
    .filter(segment => segment.kind === 'optional_gap_clause')).toHaveLength(0)
})

test('coverage may acknowledge a context-only fact without admitting it as body evidence', () => {
  const f = fixture()
  const context = {evidenceId: 'context-only', scopeId: f.brief.scopeId!, text: '实际问题是使用入口难以找到'}
  f.brief.gapContextFacts.push(context)
  f.written.coverage.find(item => item.element === 'problem')!.evidenceIds = [context.evidenceId]
  expect(f.compile().gapOutputPaths.size).toBe(0)
  const first = f.written.paragraphs[0].segments[0]
  if (first.kind !== 'fact') throw new Error('fixture')
  first.evidenceIds = [context.evidenceId]
  expect(() => f.compile()).toThrow()
})

test('incomplete context cannot turn unobserved material into a user supplement', () => {
  const f = fixture(); addGap(f)
  f.brief.gapContextComplete = false
  expectCode(f.compile, 'WRITER_GAP_DECISION_INVALID')
  f.written.gapDecisions = [{element: 'problem', action: 'omit', reason: 'context_incomplete'}]
  f.written.paragraphs[0].segments = [{kind: 'fact', text: '参与团队设计辅导系统，形成辅导能力设计。', evidenceIds: [f.id]}]
  expect(f.compile().gapOutputPaths.size).toBe(0)
})

test.each(['foreign_task', 'foreign_context', 'omit_with_gap', 'wrong_purpose'] as const)('necessary-gap decision rejects %s', mutation => {
  const f = fixture(); addGap(f)
  const decision = f.written.gapDecisions[0]
  if (decision.action !== 'supplement') throw new Error('fixture')
  if (mutation === 'foreign_task') decision.targetTaskIds = ['unrelated-task']
  if (mutation === 'foreign_context') decision.contextEvidenceIds = ['unrelated-fact']
  if (mutation === 'wrong_purpose') decision.purpose = 'clarify_contribution'
  if (mutation === 'omit_with_gap') f.written.gapDecisions = [{element: 'problem', action: 'omit', reason: 'low_value'}]
  expectCode(f.compile, 'WRITER_GAP_DECISION_INVALID')
})

test.each(['problem', 'research_problem', 'design_deliverable'] as const)('typed %s gap has a complete deletion projection and never becomes an evidence claim', template => {
  const f = fixture(); addGap(f, template)
  const compiled = f.compile()
  expect(compiled.deliveryMarkdown).toContain('【待完善：')
  expect(compiled.deliveryMarkdown).toContain('无法确认时删去')
  expect(compiled.deliveryMarkdown.split('\n').filter(line => line.includes('待完善'))).toHaveLength(1)
  expect(compiled.artifact.markdown).not.toContain('待完善')
  expect(compiled.artifact.markdown).not.toContain('需求文档')
  const paths = [...compiled.gapOutputPaths]
  expect(paths).toHaveLength(1)
  const claim = compiled.artifact.claims.find(item => item.outputPath === paths[0])!
  expect(claim.outputText).toBe('- 参与团队设计辅导系统，形成辅导能力设计。')
  expect(claim.evidenceIds).toEqual([f.id])
  expect(projectFactSegments(f.written.paragraphs[0].segments)).toBe(claim.outputText.slice(2))
  if (template === 'design_deliverable') {
    expect(compiled.deliveryMarkdown).toContain('类别示例“需求文档/页面原型/交互流程”')
    expect(compiled.deliveryMarkdown).toContain('须确实完成')
  } else expect(compiled.deliveryMarkdown).not.toContain('可参考')
  const validation = validateGeneratedResumeArtifact({artifact: compiled.artifact, resume: f.input.resume,
    plan: compiled.renderingPlan, policy: f.input.policy, gateMode: 'relaxed_release',
    textPolicy: 'supported_writing_v1', skillPolicy: f.base.skillPolicy, entryParagraphPaths: compiled.entryParagraphPaths})
  expect(validation.passed).toBe(true)
})

test.each(['known', 'not_applicable'] as const)('a %s dimension cannot be blanked', status => {
  const f = fixture(); addGap(f)
  const problem = f.written.coverage.find(item => item.element === 'problem')!
  problem.status = status
  problem.evidenceIds = status === 'known' ? [f.id] : []
  expectCode(f.compile, 'WRITER_KNOWN_ELEMENT_BLANKED')
})

test.each(['duplicate', 'foreign', 'unproven_known'] as const)('coverage rejects %s declarations', mutation => {
  const f = fixture()
  if (mutation === 'duplicate') f.written.coverage[0].element = f.written.coverage[1].element
  if (mutation === 'foreign') f.written.coverage[0].evidenceIds = ['other-scope']
  if (mutation === 'unproven_known') f.written.coverage[0].evidenceIds = []
  expectCode(f.compile, 'WRITER_COVERAGE_INVALID')
})

test.each(['missing_before', 'dangling_verb', 'comma_before', 'missing_after_punctuation', 'consecutive'] as const)('an optional clause cannot hide %s syntax', mutation => {
  const f = fixture(); addGap(f)
  const segments = f.written.paragraphs[0].segments
  if (mutation === 'missing_before') segments.shift()
  if (mutation === 'dangling_verb') segments[0] = {kind: 'fact', text: '参与团队设计辅导系统，针对', evidenceIds: [f.id]}
  if (mutation === 'comma_before') segments[0] = {kind: 'fact', text: '参与团队设计辅导系统，', evidenceIds: [f.id]}
  if (mutation === 'missing_after_punctuation') segments[2] = {kind: 'fact', text: '开展设计。', evidenceIds: [f.id]}
  if (mutation === 'consecutive') segments.splice(1, 0, {kind: 'optional_gap_clause', template: 'method', candidates: []})
  expectCode(f.compile, 'WRITER_GAP_BOUNDARY_INVALID')
})

test.each(['foreign', 'number', 'ownership', 'not_source', 'category_wrong_template', 'guessed_problem'] as const)('rejects %s candidates without granting them evidence credit', mutation => {
  const f = fixture(); addGap(f, mutation === 'guessed_problem' ? 'problem' : 'method')
  const gap = f.written.paragraphs[0].segments[1]
  if (gap.kind !== 'optional_gap_clause') throw new Error('invalid fixture')
  gap.candidates = mutation === 'category_wrong_template' ? [{kind: 'design_deliverables'}]
    : [{kind: 'source', evidenceId: mutation === 'foreign' ? 'other-scope' : f.id,
      text: mutation === 'number' ? '95%' : mutation === 'ownership' ? '独立设计' : mutation === 'not_source' ? '金融风控' : '辅导能力设计'}]
  expectCode(f.compile, 'WRITER_GAP_CANDIDATE_INVALID')
})

test('a source candidate stays a scoped suggestion and never expands claims', () => {
  const f = fixture(); addGap(f, 'method')
  const gap = f.written.paragraphs[0].segments[1]
  if (gap.kind !== 'optional_gap_clause') throw new Error('invalid fixture')
  gap.candidates = [{kind: 'source', text: '辅导能力设计', evidenceId: f.id}]
  const compiled = f.compile()
  expect(compiled.deliveryMarkdown).toContain('可参考“辅导能力设计”，须实际适用')
  expect(compiled.artifact.claims.filter(claim => claim.outputPath === [...compiled.gapOutputPaths][0])[0].evidenceIds).toEqual([f.id])
})

test('editing guidance does not consume the fact-only output budget', () => {
  const f = fixture(); addGap(f, 'design_deliverable')
  const noGap = fixture().compile()
  f.input.policy.outputLength.hardMax = (noGap.artifact.markdown.match(/[\u4e00-\u9fff]/gu) ?? []).length + 2
  const compiled = f.compile()
  expect(compiled.deliveryMarkdown).toContain('待完善')
  expect(compiled.gapOutputPaths.size).toBe(1)
  expect(compiled.writingIssues.some(issue => issue.code === 'WRITER_GAPS_OMITTED_FOR_LENGTH')).toBe(false)
})

test('leadership and collaborator normalization rewrite fact segments before both projections', () => {
  const f = fixture(); addGap(f)
  f.written.paragraphs[0].segments[0] = {kind: 'fact', text: '参与团队主导设计辅导系统，协同研发团队形成辅导能力设计', evidenceIds: [f.id]}
  const compiled = f.compile()
  expect(compiled.artifact.markdown).not.toContain('主导设计')
  expect(compiled.artifact.markdown).not.toContain('研发团队')
  expect(compiled.deliveryMarkdown).not.toContain('主导设计')
  expect(compiled.deliveryMarkdown).not.toContain('研发团队')
  expect(compiled.deliveryMarkdown).toContain('【待完善：')
})

test('bounded correction replaces a complete segment tree and preserves the other entries', async () => {
  const f = fixture(); addGap(f, 'design_deliverable')
  const original = structuredClone(f.wire), calls: number[] = []
  const corrected = await writeValidatedEntries({plan: f.plan,
    write: async (payload, attempt) => {
      calls.push(attempt)
      const output = structuredClone(original)
      if (attempt === 0) {
        const first = output.entries.find(entry => entry.entryId === f.brief.entryId)!.paragraphs[0].segments[0]
        if (first.kind === 'fact') first.text += '新增999个用户'
      } else {
        expect(payload.correction?.issues[0].paragraphIndices).toEqual([0])
        expect(payload.correction?.rejectedEntries[0].paragraphs[0].segments).toBeDefined()
        const rejected = payload.correction!.rejectedEntries[0]
        expect(entryWritingV3OutputSchema.safeParse({contractVersion: ENTRY_WRITING_POLICY, entries: [rejected]}).success).toBe(true)
        expect(Object.keys(rejected.paragraphs[0]).sort()).toEqual(['role', 'segments'])
        expect(rejected.coverage).toEqual(original.entries.find(entry => entry.entryId === f.brief.entryId)!.coverage)
        expect(rejected.gapDecisions).toEqual(original.entries.find(entry => entry.entryId === f.brief.entryId)!.gapDecisions)
        output.entries = output.entries.filter(entry => entry.entryId === f.brief.entryId)
      }
      return output
    }, validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(calls).toEqual([0, 1])
  expect(corrected.result.deliveryMarkdown).toContain('待完善')
  expect(corrected.result.artifact.markdown).not.toContain('999')
  expect(corrected.result.artifact.markdown).not.toContain('待完善')
})

test('every streamed v3 chunk boundary yields the same validated delivery preview', () => {
  const f = fixture(); addGap(f)
  const json = JSON.stringify(f.wire)
  const expected = f.compile().deliveryParagraphs.get(f.brief.entryId)!
  for (let index = 0; index <= json.length; index++) {
    const delivered: string[] = []
    const parser = new EntryJsonStream(entry => {
      if (entry.entryId !== f.brief.entryId) return
      const compiled = compileEntryWriting({output: {contractVersion: ENTRY_WRITING_POLICY, entries: [entry]},
        entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy, previewEntryId: entry.entryId})
      delivered.push(...compiled.deliveryParagraphs.get(entry.entryId)!)
    })
    parser.push(json.slice(0, index)); parser.push(json.slice(index))
    expect(delivered).toEqual(expected)
  }
})

test('v3 stream and production schema reject text-only or independently supplied display text', () => {
  const f = fixture()
  const entry = materializeWrittenEntry(f.written)
  expect(entryWritingV3OutputSchema.safeParse({contractVersion: ENTRY_WRITING_POLICY, entries: [entry]}).success).toBe(false)
  const received: WrittenEntry[] = []
  new EntryJsonStream(value => received.push(value)).push(JSON.stringify({contractVersion: ENTRY_WRITING_POLICY, entries: [entry]}))
  expect(received).toEqual([])
  expect(entryWritingV3OutputSchema.safeParse({...f.wire, deliveryMarkdown: '伪造正文'}).success).toBe(false)
})


test('layout compaction preserves gap positions, facts and original entry ownership', () => {
  const f = fixture(); addGap(f)
  f.written.paragraphs.push({role: 'detail', segments: [{kind: 'fact',
    text: '参与团队形成辅导能力设计。', evidenceIds: [f.id]}]})
  f.plan.listItemHardLimit = f.plan.entries.filter(entry => entry.slot.kind !== 'summary').length
  const compiled = f.compile()
  expect(compiled.writingIssues.some(issue => issue.code === 'WRITER_LAYOUT_COMPACTED')).toBe(true)
  expect(compiled.artifact.markdown).toContain('参与团队设计辅导系统，形成辅导能力设计。 参与团队形成辅导能力设计。')
  expect(compiled.deliveryParagraphs.get(f.brief.entryId)).toHaveLength(1)
  expect(compiled.deliveryParagraphs.get(f.brief.entryId)![0]).toContain('【待完善：')
  expect(compiled.deliveryParagraphs.get(f.brief.entryId)![0]).toEndWith('参与团队形成辅导能力设计。')
  expect(compiled.gapOutputPaths.size).toBe(1)
})

test('a real project heading cannot be downgraded to a missing project name', () => {
  const f = fixture(); addGap(f, 'project_name')
  f.brief.section = 'project'; f.brief.slot.sectionKey = 'project'
  f.input.policy.sectionOrder = [...new Set([...f.input.policy.sectionOrder, 'project' as const])]
  f.brief.projectIdentity = {text: '真实辅导项目', evidenceIds: [f.id]}
  expectCode(f.compile, 'WRITER_KNOWN_ELEMENT_BLANKED')
})

test('presentation guidance cannot silently remove otherwise useful gaps', () => {
  const f = fixture(); addGap(f, 'design_deliverable')
  f.written.coverage.find(item => item.element === 'problem')!.status = 'missing'
  f.written.coverage.find(item => item.element === 'problem')!.evidenceIds = []
  f.written.gapDecisions.push({element: 'problem', action: 'supplement', purpose: 'explain_key_action', contextEvidenceIds: [f.id], targetTaskIds: []})
  f.written.paragraphs.push({role: 'problem', segments: [
    {kind: 'fact', text: '参与团队形成辅导能力设计', evidenceIds: [f.id]},
    {kind: 'optional_gap_clause', template: 'problem', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.id]},
  ]})
  const both = f.compile()
  const withProblemOnly = both.deliveryMarkdown.replace(/，交付设计产物【待完善：[^】]+】/u, '')
  f.input.policy.outputLength.hardMax = (withProblemOnly.match(/[\u4e00-\u9fff]/gu) ?? []).length
  const compiled = f.compile()
  expect(compiled.deliveryMarkdown).toContain('实际业务问题')
  expect(compiled.deliveryMarkdown).toContain('类别示例')
  expect(compiled.gapOutputPaths.size).toBe(2)
  expect(compiled.artifact.markdown).toBe(both.artifact.markdown)
})

test('a sourced missing metric endpoint compiles without promoting the blank to a fact', () => {
  const f = fixture('参与团队项目，完成率从63.02%提升至')
  const result = f.written.coverage.find(item => item.element === 'result')!
  result.status = 'ambiguous'
  f.written.gapDecisions = [{element: 'result', action: 'supplement', purpose: 'complete_existing_comparison', contextEvidenceIds: [f.id], targetTaskIds: []}]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: '参与团队项目，完成率基线为63.02%', evidenceIds: [f.id]},
    {kind: 'optional_gap_clause', template: 'metric_detail', candidates: [], metric: {
      evidenceId: f.id, object: '完成率', missing: 'value', before: '完成率从63.02%提升至', after: '',
    }},
    {kind: 'fact', text: '。', evidenceIds: [f.id]},
  ]
  const compiled = f.compile()
  expect(compiled.deliveryMarkdown).toContain('完成率从63.02%提升至【待完善：填这一个实际数值')
  expect(compiled.artifact.markdown).toContain('完成率基线为63.02%')
  expect(compiled.artifact.markdown).not.toContain('待完善')
  expect(compiled.artifact.markdown).not.toContain('提升至')
  expect(compiled.artifact.usedEvidenceIds).toContain(f.id)
})


test.each(['missing', 'ambiguous'] as const)('identified project with %s problem may omit low-value supplementation', status => {
  const f = fixture()
  identifyProject(f)
  const coverage = f.written.coverage.find(item => item.element === 'problem')!
  coverage.status = status; coverage.evidenceIds = []
  f.written.gapDecisions = [{element: 'problem', action: 'omit', reason: 'already_clear'}]
  expect(f.compile().deliveryMarkdown).not.toContain('【待完善：')
  addGap(f, 'research_problem')
  expect(f.compile().deliveryMarkdown).toContain('【待完善：')
})

test('bounded correction can resolve a missing decision by omitting the low-value gap', async () => {
  const f = fixture()
  identifyProject(f, 'research')
  const coverage = f.written.coverage.find(item => item.element === 'problem')!
  coverage.status = 'missing'; coverage.evidenceIds = []
  const original = structuredClone(f.wire)
  const corrected = await writeValidatedEntries({plan: f.plan, write: async (payload, attempt) => {
    if (attempt === 0) return original
    expect(payload.correction?.issues.map(issue => issue.code)).toContain('WRITER_GAP_DECISION_INVALID')
    expect(payload.requiredEntryIds).toEqual([f.brief.entryId])
    f.written.gapDecisions = [{element: 'problem', action: 'omit', reason: 'low_value'}]
    return {...f.wire, entries: f.wire.entries.filter(entry => entry.entryId === f.brief.entryId)}
  }, validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(corrected.repairAttempts).toBe(1)
  expect(corrected.result.deliveryMarkdown).not.toContain('【待完善：')
  expect(corrected.result.artifact.markdown).toContain('参与团队设计辅导系统，形成辅导能力设计。')
})

test('problem gap rejects a background fragment when sourced action is available', () => {
  const f = fixture(); addGap(f)
  f.written.paragraphs[0].segments[0] = {kind: 'fact', text: '在员工体验研究与方案阶段，围绕辅导系统规划', evidenceIds: [f.id]}
  expectCode(f.compile, 'WRITER_GAP_ACTION_MISSING')
})

test('problem action check does not force an action absent from all selected source facts', () => {
  const segments: EntrySegment[] = [{kind: 'fact', text: '在员工体验研究与方案阶段，围绕辅导系统规划', evidenceIds: ['background']},
    {kind: 'optional_gap_clause', template: 'problem', candidates: []}, {kind: 'fact', text: '。', evidenceIds: ['background']}]
  const coverage = FIVE_ELEMENTS.map(element => ({element, status: element === 'problem' ? 'missing' as const : 'known' as const,
    evidenceIds: element === 'problem' ? [] : ['background']}))
  const issues = inspectEntrySkeleton({coverage, paragraphs: [{segments, text: projectFactSegments(segments), evidenceIds: ['background']}],
    facts: [{evidenceId: 'background', scopeId: 'scope', text: '员工体验研究与方案阶段，围绕辅导系统规划'}],
    atoms: [], scopeId: 'scope', business: true, outputPath: 'project.scope.bullets[0]'})
  expect(issues.some(issue => issue.code === 'WRITER_GAP_ACTION_MISSING')).toBe(false)
})

test('bounded correction moves a problem gap onto a sourced concrete action sentence', async () => {
  const f = fixture(); addGap(f)
  const original = structuredClone(f.wire)
  const paragraph = original.entries.find(entry => entry.entryId === f.brief.entryId)!.paragraphs[0]
  paragraph.segments[0] = {kind: 'fact', text: '在员工体验研究与方案阶段，围绕辅导系统规划', evidenceIds: [f.id]}
  const corrected = await writeValidatedEntries({plan: f.plan, write: async (payload, attempt) => {
    if (attempt === 0) return original
    expect(payload.correction?.issues.map(issue => issue.code)).toContain('WRITER_GAP_ACTION_MISSING')
    return {...f.wire, entries: f.wire.entries.filter(entry => entry.entryId === f.brief.entryId)}
  }, validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(corrected.repairAttempts).toBe(1)
  expect(corrected.result.deliveryMarkdown).toContain('参与团队设计辅导系统，形成辅导能力设计')
  expect(corrected.result.deliveryMarkdown).toContain('【待完善：')
})


test('v2 replay stays readable and distinct from the legacy v3 contract', () => {
  const f = fixture()
  const historical = {contractVersion: 'entry-writing-v2', entries: f.wire.entries.map(({gapDecisions: _decisions, ...entry}) => entry)}
  expect(entryWritingV2OutputSchema.safeParse(historical).success).toBe(true)
  expect(entryWritingOutputSchema.parse(historical).entries[0].paragraphs[0].text).toBeTruthy()
  expect(entryWritingV3OutputSchema.safeParse(historical).success).toBe(false)
})
