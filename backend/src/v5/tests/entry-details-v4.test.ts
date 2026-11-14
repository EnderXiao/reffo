import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {v4FixtureEntry} from './entry-skeleton-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, entryWritingPayload, entryWritingOutputSchema, entryWritingV4OutputSchema, ENTRY_WRITING_POLICY} from '@/v5/writing/entries'
import {writeValidatedEntries} from '@/v5/writing/entry-correction'
import {GAP_TEMPLATES, inspectEntrySkeleton, normalizeOptionalGapPunctuation, projectFactSegments, renderEntrySegments, segmentEvidenceIds,
  type DetailAssessment, type EntrySegment, type DependentClaim} from '@/v5/writing/entry-skeleton'
import type {EvidenceAtom} from '@/v5/types'
import {writingIssue} from '@/v5/writing/facts'
import {sourceUncertainties, sourceClaimTemplate, uncertaintyDetailRequirements} from '@/v5/writing/source-uncertainties'
import {selectCompletionGaps} from '@/v5/writing/gap-selection'
import {safeRecoveredEntry, buildDetailSeeds} from '@/v5/writing/detail-ledger'
import {collectGaps, applyCompletionCommand, prepareResumeExport, serializeWithoutAllGapClauses} from '@/shared/resume-completion'

test('a trailing research blank reuses the known sentence stop and preserves an exactly safe omission', () => {
  const original: EntrySegment[] = [{kind: 'fact', text: '完成访谈并形成研究材料。', evidenceIds: ['research']},
    {kind: 'optional_gap_clause', detailId: 'finding', template: 'research_finding', candidates: []}]
  const normalized = normalizeOptionalGapPunctuation(original)
  expect(projectFactSegments(normalized)).toBe(projectFactSegments(original))
  expect(renderEntrySegments(normalized)).toMatch(/材料，提炼的实际发现为【待完善：.+】。$/u)
  expect(renderEntrySegments(normalized, new Set())).toBe('完成访谈并形成研究材料。')
  expect(normalizeOptionalGapPunctuation(normalized)).toEqual(normalized)
  expect(original).toHaveLength(2)
})

test('punctuation normalization cannot rescue an unfinished required verb or invent a missing stop', () => {
  for (const text of ['采用。', '围绕。', '完成调研材料']) {
    const segments: EntrySegment[] = [{kind: 'fact', text, evidenceIds: ['research']},
      {kind: 'optional_gap_clause', detailId: 'finding', template: 'research_finding', candidates: []}]
    expect(normalizeOptionalGapPunctuation(segments)).toEqual(segments)
  }
})

function fixture(withUncertainty = false) {
  const result = createV5ResultFixture(), targeting = createTargetingFixture()
  const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = '参与团队设计辅导系统，形成辅导能力设计。'
  source.normalizedClaim = source.verbatimText; source.numericAtoms = []
  const uncertain: EvidenceAtom = {...structuredClone(source), evidenceId: 'pending-result', claimType: 'result' as const,
    status: 'source_qualified' as const, sourceBlockId: 'B9999', sourceSpan: {start: 10000, end: 10080},
    verbatimText: '原简历记载AI辅导有效率95%，评价标准、周期和人工介入范围待补证',
    qualifiers: ['待补证'], riskFlags: ['uncertain' as const]}
  if (withUncertainty) result.resumeEvidenceBundle.evidenceAtoms.push(uncertain)
  const input = {resume: result.resumeEvidenceBundle, job: result.jobRequirementBundle, match: result.matchAnalysis,
    plan: result.resumePlan, policy: result.generationPolicy,
    targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit},
    editorialPolicy: 'document-editorial-v1' as const}
  const base = buildWritingPlan(input), plan = buildEntryWritingPlan({...input, base})
  const payload = entryWritingPayload(plan)
  const wire = entryWritingV4OutputSchema.parse({contractVersion: 'entry-writing-v4', entries: plan.entries.map(entry => {
    const fact = entry.facts.find(item => entry.coreEvidenceIds.includes(item.evidenceId)) ?? entry.facts[0]
    return v4FixtureEntry({entryId: entry.entryId, paragraphs: [{role: 'detail', text: fact.text, evidenceIds: [fact.evidenceId]}]},
      payload.entries.find(item => item.entryId === entry.entryId)!)
  })})
  const brief = plan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const written = wire.entries.find(entry => entry.entryId === brief.entryId)!
  const compile = () => compileEntryWriting({output: wire, entryPlan: plan, resume: input.resume, policy: input.policy})
  const detail = (id: string, kind: DetailAssessment['detailKind']): DetailAssessment => ({detailId: id,
    element: GAP_TEMPLATES[kind].element, detailKind: kind, subject: '辅导系统', anchorEvidenceIds: [source.evidenceId],
    targetTaskIds: [], sourceState: 'missing', answerEvidenceIds: [], expressionState: 'underspecified',
    decision: 'supplement', reason: '来源记录了真实设计实践，但没有该项具体信息。', benefit: '说明实际贡献与交付边界'})
  return {input, plan, payload, wire, brief, written, source, uncertain, detail, compile}
}

