import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { completeMetricPrefix, deriveWritingSourceExcerpts } from '@/v5/writing/source-excerpts'
import { buildWritingPlan } from '@/v5/writing/plan'
import { compileWritingArtifact } from '@/v5/writing/compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import type { EvidenceAtom } from '@/v5/types'
import { PRACTICE_SKILL_POLICY } from '@/v5/writing/skills'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'

function fixture() {
  const result = createV5ResultFixture()
  const resume = result.resumeEvidenceBundle
  const anchor = resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  anchor.claimType = 'action'
  anchor.verbatimText = '参与团队辅导产品设计与案例审核流程改进。'
  anchor.sourceSpan.end = anchor.sourceSpan.start + anchor.verbatimText.length
  anchor.riskFlags = []
  anchor.numericAtoms = []
  const text = '审核有效率95%；单篇审核由40分钟降至近乎零人工干预，月均优秀案例'
  const support: EvidenceAtom = { ...anchor, evidenceId: 'ev_excerpt_support', claimType: 'result',
    sourceBlockId: `B${String(Number(anchor.sourceBlockId.slice(1)) + 1).padStart(4, '0')}`,
    verbatimText: text, status: 'source_qualified' as const, riskFlags: ['self_assessment_only' as const],
    sourceSpan: { start: anchor.sourceSpan.end + 1, end: anchor.sourceSpan.end + 1 + text.length } }
  // Avoid synthetic coordinate collisions with the original skill row.
  resume.evidenceAtoms = resume.evidenceAtoms.filter(atom => atom.claimType !== 'skill')
  result.resumePlan.featuredSkillEvidenceIds = []
  result.resumePlan.stableCoreEvidenceIds = result.resumePlan.stableCoreEvidenceIds.filter(id => resume.evidenceAtoms.some(atom => atom.evidenceId === id))
  result.resumePlan.customizedEvidenceIds = result.resumePlan.customizedEvidenceIds.filter(id => resume.evidenceAtoms.some(atom => atom.evidenceId === id))
  resume.evidenceAtoms.push(support)
  return { resume, anchor, support, plan: result.resumePlan, policy: result.generationPolicy,
    match: result.matchAnalysis, job: result.jobRequirementBundle }
}

