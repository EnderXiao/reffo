import { v4FixtureEntry, v5FixtureEntry } from './entry-skeleton-fixtures'
import { writeValidatedEntries } from '@/v5/writing/entry-correction'
import { test, expect, spyOn } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { assertEntryDeliveryProjection, buildEntryWritingPlan, compileEntryWriting, entryWritingPayload, ENTRY_WRITING_POLICY, isEntryWritingEnvelope, entryWritingOutputSchema, entryWritingV4OutputSchema, entryWritingV6OutputSchema, normalizeEntryWritingOutput, removeUnsupportedCollaboratorMentions, removeRepeatedResearchDeliverable, hasRepeatedSkillCase } from '@/v5/writing/entries'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { parseEvaluationRunnerArgs } from '@/v5/evaluation-runner-support'
import { workScopeBrief } from '@/v5/writing/work-coverage'
import type { EvidenceAtom } from '@/v5/types'
import { canCompactEntryParagraphs, entryLayoutItemLimit } from '@/v5/writing/entry-layout'
import { EntrySetValidationError, inspectEntrySet } from '@/v5/writing/entry-set'
import { explicitEducationDegree } from '@/v5/writing/education'
import {SupportedWritingError} from '@/v5/writing/compiler'
import {writingIssue} from '@/v5/writing/facts'
import {safeRecoveredEntry} from '@/v5/writing/detail-ledger'
import {hasRepeatedSkillDimensions} from '@/v5/writing/skills'

