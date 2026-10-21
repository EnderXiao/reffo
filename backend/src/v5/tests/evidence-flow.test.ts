import { describe, expect, test } from 'bun:test'
import { auditEvidenceFlow, type EvidenceFlowAnnotation } from '@/v5/acceptance/evidence-flow'
import { createJobFixture, createResumeFixture, createV5ResultFixture } from '@/v5/tests/fixtures'
import { buildWritingPlan } from '@/v5/writing/plan'

function fixture() {
  const result = createV5ResultFixture()
  const source = createResumeFixture().document
  const input = { source, resume: result.resumeEvidenceBundle, jdSha256: createJobFixture().document.sha256,
    plan: result.resumePlan, match: result.matchAnalysis, artifact: result.artifact }
  const business = input.resume.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  const skill = input.resume.evidenceAtoms.find(atom => atom.claimType === 'skill')!
  const unit = (atom: typeof business) => ({ sourceBlockId: atom.sourceBlockId, ...atom.sourceSpan })
  const annotation: EvidenceFlowAnnotation = { version: 'v5-evidence-flow-annotation-v1', resumeSha256: input.resume.sourceDocument.sha256,
    jdSha256: input.jdSha256, judgments: [{ judgmentId: 'decision-1', alternatives: [
      { alternativeId: 'practice', units: [unit(business)] },
      { alternativeId: 'other-practice', units: [unit(skill)] },
    ] }] }
  return { ...input, annotation, business, skill, result }
}