test('current source recovery preserves recorded outcomes without manufacturing methodology blanks', () => {
  const f = fixture(true)
  f.brief.coreEvidenceIds = f.brief.facts.map(fact => fact.evidenceId)
  const recovered = safeRecoveredEntry(f.brief)
  expect(recovered.paragraphs).toHaveLength(f.brief.facts.length)
  expect(recovered.coverage?.some(item => item.status === 'missing')).toBe(false)
  expect(recovered.coverage?.find(item => item.element === 'project')).toMatchObject({status: 'known', answer: f.brief.projectIdentity!.text})
  expect(recovered.coverage?.find(item => item.element === 'result')).toMatchObject({status: 'known', resultKind: 'business_outcome'})
  expect(recovered.paragraphs.flatMap(item => item.evidenceIds ?? [])).toContain(f.uncertain.evidenceId)
  expect(recovered.uncertaintyResolutions).toMatchObject([{action: 'use_safe_facts', claimId: null}])
  const parsed = entryWritingV4OutputSchema.parse({contractVersion: 'entry-writing-v4', entries: [{
    entryId: recovered.entryId, coverage: recovered.coverage, detailAssessments: recovered.detailAssessments,
    uncertaintyResolutions: recovered.uncertaintyResolutions,
    paragraphs: recovered.paragraphs.map(({role, segments}) => ({role, segments})),
  }]}).entries[0]
  f.wire.entries = f.wire.entries.map(item => item.entryId === f.brief.entryId ? parsed : item)
  const current = compileEntryWriting({output: {...entryWritingOutputSchema.parse(f.wire), contractVersion: ENTRY_WRITING_POLICY}, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})
  expect(collectGaps(current.completionDocument)).toHaveLength(0)
  expect(current.artifact.markdown).toContain('AI辅导有效率95%')
  expect(current.artifact.markdown).not.toContain('待补证')
})

test('local recovery does not apply project gap coverage to a skill or education entry', () => {
  const f = fixture()
  const brief = structuredClone(f.brief)
  brief.slot.kind = 'skill'
  brief.slot.sectionKey = 'skills'
  brief.section = 'skills'
  const recovered = safeRecoveredEntry(brief)
  expect(recovered.coverage).toHaveLength(5)
  expect(recovered.coverage!.every(item => item.status === 'not_applicable')).toBe(true)
  expect(recovered.actionReceipts).toEqual([])
  expect(recovered.paragraphs.flatMap(item => item.evidenceIds ?? [])
    .every(id => brief.facts.some(fact => fact.evidenceId === id))).toBe(true)
})

