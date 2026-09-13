import { writeValidatedEntries } from '@/v5/writing/entry-correction'
import { test, expect } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { buildEntryWritingPlan, compileEntryWriting, entryWritingPayload, ENTRY_WRITING_POLICY, isEntryWritingEnvelope, entryWritingOutputSchema, normalizeEntryWritingOutput } from '@/v5/writing/entries'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { parseEvaluationRunnerArgs } from '@/v5/evaluation-runner-support'
import { workScopeBrief } from '@/v5/writing/work-coverage'
import type { EvidenceAtom } from '@/v5/types'
import { canCompactEntryParagraphs, entryLayoutItemLimit } from '@/v5/writing/entry-layout'
import { EntrySetValidationError, inspectEntrySet } from '@/v5/writing/entry-set'
import { explicitEducationDegree } from '@/v5/writing/education'

function fixture(withSummary = false) {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  if (withSummary) r.generationPolicy.summaryPolicy = 'one_sentence'
  const input = { resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    job: r.jobRequirementBundle, match: r.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit },
    editorialPolicy: 'document-editorial-v1' as const }
  const base = buildWritingPlan(input)
  const entryPlan = buildEntryWritingPlan({ ...input, base })
  const output = { contractVersion: ENTRY_WRITING_POLICY, entries: entryPlan.entries.map(entry => {
    const fact = entry.facts.find(f => entry.coreEvidenceIds.includes(f.evidenceId)) ?? entry.facts[0]
    return { entryId: entry.entryId, paragraphs: [{ role: 'detail' as const, text: fact.text, evidenceIds: [fact.evidenceId] }] }
  }) }
  return { input, base, entryPlan, output }
}

function withScopeOnlyJob() {
  const f = fixture()
  const template = f.input.resume.evidenceAtoms[0]
  const scopeId = 'scope-only-work'
  const heading = { ...template, evidenceId: 'scope-heading', sourceScopeId: scopeId,
    claimType: 'timeline' as const, verbatimText: '示例公司｜专员｜2020 - 2021', riskFlags: [], status: 'source_supported' as const,
    sourceSpan: { start: 10000, end: 10030 } }
  const descriptor: EvidenceAtom = { ...heading, evidenceId: 'scope-description', claimType: 'other' as const,
    verbatimText: '客户服务平台、售后管理工具及运营支持', sourceSpan: { start: 10031, end: 10060 } }
  f.input.resume.evidenceAtoms.push(heading, descriptor)
  f.input.resume.timeline.push({ scopeId, kind: 'experience', organization: '示例公司', title: '专员',
    start: '2020', end: '2021', evidenceIds: [heading.evidenceId, descriptor.evidenceId] })
  f.input.plan.scopePlans.push({ scopeId, scopeType: 'experience', treatment: 'timeline_line', selectedEvidenceIds: [],
    bulletBudget: 0, rewriteAngle: '保留任职' })
  f.input.policy.hardTotalListItemMax = 18
  return { ...f, descriptor, scopeId }
}

test('retains an explicit same-scope degree when the model writes only academic distinctions', () => {
  const f = fixture()
  const template = f.input.resume.evidenceAtoms[0]
  const scopeId = 'education-retention'
  const degree: EvidenceAtom = { ...template, evidenceId: 'education-degree', sourceScopeId: scopeId,
    claimType: 'education', verbatimText: '理学硕士', normalizedClaim: '理学硕士', status: 'source_supported', riskFlags: [],
    qualifiers: [], numericAtoms: [], sourceSpan: { start: 10000, end: 10004 } }
  const distinction: EvidenceAtom = { ...degree, evidenceId: 'education-distinction',
    verbatimText: '连续获得学校奖学金。', normalizedClaim: '连续获得学校奖学金。', sourceSpan: { start: 10005, end: 10020 } }
  f.input.resume.evidenceAtoms.push(degree, distinction)
  f.input.resume.timeline.push({ scopeId, kind: 'education', organization: '示例大学', title: '服务设计', start: '2021', end: '2024',
    evidenceIds: [degree.evidenceId, distinction.evidenceId] })
  f.input.plan.scopePlans.push({ scopeId, scopeType: 'education', treatment: 'include', selectedEvidenceIds: [degree.evidenceId, distinction.evidenceId],
    bulletBudget: 1, rewriteAngle: '保留学历及学习成果' })
  f.input.policy.sectionOrder = [...new Set([...f.input.policy.sectionOrder, 'education' as const])]
  const base = buildWritingPlan(f.input)
  const entryPlan = buildEntryWritingPlan({ ...f.input, base })
  const entry = entryPlan.entries.find(item => item.scopeId === scopeId)!
  expect(entry.facts.map(fact => fact.evidenceId)).toContain(degree.evidenceId)
  const output = { ...f.output, entries: [...f.output.entries, { entryId: entry.entryId,
    paragraphs: [{ role: 'detail' as const, text: distinction.verbatimText, evidenceIds: [distinction.evidenceId] }] }] }
  const compiled = compileEntryWriting({ output, entryPlan, resume: f.input.resume, policy: f.input.policy })
  expect(compiled.artifact.markdown).toContain('理学硕士；连续获得学校奖学金。')
  expect(compiled.artifact.claims.find(claim => claim.outputText.includes('理学硕士；'))?.evidenceIds).toContain(degree.evidenceId)
  expect(compiled.artifact.markdown).not.toContain('硕士毕业')
  expect(output.entries.at(-1)?.paragraphs[0]?.text).toBe(distinction.verbatimText)
})