describe('offline evidence flow audit', () => {
  test('OR alternatives do not demand every defensible selection, and citations are not quality proof', () => {
    const input = fixture()
    input.artifact.claims = input.artifact.claims.filter(claim => claim.evidenceIds.includes(input.business.evidenceId))
    const report = auditEvidenceFlow(input)
    expect(report.judgments[0].stageCoverage.bodyCited).toBe(true)
    expect(report.judgments[0].alternatives[1].stages.bodyCited).toBe(false)
    expect(report.judgments[0].semanticExpression).toBe('not_assessed')
    expect(report.semanticQualityAssessed).toBe(false)
    expect(report.releaseAcceptanceAssessed).toBe(false)
    expect(report.externalCallsMade).toBe(0)
  })

  test('AND units cannot be satisfied by mentioning just one member', () => {
    const input = fixture()
    const alternatives = input.annotation.judgments[0].alternatives
    alternatives[0].units.push(...alternatives[1].units)
    alternatives.pop()
    input.artifact.claims = input.artifact.claims.filter(claim => !claim.evidenceIds.includes(input.skill.evidenceId))
    expect(auditEvidenceFlow(input).judgments[0].stageCoverage.bodyCited).toBe(false)
  })

  test('distinguishes extraction loss from unselected material and unavailable stages', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.pop()
    input.resume.evidenceAtoms = input.resume.evidenceAtoms.filter(atom => atom.evidenceId !== input.business.evidenceId)
    const report = auditEvidenceFlow({ ...input, writingPlan: undefined })
    expect(report.judgments[0].firstUncoveredStage).toBe('extracted')
    expect(report.unextractedSourceBlockIds).toContain(input.business.sourceBlockId)
    expect(report.counts.writerAvailable).toBeNull()
    expect(report.invalidReferences.planned).toBe(1)
    expect(report.judgments[0].stageCoverage.writerAvailable).toBeNull()
  })

  test('finds plan loss even if every remaining planned citation is used', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.pop()
    input.plan.scopePlans[0].selectedEvidenceIds = []
    const report = auditEvidenceFlow(input)
    expect(report.judgments[0].stageCoverage.matched).toBe(true)
    expect(report.judgments[0].firstUncoveredStage).toBe('planned')
    expect(report.judgments[0].stageCoverage.bodyCited).toBe(true)
  })

  test('summary references alone do not satisfy body coverage', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.pop()
    input.artifact.claims = [{ ...input.artifact.claims[0], outputPath: 'summary', evidenceIds: [input.business.evidenceId] }]
    expect(auditEvidenceFlow(input).judgments[0].firstUncoveredStage).toBe('bodyCited')
  })
  test('practice-derived skill citations cannot replace actual business contribution coverage', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.pop()
    input.artifact.claims = [{ ...input.artifact.claims[0], outputPath: 'skills[0]', evidenceIds: [input.business.evidenceId] }]
    expect(auditEvidenceFlow(input).judgments[0].firstUncoveredStage).toBe('bodyCited')
  })

  test('writer availability uses actual body slots rather than the entire source catalog', () => {
    const input = fixture()
    const writingPlan = buildWritingPlan({ ...input, job: input.result.jobRequirementBundle, policy: input.result.generationPolicy })
    input.annotation.judgments[0].alternatives.pop()
    expect(auditEvidenceFlow({ ...input, writingPlan }).judgments[0].stageCoverage.writerAvailable).toBe(true)
    writingPlan.blueprint.slots = writingPlan.blueprint.slots.filter(slot => slot.kind === 'summary')
    expect(auditEvidenceFlow({ ...input, writingPlan }).judgments[0].firstUncoveredStage).toBe('writerAvailable')
  })

  test('selection observations locate a stage, never invent a reason or semantic verdict', () => {
    const input = fixture()
    const writingPlan = buildWritingPlan({ ...input, job: input.result.jobRequirementBundle, policy: input.result.generationPolicy })
    const observe = (overrides: Partial<Parameters<typeof auditEvidenceFlow>[0]> = {}) => auditEvidenceFlow({ ...input, writingPlan, ...overrides })
      .rows.find(row => row.evidenceId === input.business.evidenceId)!.selectionObservation
    expect(observe()).toBe('cited_semantics_unassessed')
    expect(observe({ plan: undefined })).toBe('plan_unavailable')
    expect(observe({ writingPlan: undefined })).toBe('writer_unavailable')
    expect(observe({ artifact: undefined })).toBe('artifact_unavailable')
    expect(observe({ artifact: { ...input.artifact, claims: [] } })).toBe('not_cited_in_body')
  })

  test('partial extraction cannot pretend to cover a whole annotated contribution', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.pop()
    input.business.sourceSpan.end -= 3
    expect(auditEvidenceFlow(input).judgments[0].firstUncoveredStage).toBe('extracted')
  })

  test('a partial Writer excerpt does not count as the entire neighbouring source unit', () => {
    const input = fixture()
    input.annotation.judgments[0].alternatives.shift()
    const writingPlan = buildWritingPlan({ ...input, job: input.result.jobRequirementBundle, policy: input.result.generationPolicy })
    writingPlan.blueprint.slots = writingPlan.blueprint.slots.filter(slot => slot.allowedEvidenceIds.includes(input.business.evidenceId))
    writingPlan.facts = writingPlan.facts.filter(fact => fact.evidenceId === input.business.evidenceId)
    writingPlan.facts[0].sourceExcerpts = [{ evidenceId: input.skill.evidenceId,
      sourceSpan: { ...input.skill.sourceSpan, end: input.skill.sourceSpan.end - 2 } }]
    writingPlan.expandedEvidenceIds[input.business.evidenceId] = [input.business.evidenceId, input.skill.evidenceId]
    const report = auditEvidenceFlow({ ...input, writingPlan })
    expect(report.rows.find(row => row.evidenceId === input.skill.evidenceId)?.stages.writerAvailable).toBe(true)
    expect(report.judgments[0].stageCoverage.writerAvailable).toBe(false)
  })

  test('unannotated omissions are not automatically labelled as failures', () => {
    const input = fixture()
    const report = auditEvidenceFlow({ ...input, annotation: undefined, source: undefined })
    expect(report.judgments).toEqual([])
    expect(report.unextractedSourceBlockIds).toBeNull()
    expect(report.sourceInventoryAvailable).toBe(false)
    expect(report).not.toHaveProperty('accepted')
    expect(report).not.toHaveProperty('score')
  })

  test('loose continuation hints cannot make an excluded tail routable', () => {
    const input = fixture()
    let offset = 1000
    const atoms = ['访谈12', '名客户', '并形成报告。'].map((text, index) => {
      const atom = { ...input.business, evidenceId: `fragment-${index}`, sourceBlockId: `B010${index}`,
        sourceSpan: { start: offset, end: offset + text.length }, verbatimText: text,
        normalizedClaim: text, riskFlags: [] }
      offset = atom.sourceSpan.end + 1
      return atom
    })
    atoms[2].status = 'excluded'
    input.resume.evidenceAtoms = atoms
    const report = auditEvidenceFlow({ ...input, annotation: undefined, source: undefined })
    expect(report.rows[0].stages.routable).toBe(true)
    expect(report.rows[1].stages.routable).toBe(true)
    expect(report.rows[2].stages.routable).toBe(false)
  })

  test('source order and serialization do not change audit results or mutate input', () => {
    const input = fixture()
    const before = structuredClone(input)
    const report = auditEvidenceFlow(input)
    expect(input).toEqual(before)
    input.resume.evidenceAtoms.reverse()
    input.artifact.claims.reverse()
    expect(auditEvidenceFlow(JSON.parse(JSON.stringify(input)))).toEqual(report)
  })

  test('does not copy source text, identity, matching prose or generated content into diagnostics', () => {
    const input = fixture()
    const canary = 'PRIVATE_EMAIL_13912345678@example.invalid'
    input.resume.identity.name.value = canary
    input.match.positioning.statement = canary
    input.artifact.markdown = canary
    input.artifact.claims[0].outputText = canary
    input.resume.evidenceAtoms[0].verbatimText = canary
    const serialized = JSON.stringify(auditEvidenceFlow(input))
    expect(serialized).not.toContain(canary)
    expect(serialized).not.toContain('verbatimText')
    expect(serialized).not.toContain('outputText')
  })

  test.each(['resume', 'job', 'span', 'empty_alternative', 'duplicate_judgment'] as const)('rejects an invalid annotation without accepting new gold data: %s', mutation => {
    const input = fixture()
    if (mutation === 'resume') input.annotation.resumeSha256 = '0'.repeat(64)
    if (mutation === 'job') input.annotation.jdSha256 = '0'.repeat(64)
    if (mutation === 'span') input.annotation.judgments[0].alternatives[0].units[0].end += 1000
    if (mutation === 'empty_alternative') input.annotation.judgments[0].alternatives[0].units = []
    if (mutation === 'duplicate_judgment') input.annotation.judgments.push(input.annotation.judgments[0])
    expect(() => auditEvidenceFlow(input)).toThrow('EVIDENCE_FLOW_')
  })
})