test('local recovery preserves a separately valid cloze when another paragraph borrows future context', () => {
  const f = fixture()
  const id = f.source.evidenceId
  const detail = f.detail('deliverable', 'design_deliverable')
  const contextId = 'future-context-only'
  f.brief.coreEvidenceIds = [id]
  f.brief.gapContextFacts.push({evidenceId: contextId, scopeId: f.brief.scopeId!, text: '后续规划验证上线收益。'})
  const safeParagraph = {unitId: `${f.brief.entryId}:u0`, role: 'detail' as const,
    text: f.source.verbatimText, evidenceIds: [id], segments: [
      {kind: 'fact' as const, text: f.source.verbatimText.replace(/。$/u, ''), evidenceIds: [id]},
      {kind: 'optional_gap_clause' as const, detailId: detail.detailId, template: 'design_deliverable' as const, candidates: []},
      {kind: 'fact' as const, text: '。', evidenceIds: [id]},
    ]}
  const rejected = {...safeRecoveredEntry(f.brief), detailAssessments: [detail], paragraphs: [safeParagraph,
    {unitId: `${f.brief.entryId}:u1`, role: 'detail' as const, text: '后续规划验证上线收益。', evidenceIds: [contextId],
      segments: [{kind: 'fact' as const, text: '后续规划验证上线收益。', evidenceIds: [contextId]}]}]}
  const recovered = safeRecoveredEntry(f.brief, {written: rejected,
    issues: [writingIssue('WRITER_EVIDENCE_INVALID', `${f.brief.entryId}:p1`, [contextId], '上下文不得作为事实')]})
  expect(recovered.paragraphs).toEqual([safeParagraph])
  expect(recovered.detailAssessments).toEqual([detail])
  const output = {...f.wire, entries: f.wire.entries.map(entry => entry.entryId === f.brief.entryId ? recovered : entry)}
  const result = compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})
  expect(collectGaps(result.completionDocument)).toHaveLength(1)
  expect(result.artifact.markdown).not.toContain('后续规划')
})

test('compound source metrics receive separate source-owned period requirements, with no bundled answer field', () => {
  const f = fixture(true), signal = structuredClone(f.brief.sourceUncertainties![0])
  signal.text = '- 来源记录：原简历记载AI辅导有效率95%，案例月均沉淀1,800+篇，单篇审核由人工40分钟降为自动处理；评价标准、周期、人工介入范围待补证。'
  const requirements = uncertaintyDetailRequirements(signal)
  expect(requirements.filter(item => item.detailKind === 'metric_period').map(item => item.subject))
    .toEqual(['AI辅导有效率', '案例月均沉淀', '单篇审核'])
  expect(requirements.find(item => item.detailKind === 'human_intervention')?.subject).toBe('单篇审核')
  expect(requirements.filter(item => item.detailKind === 'metric_definition').map(item => item.subject)).toEqual(['AI辅导有效率'])
  f.brief.sourceUncertainties = [signal]
  const seeds = buildDetailSeeds(f.brief, f.input.resume.evidenceAtoms)
  expect(new Set(seeds.map(seed => seed.detailId)).size).toBe(seeds.length)
  expect(seeds.filter(seed => seed.detailKind === 'metric_period')).toHaveLength(0)
  signal.text += '未说明是否使用同一统计周期。'
  expect(uncertaintyDetailRequirements(signal).filter(item => item.detailKind === 'metric_period')).toHaveLength(3)
  signal.text += '三个指标使用同一统计周期。'
  expect(uncertaintyDetailRequirements(signal).filter(item => item.detailKind === 'metric_period')).toHaveLength(1)
})

