import { describe, expect, test } from 'bun:test'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import {
  buildEvidencePlanningCatalog,
  buildRequirementEvidenceRoutes,
} from '@/v5/evidence-routing'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { createMatchFixture } from '@/v5/tests/fixtures'
import type { EvidenceAtom, V5MatchAnalysis } from '@/v5/types'
import {
  buildDeterministicV5ResumePlan,
  validateGeneratedResumeArtifact,
  validateV5MatchAnalysis,
  validateV5ResumePlan,
} from '@/v5/validators'

function case3BoundaryFixture() {
  const fixture = createMatchFixture()
  const resume = structuredClone(fixture.resume)
  const job = structuredClone(fixture.job)
  const identity = structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'identity')!)
  const timeline = structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!)
  const skill = structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'skill')!)
  const template = structuredClone(fixture.deliverable)
  const scopeId = 'work_case3_deidentified'

  const businessAtom = (input: {
    evidenceId: string
    sourceBlockId: string
    start: number
    text: string
    claimType: EvidenceAtom['claimType']
    normalizedClaim?: string
  }): EvidenceAtom => ({
    ...structuredClone(template),
    evidenceId: input.evidenceId,
    sourceBlockId: input.sourceBlockId,
    sourceScopeId: scopeId,
    sourceSpan: { start: input.start, end: input.start + input.text.length },
    verbatimText: input.text,
    normalizedClaim: input.normalizedClaim ?? input.text,
    claimType: input.claimType,
    status: 'source_supported',
    attributionLevel: 'drove',
    sourceActionVerb: null,
    qualifiers: [],
    numericAtoms: [],
    riskFlags: [],
  })

  const splitQuantityLeft = businessAtom({
    evidenceId: 'ev_case3_01_split_quantity_left',
    sourceBlockId: 'B0100',
    start: 1000,
    text: '关键动作 主导问卷、10+',
    claimType: 'action',
  })
  const splitQuantityRight = businessAtom({
    evidenceId: 'ev_case3_02_split_quantity_right',
    sourceBlockId: 'B0101',
    start: splitQuantityLeft.sourceSpan.end + 2,
    text: '家门店调研、访谈、数据埋点和用户行为分析，形成研究材料。',
    claimType: 'action',
  })
  const nakedPercent = businessAtom({
    evidenceId: 'ev_case3_03_naked_percent',
    sourceBlockId: 'B0102',
    start: splitQuantityRight.sourceSpan.end + 8,
    text: '57.4% -> 90.7%',
    normalizedClaim: '门店目标下发及时率由57.4%提升至90.7%',
    claimType: 'result',
  })
  const metricLabel = businessAtom({
    evidenceId: 'ev_case3_04_metric_label',
    sourceBlockId: 'B0103',
    start: nakedPercent.sourceSpan.end + 8,
    text: 'OA替代、按时完成率',
    claimType: 'deliverable',
  })
  const contextSupplement = businessAtom({
    evidenceId: 'ev_case3_05_context',
    sourceBlockId: 'B0104',
    start: metricLabel.sourceSpan.end + 8,
    text: '项目背景：线下门店反馈分散',
    claimType: 'responsibility',
  })
  const transferableAnchor = businessAtom({
    evidenceId: 'ev_case3_06_transferable_anchor',
    sourceBlockId: 'B0105',
    start: contextSupplement.sourceSpan.end + 8,
    text: '平均每两周发布一个版本，协同开发、设计和测试推动功能按期上线。',
    claimType: 'action',
  })
  const boundedResult = businessAtom({
    evidenceId: 'ev_case3_07_bounded_result',
    sourceBlockId: 'B0106',
    start: transferableAnchor.sourceSpan.end + 8,
    text: '推动目标下发流程优化，使门店及时率由57.4%提升至90.7%。',
    claimType: 'result',
  })

  identity.sourceBlockId = 'B0001'
  identity.sourceSpan = { start: 0, end: identity.verbatimText.length }
  timeline.sourceBlockId = 'B0099'
  timeline.sourceScopeId = scopeId
  timeline.sourceSpan = { start: 900, end: 990 }
  skill.sourceBlockId = 'B0107'
  skill.sourceSpan = { start: boundedResult.sourceSpan.end + 8, end: boundedResult.sourceSpan.end + 16 }

  const businessAtoms = [
    splitQuantityLeft,
    splitQuantityRight,
    nakedPercent,
    metricLabel,
    contextSupplement,
    transferableAnchor,
    boundedResult,
  ]
  resume.evidenceAtoms = [identity, timeline, skill, ...businessAtoms]
  resume.timeline = [{
    scopeId,
    kind: 'experience',
    organization: '示例科技公司',
    title: '产品经理',
    start: '2022',
    end: '至今',
    evidenceIds: [timeline.evidenceId, ...businessAtoms.map(atom => atom.evidenceId)],
  }]

  const responsibility = job.requirementAtoms.find(atom => atom.category === 'responsibility')!
  const skillRequirement = job.requirementAtoms.find(atom => atom.category === 'skill')!
  responsibility.requirementId = 'req_case3_transferable'
  responsibility.importance = 'core_outcome'
  skillRequirement.requirementId = 'req_case3_skill'
  skillRequirement.importance = 'must_have'
  job.requirementAtoms.push({
    ...structuredClone(responsibility),
    requirementId: 'req_case3_outcome',
    category: 'outcome',
    importance: 'core_outcome',
    normalizedRequirement: '持续改善关键业务指标',
  })

  const match: V5MatchAnalysis = {
    ...structuredClone(fixture.match),
    strengths: [],
    gaps: [],
    requirementMatches: [
      {
        requirementId: responsibility.requirementId,
        status: 'transferable_match',
        evidenceIds: [
          splitQuantityLeft.evidenceId,
          splitQuantityRight.evidenceId,
          nakedPercent.evidenceId,
          metricLabel.evidenceId,
          contextSupplement.evidenceId,
          transferableAnchor.evidenceId,
        ],
        confidence: 'high',
        rationale: '跨域协作与版本交付能力可以迁移',
      },
      {
        requirementId: 'req_case3_outcome',
        status: 'direct_match',
        evidenceIds: [nakedPercent.evidenceId, metricLabel.evidenceId, boundedResult.evidenceId],
        confidence: 'high',
        rationale: '存在完整的指标改进证据',
      },
      {
        requirementId: skillRequirement.requirementId,
        status: 'direct_match',
        evidenceIds: [skill.evidenceId],
        confidence: 'high',
        rationale: '技能直接匹配',
      },
    ],
    positioning: {
      ...fixture.match.positioning,
      primaryRequirementIds: [responsibility.requirementId, 'req_case3_outcome', skillRequirement.requirementId],
      primaryEvidenceIds: [transferableAnchor.evidenceId, boundedResult.evidenceId, skill.evidenceId],
    },
  }

  return {
    resume,
    job,
    match,
    atoms: {
      splitQuantityLeft,
      splitQuantityRight,
      nakedPercent,
      metricLabel,
      contextSupplement,
      transferableAnchor,
      boundedResult,
    },
    requirementIds: {
      transferable: responsibility.requirementId,
      outcome: 'req_case3_outcome',
    },
  }
}

