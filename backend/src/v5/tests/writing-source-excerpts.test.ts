import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { completeMetricPrefix, deriveWritingSourceExcerpts } from '@/v5/writing/source-excerpts'
import { buildWritingPlan } from '@/v5/writing/plan'
import { compileWritingArtifact } from '@/v5/writing/compiler'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import type { EvidenceAtom } from '@/v5/types'

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