test('v4 preserves four valuable details in one entry even when five-element coverage is known', () => {
  const f = fixture()
  const kinds = ['role_detail', 'method', 'design_deliverable', 'implementation_stage'] as const
  f.written.detailAssessments = kinds.map(kind => f.detail(kind, kind))
  f.written.paragraphs = kinds.map(kind => ({role: 'detail', segments: [
    {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: kind, template: kind, candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]}))
  const compiled = f.compile()
  expect(collectGaps(compiled.completionDocument)).toHaveLength(4)
  expect(compiled.completionDocument.schemaVersion).toBe('resume-completion-v2')
  expect(compiled.entryAudits.find(entry => entry.entryId === f.brief.entryId)?.detailAssessments).toHaveLength(4)
  expect(compiled.artifact.markdown).not.toContain('待完善')
  expect(serializeWithoutAllGapClauses(compiled.completionDocument)).toBe(compiled.artifact.markdown)
})

test('v4 has no per-element, decision-array or segment quota', () => {
  const f = fixture()
  f.written.detailAssessments = Array.from({length: 7}, (_, index) => ({...f.detail(`d${index}`, 'design_deliverable'), subject: `真实模块${index}`}))
  f.written.paragraphs[0].segments = [...f.written.detailAssessments.flatMap((detail, index) => [
    {kind: 'fact' as const, text: `${index ? '，' : ''}参与团队设计辅导系统`, evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause' as const, detailId: detail.detailId, template: 'design_deliverable' as const, candidates: []},
  ]), {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]}]
  expect(entryWritingV4OutputSchema.safeParse(f.wire).success).toBe(true)
})

test('optional detail prompts identify their subject without introducing template markers', () => {
  const f = fixture()
  f.written.detailAssessments = [{...f.detail('deliverable', 'design_deliverable'), subject: '【辅导系统】\n设计'}]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: 'deliverable', template: 'design_deliverable', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]
  const compiled = f.compile(), gap = collectGaps(compiled.completionDocument)[0]
  expect(gap.label).toBe('「辅导系统」 设计｜实际交付名称')
  expect(gap.instruction).toContain('「辅导系统」 设计')
  expect(gap.instruction).not.toMatch(/[【】\r\n]/u)
  expect(serializeWithoutAllGapClauses(compiled.completionDocument)).toBe(compiled.artifact.markdown)
})

test('source-known details must use the admitted answer and cannot be reblanked', () => {
  const f = fixture()
  f.written.detailAssessments = [{...f.detail('deliverable', 'design_deliverable'), sourceState: 'known', answerEvidenceIds: [f.source.evidenceId]}]
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: f.source.verbatimText.slice(0, -1), evidenceIds: [f.source.evidenceId]},
    {kind: 'optional_gap_clause', detailId: 'deliverable', template: 'design_deliverable', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [f.source.evidenceId]},
  ]
  expect(f.compile).toThrow()
  f.written.detailAssessments[0].decision = 'use_source'
  f.written.paragraphs[0].segments = [{kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}]
  expect(collectGaps(f.compile().completionDocument)).toHaveLength(0)
})

test('same-scope answers are fact-gated and admitted before writing, without a new model request', () => {
  const f = fixture()
  expect(f.payload.skeletonPolicy).not.toHaveProperty('maxGapsPerDocument')
  expect(f.payload.skeletonPolicy).not.toHaveProperty('maxGapsPerEntry')
  expect(f.brief.gapContextFacts.every(context => !f.input.resume.evidenceAtoms.some(atom => atom.evidenceId === context.evidenceId
    && atom.riskFlags.includes('sensitive_pii')))).toBe(true)
})

test('a detail gap stays attached to its actual practice paragraph', () => {
  const f = fixture(), otherId = 'other-practice'
  const segments: EntrySegment[] = [{kind: 'fact', text: '梳理另一项业务流程', evidenceIds: [otherId]},
    {kind: 'optional_gap_clause', detailId: 'deliverable', template: 'design_deliverable', candidates: []},
    {kind: 'fact', text: '。', evidenceIds: [otherId]}]
  const detail = f.detail('deliverable', 'design_deliverable')
  const inspect = () => inspectEntrySkeleton({requireDetails: true, coverage: f.written.coverage,
    detailAssessments: [detail], uncertaintyResolutions: [], sourceUncertainties: [],
    paragraphs: [{segments, text: projectFactSegments(segments), evidenceIds: segmentEvidenceIds(segments)}],
    facts: [...f.brief.facts, {evidenceId: otherId, scopeId: f.brief.scopeId!, text: '梳理另一项业务流程。'}],
    gapContextFacts: f.brief.gapContextFacts, atoms: f.input.resume.evidenceAtoms,
    scopeId: f.brief.scopeId, business: true, outputPath: f.brief.slot.outputPath})
  expect(inspect().some(issue => issue.code === 'WRITER_DETAIL_INVALID')).toBe(true)
  detail.anchorEvidenceIds = [otherId]
  expect(inspect().some(issue => issue.code === 'WRITER_DETAIL_INVALID')).toBe(false)
})