describe('bounded writing source excerpts', () => {
  test('skill abstractions retain a verified result excerpt only together with its planned practice anchor', () => {
    const input = fixture(), writingPlan = buildWritingPlan(input)
    const fact = writingPlan.facts.find(f => f.evidenceId === input.anchor.evidenceId)!
    writingPlan.skillPolicy = PRACTICE_SKILL_POLICY
    if (!writingPlan.blueprint.sectionOrder.includes('skills')) writingPlan.blueprint.sectionOrder.push('skills')
    writingPlan.blueprint.slots.push({ slotId: 'skill-excerpt', kind: 'skill', sectionKey: 'skills', scopeId: null,
      outputPath: 'skills[0]', order: 100, required: true, allowedEvidenceIds: [input.anchor.evidenceId] })
    const composition = { contractVersion: writingPlan.blueprint.contractVersion,
      blocks: writingPlan.blueprint.slots.map(slot => ({ slotId: slot.slotId,
        evidenceIds: [input.anchor.evidenceId], text: slot.kind === 'summary' ? '参与团队辅导产品设计。'
          : slot.kind === 'skill' ? `辅导流程实践：${fact.text}` : fact.text })) }
    const { artifact } = compileWritingArtifact({ ...input, writingPlan, composition })
    const validate = () => validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release',
      textPolicy: 'supported_writing_v1', skillPolicy: PRACTICE_SKILL_POLICY })
    expect(validate().issues.filter(issue => issue.severity === 'error')).toEqual([])
    const skill = artifact.claims.find(c => c.outputPath === 'skills[0]')!
    expect(skill.evidenceIds).toContain(input.support.evidenceId)
    skill.evidenceIds = [input.support.evidenceId]
    expect(validate().issues.map(i => i.code)).toContain('SKILL_SECTION_EVIDENCE_MISMATCH')
    skill.evidenceIds = [input.anchor.evidenceId, input.support.evidenceId]
    input.support.riskFlags = ['conflicting']
    expect(validate().issues.map(i => i.code)).toContain('SKILL_SECTION_EVIDENCE_MISMATCH')
  })

  test('a summary may combine a complete verified source group with another planned fact, but not an orphan companion', () => {
    const input = fixture()
    input.anchor.status = 'source_supported'
    input.anchor.verbatimText = input.anchor.verbatimText.replace(/。$/u, '')
    input.anchor.sourceBlockId = 'B0100'
    input.anchor.sourceSpan = { start: 500, end: 500 + input.anchor.verbatimText.length }
    Object.assign(input.support, { claimType: 'other', verbatimText: '产品反馈与审核流程', status: 'source_supported',
      riskFlags: [], sourceBlockId: 'B0101', sourceSpan: { start: input.anchor.sourceSpan.end + 1, end: input.anchor.sourceSpan.end + 10 } })
    input.support.sourceSpan.end = input.support.sourceSpan.start + input.support.verbatimText.length
    const extra: EvidenceAtom = { ...input.anchor, evidenceId: 'extra-practice', sourceBlockId: 'B0200',
      verbatimText: '参与团队数据汇总。', sourceSpan: { start: 1000, end: 1010 } }
    extra.sourceSpan.end = extra.sourceSpan.start + extra.verbatimText.length
    input.resume.evidenceAtoms.push(extra)
    input.plan.scopePlans.find(s => s.scopeId === extra.sourceScopeId)!.selectedEvidenceIds.push(extra.evidenceId)
    expect(deriveEvidenceAssemblies(input.resume, input.plan).some(a => a.memberEvidenceIds.includes(input.support.evidenceId))).toBe(true)
    const writingPlan = buildWritingPlan(input)
    writingPlan.blueprint.sectionOrder = ['summary', ...writingPlan.blueprint.sectionOrder.filter(s => s !== 'summary')]
    writingPlan.blueprint.slots = writingPlan.blueprint.slots.filter(s => s.kind !== 'summary')
    writingPlan.blueprint.slots.unshift({ slotId: 'summary-combined', kind: 'summary', sectionKey: 'summary', scopeId: null,
      outputPath: 'summary[0]', order: -1, required: true, allowedEvidenceIds: [input.anchor.evidenceId, extra.evidenceId] })
    const composition = { contractVersion: writingPlan.blueprint.contractVersion,
      blocks: writingPlan.blueprint.slots.map(slot => ({ slotId: slot.slotId,
        evidenceIds: slot.kind === 'summary' ? [input.anchor.evidenceId, extra.evidenceId] : [slot.allowedEvidenceIds[0]],
        text: slot.kind === 'summary' ? '参与团队辅导产品设计与数据汇总。' : writingPlan.facts.find(f => f.evidenceId === slot.allowedEvidenceIds[0])!.text })) }
    const { artifact } = compileWritingArtifact({ ...input, writingPlan, composition })
    const validate = () => validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
    expect(validate().issues.filter(i => i.severity === 'error')).toEqual([])
    const summary = artifact.claims.find(c => c.outputPath === 'summary[0]')!
    expect(summary.evidenceIds).toContain(input.support.evidenceId)
    const body = artifact.claims.find(c => /^(?:experience|project|research)\./u.test(c.outputPath) && c.evidenceIds.includes(input.anchor.evidenceId))!
    body.evidenceIds = [...new Set([...body.evidenceIds, extra.evidenceId])]
    expect(validate().issues.filter(i => i.severity === 'error')).toEqual([])
    const originalBody = [...body.evidenceIds]
    body.evidenceIds = [input.support.evidenceId, extra.evidenceId]
    expect(validate().issues.map(i => i.code)).toContain('UNPLANNED_EVIDENCE')
    body.evidenceIds = originalBody
    summary.evidenceIds = [input.support.evidenceId, extra.evidenceId]
    expect(validate().issues.map(i => i.code)).toContain('UNPLANNED_EVIDENCE')
  })
  test('recovers only a complete prefix with exact immutable source coordinates', () => {
    const input = fixture(), before = structuredClone(input.resume)
    const excerpt = completeMetricPrefix(input.support)!
    expect(excerpt.text).toBe('审核有效率95%；单篇审核由40分钟降至近乎零人工干预')
    expect(input.support.verbatimText.slice(0, excerpt.sourceSpan.end - excerpt.sourceSpan.start)).toBe(excerpt.text)
    expect(deriveWritingSourceExcerpts(input.resume, input.plan)).toHaveLength(1)
    expect(input.resume).toEqual(before)
  })
  test.each(['excluded', 'conflict', 'uncertain', 'future', 'cross_scope', 'not_adjacent', 'bad_span', 'unplanned_anchor'] as const)('rejects %s', mutation => {
    const input = fixture()
    if (mutation === 'excluded') input.support.status = 'excluded'
    if (mutation === 'conflict') input.support.riskFlags = ['conflicting']
    if (mutation === 'uncertain') input.support.riskFlags = ['uncertain']
    if (mutation === 'future') input.support.riskFlags = ['future_or_planned']
    if (mutation === 'cross_scope') input.support.sourceScopeId = 'other_scope'
    if (mutation === 'not_adjacent') input.support.sourceBlockId = 'B0999'
    if (mutation === 'bad_span') input.support.sourceSpan.end += 1
    if (mutation === 'unplanned_anchor') input.plan.scopePlans.forEach(scope => { scope.selectedEvidenceIds = [] })
    expect(deriveWritingSourceExcerpts(input.resume, input.plan)).toEqual([])
  })
  test.each([
    '审核有效率95%；成本减少，月均优秀案例',
    '审核有效率95%，但未验证，月均优秀案例',
    '审核有效率95%；审核由40分钟降至，月均优秀案例',
    '审核有效率95%；成本降低10%，月均优秀案例可能不准确',
    '审核有效率95%并不属实；成本降低10%，月均优秀案例',
    '模拟审核有效率95%；成本降低10%，月均优秀案例',
  ])('does not extract incomplete or qualified-away metrics: %s', text => {
    const { support } = fixture()
    support.verbatimText = text
    support.sourceSpan.end = support.sourceSpan.start + text.length
    expect(completeMetricPrefix(support)).toBeNull()
  })
  test('Writer can use the prefix, while the legacy path and unplanned standalone tail cannot', () => {
    const input = fixture()
    const writingPlan = buildWritingPlan(input)
    const fact = writingPlan.facts.find(fact => fact.evidenceId === input.anchor.evidenceId)!
    expect(fact.text).toContain('95%')
    expect(fact.text).toContain('40分钟')
    expect(fact.text).not.toContain('月均优秀案例')
    const composition = { contractVersion: writingPlan.blueprint.contractVersion,
      blocks: writingPlan.blueprint.slots.map(slot => ({ slotId: slot.slotId,
        evidenceIds: [slot.allowedEvidenceIds[0]],
        text: slot.kind === 'summary' ? '参与团队辅导产品设计。' : fact.text })) }
    const { artifact } = compileWritingArtifact({ ...input, writingPlan, composition })
    const checked = validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
    expect(checked.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(validateGeneratedResumeArtifact({ ...input, artifact, gateMode: 'relaxed_release' }).passed).toBe(false)
    const unsupported = structuredClone(artifact)
    const body = unsupported.claims.find(claim => claim.evidenceIds.includes(input.support.evidenceId))!
    body.evidenceIds = [input.support.evidenceId]
    expect(validateGeneratedResumeArtifact({ ...input, artifact: unsupported, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' }).passed).toBe(false)
    composition.blocks.forEach(block => { block.text = '参与团队辅导产品设计。' })
    expect(compileWritingArtifact({ ...input, writingPlan, composition }).writingIssues.map(issue => issue.code)).toContain('WRITER_SUPPORTING_DETAIL_OMITTED')
  })
})
