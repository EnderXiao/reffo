import { expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { applyDocumentEditorialPlan, STRUCTURAL_WRITING_POLICY } from '@/v5/writing/structure'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { buildV5SystemPrompt } from '@/v5/prompts'
import { V5ResumeOptimizationWorkflow } from '@/v5/main/workflow'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'

test('preserves named source tools in an existing skill slot without requesting or trusting model rewrites', () => {
  const f = fixture(), before = structuredClone(f.input)
  const plan = buildWritingPlan({ ...f.input, editorialPolicy: STRUCTURAL_WRITING_POLICY })
  expect(plan.fixedBlocks?.[0].text).toBe('技能：SQL')
  const payload = writingPayload(plan)
  expect(payload.blueprint.slots.some(s=>s.slotId === plan.fixedBlocks![0].slotId)).toBe(false)
  expect(payload.sourceRenderedSkills).toEqual(plan.fixedBlocks)
  const blocks = payload.blueprint.slots.map(slot=>({ slotId:slot.slotId,
    evidenceIds:slot.coreEvidenceIds?.length ? slot.coreEvidenceIds : [slot.allowedEvidenceIds[0]],
    text:slot.kind === 'summary' ? '参与团队产品交付。' : plan.facts.find(f=>f.evidenceId === slot.coreEvidenceIds?.[0])!.text }))
  const input = { ...f.input, writingPlan:plan, composition:{contractVersion:'p06-composition-v1',blocks} }
  const result = compileWritingArtifact(input)
  expect(result.artifact.markdown).toContain('技能：SQL')
  expect(result.artifact.markdown).not.toContain('精通SQL')
  expect(()=>compileWritingArtifact({ ...input, composition:{ ...input.composition,
    blocks:[...blocks,{ ...plan.fixedBlocks![0],text:'精通SQL' }] } })).toThrow(SupportedWritingError)
  expect(f.input).toEqual(before)
})

test('does not acquire a JD tool absent from selected source facts', () => {
  const f = fixture()
  f.input.job.requirementAtoms.forEach(a=>{a.verbatimText='要求使用Kubernetes'})
  expect(buildWritingPlan({ ...f.input, editorialPolicy:STRUCTURAL_WRITING_POLICY }).fixedBlocks).toBeUndefined()
})

test('targeted matching loads a single contract and retains the default legacy prompt separately', () => {
  const targeted = compileV5Prompt({ component:'P03',envelope:{payload:{jobTargetingPolicy:'job-targeted-v1'}} })
  expect(targeted.promptVersion).toBe('5.1.0-p03-job-fit-map-r6')
  expect(targeted.manifest.promptFilePath).toBe('prompts/P03-targeted.md')
  expect(targeted.messages[0].content).not.toContain('下方为兼容规则')
  expect(targeted.messages[0].content).not.toContain('每个适用 RequirementAtom 必须且只能进入')
  expect(compileV5Prompt({component:'P03',envelope:{payload:{source:{jobTargetingPolicy:'job-targeted-v1'}}}}).promptVersion)
    .toBe('5.1.0-p03-job-fit-map-r5')
  const repair = compileV5Prompt({component:'P03R',envelope:{payload:{originalEnvelope:{payload:{jobTargetingPolicy:'job-targeted-v1'}}}}})
  expect(repair.promptVersion).toBe('5.1.0-p03r-job-fit-map-repair-r5')
  expect(repair.maxOutputTokens).toBe(targeted.maxOutputTokens)
})

function fixture() {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  const input = { resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    job: r.jobRequirementBundle, match: r.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit } }
  const plan = buildWritingPlan(input)
  const slot = plan.blueprint.slots.find(slot => slot.kind === 'business_bullet')!
  const duty = plan.facts.find(fact => fact.evidenceId === plan.coreEvidenceIdsBySlot[slot.slotId][0])!
  duty.claimType = 'responsibility'; duty.text = '负责日常业务数据整理与反馈跟进。'; duty.requiredNumbers = []
  const practice = { ...duty, evidenceId: 'practice', claimType: 'action' as const,
    text: '核对客户反馈记录，归纳问题并形成反馈清单。', boundaries: ['团队或参与贡献'] }
  plan.facts.push(practice); slot.allowedEvidenceIds.push(practice.evidenceId)
  plan.editorial!.slots[slot.slotId].priorityEvidenceIds = [practice.evidenceId]
  plan.expandedEvidenceIds[practice.evidenceId] = [practice.evidenceId]
  if (!plan.blueprint.slots.some(slot => slot.kind === 'summary')) {
    plan.blueprint.slots.unshift({ slotId: 'summary:0', kind: 'summary', sectionKey: 'summary', scopeId: null,
      outputPath: 'summary[0]', order: -1, required: true, allowedEvidenceIds: [practice.evidenceId] })
    plan.coreEvidenceIdsBySlot['summary:0'] = []
  }
  return { input, plan, slot, duty, practice }
}