test('known answers cannot be marked keep when their expression still needs work', () => {
  const f = fixture()
  f.written.detailAssessments = [{...f.detail('deliverable', 'design_deliverable'), sourceState: 'known',
    answerEvidenceIds: [f.source.evidenceId], decision: 'keep', expressionState: 'not_used'}]
  expect(f.compile).toThrow()
  f.written.detailAssessments[0].expressionState = 'clear'
  expect(f.compile).not.toThrow()
})

test('detail selection deduplicates the same fact detail but preserves distinct result details', () => {
  const base = {entryId: 'one', scopeId: 'scope', element: 'result' as const, purpose: 'identify_deliverable' as const,
    taskPriority: 0, order: 0, path: 'project.scope.bullets[0]', index: 1, anchorEvidenceIds: ['e1'], subject: '辅导系统'}
  const selected = selectCompletionGaps([{...base, detailId: 'a', detailKind: 'design_deliverable'},
    {...base, detailId: 'b', detailKind: 'implementation_stage', index: 3},
    {...base, detailId: 'copy', detailKind: 'design_deliverable', path: 'project.scope.bullets[1]'}])
  expect(selected.filter(item => item.disposition === 'selected')).toHaveLength(2)
  expect(selected.find(item => item.detailId === 'copy')?.disposition).toBe('omitted_duplicate')
})

test('explicit methodology uncertainties are tracked while their recorded result is admitted', () => {
  const f = fixture(true)
  expect(f.brief.sourceUncertainties).toMatchObject([{evidenceId: 'pending-result', readiness: 'metadata_missing',
    detailKinds: ['metric_definition', 'metric_period', 'human_intervention']}])
  expect(f.brief.facts.find(fact => fact.evidenceId === 'pending-result')?.text).toBe('AI辅导有效率95%。')
  f.written.uncertaintyResolutions = []
  expect(f.compile).toThrow()
})

function dependentFixture() {
  const f = fixture(true)
  const signal = f.brief.sourceUncertainties![0]
  const kinds = signal.detailKinds
  f.written.detailAssessments = kinds.map(kind => f.detail(kind, kind))
  const claim: DependentClaim = {kind: 'dependent_claim', claimId: 'source-result', sourceEvidenceIds: [f.uncertain.evidenceId],
    sourceSpans: [{sourceBlockId: signal.sourceBlockId, ...signal.sourceSpan}], readiness: signal.readiness,
    qualifiers: ['待补证'], requiredDetailIds: kinds, fillPolicy: 'all_required', parts: [
      {kind: 'fact', text: `；${f.uncertain.verbatimText}`, evidenceIds: [f.uncertain.evidenceId]},
      ...kinds.map(kind => ({kind: 'required_detail_gap' as const, detailId: kind, template: kind, candidates: []})),
      {kind: 'fact', text: '。', evidenceIds: [f.uncertain.evidenceId]},
    ]}
  f.written.paragraphs[0].segments = [
    {kind: 'fact', text: f.source.verbatimText, evidenceIds: [f.source.evidenceId]}, claim]
  f.written.uncertaintyResolutions = [{uncertaintyId: signal.uncertaintyId, action: 'dependent_claim', claimId: claim.claimId,
    reason: 'metadata_fields', explanation: '三个字段分别明确评价标准、周期与人工介入范围。'}]
  return {...f, claim}
}