function selectedBusinessEvidenceIds(plan: ReturnType<typeof buildDeterministicV5ResumePlan>) {
  return plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)
}

describe('v5 deterministic evidence routing', () => {
  test('filters deidentified case3 fragments while preserving a complete transferable anchor', () => {
    const fixture = case3BoundaryFixture()
    const catalog = buildEvidencePlanningCatalog(fixture.resume)
    const routes = buildRequirementEvidenceRoutes({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      catalog,
    })

    const left = catalog.assessments.get(fixture.atoms.splitQuantityLeft.evidenceId)!
    const right = catalog.assessments.get(fixture.atoms.splitQuantityRight.evidenceId)!
    expect(left.standaloneClass).toBe('fragment')
    expect(right.standaloneClass).toBe('fragment')
    expect(left.nextEvidenceId).toBe(right.evidenceId)
    expect(right.previousEvidenceId).toBe(left.evidenceId)
    expect(left.continuationGroupId).toBe(right.continuationGroupId)
    expect(left.continuationGroupId).not.toBeNull()
    expect(catalog.assessments.get(fixture.atoms.nakedPercent.evidenceId)).toMatchObject({
      standaloneClass: 'fragment',
      boundedMetricCount: 0,
    })
    expect(catalog.assessments.get(fixture.atoms.metricLabel.evidenceId)).toMatchObject({
      standaloneClass: 'metadata_only',
      boundedMetricCount: 0,
    })
    expect(catalog.assessments.get(fixture.atoms.contextSupplement.evidenceId)?.standaloneClass).toBe('supplement')
    expect(catalog.assessments.get(fixture.atoms.boundedResult.evidenceId)?.boundedMetricCount).toBe(2)

    const transferableRoute = routes.byRequirement.get(fixture.requirementIds.transferable)!
    expect(transferableRoute.planningDisposition).toBe('primary_candidate')
    expect(transferableRoute.anchorEvidenceIds).toContain(fixture.atoms.transferableAnchor.evidenceId)
    expect(transferableRoute.supportingEvidenceIds).toEqual(expect.arrayContaining([
      fixture.atoms.splitQuantityLeft.evidenceId,
      fixture.atoms.splitQuantityRight.evidenceId,
      fixture.atoms.nakedPercent.evidenceId,
      fixture.atoms.contextSupplement.evidenceId,
    ]))
  })

  test('keeps P03 valid but removes weak atoms from policy, plan and artifact capacity', () => {
    const fixture = case3BoundaryFixture()
    const p03Validation = validateV5MatchAnalysis(fixture)
    expect(p03Validation.passed, JSON.stringify(p03Validation.issues)).toBe(true)

    const strategy = buildAdaptiveStrategy(fixture)
    expect(strategy.profile.metrics.eligibleBusinessEvidenceCount).toBe(2)
    const plan = buildDeterministicV5ResumePlan({ ...fixture, policy: strategy.policy, profile: strategy.profile })
    const selected = selectedBusinessEvidenceIds(plan)
    expect(selected).toEqual(expect.arrayContaining([
      fixture.atoms.transferableAnchor.evidenceId,
      fixture.atoms.boundedResult.evidenceId,
    ]))
    expect(selected).not.toEqual(expect.arrayContaining([
      fixture.atoms.splitQuantityLeft.evidenceId,
      fixture.atoms.splitQuantityRight.evidenceId,
      fixture.atoms.nakedPercent.evidenceId,
      fixture.atoms.metricLabel.evidenceId,
      fixture.atoms.contextSupplement.evidenceId,
    ]))

    const planValidation = validateV5ResumePlan({
      ...fixture,
      plan,
      policy: strategy.policy,
      profile: strategy.profile,
      gateMode: 'relaxed_release',
    })
    expect(planValidation.passed).toBe(true)
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan })
    expect(validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan,
      policy: strategy.policy,
      gateMode: 'relaxed_release',
    }).passed).toBe(true)
  })

  test('is invariant to P01 atom and P03 evidence ordering', () => {
    const fixture = case3BoundaryFixture()
    const strategy = buildAdaptiveStrategy(fixture)
    const firstCatalog = buildEvidencePlanningCatalog(fixture.resume)
    const firstPlan = buildDeterministicV5ResumePlan({ ...fixture, policy: strategy.policy, profile: strategy.profile })

    const reversed = structuredClone(fixture)
    reversed.resume.evidenceAtoms.reverse()
    reversed.match.requirementMatches.reverse()
    reversed.match.requirementMatches.forEach(item => item.evidenceIds.reverse())
    const reversedStrategy = buildAdaptiveStrategy(reversed)
    const reversedCatalog = buildEvidencePlanningCatalog(reversed.resume)
    const reversedPlan = buildDeterministicV5ResumePlan({
      ...reversed,
      policy: reversedStrategy.policy,
      profile: reversedStrategy.profile,
    })

    expect(reversedCatalog.orderedEvidenceIds).toEqual(firstCatalog.orderedEvidenceIds)
    expect(reversedCatalog.businessAnchorEvidenceIds).toEqual(firstCatalog.businessAnchorEvidenceIds)
    expect(reversedStrategy.profile.metrics).toEqual(strategy.profile.metrics)
    expect(reversedPlan.primaryRequirementIds).toEqual(firstPlan.primaryRequirementIds)
    expect(reversedPlan.scopePlans).toEqual(firstPlan.scopePlans)
    expect(reversedPlan.featuredSkillEvidenceIds).toEqual(firstPlan.featuredSkillEvidenceIds)
  })

  test('rejects a non-standalone business atom if a caller bypasses the deterministic builder', () => {
    const fixture = case3BoundaryFixture()
    const strategy = buildAdaptiveStrategy(fixture)
    const plan = buildDeterministicV5ResumePlan({ ...fixture, policy: strategy.policy, profile: strategy.profile })
    const bypassedPlan = structuredClone(plan)
    const scopePlan = bypassedPlan.scopePlans.find(item => item.scopeId === fixture.atoms.splitQuantityLeft.sourceScopeId)!
    scopePlan.selectedEvidenceIds.push(fixture.atoms.splitQuantityLeft.evidenceId)
    scopePlan.bulletBudget += 1
    bypassedPlan.stableCoreEvidenceIds.push(fixture.atoms.splitQuantityLeft.evidenceId)

    const planValidation = validateV5ResumePlan({
      ...fixture,
      plan: bypassedPlan,
      policy: strategy.policy,
      profile: strategy.profile,
      gateMode: 'relaxed_release',
    })
    expect(planValidation.issues).toContainEqual(expect.objectContaining({
      code: 'NON_STANDALONE_BUSINESS_EVIDENCE_SELECTED',
      severity: 'error',
    }))

    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: bypassedPlan })
    const artifactValidation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: bypassedPlan,
      policy: strategy.policy,
      gateMode: 'relaxed_release',
    })
    expect(artifactValidation.issues).toContainEqual(expect.objectContaining({
      code: 'BUSINESS_SCOPE_EVIDENCE_MISMATCH',
      severity: 'error',
    }))
  })

  test('requires a continuation to cross exactly one source-block boundary', () => {
    const fixture = case3BoundaryFixture()
    const left = fixture.atoms.splitQuantityLeft
    const right = fixture.atoms.splitQuantityRight
    right.sourceBlockId = left.sourceBlockId
    const sameBlockCatalog = buildEvidencePlanningCatalog(fixture.resume)

    expect(sameBlockCatalog.assessments.get(left.evidenceId)?.continuationGroupId).toBeNull()
    expect(sameBlockCatalog.assessments.get(right.evidenceId)?.continuationGroupId).toBeNull()

    right.sourceBlockId = 'B0102'
    const skippedBlockCatalog = buildEvidencePlanningCatalog(fixture.resume)

    expect(skippedBlockCatalog.assessments.get(left.evidenceId)?.continuationGroupId).toBeNull()
    expect(skippedBlockCatalog.assessments.get(right.evidenceId)?.continuationGroupId).toBeNull()
  })
})