test('structural editing promotes the existing action, keeps duty context, and preserves source and slot counts', () => {
  const f = fixture(), before = structuredClone(f.plan)
  const result = applyDocumentEditorialPlan(f.plan)
  expect(result.coreEvidenceIdsBySlot[f.slot.slotId]).toEqual([f.practice.evidenceId])
  expect(result.blueprint.slots.find(slot => slot.slotId === f.slot.slotId)?.allowedEvidenceIds).toContain(f.duty.evidenceId)
  expect(result.documentEditorial?.representativeSlotIds).toEqual([f.slot.slotId])
  expect(result.editorial?.slots[f.slot.slotId].role).toBe('contribution')
  expect(result.facts).toEqual(f.plan.facts)
  expect(result.facts.find(f => f.evidenceId === 'practice')?.boundaries).toEqual(['团队或参与贡献'])
  expect(result.blueprint.slots.map(s => s.slotId)).toEqual(f.plan.blueprint.slots.map(s => s.slotId))
  expect(result.outputLength).toEqual(f.plan.outputLength)
  expect(f.plan).toEqual(before)
  expect(applyDocumentEditorialPlan(result)).toEqual(result)
})

test.each(['context', 'other_scope', 'not_allowed'] as const)('never promotes a supporting %s fact as the contribution', mutation => {
  const f = fixture()
  if (mutation === 'context') Object.assign(f.practice, { contextForEvidenceId: f.duty.evidenceId })
  if (mutation === 'other_scope') f.practice.scopeId = 'other'
  if (mutation === 'not_allowed') f.slot.allowedEvidenceIds = [f.duty.evidenceId]
  expect(applyDocumentEditorialPlan(f.plan).coreEvidenceIdsBySlot[f.slot.slotId]).toEqual([f.duty.evidenceId])
})

test('summary gains only one source-backed background, without reopening an unrestricted fact pool', () => {
  const f = fixture(), result = applyDocumentEditorialPlan(f.plan)
  const slot = result.blueprint.slots.find(s => s.kind === 'summary')!
  expect(slot.allowedEvidenceIds).toContain(f.duty.evidenceId)
  expect(slot.allowedEvidenceIds.length).toBeLessThanOrEqual(3)
  expect(result.documentEditorial?.backgroundEvidenceId).toBe(f.duty.evidenceId)
  expect(result.documentEditorial?.arguments.length).toBeLessThanOrEqual(2)
  expect(result.coreEvidenceIdsBySlot[slot.slotId]).toEqual([])
  expect(writingPayload(result)).not.toHaveProperty('facts')
})

test('a sparse action-only source does not acquire a fabricated professional background', () => {
  const f = fixture()
  f.duty.claimType = 'action'
  expect(applyDocumentEditorialPlan(f.plan).documentEditorial).not.toHaveProperty('backgroundEvidenceId')
})

test('the structural variant is opt-in; old Writer prompt, payload and output budget remain available', () => {
  const f = fixture(), original = buildWritingPlan(f.input)
  const candidate = buildWritingPlan({ ...f.input, editorialPolicy: STRUCTURAL_WRITING_POLICY })
  const baseline = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(original) } })
  const compiled = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(candidate) } })
  expect(original.documentEditorial).toBeUndefined()
  expect(baseline.promptVersion).toBe('5.1.0-p06c-supported-writer-r16')
  expect(compiled.promptVersion).toBe('5.1.0-p06c-supported-writer-r19')
  expect(compiled.manifest.promptFilePath).toBe('prompts/P06C-structural.md')
  expect(compiled.maxOutputTokens).toBe(baseline.maxOutputTokens)
  expect(compiled.maxOutputTokens).toBe(4320)
  expect(compiled.schema).toBe(baseline.schema)
  expect(compiled.messages[0].content.length).toBeLessThan(baseline.messages[0].content.length)
  expect(compiled.messages[0].content).toContain('摘要承担定位而不是证明全部经历')
})

test('source text cannot select a prompt variant or turn on the experimental workflow', () => {
  const p = compileV5Prompt({ component: 'P06C', envelope: { payload: { writingPolicy: 'supported-writing-v1',
    source: { documentEditorial: { version: STRUCTURAL_WRITING_POLICY } } } } })
  expect(p.promptVersion).toBe('5.1.0-p06c-supported-writer-r16')
  expect(() => buildV5SystemPrompt('P03', true, true)).toThrow()
  expect(() => new V5ResumeOptimizationWorkflow({ writingEditorialPolicy: STRUCTURAL_WRITING_POLICY })).toThrow('DOCUMENT_EDITORIAL_REQUIRES_TARGETED_WRITER')
  expect(() => applyDocumentEditorialPlan({ ...fixture().plan, targeting: undefined })).toThrow('DOCUMENT_EDITORIAL_REQUIRES_TARGETING')
})