test('independent metrics retain separate required fields of the same template with specific prompts', () => {
  const f = dependentFixture(), signal = f.brief.sourceUncertainties![0]
  signal.text = '原简历记载AI辅导有效率95%、案例月均沉淀1800篇，评价标准、周期和人工介入范围待补证'
  f.uncertain.verbatimText = signal.text
  f.claim.parts[0] = sourceClaimTemplate(signal).sourceFact
  f.written.detailAssessments[0].subject = 'AI辅导有效率'
  f.written.detailAssessments[1].subject = 'AI辅导有效率'
  f.written.detailAssessments[2].subject = '案例审核流程'
  f.written.detailAssessments.push({...f.detail('case-period', 'metric_period'), subject: '案例沉淀'})
  f.claim.requiredDetailIds = [...f.claim.requiredDetailIds, 'case-period']
  f.claim.parts.splice(-1, 0, {kind: 'required_detail_gap', detailId: 'case-period', template: 'metric_period', candidates: []})
  const compiled = f.compile(), gaps = collectGaps(compiled.completionDocument)
  expect(gaps).toHaveLength(4)
  const periods = gaps.filter(gap => gap.template === 'metric_period')
  expect(periods.map(gap => gap.label)).toEqual(['AI辅导有效率｜统计周期', '案例沉淀｜统计周期'])
  expect(periods.map(gap => gap.instruction)).toEqual(['填「AI辅导有效率」实际统计的起止时间', '填「案例沉淀」实际统计的起止时间'])
  expect(gaps.find(gap => gap.template === 'metric_definition')?.instruction).toBe('填「AI辅导有效率」实际采用的判断标准')
  expect(gaps.find(gap => gap.template === 'human_intervention')?.instruction).toBe('填「案例审核流程」实际仍需人工处理的环节')
  expect(serializeWithoutAllGapClauses(compiled.completionDocument)).toBe(compiled.artifact.markdown)
  let document = compiled.completionDocument
  const answers: Record<string, string> = {metric_definition: '由店长判断实际问题是否解决',
    metric_period: '2026年8月', human_intervention: '异常案例由人工复核', 'case-period': '2026年9月'}
  for (const [index, gap] of gaps.entries()) {
    const edited = applyCompletionCommand(document, {type: 'fill', documentId: document.documentId,
      baseRevision: document.revision, gapId: gap.gapId, value: answers[gap.detailId!]})
    expect(edited.ok).toBe(true)
    if (edited.ok) document = edited.document
    const exported = prepareResumeExport(document)
    expect(exported.ok).toBe(true)
    if (!exported.ok) continue
    if (index < gaps.length - 1) {
      expect(exported.markdown).not.toContain('关于AI辅导有效率')
      expect(exported.markdown).not.toContain('关于案例沉淀')
      expect(exported.markdown).not.toContain('95%')
    } else {
      expect(exported.markdown).toContain('；关于AI辅导有效率，统计周期为2026年8月')
      expect(exported.markdown).toContain('；关于案例沉淀，统计周期为2026年9月')
      expect(exported.markdown).toContain('；关于案例审核流程，人工介入环节为异常案例由人工复核')
      expect(exported.markdown).not.toContain('待完善')
    }
    expect(serializeWithoutAllGapClauses(document)).toBe(compiled.artifact.markdown)
  }
})

test.each([true, false])('dependent-claim punctuation respects the existing fact boundary: %s', hasBoundary => {
  const f = dependentFixture()
  const fact = f.written.paragraphs[0].segments[0]
  if (fact.kind !== 'fact') throw new Error('fixture')
  if (!hasBoundary) fact.text = fact.text.slice(0, -1)
  const originalFact = fact.text, compiled = f.compile()
  expect(fact.text).toBe(originalFact)
  expect(compiled.deliveryMarkdown).not.toContain('。；')
  expect(compiled.deliveryMarkdown).toContain(`${originalFact}${hasBoundary ? '' : '；'}${f.uncertain.verbatimText}`)
  expect(serializeWithoutAllGapClauses(compiled.completionDocument)).toBe(compiled.artifact.markdown)
  let document = compiled.completionDocument
  for (const gap of collectGaps(document)) {
    const filled = applyCompletionCommand(document, {type: 'fill', documentId: document.documentId,
      baseRevision: document.revision, gapId: gap.gapId, value: '实际记录'})
    expect(filled.ok).toBe(true)
    if (filled.ok) document = filled.document
  }
  const exported = prepareResumeExport(document)
  expect(exported.ok).toBe(true)
  if (exported.ok) {
    expect(exported.markdown).not.toContain('。；')
    expect(exported.markdown).toContain(`${originalFact}${hasBoundary ? '' : '；'}${f.uncertain.verbatimText}`)
  }
})

