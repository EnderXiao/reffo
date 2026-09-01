import { describe, expect, test } from 'bun:test'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { calculateV5MatchScore } from '@/v5/match-score'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { createMatchFixture } from '@/v5/tests/fixtures'
import type { BlockingFactJudgeResult, V5ResumePlan } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import {
  measureArtifactMarkdown,
  normalizeBlockingFactJudgeResult,
  validateGeneratedResumeArtifact,
  validateV5MatchAnalysis,
  validateV5ResumePlan,
} from '@/v5/validators'

function setupPlan() {
  const fixture = createMatchFixture()
  const strategy = buildAdaptiveStrategy({ resume: fixture.resume, job: fixture.job, match: fixture.match })
  const scope = fixture.resume.timeline[0]
  const plan: V5ResumePlan = {
    schemaVersion: V5_SCHEMA_VERSION,
    strategyProfile: strategy.profile,
    generationPolicy: strategy.policy,
    targetValueProposition: fixture.match.positioning.statement,
    primaryRequirementIds: [fixture.core.requirementId, fixture.must.requirementId],
    stableCoreEvidenceIds: [fixture.deliverable.evidenceId],
    customizedEvidenceIds: [fixture.skill.evidenceId],
    evidencePillars: [
      { pillarId: 'p1', title: '产品交付', requirementIds: [fixture.core.requirementId], evidenceIds: [fixture.deliverable.evidenceId], role: 'career_anchor' },
      { pillarId: 'p2', title: 'SQL', requirementIds: [fixture.must.requirementId], evidenceIds: [fixture.skill.evidenceId], role: 'jd_primary' },
    ],
    scopePlans: [{
      scopeId: scope.scopeId,
      scopeType: scope.kind,
      treatment: 'compress',
      selectedEvidenceIds: [fixture.deliverable.evidenceId],
      bulletBudget: 1,
      rewriteAngle: '保留参与和团队边界',
    }],
    featuredSkillEvidenceIds: [fixture.skill.evidenceId],
    safeKeywordMappings: [{ requirementId: fixture.must.requirementId, evidenceIds: [fixture.skill.evidenceId], safePhrase: 'SQL' }],
    forbiddenRequirementIds: [],
    omittedHighValueEvidence: [],
    lowerBoundException: null,
  }
  return { ...fixture, ...strategy, plan }
}

