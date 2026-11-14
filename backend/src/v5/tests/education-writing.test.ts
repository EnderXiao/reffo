import { expect, test } from 'bun:test'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { educationCompanion, educationDetailPriority } from '@/v5/writing/education'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact } from '@/v5/validators'
import { buildWritingPlan } from '@/v5/writing/plan'
import { createTargetingFixture } from '@/v5/tests/targeting-fixtures'
import { compileWritingArtifact } from '@/v5/writing/compiler'

test('targeted planning prioritizes academic detail while retaining an explicit degree absent from the heading', () => {
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
  expect(writing.coreEvidenceIdsBySlot[slot.slotId]).toEqual([highlight.evidenceId])
  const composition = { contractVersion: writing.blueprint.contractVersion, blocks: writing.blueprint.slots.map(item => {
    const ids = item.slotId === slot.slotId ? [original.evidenceId, highlight.evidenceId] : item.allowedEvidenceIds.slice(0, 1)
    return { slotId: item.slotId, evidenceIds: ids,
      text: item.kind === 'summary' || item.kind === 'skill' ? '参与团队产品迭代。'
        : ids.map(id => writing.facts.find(f => f.evidenceId === id)!.text).join('；') }
  }) }
  const compiled = compileWritingArtifact({ composition, writingPlan: writing, resume: r.resumeEvidenceBundle, plan, policy: r.generationPolicy })
  expect(compiled.artifact.markdown).toContain('理学硕士；均分28.1/30')
  expect(compiled.artifact.claims.find(claim => claim.outputText.includes('理学硕士；均分28.1/30'))?.evidenceIds).toEqual([original.evidenceId, highlight.evidenceId])
  expect(validateGeneratedResumeArtifact({ artifact: compiled.artifact, resume: r.resumeEvidenceBundle, plan, policy: r.generationPolicy,
    gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1', skillPolicy: writing.skillPolicy }).passed).toBe(true)
  expect(educationCompanion(original, [{ ...highlight, sourceScopeId: 'other-school' }])).toBeUndefined()
  expect(educationCompanion(original, [{ ...highlight, riskFlags: ['uncertain'] }])).toBeUndefined()
  expect(educationCompanion(highlight, [original], {...scope, title: '设计专业 | 理学硕士'})).toBeUndefined()
  expect(educationCompanion({...highlight, claimType: 'award'}, [original], scope)?.evidenceId).toBe(original.evidenceId)
  scope.title = '设计专业 | 理学硕士'
  const representedPlan = buildDeterministicV5ResumePlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle,
    match: r.matchAnalysis, profile: r.strategyProfile, policy: r.generationPolicy, targetingScores: new Map() })
  expect(representedPlan.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).toEqual([highlight.evidenceId])
  const representedWriting = buildWritingPlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle, match: r.matchAnalysis,
    plan: representedPlan, policy: r.generationPolicy, targeting: { profile: t.candidate.jobSuccessProfile, targets: t.targets, fit: t.fit } })
  const representedComposition = {contractVersion: representedWriting.blueprint.contractVersion,
    blocks: representedWriting.blueprint.slots.map(item => ({slotId: item.slotId, evidenceIds: item.allowedEvidenceIds.slice(0, 1),
      text: item.kind === 'summary' || item.kind === 'skill' ? '参与团队产品迭代。'
        : representedWriting.facts.find(fact => fact.evidenceId === item.allowedEvidenceIds[0])!.text}))}
  const represented = compileWritingArtifact({composition: representedComposition, writingPlan: representedWriting,
    resume: r.resumeEvidenceBundle, plan: representedPlan, policy: r.generationPolicy})
  expect(represented.artifact.markdown).toContain('### 示例大学｜设计专业 | 理学硕士')
  expect(represented.artifact.markdown).toContain('- 均分28.1/30，排名前15%，获得奖学金。')
  expect(represented.artifact.markdown.match(/理学硕士/gu)).toHaveLength(1)
  const legacy = buildDeterministicV5ResumePlan({ resume: r.resumeEvidenceBundle, job: r.jobRequirementBundle,
    match: r.matchAnalysis, profile: r.strategyProfile, policy: r.generationPolicy })
  expect(legacy.scopePlans.find(item => item.scopeId === scope.scopeId)?.selectedEvidenceIds).toHaveLength(1)
})