function fixture(withSummary = false) {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  if (withSummary) r.generationPolicy.summaryPolicy = 'one_sentence'
  const input = { resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    job: r.jobRequirementBundle, match: r.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit },
    editorialPolicy: 'document-editorial-v1' as const }
  const base = buildWritingPlan(input)
  const entryPlan = buildEntryWritingPlan({ ...input, base })
  const output: ReturnType<typeof entryWritingOutputSchema.parse> = { contractVersion: 'entry-writing-v1', entries: entryPlan.entries.map(entry => {
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

test('invalid action receipt transport is quarantined whole without relaxing body strictness', () => {
  const f = fixture(true)
  const valid = {actionId: 'action', unitIds: ['unit'], evidenceIds: [], detailIds: [], coveredAspectIds: [], explanation: '待实际核对'}
  const value = {...f.output, entries: f.output.entries.map(entry => ({...entry, actionReceipts: [
    valid, {...valid, actionId: 'invalid-note', evidenceIdsNote: '私人说明'}, {...valid, actionId: 12},
  ]}))}
  const before = structuredClone(value), normalized = normalizeEntryWritingOutput(value)
  expect(normalized.rejectedReceiptCount).toBe(f.output.entries.length * 2)
  expect(value).toEqual(before)
  expect(entryWritingOutputSchema.safeParse(normalized.value).success).toBe(true)
  for (const entry of (normalized.value as typeof value).entries) expect(entry.actionReceipts).toEqual([valid])
  for (const extra of [{extraBody: '不可删除'}, {paragraphs: [{...f.output.entries[0].paragraphs[0], extra: '正文'}]}]) {
    const invalid = {...value, entries: value.entries.map(entry => ({...entry, ...extra}))}
    expect(entryWritingOutputSchema.safeParse(normalizeEntryWritingOutput(invalid).value).success).toBe(false)
  }
  const unknown = {contractVersion: 'unrecognized', entries: value.entries}
  expect(normalizeEntryWritingOutput(unknown)).toEqual({value: unknown, removedNotes: 0, rejectedReceiptCount: 0})
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

test('versioned entry prompt uses strict segments and budgets metadata without increasing fact length', () => {
  const f = fixture()
  const old = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(f.base) } })
  const next = compileV5Prompt({ component: 'P06C', envelope: { payload: entryWritingPayload(f.entryPlan) } })
  expect(old.manifest.promptFilePath).toBe('prompts/P06C-structural.md')
  expect(old.promptVersion).toBe('5.1.0-p06c-supported-writer-r19')
  expect(next.manifest.promptFilePath).toBe('prompts/P06C-entry.md')
  expect(next.schema).toBe(entryWritingV6OutputSchema)
  expect(next.promptVersion).toBe('5.7.0-p06c-entry-routed-v6-r6')
  expect(next.maxOutputTokens).toBe(7200)
  expect(entryWritingPayload(f.entryPlan).outputLength).toEqual(writingPayload(f.base).outputLength)
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
  const wire = {...f.output, contractVersion: ENTRY_WRITING_POLICY, entries: f.output.entries.map(entry => v5FixtureEntry(entry, payload.entries.find(brief => brief.entryId === entry.entryId)!))}
  expect(prompt.providerSchema.safeParse(wire).success).toBe(true)
  expect(prompt.providerSchema.safeParse(f.output).success).toBe(false)
  for (const entries of [wire.entries.slice(1), [...wire.entries, wire.entries[0]],
    wire.entries.map((entry, index) => index ? entry : { ...entry, entryId: 'entry:999' })]) {
    expect(prompt.providerSchema.safeParse({ ...wire, entries }).success).toBe(false)
    expect(prompt.schema.safeParse({ ...wire, entries }).success).toBe(true)
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

test('skills remove only an exactly repeated independent clause and retain the distinct remainder', () => {
  const f = fixture(true)
  const template = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const first = {...structuredClone(template), entryId: 'entry:first-skill', section: 'skills' as const, scopeId: null,
    slot: {...template.slot, slotId: 'skills:first', kind: 'skill' as const, sectionKey: 'skills' as const, scopeId: null, outputPath: 'skills[8]'}}
  f.entryPlan.entries.push(first)
  f.entryPlan.base.skillPolicy = 'practice-skills-v1'
  if (!f.entryPlan.base.blueprint.sectionOrder.includes('skills')) f.entryPlan.base.blueprint.sectionOrder.push('skills')
  const second = {...structuredClone(first), entryId: 'entry:second-skill',
    slot: {...first.slot, slotId: 'skills:second', outputPath: 'skills[9]'}}
  f.entryPlan.entries.push(second)
  const evidenceIds = [template.facts[0].evidenceId]
  f.output.entries.push({entryId: first.entryId, paragraphs: [{role: 'detail', text: '团队产品研究：用户访谈、需求分析。', evidenceIds}]})
  f.output.entries.push({entryId: second.entryId, paragraphs: [{role: 'detail',
    text: '团队产品研究：用户访谈、需求分析；参与团队产品交付。', evidenceIds}]})
  const compiled = compileEntryWriting({output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy})
  expect(compiled.artifact.markdown.match(/团队产品研究：用户访谈、需求分析/gu)).toHaveLength(1)
  expect(compiled.artifact.markdown).toContain('参与团队产品交付。')
  expect(compiled.writingIssues.some(issue => issue.code === 'WRITER_DUPLICATE_SKILL_CLAUSE_REMOVED')).toBe(true)
  expect(f.output.entries.at(-1)?.paragraphs[0].text).toContain('团队产品研究：用户访谈、需求分析；')
})

test('skill clauses already rendered by a fixed source slot are also deduplicated before rendering', () => {
  const f = fixture(true)
  const template = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const evidenceIds = [template.facts[0].evidenceId]
  const slot = {...template.slot, slotId: 'skills:source-fixed', kind: 'skill' as const, sectionKey: 'skills' as const, scopeId: null, outputPath: 'skills[8]'}
  f.entryPlan.base.blueprint.slots.push(slot)
  f.entryPlan.base.fixedBlocks = [...f.entryPlan.base.fixedBlocks ?? [], {slotId: slot.slotId, text: '团队产品研究：用户访谈、需求分析。', evidenceIds}]
  f.entryPlan.base.skillPolicy = 'practice-skills-v1'
  const entry = {...structuredClone(template), entryId: 'entry:extra-skill', section: 'skills' as const, scopeId: null,
    slot: {...slot, slotId: 'skills:extra', outputPath: 'skills[9]'}}
  f.entryPlan.entries.push(entry)
  f.output.entries.push({entryId: entry.entryId, paragraphs: [{role: 'detail', text: '团队产品研究：用户访谈、需求分析；参与团队产品交付。', evidenceIds}]})
  const compiled = compileEntryWriting({output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy})
  expect(compiled.artifact.markdown.match(/团队产品研究：用户访谈、需求分析/gu)).toHaveLength(1)
  expect(compiled.artifact.markdown).toContain('参与团队产品交付。')
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

test.each([
  ['市场', '市场团队'],
  ['研发', '开发团队'],
])('deterministically removes invented %s collaborator and records the normalization', (_normalizedTeam, writtenTeam) => {
  const f = fixture()
  const brief = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const paragraph = f.output.entries.find(entry => entry.entryId === brief.entryId)!.paragraphs[0]
  paragraph.text = `协同${writtenTeam}${paragraph.text}`
  const providerOutput = structuredClone(f.output)

  const compiled = compileEntryWriting({
    output: f.output,
    entryPlan: f.entryPlan,
    resume: f.input.resume,
    policy: f.input.policy,
  })
  const checked = validateGeneratedResumeArtifact({
    artifact: compiled.artifact,
    resume: f.input.resume,
    plan: compiled.renderingPlan,
    policy: f.input.policy,
    gateMode: 'relaxed_release',
    textPolicy: 'supported_writing_v1',
    skillPolicy: f.base.skillPolicy,
    entryParagraphPaths: compiled.entryParagraphPaths,
  })

  expect(compiled.artifact.markdown).not.toContain(writtenTeam)
  expect(compiled.writingIssues).toContainEqual(expect.objectContaining({
    code: 'WRITER_COLLABORATOR_REMOVED',
    severity: 'warning',
  }))
  expect(checked.issues.filter(issue => issue.severity === 'error')).toEqual([])
  expect(f.output).toEqual(providerOutput)
})

test('collaborator-list correction preserves the verb and only source-supported actors', () => {
  const template = fixture().input.resume.evidenceAtoms[0]
  const atoms = [{...template, verbatimText: '参与产品迭代，协同研发推动上线与问题修复。'}]
  const value = '以用户研究支撑产品判断，并协同设计、研发、测试与运营推动上线与问题修复。'
  expect(removeUnsupportedCollaboratorMentions(value, atoms)).toBe('以用户研究支撑产品判断，并协同研发推动上线与问题修复。')
  expect(removeUnsupportedCollaboratorMentions('与市场、研发与用户共同推进迭代。', atoms)).toBe('与研发与用户共同推进迭代。')
  expect(removeUnsupportedCollaboratorMentions('协同市场团队参与产品迭代。', atoms)).toBe('通过团队协作参与产品迭代。')
  const supported = '协同设计、研发、测试与运营推动上线与问题修复。'
  expect(removeUnsupportedCollaboratorMentions(supported, [{...template, verbatimText: supported}])).toBe(supported)
  expect(removeUnsupportedCollaboratorMentions('分析市场数据，提升销售收入。', atoms)).toBe('分析市场数据，提升销售收入。')
})

test('only an identical same-source research deliverable moves from method to outcome, retaining gaps and numbers', () => {
  const template = fixture().input.resume.evidenceAtoms[0]
  const repeated = '形成使用研究、埋点分析及重优化方向材料'
  const atom: EvidenceAtom = {...template, evidenceId: 'research', status: 'source_supported', riskFlags: [],
    verbatimText: `主导问卷与访谈，回收367份，${repeated}。`}
  const method = `主导问卷与访谈，回收367份，${repeated}`
  const outcome = `上述研究${repeated}，作为后续规划依据；新能力上线材料未记录。`
  const paragraphs = [{text: method + '。', evidenceIds: ['research'], segments: [
    {kind: 'fact' as const, text: method, evidenceIds: ['research']},
    {kind: 'optional_gap_clause' as const, detailId: 'finding', template: 'research_finding' as const, metric: null, candidates: []},
    {kind: 'fact' as const, text: '。', evidenceIds: ['research']},
  ]}, {text: outcome, evidenceIds: ['research']}]
  const before = structuredClone(paragraphs)
  const result = removeRepeatedResearchDeliverable(paragraphs, [atom])
  expect(result.removed).toBe(1)
  expect(result.paragraphs[0].text).toBe('主导问卷与访谈，回收367份。')
  expect(result.paragraphs[0].segments?.[1]).toEqual(paragraphs[0].segments?.[1])
  expect(result.paragraphs[1]).toEqual(paragraphs[1])
  expect(paragraphs).toEqual(before)
  expect(removeRepeatedResearchDeliverable(paragraphs, [{...atom, evidenceId: 'different'}]).removed).toBe(0)
  expect(removeRepeatedResearchDeliverable(paragraphs, [{...atom, riskFlags: ['uncertain']}]).removed).toBe(0)
  expect(removeRepeatedResearchDeliverable(paragraphs, [{...atom, verbatimText: '研究后形成其他资料。'}]).removed).toBe(0)
  const protectedValue = '形成13项研究发现与重优化方向材料'
  expect(removeRepeatedResearchDeliverable([{text: `主导问卷与访谈，${protectedValue}`, evidenceIds: ['research']},
    {text: `上述研究${protectedValue}，尚未上线。`, evidenceIds: ['research']}], [{...atom, verbatimText: protectedValue}]).removed).toBe(0)
})

test('a skills case near-copy is scoped for rewriting; short ability dimensions and a different source remain valid', () => {
  const business = [{text: '连续6个月输出消毒柜竞品分析，并参与气泡水机用户访谈、母婴小家电与全屋家电套系化策略；组织双周设计共创，协调工业设计、UI、CMF与工程团队评估方案可行性。', evidenceIds: ['case']}]
  const repeated = {text: '连续6个月输出消毒柜竞品分析，参与用户访谈与设计共创，协调工业设计、UI、CMF与工程团队评估方案可行性。', evidenceIds: ['case']}
  expect(hasRepeatedSkillCase(repeated, business)).toBe(true)
  expect(hasRepeatedSkillCase({...repeated, evidenceIds: ['another']}, business)).toBe(false)
  expect(hasRepeatedSkillCase({...repeated, evidenceIds: ['assembly']}, business, {assembly: ['case']})).toBe(true)
  expect(hasRepeatedSkillCase({text: '竞品分析与用户访谈：为产品方案提供研究输入。', evidenceIds: ['case']}, business)).toBe(false)
  expect(hasRepeatedSkillCase({text: '熟悉原型设计、需求分析、用户研究与服务设计，能够组织有依据的产品方案。', evidenceIds: ['case']}, business)).toBe(false)
})

test('a reworded complete fixed skill list is rewritten while an incremental dimension remains valid', () => {
  const rendered = ['产品与研究：用户研究、服务设计、业务规则建模、需求分析、原型与PRD；交付与验证：数据埋点、敏捷迭代、灰度与A/B测试、跨团队协作。']
  expect(hasRepeatedSkillDimensions('产品与研究能力覆盖用户研究、服务设计、业务规则建模、需求分析与原型及PRD撰写，可支撑从需求理解到方案成文的产出；竞品分析用于方案判断。', rendered)).toBe(true)
  expect(hasRepeatedSkillDimensions('交付验证能力覆盖数据埋点、敏捷迭代、灰度测试、A/B测试与跨部门协作。', rendered)).toBe(true)
  expect(hasRepeatedSkillDimensions('竞品分析：整理竞品对比材料，为方案判断提供输入。', rendered)).toBe(false)
  expect(hasRepeatedSkillDimensions('日志分析与问题复现：配合监控跟进稳定性问题及修复发版。', rendered)).toBe(false)
  expect(hasRepeatedSkillDimensions('需求分析：整理反馈中的未满足需求。', rendered)).toBe(false)
  expect(hasRepeatedSkillDimensions('完整产品研究能力。', rendered)).toBe(false)
})

test('entry payload exposes only fixed skills as prior content during scoped rewriting', () => {
  const f = fixture(), skill = {...f.entryPlan.base.blueprint.slots[0], kind: 'skill' as const, sectionKey: 'skills' as const, slotId: 'fixed-skill'}
  f.entryPlan.base.blueprint.slots.push(skill)
  f.entryPlan.base.fixedBlocks = [{slotId: skill.slotId, evidenceIds: ['source-skill'], text: '用户研究、需求分析、原型与PRD。'},
    {slotId: 'work-scope', evidenceIds: ['work'], text: '在甲公司参与工作。'}]
  expect(entryWritingPayload(f.entryPlan).sourceRenderedSkills).toEqual([f.entryPlan.base.fixedBlocks[0]])
})

test('exhausted skill-case corrections recover an original skill fact instead of the copied event', () => {
  const f = fixture(), entry = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const skill = {...entry.facts[0], evidenceId: 'declared-skill', claimType: 'skill' as const, text: '用户研究、需求分析、原型与PRD。'}
  const brief = {...entry, section: 'skills' as const, slot: {...entry.slot, kind: 'skill' as const, sectionKey: 'skills' as const}, facts: [...entry.facts, skill]}
  const recovered = safeRecoveredEntry(brief, {written: f.output.entries.find(item => item.entryId === entry.entryId)!,
    issues: [writingIssue('WRITER_SKILL_CASE_REPEATED', brief.slot.outputPath, [], '重复案例')]})
  expect(recovered.paragraphs.map(paragraph => paragraph.text)).toEqual([skill.text])
  expect(recovered.paragraphs[0].evidenceIds).toEqual([skill.evidenceId])
  expect(recovered.paragraphs[0].text).not.toContain(entry.facts[0].text)
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
test.each([[false, true], [false, false], [true, true], [true, false]])(
  'boundary correction identifies the original paragraph, compacted=%s corrected=%s', async (compacted, corrected) => {
  const f = fixture(true)
  const target = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const entry = f.output.entries.find(item => item.entryId === target.entryId)!
  const evidenceIds = entry.paragraphs[0].evidenceIds
  entry.paragraphs = [
    {role: 'detail', text: '参与团队产品迭代。', evidenceIds},
    ...(compacted ? [{role: 'detail' as const, text: '参与团队产品整理。', evidenceIds}] : []),
    {role: 'outcome', text: '交付3个功能。', evidenceIds},
  ]
  const originalIndex = compacted ? 2 : 1
  if (compacted) f.entryPlan.listItemHardLimit = f.entryPlan.entries.filter(item => item.slot.kind !== 'summary').length + 1
  let calls = 0
  const promise = writeValidatedEntries({ plan: f.entryPlan,
    write: async (payload, attempt) => {
      calls++
      if (attempt) expect(payload.correction?.issues).toEqual([expect.objectContaining({
        entryId: target.entryId, code: 'WRITER_BOUNDARY_LOST', paragraphIndex: originalIndex,
        paragraphIndices: [originalIndex],
        outputPath: `${target.section}.${target.scopeId}.bullets[1]`,
      })])
      const output = structuredClone(f.output)
      if (attempt) {
        output.entries = output.entries.filter(item => item.entryId === target.entryId)
        output.entries[0].paragraphs[corrected ? originalIndex : 0].text = '参与团队交付3个功能。'
      }
      return output
    },
    validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy}),
  })
  if (corrected) expect((await promise).repairAttempts).toBe(1)
  else await expect(promise).rejects.toThrow()
  expect(calls).toBe(corrected ? 2 : 3)
})

test.each(['number', 'incomplete_metric'] as const)('correction retains every source paragraph after repeated compaction: %s', async variant => {
  const f = fixture(true)
  const target = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const entry = f.output.entries.find(item => item.entryId === target.entryId)!
  const evidenceIds = entry.paragraphs[0].evidenceIds
  entry.paragraphs = [
    {role: 'detail', text: '参与团队产品迭代。', evidenceIds},
    {role: 'detail', text: '支持团队完成需求梳理。', evidenceIds},
    {role: 'detail', text: variant === 'number' ? '团队交付999个功能。' : '团队交付3个功能，覆盖率提升至', evidenceIds},
  ]
  f.entryPlan.listItemHardLimit = f.entryPlan.entries.filter(item => item.slot.kind !== 'summary').length
  let calls = 0
  const result = await writeValidatedEntries({ plan: f.entryPlan,
    write: async (payload, attempt) => {
      calls++
      if (attempt) {
        expect(payload.correction?.issues).toEqual([expect.objectContaining({
          entryId: target.entryId,
          code: variant === 'number' ? 'WRITER_NUMBER_CHANGED' : 'WRITER_INCOMPLETE_METRIC',
          outputPath: variant === 'number' ? `${target.section}.${target.scopeId}.bullets[0]` : `${target.entryId}:p0`,
          paragraphIndex: null, paragraphIndices: [0, 1, 2],
        })])
        expect(payload.correction?.rejectedEntries[0].paragraphs).toEqual(entry.paragraphs)
      }
      const output = structuredClone(f.output)
      if (attempt) {
        output.entries = output.entries.filter(item => item.entryId === target.entryId)
        output.entries[0].paragraphs[2].text = '团队交付3个功能。'
      }
      return output
    },
    validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy}),
  })
  expect(calls).toBe(2)
  expect(result.repairAttempts).toBe(1)
  expect(result.result.artifact.markdown).toContain('参与团队产品迭代。 支持团队完成需求梳理。 团队交付3个功能。')
})

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

test('local recovery handles errors exposed by an earlier recovered entry while retaining valid entries', async () => {
  const f = fixture(true), [first, second] = f.entryPlan.entries
  expect(second).toBeDefined()
  let calls = 0
  const recovered: string[] = []
  const result = await writeValidatedEntries({plan: f.entryPlan,
    write: async payload => {calls++; return {...f.output, entries: f.output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}},
    recoverEntry: entry => {
      recovered.push(entry.entryId)
      return {...f.output.entries.find(item => item.entryId === entry.entryId)!, paragraphs: [{role: 'detail', text: '安全来源内容', evidenceIds: [entry.facts[0].evidenceId]}]}
    },
    validate: output => {
      const parsed = entryWritingOutputSchema.parse(output)
      for (const entry of [first, second]) if (parsed.entries.find(item => item.entryId === entry.entryId)?.paragraphs[0].text !== '安全来源内容') {
        throw new SupportedWritingError([writingIssue('WRITER_BOUNDARY_LOST', entry.slot.outputPath, [], '来源边界未保留')])
      }
      return parsed
    },
  })
  expect(calls).toBe(3)
  expect(recovered).toEqual([first.entryId, second.entryId])
  expect(result.recoveredEntryIds).toEqual(recovered)
  expect(result.result.entries.filter(entry => !recovered.includes(entry.entryId)))
    .toEqual(f.output.entries.filter(entry => !recovered.includes(entry.entryId)))
})

test.each(['corrected', 'still_invalid', 'unknown', 'foreign_context', 'mixed', 'spoofed_fact'] as const)(
  'only own context-only body citations receive bounded correction: %s', async variant => {
    const f = fixture(true)
    const target = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
    const originalPlan = structuredClone(f.entryPlan)
    const contextId = 'private-context-reference'
    target.gapContextFacts.push({evidenceId: contextId,
      scopeId: variant === 'foreign_context' ? 'another-scope' : target.scopeId!,
      text: '仅供查缺使用的内部材料。'})
    const originalOutput = structuredClone(f.output)
    const originalFacts = structuredClone(target.facts)
    let calls = 0
    const log = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const promise = writeValidatedEntries({plan: f.entryPlan,
        write: async (payload, attempt) => {
          calls++
          const output = structuredClone(f.output)
          if (attempt) {
            expect(payload.requiredEntryIds).toEqual([target.entryId])
            expect(payload.entries[0].facts).toEqual(originalFacts)
            if (attempt === 1) expect(payload.correction?.issues).toEqual([expect.objectContaining({
              entryId: target.entryId, code: 'WRITER_EVIDENCE_INVALID',
              paragraphIndex: 0, paragraphIndices: [0],
              bodyEvidencePolicy: {
                allowedEvidenceIds: originalFacts.map(fact => fact.evidenceId),
                contextOnlyEvidenceIds: expect.arrayContaining([contextId]),
              },
            })])
            output.entries = output.entries.filter(entry => entry.entryId === target.entryId)
          }
          const paragraph = output.entries.find(entry => entry.entryId === target.entryId)!.paragraphs[0]
          if (attempt === 0 || variant === 'still_invalid') {
            paragraph.evidenceIds = variant === 'unknown' ? ['private-unknown-reference']
              : variant === 'mixed' ? [contextId, 'private-unknown-reference'] : [contextId]
          } else if (variant === 'spoofed_fact') paragraph.text += '新增999个用户。'
          return {contractVersion: ENTRY_WRITING_POLICY, entries: output.entries.map(entry => v5FixtureEntry(entry,
            entryWritingPayload(f.entryPlan).entries.find(brief => brief.entryId === entry.entryId)!))}
        },
        validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy}),
      })
      if (variant === 'corrected') {
        const result = await promise
        const baseline = compileEntryWriting({output: originalOutput, entryPlan: originalPlan, resume: f.input.resume, policy: f.input.policy})
        expect(result.repairAttempts).toBe(1)
        expect(result.result.artifact.markdown).toBe(baseline.artifact.markdown)
      } else await expect(promise).rejects.toThrow()
      expect(calls).toBe(variant === 'corrected' ? 2 : ['still_invalid', 'spoofed_fact'].includes(variant) ? 3 : 1)
      const diagnostics = JSON.parse(log.mock.calls[0][1] as string)
      expect(diagnostics.issues[0]).toMatchObject({code: 'WRITER_EVIDENCE_INVALID', entryId: target.entryId,
        contextOnlyReferenceCount: ['unknown', 'foreign_context'].includes(variant) ? 0 : 1,
        unknownReferenceCount: ['unknown', 'foreign_context', 'mixed'].includes(variant) ? 1 : 0,
        correctionEligible: ['corrected', 'still_invalid', 'spoofed_fact'].includes(variant)})
      const serializedLogs = JSON.stringify(log.mock.calls)
      expect(serializedLogs).not.toContain(contextId)
      expect(serializedLogs).not.toContain('private-unknown-reference')
      expect(serializedLogs).not.toContain(originalOutput.entries[0].paragraphs[0].text)
      expect(f.output).toEqual(originalOutput)
      expect(target.facts).toEqual(originalFacts)
    } finally { log.mockRestore() }
  },
)

test('duplicate legacy body references do not become context-only correction', async () => {
  const f = fixture()
  const target = f.entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  target.gapContextFacts.push({evidenceId: 'context-only', scopeId: target.scopeId!, text: '只读查缺。'})
  const paragraph = f.output.entries.find(entry => entry.entryId === target.entryId)!.paragraphs[0]
  paragraph.evidenceIds = [paragraph.evidenceIds[0], paragraph.evidenceIds[0], 'context-only']
  let calls = 0
  await expect(writeValidatedEntries({plan: f.entryPlan,
    write: async () => { calls++; return f.output },
    validate: output => compileEntryWriting({output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy}),
  })).rejects.toThrow()
  expect(calls).toBe(1)
})

test.each(['known', 'unknown'] as const)('summary reference outside its pool is bounded only when globally admitted: %s', async variant => {
  const f=fixture(true), summary=f.entryPlan.entries.find(entry=>entry.section==='summary')!
  const admitted=f.entryPlan.entries.find(entry=>entry.slot.kind==='business_bullet')!.facts[0]
  summary.facts=summary.facts.filter(fact=>fact.evidenceId!==admitted.evidenceId)
  if(!summary.facts.length)summary.facts=[{...admitted,evidenceId:'summary-allowed'}]
  const badId=variant==='known'?admitted.evidenceId:'truly-unknown'
  let calls=0
  const result=writeValidatedEntries({plan:f.entryPlan,write:async(payload,attempt)=>{
    calls++
    const output=structuredClone(f.output)
    if(attempt){
      expect(payload.requiredEntryIds).toEqual([summary.entryId])
      expect(payload.entries[0].facts).toEqual(summary.facts)
      return {...output,entries:output.entries.filter(entry=>entry.entryId===summary.entryId)}
    }
    return output
  },validate:output=>{
    if(calls===1)throw new SupportedWritingError([writingIssue('WRITER_EVIDENCE_INVALID',`${summary.entryId}:p0`,[badId],'outside pool')])
    return output
  }})
  if(variant==='known')expect((await result).repairAttempts).toBe(1)
  else await expect(result).rejects.toThrow()
  expect(calls).toBe(variant==='known'?2:1)
})


test('delivery publication accepts metadata normalization but blocks a normalized fact-text change', () => {
  const f = fixture()
  const compiled = compileEntryWriting({ output: f.output, entryPlan: f.entryPlan, resume: f.input.resume, policy: f.input.policy })
  const metadataNormalized = { ...compiled.artifact, claims: compiled.artifact.claims.map(claim => ({ ...claim })) }
  expect(() => assertEntryDeliveryProjection(compiled.artifact, metadataNormalized)).not.toThrow()
  expect(() => assertEntryDeliveryProjection(compiled.artifact, undefined)).not.toThrow()
  const changed = { ...metadataNormalized, markdown: `${metadataNormalized.markdown}\n## 教育经历` }
  try {
    assertEntryDeliveryProjection(compiled.artifact, changed)
    throw new Error('changed fact text must block delivery')
  } catch (error) {
    expect(error).toMatchObject({ issues: [{ code: 'WRITER_PROJECTION_MISMATCH', outputPath: 'artifact.markdown' }] })
  }
})