test('three required details stay linked and uncertain numbers never enter the artifact or a partial export', () => {
  const f = dependentFixture(), compiled = f.compile()
  expect(compiled.artifact.markdown).not.toContain('95%')
  expect(compiled.artifact.usedEvidenceIds).not.toContain(f.uncertain.evidenceId)
  expect(compiled.deliveryMarkdown).toContain('95%')
  const gaps = collectGaps(compiled.completionDocument)
  expect(gaps).toHaveLength(3)
  let document = compiled.completionDocument
  const fill = (index: number, value: string) => {
    const edited = applyCompletionCommand(document, {documentId: document.documentId, baseRevision: document.revision,
      gapId: gaps[index].gapId, type: 'fill', value})
    expect(edited.ok).toBe(true); if (edited.ok) document = edited.document
  }
  fill(0, '由店长逐条判断回答是否解决问题')
  const partial = prepareResumeExport(document)
  expect(partial.ok).toBe(true); if (partial.ok) expect(partial.markdown).not.toContain('95%')
  fill(1, '2026 年 8 月'); fill(2, '异常案例由人工复核')
  const complete = prepareResumeExport(document)
  expect(complete.ok).toBe(true); if (complete.ok) expect(complete.markdown).toContain('原简历记载AI辅导有效率95%')
  expect(serializeWithoutAllGapClauses(document)).toBe(compiled.artifact.markdown)
})

test('dependent results cannot omit required dimensions, upgrade readiness, or copy uncertain numbers into facts', () => {
  for (const mutation of ['missing_dimension', 'readiness', 'body_copy'] as const) {
    const f = dependentFixture()
    if (mutation === 'missing_dimension') {
      f.claim.parts = f.claim.parts.filter(part => part.kind !== 'required_detail_gap' || part.template !== 'metric_period')
      f.claim.requiredDetailIds = f.claim.requiredDetailIds.filter(id => id !== 'metric_period')
      f.written.detailAssessments = f.written.detailAssessments.filter(detail => detail.detailId !== 'metric_period')
    }
    if (mutation === 'readiness') f.claim.readiness = 'context_incomplete'
    if (mutation === 'body_copy') f.written.paragraphs[0].segments.push({kind: 'fact', text: 'AI辅导有效率95%。', evidenceIds: [f.uncertain.evidenceId]})
    expect(f.compile).toThrow()
  }
})

test('a source conflict is never made ready by asking for more fields', () => {
  const f = fixture(true)
  f.uncertain.riskFlags = ['conflicting']
  const found = sourceUncertainties([f.uncertain], f.uncertain.sourceScopeId)
  expect(found[0].readiness).toBe('conflicted')
})

test('the source-owned claim template retains source labels, metrics and all required fields', () => {
  const f = dependentFixture(), signal = f.brief.sourceUncertainties![0]
  signal.text = '- 来源记录：原简历记载AI辅导有效率95%；评价标准、周期和人工介入范围待补证。'
  f.uncertain.verbatimText = signal.text
  const template = sourceClaimTemplate(signal)
  f.claim.parts = [template.sourceFact, ...f.claim.parts.filter(part => part.kind === 'required_detail_gap'), template.closingFact]
  f.claim.qualifiers = template.qualifiers
  f.written.detailAssessments.forEach(detail => {detail.anchorEvidenceIds = [f.uncertain.evidenceId]})
  expect(entryWritingPayload(f.plan).entries.find(entry => entry.entryId === f.brief.entryId)?.sourceClaimTemplates).toEqual([])
  const compiled = f.compile()
  expect(collectGaps(compiled.completionDocument)).toHaveLength(3)
  expect(compiled.deliveryMarkdown).toContain('来源记录：原简历记载AI辅导有效率95%')
  expect(compiled.artifact.markdown).not.toContain('95%')
  f.claim.parts[0] = {kind: 'fact', text: '上述结果的口径需补充：', evidenceIds: [f.uncertain.evidenceId]}
  expect(f.compile).toThrow()
})