describe('v5 adaptive policy, scoring and gates', () => {
  test('derives sparse source-preserving policy and service-side score', () => {
    const fixture = setupPlan()
    expect(fixture.profile.evidenceRichness).toBe('sparse')
    expect(fixture.policy.mode).toBe('preserve_sparse')
    const score = calculateV5MatchScore(fixture)
    expect(score.formulaVersion).toBe('match-score-v1')
    expect(score.label).toBe('based_on_current_material')
    expect(score.score).toBeGreaterThan(0)
  })

  test('rejects model score input drift and currently-unproven strategy leakage', () => {
    const fixture = setupPlan()
    const badMatch = structuredClone(fixture.match)
    badMatch.scoreInputs.mustHaveDirect = 0
    expect(validateV5MatchAnalysis({ resume: fixture.resume, job: fixture.job, match: badMatch }).issues.map(item => item.code)).toContain('SCORE_INPUT_MISMATCH')

    const unproven = structuredClone(fixture.match)
    unproven.requirementMatches[0].status = 'currently_unproven'
    unproven.requirementMatches[0].evidenceIds = []
    const plan = structuredClone(fixture.plan)
    expect(validateV5ResumePlan({ resume: fixture.resume, job: fixture.job, match: unproven, plan, policy: fixture.policy, profile: fixture.profile }).issues.map(item => item.code)).toContain('DIRECT_MISSING_LEAKED_TO_STRATEGY')
  })

  test('source-preserving fallback passes claim, structure and budget gates', () => {
    const fixture = setupPlan()
    expect(validateV5ResumePlan({ resume: fixture.resume, job: fixture.job, match: fixture.match, plan: fixture.plan, policy: fixture.policy, profile: fixture.profile }).passed).toBe(true)
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    expect(validation.passed).toBe(true)
  })

  test('preserves explicitly selected awards through policy, safe rendering and final gates', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const award = {
      ...structuredClone(fixture.skill),
      evidenceId: 'ev_award',
      sourceScopeId: 'awards',
      verbatimText: '年度优秀项目奖',
      normalizedClaim: '年度优秀项目奖',
      claimType: 'award' as const,
    }
    resume.evidenceAtoms.push(award)
    const strategy = buildAdaptiveStrategy({ resume, job: fixture.job, match: fixture.match })
    expect(strategy.policy.sectionOrder).toContain('awards')
    const plan = structuredClone(fixture.plan)
    plan.strategyProfile = strategy.profile
    plan.generationPolicy = strategy.policy
    plan.stableCoreEvidenceIds.push(award.evidenceId)
    const planValidation = validateV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: strategy.policy,
      profile: strategy.profile,
    })
    expect(planValidation.passed).toBe(true)
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    expect(artifact.markdown).toContain('## 荣誉奖项')
    expect(artifact.markdown).toContain('- 年度优秀项目奖')
    expect(validateGeneratedResumeArtifact({ artifact, resume, plan, policy: strategy.policy }).passed).toBe(true)
  })

  test('blocks number, attribution, causality and unauthorized entity upgrades', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const business = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    business.outputText = '- 主导团队产品迭代，交付4个功能，从而提升业务'
    artifact.markdown = artifact.markdown.replace('- 参与团队产品迭代，交付3个功能。', business.outputText)
    artifact.markdown = artifact.markdown.replace('# 张三', '# 高级产品经理')
    artifact.markdown = artifact.markdown.replace('### 甲公司', '### 假公司')
    const codes = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy }).issues.map(item => item.code)
    expect(codes).toContain('NUMBER_MISMATCH')
    expect(codes).toContain('ATTRIBUTION_UPGRADE')
    expect(codes).toContain('CAUSALITY_INVENTED')
    expect(codes).toContain('UNSUPPORTED_TIMELINE_TUPLE')
    expect(codes).toContain('HEADING_POLICY_VIOLATION')
  })

  test('rejects omit plans carrying evidence and renderer never leaks the omitted scope', () => {
    const fixture = setupPlan()
    const plan = structuredClone(fixture.plan)
    plan.scopePlans[0].treatment = 'omit'
    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: fixture.policy,
      profile: fixture.profile,
    })
    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('OMIT_WITH_BUSINESS_CLAIM')

    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan })
    expect(artifact.markdown).not.toContain(fixture.deliverable.verbatimText)
    expect(artifact.usedEvidenceIds).not.toContain(fixture.deliverable.evidenceId)
  })

  test('blocks evidence that was not assigned by the resume plan', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const unplanned = {
      ...structuredClone(fixture.deliverable),
      evidenceId: 'ev_unplanned',
      verbatimText: '参与需求梳理',
      normalizedClaim: '参与需求梳理',
      numericAtoms: [],
    }
    resume.evidenceAtoms.push(unplanned)
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    const outputText = `- ${unplanned.verbatimText}`
    artifact.markdown = artifact.markdown.replace('\n\n## 专业技能', `\n${outputText}\n\n## 专业技能`)
    artifact.claims.push({
      claimId: 'claim_unplanned',
      outputPath: `experience.${resume.timeline[0].scopeId}.bullets[1]`,
      outputText,
      evidenceIds: [unplanned.evidenceId],
      transformation: 'verbatim',
      attributionLevel: unplanned.attributionLevel,
    })
    artifact.usedEvidenceIds.push(unplanned.evidenceId)
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan: fixture.plan, policy: fixture.policy })
    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('UNPLANNED_EVIDENCE')
  })

  test('counts only work, project, research and other bullets as business content', () => {
    const stats = measureArtifactMarkdown([
      '## 工作经历',
      '### 甲公司｜产品经理｜2022 - 至今',
      '- 参与产品迭代',
      '',
      '## 专业技能',
      '- SQL',
      '- Python',
    ].join('\n'))
    expect(stats.totalListItemCount).toBe(3)
    expect(stats.businessBulletCount).toBe(1)
    expect(measureArtifactMarkdown('## 专业技能\n- SQL\n- Python').businessBulletCount).toBe(0)
  })

  test('requires each level-three heading to match one complete timeline tuple', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    resume.timeline.push({
      ...structuredClone(resume.timeline[0]),
      scopeId: 'work2',
      organization: '乙公司',
      title: '研发经理',
      start: '2020',
      end: '2021',
    })
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    artifact.markdown = artifact.markdown.replace(
      '### 甲公司｜产品经理｜2022 - 至今',
      '### 甲公司｜研发经理｜2020 - 2021'
    )
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan: fixture.plan, policy: fixture.policy })
    expect(validation.issues.map(item => item.code)).toContain('UNSUPPORTED_TIMELINE_TUPLE')
  })

  test('blocks a valid timeline heading when the body evidence belongs to another scope', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    resume.timeline.push({
      ...structuredClone(resume.timeline[0]),
      scopeId: 'work2',
      organization: '乙公司',
      title: '研发经理',
      start: '2020',
      end: '2021',
    })
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    artifact.markdown = artifact.markdown.replace(
      '### 甲公司｜产品经理｜2022 - 至今',
      '### 乙公司｜研发经理｜2020 - 2021'
    )
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan: fixture.plan, policy: fixture.policy })
    expect(validation.issues.map(item => item.code)).toContain('MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH')
  })

  test('rejects a model-authored lower-bound exception when evidence is sufficient', () => {
    const fixture = setupPlan()
    const plan = structuredClone(fixture.plan)
    plan.evidencePillars = []
    plan.lowerBoundException = '材料有限'
    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: fixture.policy,
      profile: fixture.profile,
    })
    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('LOWER_BOUND_EXCEPTION_NOT_ELIGIBLE')
    expect(validation.issues.map(item => item.code)).toContain('PRIMARY_REQUIREMENT_UNDERCOVERED')
  })

  test('does not let identical text from another scope satisfy exact evidence coverage', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const duplicate = {
      ...structuredClone(fixture.deliverable),
      evidenceId: 'ev_duplicate_other_scope',
      sourceScopeId: 'work2',
    }
    resume.evidenceAtoms.push(duplicate)
    resume.timeline.push({
      scopeId: 'work2',
      kind: 'experience',
      organization: '乙公司',
      title: '产品经理',
      start: '2020',
      end: '2021',
      evidenceIds: [duplicate.evidenceId],
    })
    const policy = { ...fixture.policy, targetBusinessBulletMin: 1 }
    const plan = structuredClone(fixture.plan)
    plan.generationPolicy = policy
    plan.scopePlans = [
      {
        ...plan.scopePlans[0],
        treatment: 'omit',
        selectedEvidenceIds: [],
        bulletBudget: 0,
      },
      {
        scopeId: 'work2',
        scopeType: 'experience',
        treatment: 'compress',
        selectedEvidenceIds: [duplicate.evidenceId],
        bulletBudget: 1,
        rewriteAngle: '保留边界',
      },
    ]
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy })
    const regression = validation.issues.find(item => item.code === 'PLAN_COVERAGE_REGRESSION')
    expect(regression).toBeDefined()
    expect(regression?.evidenceIds).toContain(fixture.deliverable.evidenceId)
  })

  test('rejects sensitive PII and treatment-kind mismatches in plans', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    resume.evidenceAtoms.find(item => item.evidenceId === fixture.deliverable.evidenceId)!.riskFlags.push('sensitive_pii')
    const piiCodes = validateV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      plan: fixture.plan,
      policy: fixture.policy,
      profile: fixture.profile,
    }).issues.map(item => item.code)
    expect(piiCodes).toContain('SENSITIVE_PII_EVIDENCE_SELECTED')

    const plan = structuredClone(fixture.plan)
    plan.scopePlans[0].treatment = 'include'
    const treatmentCodes = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: fixture.policy,
      profile: fixture.profile,
    }).issues.map(item => item.code)
    expect(treatmentCodes).toContain('SCOPE_TREATMENT_MISMATCH')
  })

  test('never downgrades blocking P09 issues from their natural-language message', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    const result: BlockingFactJudgeResult = {
      schemaVersion: V5_SCHEMA_VERSION,
      passed: false,
      auditedClaimCount: artifact.claims.length,
      issues: [{
        issueId: 'judge-1',
        severity: 'error',
        code: 'scope_migration',
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '该表述看似属于同一 scope，未明确说明 foreign scope。',
        safeRepairDirection: '阻断并核对来源',
      }],
    }
    const normalized = normalizeBlockingFactJudgeResult(result, artifact)
    expect(normalized.passed).toBe(false)
    expect(normalized.issues[0].severity).toBe('error')
    expect(normalized.issues[0].code).toBe('scope_migration')
  })

  test('fails closed when P09 references an unknown claim or evidence outside that claim', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    const baseIssue: BlockingFactJudgeResult['issues'][number] = {
      issueId: 'judge-mapping',
      severity: 'warning',
      code: 'unsupported_claim',
      claimId: claim.claimId,
      evidenceIds: ['ev_not_used_by_claim'],
      message: '引用越界',
      safeRepairDirection: '核对映射',
    }
    const result: BlockingFactJudgeResult = {
      schemaVersion: V5_SCHEMA_VERSION,
      passed: true,
      auditedClaimCount: 0,
      issues: [baseIssue, { ...baseIssue, issueId: 'judge-unknown', claimId: 'missing-claim', evidenceIds: [] }],
    }
    const normalized = normalizeBlockingFactJudgeResult(result, artifact)
    expect(normalized.passed).toBe(false)
    expect(normalized.auditedClaimCount).toBe(artifact.claims.length)
    expect(normalized.issues.every(item => item.code === 'claim_mapping_insufficient')).toBe(true)
    expect(normalized.issues.every(item => item.severity === 'error')).toBe(true)
  })
})
