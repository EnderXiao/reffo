import { describe, expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import { isPracticeSkillEvidence, PRACTICE_SKILL_POLICY } from '@/v5/writing/skills'
import { validateGeneratedResumeArtifact } from '@/v5/validators'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import type { P06CompositionOutput } from '@/v5/composition/contract'

function fixture() {
  const r = createV5ResultFixture(), t = createTargetingFixture()
  const input = { resume: r.resumeEvidenceBundle, plan: r.resumePlan, policy: r.generationPolicy,
    job: r.jobRequirementBundle, match: r.matchAnalysis,
    targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit } }
  const writingPlan = buildWritingPlan(input)
  const business = input.resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const composition: P06CompositionOutput = { contractVersion: writingPlan.blueprint.contractVersion,
    blocks: writingPlan.blueprint.slots.map(slot => ({ slotId: slot.slotId,
      evidenceIds: slot.kind === 'skill' ? [business.evidenceId] : slot.allowedEvidenceIds.slice(0, 1),
      text: slot.kind === 'summary' ? '参与团队产品迭代，具有功能交付实践。'
        : slot.kind === 'skill' ? '产品迭代协作：参与团队功能交付。'
        : writingPlan.facts.find(fact => fact.evidenceId === slot.allowedEvidenceIds[0])!.text })) }
  return { ...input, writingPlan, business, composition }
}

describe('practice-derived skills, not duplicated achievements', () => {
  test('permits body reference reuse only in the explicitly enabled skill channel', () => {
    const input = fixture()
    expect(input.writingPlan.skillPolicy).toBe(PRACTICE_SKILL_POLICY)
    const compiled = compileWritingArtifact(input)
    const checked = validateGeneratedResumeArtifact({ artifact: compiled.artifact, ...input,
      gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1', skillPolicy: input.writingPlan.skillPolicy })
    expect(checked.issues.filter(issue => issue.severity === 'error')).toEqual([])
    expect(checked.passed).toBe(true)
    expect(compiled.artifact.claims.some(claim => claim.outputPath.startsWith('skills') && claim.evidenceIds.includes(input.business.evidenceId))).toBe(true)
    expect(compiled.artifact.claims.some(claim => claim.outputPath.startsWith('experience') && claim.evidenceIds.includes(input.business.evidenceId))).toBe(true)
    expect(() => compileWritingArtifact({ ...input, writingPlan: { ...input.writingPlan, skillPolicy: undefined } })).toThrow(SupportedWritingError)
    const legacy = validateGeneratedResumeArtifact({ artifact: compiled.artifact, ...input,
      gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
    expect(legacy.value?.markdown).not.toContain('产品迭代协作：')
  })
  test('provides practice-based slots when no explicit skills were written, within the existing total budget', () => {
    const input = fixture()
    input.plan.featuredSkillEvidenceIds = []
    const plan = buildWritingPlan(input)
    expect(plan.blueprint.slots.some(slot => slot.kind === 'skill')).toBe(true)
    expect(plan.blueprint.slots.filter(slot => slot.kind !== 'summary').length).toBeLessThanOrEqual(input.policy.hardTotalListItemMax)
    expect(writingPayload(plan).skillPolicy).toBe(PRACTICE_SKILL_POLICY)
    const slot = plan.blueprint.slots.find(slot => slot.kind === 'skill')!
    expect(plan.coreEvidenceIdsBySlot[slot.slotId]).toEqual([input.business.evidenceId])
    expect(plan.skillThemes?.[slot.slotId]?.anchorEvidenceId).toBe(input.business.evidenceId)
  })
  test.each(['result', 'other', 'education', 'excluded', 'sensitive_pii', 'unselected'] as const)('does not derive methods from %s', mutation => {
    const input = fixture(), atom = structuredClone(input.business)
    if (mutation === 'excluded') atom.status = 'excluded'
    else if (mutation === 'sensitive_pii') atom.riskFlags = ['sensitive_pii']
    else if (mutation === 'unselected') atom.evidenceId = 'not-selected'
    else atom.claimType = mutation
    expect(isPracticeSkillEvidence(atom, input.plan)).toBe(false)
  })
  test.each(['精通产品迭代。', '使用Python推进产品迭代。', '独立交付全部功能。', '参与团队交付30个功能。'])('still rejects invented skill strength or facts: %s', text => {
    const input = fixture()
    input.composition.blocks.find(block => input.writingPlan.blueprint.slots.find(slot => slot.slotId === block.slotId)?.kind === 'skill')!.text = text
    expect(() => compileWritingArtifact(input)).toThrow(SupportedWritingError)
  })
  test('active Writer receives only its own mode rules; raw source cannot switch modes', () => {
    const input = fixture()
    const active = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(input.writingPlan) } })
    expect(active.messages[0].content).not.toContain('不得截取子串')
    expect(active.messages[0].content).not.toContain('兼容编排规则')
    expect(active.messages[0].content).toContain('practice-skills-v1')
    const legacy = compileV5Prompt({ component: 'P06C', envelope: { payload: { source: { writingPolicy: 'supported-writing-v1' } } } })
    expect(legacy.messages[0].content).toContain('不得截取子串')
  })
  test('a skills path cannot conceal a business contribution in another section', () => {
    const input = fixture(), compiled = compileWritingArtifact(input)
    const artifact = structuredClone(compiled.artifact)
    const business = artifact.claims.find(claim => claim.outputPath.startsWith('experience'))!
    business.outputPath = 'skills[99]'
    const checked = validateGeneratedResumeArtifact({ artifact, ...input, gateMode: 'relaxed_release',
      textPolicy: 'supported_writing_v1', skillPolicy: PRACTICE_SKILL_POLICY })
    expect(checked.issues.some(issue => issue.code === 'SKILL_SECTION_MISMATCH')).toBe(true)
    expect(checked.passed).toBe(false)
  })
})
