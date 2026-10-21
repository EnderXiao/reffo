import { expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { educationCompanion, educationDetailPriority } from '@/v5/writing/education'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact } from '@/v5/validators'
import { buildWritingPlan } from '@/v5/writing/plan'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { compileWritingArtifact } from '@/v5/writing/compiler'

test('targeted planning selects explicit degree instead of repeating school and major', () => {
  const r = createV5ResultFixture()
  const scope = { ...r.resumeEvidenceBundle.timeline[0], kind: 'education' as const, scopeId: 'school', organization: '示例大学', title: '设计专业', evidenceIds: ['education-degree'] }
  const original = { ...r.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!, evidenceId: 'education-degree', sourceScopeId: scope.scopeId,
    claimType: 'education' as const, riskFlags: [], numericAtoms: [], qualifiers: [] }
  r.resumeEvidenceBundle.timeline.push(scope)
  r.resumeEvidenceBundle.evidenceAtoms.push(original)
  const heading = { ...original, evidenceId: 'education-heading', verbatimText: `## ${scope.organization} | ${scope.title}`, normalizedClaim: '学校专业' }
  original.verbatimText = '理学硕士'; original.normalizedClaim = '理学硕士'
  r.resumeEvidenceBundle.evidenceAtoms.push(heading)
  const highlight = { ...original, evidenceId: 'education-highlight', verbatimText: '均分28.1/30，排名前15%，获得奖学金。', normalizedClaim: '成绩与奖学金' }
  r.resumeEvidenceBundle.evidenceAtoms.push(highlight)
  expect(educationDetailPriority(original, scope)).toBeGreaterThan(educationDetailPriority(heading, scope))
  const plan = buildDeterministicV5ResumePlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle,
    match: r.matchAnalysis, profile: r.strategyProfile, policy: r.generationPolicy, targetingScores: new Map() })
  expect(plan.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).toContain(original.evidenceId)
  expect(plan.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).not.toContain(heading.evidenceId)
  expect(plan.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).toContain(highlight.evidenceId)
  expect(plan.scopePlans.find(item => item.scopeId === scope.scopeId)?.bulletBudget).toBe(1)
  const t = createTargetingFixture()
  const writing = buildWritingPlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle, match: r.matchAnalysis,
    plan, policy: r.generationPolicy, targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit } })
  const slot = writing.blueprint.slots.find(slot => slot.scopeId === scope.scopeId)!
  expect(slot.allowedEvidenceIds).toContain(highlight.evidenceId)
  expect(writing.coreEvidenceIdsBySlot[slot.slotId]).toEqual([original.evidenceId])
  const composition = { contractVersion: writing.blueprint.contractVersion, blocks: writing.blueprint.slots.map(item => {
    const ids = item.slotId === slot.slotId ? [original.evidenceId, highlight.evidenceId] : item.allowedEvidenceIds.slice(0, 1)
    return { slotId: item.slotId, evidenceIds: ids,
      text: item.kind === 'summary' || item.kind === 'skill' ? '参与团队产品迭代。'
        : ids.map(id => writing.facts.find(f => f.evidenceId === id)!.text).join('；') }
  }) }
  const compiled = compileWritingArtifact({ composition, writingPlan: writing, resume: r.resumeEvidenceBundle, plan, policy: r.generationPolicy })
  expect(compiled.artifact.markdown).toContain('理学硕士；均分28.1/30')
  expect(validateGeneratedResumeArtifact({ artifact: compiled.artifact, resume: r.resumeEvidenceBundle, plan, policy: r.generationPolicy,
    gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1', skillPolicy: writing.skillPolicy }).passed).toBe(true)
  expect(educationCompanion(original, [{ ...highlight, sourceScopeId: 'other-school' }])).toBeUndefined()
  expect(educationCompanion(original, [{ ...highlight, riskFlags: ['uncertain'] }])).toBeUndefined()
  const legacy = buildDeterministicV5ResumePlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle,
    match: r.matchAnalysis, profile: r.strategyProfile, policy: r.generationPolicy })
  expect(legacy.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).toHaveLength(1)
})