test('does not infer a degree from a school, planned admission or qualified evidence', () => {
  const template = fixture().input.resume.evidenceAtoms[0]
  const atom: EvidenceAtom = { ...template, claimType: 'education', status: 'source_supported', riskFlags: [] }
  expect(explicitEducationDegree({ ...atom, verbatimText: '示例大学服务设计' })).toBeNull()
  expect(explicitEducationDegree({ ...atom, verbatimText: '计划申请理学硕士' })).toBeNull()
  expect(explicitEducationDegree({ ...atom, verbatimText: '理学硕士', riskFlags: ['future_or_planned'] })).toBeNull()
  expect(explicitEducationDegree({ ...atom, verbatimText: '本科' })).toBe('本科')
})

test('only empty entry ID notes are removed without changing content, references, IDs or input', () => {
  const f = fixture(true)
  const value = { ...f.output, entries: f.output.entries.map(entry => ({ ...entry, entryIdNote: '' })) }
  const before = structuredClone(value)
  const normalized = normalizeEntryWritingOutput(value)
  expect(normalized.removedNotes).toBe(f.output.entries.length)
  expect(normalized.value).toEqual(f.output)
  expect(value).toEqual(before)
  expect(entryWritingOutputSchema.safeParse(value).success).toBe(false)
  expect(entryWritingOutputSchema.safeParse(normalized.value).success).toBe(true)
  for (const extra of [{ entryIdNote: '正文不可丢弃' }, { entryIdNote: null }, { entryIdNote: '', note: '' }]) {
    const invalid = { ...f.output, entries: f.output.entries.map(entry => ({ ...entry, ...extra })) }
    expect(entryWritingOutputSchema.safeParse(normalizeEntryWritingOutput(invalid).value).success).toBe(false)
  }
  const missing = normalizeEntryWritingOutput({ ...value, entries: value.entries.slice(1) })
  expect(() => compileEntryWriting({ output: missing.value, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy }))
    .toThrow(EntrySetValidationError)
})

test('scope-only work gets an exact server-owned brief, not an empty title or an invented contribution', () => {
  const f = withScopeOnlyJob(), before = structuredClone(f.input)
  const entryPlan = buildEntryWritingPlan({ ...f.input, base: f.base })
  expect(entryPlan.entries.some(e => e.scopeId === f.scopeId)).toBe(false)
  expect(entryPlan.renderingPlan.scopePlans.find(s => s.scopeId === f.scopeId)?.treatment).toBe('compress')
  const compiled = compileEntryWriting({ output: f.output, entryPlan, resume: f.input.resume, policy: f.input.policy })
  expect(compiled.artifact.markdown).toContain('### 示例公司｜专员｜2020 - 2021\n\n- 工作范围：客户服务平台、售后管理工具及运营支持。')
  const checked = validateGeneratedResumeArtifact({ artifact: compiled.artifact, resume: f.input.resume,
    plan: compiled.renderingPlan, policy: f.input.policy, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1',
    skillPolicy: f.base.skillPolicy, entryParagraphPaths: compiled.entryParagraphPaths })
  expect(checked.issues.filter(i => i.severity === 'error')).toEqual([])
  expect(f.input).toEqual(before)
  const claim = compiled.artifact.claims.find(c => c.evidenceIds.includes(f.descriptor.evidenceId))!
  compiled.artifact.markdown = compiled.artifact.markdown.replace(claim.outputText, claim.outputText + ' 提升效率。')
  claim.outputText += ' 提升效率。'
  const invalid = validateGeneratedResumeArtifact({ artifact: compiled.artifact, resume: f.input.resume,
    plan: compiled.renderingPlan, policy: f.input.policy, textPolicy: 'supported_writing_v1', entryParagraphPaths: compiled.entryParagraphPaths })
  expect(invalid.issues.some(i => i.code === 'BUSINESS_SCOPE_EVIDENCE_MISMATCH')).toBe(true)
})