test('a dependent claim cannot be detached from its safe practice paragraph', () => {
  const f = dependentFixture()
  f.written.paragraphs[0].segments = [f.claim]
  expect(f.compile).toThrow()
})

test('a dependent-only paragraph reaches scoped correction after stage materialization', async () => {
  const f = dependentFixture(), valid = structuredClone(f.wire)
  f.brief.taskIds = ['allowed-task']
  f.written.paragraphs[0].segments = [f.claim]
  f.written.detailAssessments[0].targetTaskIds = ['foreign-task']
  const materialized = entryWritingOutputSchema.parse(f.wire)
  const calls: string[][] = []
  const corrected = await writeValidatedEntries({plan: f.plan, write: async payload => {
    calls.push(payload.requiredEntryIds)
    if (!payload.correction) return materialized
    expect(payload.correction.issues.some(issue => issue.code === 'WRITER_DEPENDENT_CLAIM_INVALID')).toBe(true)
    expect(payload.correction.issues.some(issue => issue.message.includes('entry.targetTaskIds=["allowed-task"]'))).toBe(true)
    return {...valid, entries: valid.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}
  }, validate: output => compileEntryWriting({output, entryPlan: f.plan, resume: f.input.resume, policy: f.input.policy})})
  expect(corrected.repairAttempts).toBe(1)
  expect(calls[1]).toEqual([f.brief.entryId])
  expect(collectGaps(corrected.result.completionDocument)).toHaveLength(3)
})

test('all entry skeleton errors are returned together before spending a correction', () => {
  const f = fixture()
  const other = {...structuredClone(f.brief), entryId: 'second-entry',
    slot: {...structuredClone(f.brief.slot), outputPath: `${f.brief.slot.outputPath}:second`}}
  f.plan.entries.push(other)
  f.wire.entries.push({...structuredClone(f.written), entryId: other.entryId})
  f.wire.entries.forEach(entry => {entry.coverage[0].evidenceIds = ['foreign-source']})
  let issues: Array<{code:string;outputPath?:string|null}> = []
  try { f.compile() } catch (error) {issues = (error as {issues: typeof issues}).issues}
  expect(issues.filter(issue => issue.code === 'WRITER_COVERAGE_INVALID').map(issue => issue.outputPath))
    .toEqual([f.brief.slot.outputPath, other.slot.outputPath])
})

test('same-scope known answers enter both the body fact pool and final rendering allocation', () => {
  const f = fixture(), answer: EvidenceAtom = {...structuredClone(f.source), evidenceId: 'known-design-output',
    verbatimText: '参与团队交付需求文档、页面原型和交互流程。', normalizedClaim: '参与团队交付需求文档、页面原型和交互流程。',
    sourceSpan: {start: 15000, end: 15020}, riskFlags: [], qualifiers: [], numericAtoms: []}
  f.input.resume.evidenceAtoms.push(answer)
  const plan = buildEntryWritingPlan({...f.input, base: buildWritingPlan(f.input)})
  expect(plan.entries.find(entry => entry.scopeId === answer.sourceScopeId)?.facts.some(fact => fact.evidenceId === answer.evidenceId)).toBe(true)
  expect(plan.renderingPlan.scopePlans.find(scope => scope.scopeId === answer.sourceScopeId)?.selectedEvidenceIds).toContain(answer.evidenceId)
})