test.each(['excluded', 'uncertain', 'foreign_scope', 'project', 'heading', 'metric', 'empty'])(
  'does not fabricate a work brief from %s material', kind => {
    const f = withScopeOnlyJob()
    if (kind === 'excluded') f.descriptor.status = 'excluded'
    if (kind === 'uncertain') f.descriptor.riskFlags.push('uncertain')
    if (kind === 'foreign_scope') f.descriptor.sourceScopeId = 'unrelated'
    if (kind === 'project') f.input.resume.timeline.find(t => t.scopeId === f.scopeId)!.kind = 'project'
    if (kind === 'heading') f.descriptor.verbatimText = '# 客户服务平台、售后管理工具及运营支持'
    if (kind === 'metric') f.descriptor.verbatimText = '覆盖100万用户、增长至'
    if (kind === 'empty') f.descriptor.verbatimText = ''
    expect(workScopeBrief(f.input.resume, f.scopeId)).toBeNull()
  })

test('entry plan is opt-in and immutable, with one source pool per experience', () => {
  const { input, base, entryPlan } = fixture()
  const before = structuredClone(base)
  expect(buildEntryWritingPlan({ ...input, base })).toEqual(entryPlan)
  expect(base).toEqual(before)
  const payload = entryWritingPayload(entryPlan)
  expect(payload).not.toHaveProperty('blueprint')
  expect(payload.entries.every(e => e.purpose && e.facts.length)).toBe(true)
  expect(payload.entries.every(e => Number.isFinite(e.lengthHint.target) && e.lengthHint.target >= 0)).toBe(true)
  expect(payload.entries.reduce((sum, e) => sum + e.lengthHint.target, 0)).toBeLessThanOrEqual(base.outputLength.softMax)
})

test('versioned entry prompt changes only the opt-in schema and preserves old Writer budget', () => {
  const f = fixture()
  const old = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(f.base) } })
  const next = compileV5Prompt({ component: 'P06C', envelope: { payload: entryWritingPayload(f.entryPlan) } })
  expect(old.manifest.promptFilePath).toBe('prompts/P06C-structural.md')
  expect(old.promptVersion).toBe('5.1.0-p06c-supported-writer-r19')
  expect(next.manifest.promptFilePath).toBe('prompts/P06C-entry.md')
  expect(next.schema).toBe(entryWritingOutputSchema)
  expect(next.promptVersion).toBe('5.2.0-p06c-entry-writer-r8')
  expect(next.maxOutputTokens).toBe(old.maxOutputTokens)
  expect(next.messages[0].content).toContain('方案行')
  expect(next.messages[0].content).toContain('不是四项强制填空')
  expect(next.messages[0].content).not.toContain('每个 blueprint.slots')
  expect(next.messages[0].content).not.toContain('无安全证据使用 null')
  expect(isEntryWritingEnvelope({ payload: { source: { entryWritingPolicy: ENTRY_WRITING_POLICY } } })).toBe(false)
})

test('request schema constrains IDs and count while compilation preserves presentation order', () => {
  const f = fixture(true)
  const payload = entryWritingPayload(f.entryPlan)
  const ids = f.entryPlan.entries.map(entry => entry.entryId)
  expect(payload.requiredEntryIds).toEqual(ids)
  expect(payload.requiredEntryCount).toBe(ids.length)
  expect(payload.entries.map(entry => entry.entryId)).not.toEqual(ids)
  const prompt = compileV5Prompt({ component: 'P06C', envelope: { payload } })
  expect(prompt.providerSchema.safeParse(f.output).success).toBe(true)
  for (const entries of [f.output.entries.slice(1), [...f.output.entries, f.output.entries[0]],
    f.output.entries.map((entry, index) => index ? entry : { ...entry, entryId: 'entry:999' })]) {
    expect(prompt.providerSchema.safeParse({ ...f.output, entries }).success).toBe(false)
    expect(prompt.schema.safeParse({ ...f.output, entries }).success).toBe(true)
  }
  const schema = JSON.parse(prompt.messages[1].content.split('STRICT_OUTPUT_JSON_SCHEMA:\n')[1])
  expect(schema.properties.entries).toMatchObject({ minItems: ids.length, maxItems: ids.length })
  expect(schema.properties.entries.items.properties.entryId.enum).toEqual(payload.entries.map(entry => entry.entryId))
  const before = structuredClone(f)
  const original = compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  const reversed = compileEntryWriting({ output: { ...f.output, entries: [...f.output.entries].reverse() },
    entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  expect(reversed.artifact.markdown).toBe(original.artifact.markdown)
  expect(f).toEqual(before)
})

test.each(['missing', 'duplicate', 'unknown'] as const)('reports precise %s entry IDs without leaking arbitrary model text', mutation => {
  const f = fixture(true), ids = f.entryPlan.entries.map(entry => entry.entryId)
  if (mutation === 'missing') f.output.entries.shift()
  if (mutation === 'duplicate') f.output.entries[0] = structuredClone(f.output.entries[1])
  if (mutation === 'unknown') f.output.entries[0].entryId = '私人姓名和联系方式'
  try {
    compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
    throw new Error('expected rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(EntrySetValidationError)
    const { diagnostics } = error as EntrySetValidationError
    expect(diagnostics).toMatchObject({ passed: false, expectedCount: ids.length,
      actualCount: ids.length - Number(mutation === 'missing'), missingIds: [ids[0]] })
    expect(diagnostics.duplicateIds).toEqual(mutation === 'duplicate' ? [ids[1]] : [])
    expect(diagnostics.unknownIds).toHaveLength(Number(mutation === 'unknown'))
    expect(JSON.stringify(diagnostics)).not.toContain('私人姓名和联系方式')
    expect(f.output.entries).toHaveLength(diagnostics.actualCount)
  }
})

test('rejects ambiguous server plans before compiling a model request', () => {
  const f = fixture()
  f.entryPlan.entries.push(structuredClone(f.entryPlan.entries[0]))
  expect(() => entryWritingPayload(f.entryPlan)).toThrow(EntrySetValidationError)
  expect(inspectEntrySet(['entry:0', 'entry:0'], ['entry:0']).duplicateExpectedIds).toEqual(['entry:0'])
  const scope = withScopeOnlyJob()
  const plan = buildEntryWritingPlan({ ...scope.input, base: scope.base })
  const payload = entryWritingPayload(plan)
  expect(payload.entries.every(entry => plan.entries.find(e => e.entryId === entry.entryId)!.scopeId !== scope.scopeId)).toBe(true)
  const fixed = plan.base.fixedBlocks![0]
  plan.entries[0].slot.slotId = fixed.slotId
  expect(() => entryWritingPayload(plan)).toThrow(EntrySetValidationError)
})

test('a long source can support distinct paragraphs without being pruned as repeated evidence', () => {
  const f = fixture()
  const entry = f.entryPlan.entries.find(e => e.slot.kind === 'business_bullet')!
  const written = f.output.entries.find(e => e.entryId === entry.entryId)!
  const evidenceIds = written.paragraphs[0].evidenceIds
  written.paragraphs = [
    { role: 'detail', text: '参与团队产品迭代。', evidenceIds },
    { role: 'detail', text: '团队交付3个功能。', evidenceIds },
  ]
  const compiled = compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  const checked = validateGeneratedResumeArtifact({ artifact: compiled.artifact, resume: f.input.resume,
    plan: compiled.renderingPlan, policy: f.input.policy, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1',
    skillPolicy: f.base.skillPolicy, entryParagraphPaths: compiled.entryParagraphPaths })
  expect(checked.issues.filter(i => i.severity === 'error')).toEqual([])
  expect(checked.value!.markdown).toContain('参与团队产品迭代。')
  expect(checked.value!.markdown).toContain('团队交付3个功能。')
  expect(checked.issues.some(i => i.code === 'REDUNDANT_BUSINESS_CLAIM_SERVER_PRUNED')).toBe(false)
})

test('response arrival order cannot reorder the final document', () => {
  const f = fixture()
  const compile = (output: unknown) => compileEntryWriting({ output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy }).artifact.markdown
  expect(compile(f.output)).toBe(compile({ ...f.output, entries: [...f.output.entries].reverse() }))
})

test('ancillary paragraph splitting is a lossless layout normalization, not an extra model failure', () => {
  const f = fixture(true)
  const brief = f.entryPlan.entries.find(e => e.section === 'summary')!
  const entry = f.output.entries.find(e => e.entryId === brief.entryId)!
  const ids = entry.paragraphs[0].evidenceIds
  entry.paragraphs = [
    { role: 'detail', text: '具有团队产品交付实践。', evidenceIds: ids },
    { role: 'detail', text: '能够协同团队推进迭代。', evidenceIds: ids },
  ]
  const original = structuredClone(f.output)
  const compiled = compileEntryWriting({ output:f.output, entryPlan:f.entryPlan, resume:f.input.resume, policy:f.input.policy })
  expect(compiled.artifact.markdown).toContain('具有团队产品交付实践。 能够协同团队推进迭代。')
  expect(compiled.writingIssues.some(i => i.code === 'WRITER_ANCILLARY_PARAGRAPHS_JOINED' && i.severity === 'warning')).toBe(true)
  expect(f.output).toEqual(original)
  entry.paragraphs[1].evidenceIds = ['foreign']
  expect(() => compileEntryWriting({ output:f.output, entryPlan:f.entryPlan, resume:f.input.resume, policy:f.input.policy })).toThrow()
})

test('entry layout respects the fixed list budget without dropping sentences or rewriting quantities', () => {
  const f = fixture()
  const brief = f.entryPlan.entries.find(e => e.slot.kind === 'business_bullet')!
  const entry = f.output.entries.find(e => e.entryId === brief.entryId)!
  const evidenceIds = entry.paragraphs[0].evidenceIds
  entry.paragraphs = [
    {role:'detail', text:'参与团队产品迭代。', evidenceIds},
    {role:'detail', text:'团队交付3个功能。', evidenceIds},
    {role:'detail', text:'支持团队完成需求梳理。', evidenceIds},
  ]
  f.entryPlan.listItemBudget = f.entryPlan.entries.filter(e => e.slot.kind !== 'summary').length
  f.entryPlan.listItemHardLimit = f.entryPlan.listItemBudget
  const compiled = compileEntryWriting({output:f.output, entryPlan:f.entryPlan, resume:f.input.resume, policy:f.input.policy})
  for (const p of entry.paragraphs) expect(compiled.artifact.markdown).toContain(p.text)
  expect(compiled.writingIssues.some(i => i.code === 'WRITER_LAYOUT_COMPACTED')).toBe(true)
})

test('layout preserves four meaning units within bounded headroom, not one long work paragraph', () => {
  const f = fixture()
  const brief = f.entryPlan.entries.find(e => e.slot.kind === 'business_bullet')!
  const entry = f.output.entries.find(e => e.entryId === brief.entryId)!
  const evidenceIds = entry.paragraphs[0].evidenceIds
  entry.paragraphs = ['scope', 'approach', 'contribution', 'outcome'].map((role, index) => ({
    role: role as 'detail', text: ['参与团队产品迭代。', '协同团队梳理产品需求。', '团队交付3个功能。', '团队完成产品交付。'][index], evidenceIds,
  }))
  f.entryPlan.listItemBudget = 2
  f.entryPlan.listItemHardLimit = 6
  const compiled = compileEntryWriting({output:f.output, entryPlan:f.entryPlan, resume:f.input.resume, policy:f.input.policy})
  expect(compiled.artifact.claims.filter(c => c.outputPath.startsWith('experience.'))).toHaveLength(4)
  expect(compiled.writingIssues.some(i => i.code === 'WRITER_LAYOUT_COMPACTED')).toBe(false)
  expect(compiled.writingIssues.some(i => i.code === 'ENTRY_LAYOUT_TARGET_EXCEEDED')).toBe(true)
  // Headroom is server-owned, bounded, and cannot override the word cap.
  const policy = { ...f.input.policy, hardTotalListItemMax: 4 }
  const input = {artifact:compiled.artifact, resume:f.input.resume, plan:compiled.renderingPlan, policy,
    gateMode:'relaxed_release' as const, textPolicy:'supported_writing_v1' as const}
  // The legacy validator may deduplicate shared-source paragraphs, but does
  // not opt into the entry-specific presentation allowance.
  expect(validateGeneratedResumeArtifact(input).issues.some(i => i.code === 'ENTRY_LAYOUT_TARGET_EXCEEDED')).toBe(false)
  expect(validateGeneratedResumeArtifact({...input, entryParagraphPaths:compiled.entryParagraphPaths}).issues.some(i => i.code === 'BUDGET_EXCEEDED')).toBe(false)
  expect(validateGeneratedResumeArtifact({...input, policy:{...policy, hardTotalListItemMax:1}, entryParagraphPaths:compiled.entryParagraphPaths}).issues.some(i => i.code === 'BUDGET_EXCEEDED')).toBe(true)
  expect(validateGeneratedResumeArtifact({...input, policy:{...policy, outputLength:{...policy.outputLength, hardMax:1}}, entryParagraphPaths:compiled.entryParagraphPaths}).issues.some(i => i.code === 'BUDGET_EXCEEDED')).toBe(true)
  expect(entryLayoutItemLimit({...policy, hardTotalListItemMax:18})).toBe(24)
})

test('compaction never joins a long paragraph or erases distinct problem/scope roles', () => {
  const paragraph = { role: 'contribution', text: '已记录的实际业务动作。'.repeat(10) }
  expect(canCompactEntryParagraphs(paragraph, paragraph, 'cjk_characters')).toBe(false)
  expect(canCompactEntryParagraphs({role:'problem',text:'业务问题。'}, {role:'approach',text:'方案。'}, 'cjk_characters')).toBe(false)
  expect(canCompactEntryParagraphs({role:'scope',text:'岗位职责。'}, {role:'contribution',text:'代表贡献。'}, 'cjk_characters')).toBe(false)
  expect(canCompactEntryParagraphs({role:'approach',text:'已记录的行动。'}, {role:'outcome',text:'实际交付。'}, 'cjk_characters')).toBe(true)
  expect(canCompactEntryParagraphs({role:'detail',text:'word '.repeat(50)}, {role:'detail',text:'word '.repeat(50)}, 'words')).toBe(false)
})

test('unsupported summary leadership is downgraded, not accepted as a stronger role', () => {
  const f = fixture(true)
  const brief = f.entryPlan.entries.find(e => e.section === 'summary')!
  const entry = f.output.entries.find(e => e.entryId === brief.entryId)!
  entry.paragraphs[0].text = '具备团队产品实践，主导过产品迭代。'
  const compiled = compileEntryWriting({output:f.output, entryPlan:f.entryPlan, resume:f.input.resume, policy:f.input.policy})
  expect(compiled.artifact.markdown).toContain('具备团队产品实践，参与过产品迭代。')
  expect(compiled.writingIssues.some(i => i.code === 'WRITER_SUMMARY_OWNERSHIP_DOWNGRADED')).toBe(true)
  expect(entry.paragraphs[0].text).toContain('主导过')
})

test.each([false, true])('business leadership normalization preserves a source action and respects explicit leadership: %s', supported => {
  const f = fixture()
  const brief = f.entryPlan.entries.find(e => e.slot.kind === 'business_bullet')!
  const paragraph = f.output.entries.find(e => e.entryId === brief.entryId)!.paragraphs[0]
  const atom = f.input.resume.evidenceAtoms.find(a => a.evidenceId === paragraph.evidenceIds[0])!
  atom.verbatimText = supported ? '主导完成团队产品迭代。' : '参与团队完成产品迭代。'
  paragraph.text = '主导完成团队产品迭代。'
  const compiled = compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  expect(compiled.artifact.markdown).toContain(supported ? '主导完成团队产品迭代。' : '- 完成团队产品迭代。')
  expect(compiled.writingIssues.some(i => i.code === 'WRITER_UNSUPPORTED_LEADERSHIP_REMOVED')).toBe(!supported)
  expect(paragraph.text).toBe('主导完成团队产品迭代。')
})

test.each(['missing', 'duplicate', 'unknown', 'foreign_reference', 'invented_number', 'markdown'] as const)('rejects %s without requiring a model judge', mutation => {
  const f = fixture(), entry = f.output.entries[0]
  if (mutation === 'missing') f.output.entries.pop()
  if (mutation === 'duplicate') f.output.entries.push(structuredClone(entry))
  if (mutation === 'unknown') entry.entryId = 'invented-entry'
  if (mutation === 'foreign_reference') entry.paragraphs[0].evidenceIds = ['unrelated']
  if (mutation === 'invented_number') entry.paragraphs[0].text += '增长999%。'
  if (mutation === 'markdown') entry.paragraphs[0].text = '### 自创标题'
  expect(() => compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })).toThrow()
})

test('ordinary missing outcomes remain an optional writing dimension', () => {
  const f = fixture()
  const entry = f.output.entries.find(e => f.entryPlan.entries.find(b => b.entryId === e.entryId)?.slot.kind === 'business_bullet')!
  entry.paragraphs[0].text = '参与团队产品迭代。'
  const result = compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  expect(result.artifact.markdown).not.toContain('源材料未记录')
  expect(result.writingIssues.some(i => i.code === 'WRITER_PRIORITY_OUTCOME_OMITTED' && i.severity === 'warning')).toBe(true)
})

test('entry brief restores selected material and unlabeled context, but never another scope or unsafe text', () => {
  const f = fixture(), scope = f.input.plan.scopePlans.find(s => s.selectedEvidenceIds.length)!
  const anchor = f.input.resume.evidenceAtoms.find(a => a.evidenceId === scope.selectedEvidenceIds[0])!
  const context = { ...anchor, evidenceId: 'context', claimType: 'other' as const,
    verbatimText: '原流程需要分别查看各类业务数据，难以综合观察', riskFlags: [] }
  f.input.resume.evidenceAtoms.push(context, { ...context, evidenceId: 'foreign', sourceScopeId: 'another-project' },
    { ...context, evidenceId: 'unsafe', riskFlags: ['prompt_injection_like_text'] })
  const updated = buildEntryWritingPlan({ ...f.input, base: f.base })
  const facts = updated.entries.flatMap(e => e.facts)
  expect(facts.some(f => f.evidenceId === 'context')).toBe(true)
  expect(facts.some(f => f.evidenceId === 'foreign' || f.evidenceId === 'unsafe')).toBe(false)
  expect(updated.entries.flatMap(e => e.coreEvidenceIds)).not.toContain('context')
})

test('entry writer CLI requires targeted mode and stays dry-run by default', () => {
  expect(() => parseEvaluationRunnerArgs(['--entry-writer'], { backendRoot: process.cwd() })).toThrow()
  const args = parseEvaluationRunnerArgs(['--artifact-mode', 'writer_v1', '--job-targeted', '--entry-writer'], { backendRoot: process.cwd() })
  expect(args.entryWritingPolicy).toBe(ENTRY_WRITING_POLICY)
  expect(args.live).toBe(false)
})

// 通过真实编译器验证纠正，未涉及条目不得被模型顺带改写。
test.each(['corrected', 'still_invalid', 'extra_entry'] as const)('bounded fact correction: %s', async variant => {
  const f = fixture(true)
  const target = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const original = structuredClone(f.output)
  let calls = 0
  const promise = writeValidatedEntries({ plan: f.entryPlan,
    write: async (payload, attempt) => {
      calls++
      if (attempt) {
        expect(payload.requiredEntryIds).toEqual([target.entryId])
        expect(payload.entries.map(entry => entry.entryId)).toEqual([target.entryId])
        expect(payload.correction?.issues.some(issue => issue.code === 'WRITER_NUMBER_CHANGED')).toBe(true)
      }
      const output = structuredClone(f.output)
      if (attempt === 0 || variant === 'still_invalid') {
        output.entries.find(entry => entry.entryId === target.entryId)!.paragraphs[0].text += '新增999个用户。'
      }
      if (attempt && variant !== 'extra_entry') output.entries = output.entries.filter(entry => entry.entryId === target.entryId)
      return output
    },
    validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy}),
  })
  if (variant === 'corrected') {
    const result = await promise
    expect(result.repairAttempts).toBe(1)
    expect(result.result.artifact.markdown).not.toContain('999')
    const originalResult = compileEntryWriting({output: original, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy})
    expect(result.result.artifact.markdown).toBe(originalResult.artifact.markdown)
  } else await expect(promise).rejects.toThrow()
  expect(calls).toBe(variant === 'still_invalid' ? 3 : 2)
  expect(f.output).toEqual(original)
})
