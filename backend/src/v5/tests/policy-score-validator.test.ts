import { describe, expect, test } from 'bun:test'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { calculateV5MatchScore } from '@/v5/match-score'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import { createMatchFixture } from '@/v5/tests/fixtures'
import type { BlockingFactJudgeResult, V5ResumePlan } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'
import {
  buildDeterministicV5ResumePlan,
  hasRenderableTimelineLine,
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

function setupRichPlan() {
  const fixture = setupPlan()
  const resume = structuredClone(fixture.resume)
  const identityAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'identity')!
  const skillAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'skill')!
  const baseBusiness = fixture.deliverable
  const baseTimeline = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
  const claimTypes = ['result', 'deliverable', 'action', 'responsibility'] as const
  const businessAtoms = Array.from({ length: 16 }, (_, index) => {
    const scopeId = `rich_work_${Math.floor(index / 4) + 1}`
    const claimType = claimTypes[index % claimTypes.length]
    const percentage = `${index + 10}%`
    const verbatimText = claimType === 'result'
      ? `参与第${index + 1}项产品迭代并取得${percentage}的可核验阶段结果`
      : `参与第${index + 1}项产品迭代，形成与目标岗位相关的${claimType}证据`
    return {
      ...structuredClone(baseBusiness),
      evidenceId: `ev_rich_business_${String(index + 1).padStart(2, '0')}`,
      sourceBlockId: `B${String(1100 + index).padStart(4, '0')}`,
      sourceScopeId: scopeId,
      sourceSpan: { start: 0, end: verbatimText.length },
      verbatimText,
      normalizedClaim: verbatimText,
      claimType,
      numericAtoms: claimType === 'result' ? [{
        raw: percentage,
        valueText: String(index + 10),
        unit: '%',
        qualifier: null,
        period: null,
        ownerScope: scopeId,
      }] : [],
      riskFlags: [],
    }
  })
  const timelineAtoms = Array.from({ length: 4 }, (_, index) => {
    const scopeId = `rich_work_${index + 1}`
    const verbatimText = `第${index + 1}家公司｜产品经理｜202${index} - 202${index + 1}`
    return {
      ...structuredClone(baseTimeline),
      evidenceId: `ev_rich_timeline_${index + 1}`,
      sourceBlockId: `B${String(1000 + index).padStart(4, '0')}`,
      sourceScopeId: scopeId,
      sourceSpan: { start: 0, end: verbatimText.length },
      verbatimText,
      normalizedClaim: verbatimText,
      numericAtoms: [],
      riskFlags: [],
    }
  })
  resume.timeline = timelineAtoms.map((atom, index) => ({
    scopeId: atom.sourceScopeId,
    kind: 'experience' as const,
    organization: `第${index + 1}家公司`,
    title: '产品经理',
    start: `202${index}`,
    end: `202${index + 1}`,
    evidenceIds: [
      atom.evidenceId,
      ...businessAtoms.filter(item => item.sourceScopeId === atom.sourceScopeId).map(item => item.evidenceId),
    ],
  }))
  resume.evidenceAtoms = [identityAtom, skillAtom, ...timelineAtoms, ...businessAtoms]
  const match = structuredClone(fixture.match)
  match.requirementMatches[0].evidenceIds = businessAtoms.slice(0, 4).map(atom => atom.evidenceId)
  match.positioning.primaryEvidenceIds = [businessAtoms[0].evidenceId, skillAtom.evidenceId]
  const strategy = buildAdaptiveStrategy({ resume, job: fixture.job, match })
  const plan = buildDeterministicV5ResumePlan({
    resume,
    job: fixture.job,
    match,
    policy: strategy.policy,
    profile: strategy.profile,
  })
  return { ...fixture, resume, match, ...strategy, plan, businessAtoms }
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

  test('recomputes model score input drift and still blocks currently-unproven strategy leakage', () => {
    const fixture = setupPlan()
    const badMatch = structuredClone(fixture.match)
    badMatch.scoreInputs.mustHaveDirect = 0
    const scoreValidation = validateV5MatchAnalysis({ resume: fixture.resume, job: fixture.job, match: badMatch })
    expect(scoreValidation.passed).toBe(true)
    expect(scoreValidation.value?.scoreInputs.mustHaveDirect).toBe(fixture.match.scoreInputs.mustHaveDirect)
    expect(scoreValidation.issues).toContainEqual(expect.objectContaining({ code: 'SCORE_INPUT_MISMATCH', severity: 'warning' }))

    const unproven = structuredClone(fixture.match)
    unproven.requirementMatches[0].status = 'currently_unproven'
    unproven.requirementMatches[0].evidenceIds = []
    const plan = structuredClone(fixture.plan)
    expect(validateV5ResumePlan({ resume: fixture.resume, job: fixture.job, match: unproven, plan, policy: fixture.policy, profile: fixture.profile }).issues.map(item => item.code)).toContain('DIRECT_MISSING_LEAKED_TO_STRATEGY')
  })

  test('deduplicates same-status requirement matches but keeps conflicting statuses blocked', () => {
    const fixture = setupPlan()
    const sameStatus = structuredClone(fixture.match)
    sameStatus.requirementMatches.push({
      ...structuredClone(sameStatus.requirementMatches[0]),
      confidence: 'low',
      rationale: '机械重复但理由措辞不同',
    })

    const normalized = validateV5MatchAnalysis({ resume: fixture.resume, job: fixture.job, match: sameStatus })

    expect(normalized.passed).toBe(true)
    expect(normalized.value?.requirementMatches).toHaveLength(fixture.match.requirementMatches.length)
    expect(normalized.value?.requirementMatches[0].confidence).toBe('low')
    expect(normalized.issues).toContainEqual(expect.objectContaining({ code: 'REQUIREMENT_MATCHES_SERVER_DEDUPED', severity: 'warning' }))
    expect(normalized.issues.map(item => item.code)).not.toContain('REQUIREMENT_MATCH_DUPLICATE')

    const conflicting = structuredClone(fixture.match)
    conflicting.requirementMatches.push({
      ...structuredClone(conflicting.requirementMatches[0]),
      status: 'currently_unproven',
      evidenceIds: [],
      rationale: '与原状态冲突',
    })
    const blocked = validateV5MatchAnalysis({ resume: fixture.resume, job: fixture.job, match: conflicting })
    expect(blocked.passed).toBe(false)
    expect(blocked.issues.map(item => item.code)).toContain('REQUIREMENT_MATCH_DUPLICATE')
  })

  test('drops an advisory direct-missing gap when its requirements are already matched', () => {
    const fixture = setupPlan()
    const match = structuredClone(fixture.match)
    match.gaps = [{
      gapId: 'gap_invalid_direct_missing',
      evidenceType: 'direct_missing',
      requirementIds: [fixture.core.requirementId],
      evidenceIds: [fixture.deliverable.evidenceId],
      priority: 'medium',
      impact: 'medium',
      safeHandling: '不处理',
    }]

    const validation = validateV5MatchAnalysis({ resume: fixture.resume, job: fixture.job, match })

    expect(validation.passed).toBe(true)
    expect(validation.value?.gaps).toEqual([])
    expect(validation.issues.map(item => item.code)).toContain('ADVISORY_GAPS_SERVER_ALIGNED')
    expect(validation.issues.map(item => item.code)).not.toContain('DIRECT_MISSING_LEAKED_TO_STRATEGY')
  })

  test('source-preserving fallback passes claim, structure and budget gates', () => {
    const fixture = setupPlan()
    expect(validateV5ResumePlan({ resume: fixture.resume, job: fixture.job, match: fixture.match, plan: fixture.plan, policy: fixture.policy, profile: fixture.profile }).passed).toBe(true)
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    expect(validation.passed).toBe(true)
  })

  test('requires identifiable, dated and usable evidence-backed timeline lines', () => {
    const fixture = setupPlan()
    const timelineAtom = structuredClone(fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!)
    const evidence = new Map([[timelineAtom.evidenceId, timelineAtom]])
    const base = {
      ...structuredClone(fixture.resume.timeline[0]),
      organization: '甲公司',
      title: null,
      start: '2020',
      end: '2021',
      evidenceIds: [timelineAtom.evidenceId],
    }

    expect(hasRenderableTimelineLine(base, evidence)).toBe(true)
    expect(hasRenderableTimelineLine({ ...base, organization: null, title: '产品经理' }, evidence)).toBe(true)
    expect(hasRenderableTimelineLine({ ...base, organization: null, title: null }, evidence)).toBe(false)
    expect(hasRenderableTimelineLine({ ...base, start: null, end: null }, evidence)).toBe(false)
    expect(hasRenderableTimelineLine(base, new Map([
      [timelineAtom.evidenceId, { ...timelineAtom, status: 'excluded' as const }],
    ]))).toBe(false)
    expect(hasRenderableTimelineLine(base, new Map([
      [timelineAtom.evidenceId, { ...timelineAtom, riskFlags: ['sensitive_pii'] }],
    ]))).toBe(false)
  })

  test('omits a date-only unselected scope and keeps the deterministic safe-renderer contract closed', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const timelineAtom = {
      ...structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!),
      evidenceId: 'ev_date_only_timeline',
      sourceScopeId: 'work_date_only',
      verbatimText: '2020 - 2021',
      normalizedClaim: '2020 - 2021',
      numericAtoms: [],
      riskFlags: [],
    }
    resume.evidenceAtoms.push(timelineAtom)
    resume.timeline.push({
      scopeId: 'work_date_only',
      kind: 'experience',
      organization: null,
      title: null,
      start: '2020',
      end: '2021',
      evidenceIds: [timelineAtom.evidenceId],
    })

    const plan = buildDeterministicV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      policy: fixture.policy,
      profile: fixture.profile,
    })
    const dateOnlyScopePlan = plan.scopePlans.find(item => item.scopeId === 'work_date_only')!
    expect(dateOnlyScopePlan).toMatchObject({ treatment: 'omit', selectedEvidenceIds: [], bulletBudget: 0 })
    expect(validateV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: fixture.policy,
      profile: fixture.profile,
      gateMode: 'relaxed_release',
    }).passed).toBe(true)

    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const artifactValidation = validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })
    expect(artifact.markdown.split(/\r?\n/)).not.toContain('2020 - 2021')
    expect(artifactValidation.passed).toBe(true)

    const invalidPlan = structuredClone(plan)
    Object.assign(invalidPlan.scopePlans.find(item => item.scopeId === 'work_date_only')!, {
      treatment: 'timeline_line',
    })
    const invalidPlanValidation = validateV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      plan: invalidPlan,
      policy: fixture.policy,
      profile: fixture.profile,
      gateMode: 'relaxed_release',
    })
    expect(invalidPlanValidation.passed).toBe(false)
    expect(invalidPlanValidation.issues).toContainEqual(expect.objectContaining({
      code: 'TIMELINE_WITHOUT_VERIFIED_EVIDENCE',
      severity: 'error',
    }))
  })

  test('source-preserving fallback does not duplicate a source Markdown list marker', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const deliverable = resume.evidenceAtoms.find(atom => atom.evidenceId === fixture.deliverable.evidenceId)!
    deliverable.verbatimText = `- ${deliverable.verbatimText}`
    deliverable.normalizedClaim = deliverable.verbatimText

    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan: fixture.plan, policy: fixture.policy })

    expect(artifact.markdown).toContain(`- ${fixture.deliverable.verbatimText}`)
    expect(artifact.markdown).not.toContain(`- - ${fixture.deliverable.verbatimText}`)
    expect(validation.passed).toBe(true)
    expect(validation.issues.map(item => item.code)).not.toContain('TRANSFORMATION_CONTRACT_MISMATCH')
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
    const relaxedValidation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })
    const codes = relaxedValidation.issues.map(item => item.code)
    expect(relaxedValidation.passed).toBe(false)
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

  test('deterministically fills a lower-bound exception when complete evidence is insufficient', () => {
    const fixture = setupPlan()
    const policy = {
      ...fixture.policy,
      targetBusinessBulletMin: 2,
      targetBusinessBulletTarget: 2,
      targetBusinessBulletMax: 2,
    }
    const plan = {
      ...structuredClone(fixture.plan),
      generationPolicy: policy,
      lowerBoundException: null,
    }

    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy,
      profile: fixture.profile,
    })

    expect(validation.passed).toBe(true)
    expect(validation.value?.lowerBoundException).toContain('服务端确定性下限例外')
    expect(validation.value?.lowerBoundException).toContain('可用业务证据 1 条')
    expect(validation.issues.map(item => item.code)).not.toContain('PLAN_BUSINESS_BUDGET_UNDER_TARGET')
  })

  test('builds a valid deterministic plan when model planning and repair remain invalid', () => {
    const fixture = setupPlan()
    const policy = {
      ...fixture.policy,
      targetBusinessBulletMin: 2,
      targetBusinessBulletTarget: 2,
      targetBusinessBulletMax: 2,
    }
    const plan = buildDeterministicV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      policy,
      profile: fixture.profile,
    })
    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy,
      profile: fixture.profile,
    })

    expect(validation.passed).toBe(true)
    expect(validation.value?.strategyProfile).toEqual(fixture.profile)
    expect(validation.value?.generationPolicy).toEqual(policy)
    expect(validation.value?.scopePlans[0]).toMatchObject({ treatment: 'compress', bulletBudget: 1 })
    expect(validation.value?.lowerBoundException).toContain('服务端确定性下限例外')
    expect(validation.value?.evidencePillars.every(pillar => pillar.requirementIds.length === 1)).toBe(true)
  })

  test('uses the quality target, high-value evidence and multiple scopes for a rich resume', () => {
    const fixture = setupRichPlan()
    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan: fixture.plan,
      policy: fixture.policy,
      profile: fixture.profile,
    })
    const selectedBusiness = fixture.plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds)
    const selectedTypes = new Set(fixture.resume.evidenceAtoms
      .filter(atom => selectedBusiness.includes(atom.evidenceId))
      .map(atom => atom.claimType))
    const selectedScopes = fixture.plan.scopePlans.filter(scope => scope.bulletBudget > 0)
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const artifactValidation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
    })

    expect(fixture.profile.evidenceRichness).toBe('rich')
    expect(fixture.plan.scopePlans.reduce((sum, scope) => sum + scope.bulletBudget, 0))
      .toBe(fixture.policy.targetBusinessBulletTarget)
    expect(selectedScopes).toHaveLength(4)
    expect(selectedTypes).toContain('result')
    expect(selectedTypes).toContain('deliverable')
    expect(validation.passed).toBe(true)
    expect(artifact.renderStats.businessBulletCount).toBe(fixture.policy.targetBusinessBulletTarget)
    expect(artifact.omittedPlannedEvidenceIds).toEqual([])
    expect(artifactValidation.passed).toBe(true)

    const reversedResume = { ...fixture.resume, evidenceAtoms: [...fixture.resume.evidenceAtoms].reverse() }
    const reversedPlan = buildDeterministicV5ResumePlan({
      resume: reversedResume,
      job: fixture.job,
      match: fixture.match,
      policy: fixture.policy,
      profile: fixture.profile,
    })
    expect(reversedPlan.scopePlans.map(scope => ({
      scopeId: scope.scopeId,
      selectedEvidenceIds: [...scope.selectedEvidenceIds].sort(),
      bulletBudget: scope.bulletBudget,
    }))).toEqual(fixture.plan.scopePlans.map(scope => ({
      scopeId: scope.scopeId,
      selectedEvidenceIds: [...scope.selectedEvidenceIds].sort(),
      bulletBudget: scope.bulletBudget,
    })))
  })

  test('treats the plan target as advisory while preserving the hard minimum', () => {
    const fixture = setupRichPlan()
    const policy = {
      ...fixture.policy,
      targetBusinessBulletTarget: fixture.policy.targetBusinessBulletTarget + 1,
      targetBusinessBulletMax: fixture.policy.targetBusinessBulletMax + 1,
    }
    const plan = {
      ...structuredClone(fixture.plan),
      generationPolicy: policy,
    }
    const input = {
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy,
      profile: fixture.profile,
    }

    const strict = validateV5ResumePlan(input)
    const relaxed = validateV5ResumePlan({ ...input, gateMode: 'relaxed_release' })

    expect(strict.passed).toBe(false)
    expect(strict.issues.map(item => item.code)).toContain('PLAN_QUALITY_UNDER_TARGET')
    expect(relaxed.passed).toBe(true)
    expect(relaxed.issues).toContainEqual(expect.objectContaining({
      code: 'PLAN_QUALITY_UNDER_TARGET',
      severity: 'warning',
    }))
  })

  test('caps project-led quality targets and deterministic selection at the hard project limit', () => {
    const fixture = setupRichPlan()
    const resume = {
      ...fixture.resume,
      timeline: fixture.resume.timeline.map(item => ({ ...item, kind: 'project' as const })),
    }
    const strategy = buildAdaptiveStrategy({ resume, job: fixture.job, match: fixture.match })
    const plan = buildDeterministicV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      policy: strategy.policy,
      profile: strategy.profile,
    })
    const validation = validateV5ResumePlan({
      resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: strategy.policy,
      profile: strategy.profile,
    })
    const includedProjects = plan.scopePlans.filter(item => item.treatment === 'include')

    expect(strategy.policy.targetBusinessBulletTarget).toBe(8)
    expect(includedProjects).toHaveLength(strategy.policy.hardProjectMax)
    expect(plan.scopePlans.reduce((sum, item) => sum + item.bulletBudget, 0))
      .toBe(strategy.policy.targetBusinessBulletTarget)
    expect(validation.passed).toBe(true)
  })

  test('blocks an artifact that silently drops planned evidence', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const skillClaim = artifact.claims.find(claim => claim.outputPath.startsWith('skills'))!
    artifact.markdown = artifact.markdown.replace(skillClaim.outputText, '')
    artifact.claims = artifact.claims.filter(claim => claim.claimId !== skillClaim.claimId)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('PLANNED_EVIDENCE_OMITTED')

    const relaxed = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })
    expect(relaxed.passed).toBe(true)
    expect(relaxed.issues).toContainEqual(expect.objectContaining({
      code: 'PLANNED_EVIDENCE_OMITTED',
      severity: 'warning',
    }))
  })

  test('keeps the minimum business-content floor blocking in relaxed release mode', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const businessClaims = artifact.claims.filter(claim => claim.outputPath.includes('bullets'))
    for (const claim of businessClaims) {
      artifact.markdown = artifact.markdown.replace(`${claim.outputText}\n`, '')
    }
    artifact.claims = artifact.claims.filter(claim => !businessClaims.includes(claim))

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'MINIMUM_BUSINESS_CONTENT_MISSING',
      severity: 'error',
    }))
  })

  test('blocks an artifact that drops a planned timeline-only experience', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const timelineAtom = structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!)
    timelineAtom.evidenceId = 'ev_timeline_only'
    timelineAtom.sourceScopeId = 'work_timeline_only'
    timelineAtom.verbatimText = '乙公司｜产品助理｜2020 - 2021'
    timelineAtom.normalizedClaim = timelineAtom.verbatimText
    resume.evidenceAtoms.push(timelineAtom)
    resume.timeline.push({
      scopeId: 'work_timeline_only',
      kind: 'experience',
      organization: '乙公司',
      title: '产品助理',
      start: '2020',
      end: '2021',
      evidenceIds: [timelineAtom.evidenceId],
    })
    plan.scopePlans.push({
      scopeId: 'work_timeline_only',
      scopeType: 'experience',
      treatment: 'timeline_line',
      selectedEvidenceIds: [],
      bulletBudget: 0,
      rewriteAngle: '保留时间线',
    })
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const timelineClaim = artifact.claims.find(claim => claim.outputPath === 'timeline.work_timeline_only')!
    artifact.markdown = artifact.markdown.replace(`${timelineClaim.outputText}\n`, '')
    artifact.claims = artifact.claims.filter(claim => claim.claimId !== timelineClaim.claimId)

    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy: fixture.policy })

    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('PLANNED_TIMELINE_MISSING')
  })

  test('normalizes unambiguous artifact claim markers, unsupported headings and render stats', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const originalHeading = '### 甲公司｜产品经理｜2022 - 至今'
    artifact.markdown = artifact.markdown.replace(originalHeading, '### 甲公司 / 产品经理 / 2022-至今')
    artifact.claims = artifact.claims.map(claim => ({
      ...claim,
      outputText: claim.outputText.replace(/^[-*+]\s+/, ''),
    }))
    artifact.renderStats = { businessBulletCount: 0, totalListItemCount: 0, projectCount: 0, cjkCharacterCount: 0, wordCount: 0 }

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.value?.markdown).toContain(originalHeading)
    expect(validation.value?.claims.some(claim => claim.outputText.startsWith('- '))).toBe(true)
    expect(validation.value?.renderStats).toEqual(measureArtifactMarkdown(validation.value!.markdown))
    expect(validation.issues.map(item => item.code)).not.toContain('CLAIM_TEXT_NOT_FOUND')
    expect(validation.issues.map(item => item.code)).not.toContain('UNSUPPORTED_TIMELINE_TUPLE')
  })

  test('prunes empty scope headings and realigns false verbatim metadata without changing facts', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    const paraphrase = `${claim.outputText.replace(/[。；]$/, '')}；`
    artifact.markdown = artifact.markdown
      .replace(claim.outputText, paraphrase)
      .concat('\n\n## 项目经历\n\n### 不应保留的空标题\n')
    claim.outputText = paraphrase
    claim.transformation = 'verbatim'

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.value?.markdown).not.toContain('不应保留的空标题')
    expect(validation.value?.markdown).not.toContain('## 项目经历')
    expect(validation.value?.markdown).toContain(paraphrase)
    expect(validation.value?.claims.find(item => item.claimId === claim.claimId)?.transformation).toBe('safe_paraphrase')
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'EMPTY_STRUCTURE_SERVER_PRUNED', severity: 'warning' }))
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'TRANSFORMATION_METADATA_SERVER_ALIGNED', severity: 'warning' }))
    expect(validation.issues.map(item => item.code)).not.toContain('TRANSFORMATION_CONTRACT_MISMATCH')
  })

  test('recomputes artifact evidence summary sets from claims and the plan', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    artifact.usedEvidenceIds = []
    artifact.omittedPlannedEvidenceIds = [...fixture.plan.scopePlans[0].selectedEvidenceIds]

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    const expectedUsed = [...new Set(validation.value!.claims.flatMap(claim => claim.evidenceIds))]
    const plannedBody = [
      ...fixture.plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds),
      ...fixture.plan.featuredSkillEvidenceIds,
    ]

    expect(validation.passed).toBe(true)
    expect(validation.value?.usedEvidenceIds).toEqual(expectedUsed)
    expect(validation.value?.omittedPlannedEvidenceIds).toEqual(plannedBody.filter(id => !expectedUsed.includes(id)))
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'ARTIFACT_EVIDENCE_SETS_SERVER_ALIGNED', severity: 'warning' }))
    expect(validation.issues.map(item => item.code)).not.toContain('USED_EVIDENCE_SET_MISMATCH')
    expect(validation.issues.map(item => item.code)).not.toContain('OMITTED_PLANNED_SET_MISMATCH')
  })

  test('normalizes timeline metadata and redundant claims but blocks timeline output for a body scope', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const timelineAtom = fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const businessClaim = artifact.claims.find(claim => claim.outputPath.includes('bullets'))!
    const timelineText = '甲公司｜产品经理｜2022 - 至今'
    artifact.markdown = artifact.markdown
      .replace('## 工作经历\n\n', `## 工作经历\n\n${timelineText}\n`)
      .concat(`\n* ${fixture.deliverable.verbatimText}`)
    artifact.claims.push({
      claimId: 'claim_nested_timeline',
      outputPath: 'experience.work1.timeline',
      outputText: timelineText,
      evidenceIds: [timelineAtom.evidenceId, fixture.deliverable.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    }, {
      claimId: 'claim_stale_timeline',
      outputPath: 'experience.work1.timeline',
      outputText: '不存在的旧时间线',
      evidenceIds: [timelineAtom.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    }, {
      ...structuredClone(businessClaim),
      claimId: 'claim_redundant_business',
      outputText: `* ${fixture.deliverable.verbatimText}`,
    })

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    const timelineClaim = validation.value?.claims.find(claim => claim.claimId === 'claim_nested_timeline')

    expect(validation.passed).toBe(false)
    expect(timelineClaim?.evidenceIds).toEqual([timelineAtom.evidenceId])
    expect(validation.value?.claims.some(claim => claim.claimId === 'claim_stale_timeline')).toBe(false)
    expect(validation.value?.claims.some(claim => claim.claimId === 'claim_redundant_business')).toBe(false)
    expect(validation.value?.markdown).not.toContain(`* ${fixture.deliverable.verbatimText}`)
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'TIMELINE_EVIDENCE_SERVER_ALIGNED', severity: 'warning' }))
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'STALE_TIMELINE_CLAIM_SERVER_PRUNED', severity: 'warning' }))
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'REDUNDANT_BUSINESS_CLAIM_SERVER_PRUNED', severity: 'warning' }))
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPLANNED_TIMELINE_CLAIM',
      severity: 'error',
      claimId: 'claim_nested_timeline',
    }))
    expect(validation.issues.map(item => item.code)).not.toContain('UNPLANNED_EVIDENCE')
    expect(validation.issues.map(item => item.code)).not.toContain('DUPLICATE_EVIDENCE_USE')
  })

  test('blocks an independent timeline claim when its scope is planned as body content', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const timelineAtom = fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const unplannedTimelineText = '甲公司｜资深产品总监'
    artifact.markdown = `${artifact.markdown}\n${unplannedTimelineText}`
    artifact.claims.push({
      claimId: 'claim_unplanned_timeline_for_body_scope',
      outputPath: `timeline.${fixture.resume.timeline[0].scopeId}`,
      outputText: unplannedTimelineText,
      evidenceIds: [timelineAtom.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    })

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPLANNED_TIMELINE_CLAIM',
      severity: 'error',
      claimId: 'claim_unplanned_timeline_for_body_scope',
    }))
  })

  test('detects an omitted scope timeline claim by evidence even when its path is nested', () => {
    const fixture = setupPlan()
    const plan = structuredClone(fixture.plan)
    Object.assign(plan.scopePlans[0], {
      treatment: 'omit',
      selectedEvidenceIds: [],
      bulletBudget: 0,
    })
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan })
    const timelineAtom = fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const timelineText = '甲公司｜产品经理｜2022 - 至今'
    artifact.markdown = `${artifact.markdown}\n## 工作经历\n\n${timelineText}`
    artifact.claims.push({
      claimId: 'claim_nested_omitted_timeline',
      outputPath: `experience.${fixture.resume.timeline[0].scopeId}.timeline`,
      outputText: timelineText,
      evidenceIds: [timelineAtom.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    })

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPLANNED_TIMELINE_CLAIM',
      severity: 'error',
      claimId: 'claim_nested_omitted_timeline',
    }))
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'PLANNED_OMIT_SCOPE_RENDERED',
      severity: 'warning',
      outputPath: `scope.${fixture.resume.timeline[0].scopeId}`,
    }))
  })

  test('keeps a retained timeline line when pruning a duplicate business claim on the same physical line', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const timeline = fixture.resume.timeline[0]
    const timelineText = [
      timeline.organization,
      timeline.title,
      [timeline.start, timeline.end].filter(Boolean).join(' - '),
    ].filter(Boolean).join('｜')
    const timelineAtoms = fixture.resume.evidenceAtoms.filter(atom => (
      atom.sourceScopeId === timeline.scopeId && atom.claimType === 'timeline'
    ))
    const businessClaim = artifact.claims.find(claim => claim.outputPath.includes('bullets'))!
    artifact.markdown = artifact.markdown.replace('## 工作经历\n\n', `## 工作经历\n\n${timelineText}\n`)
    artifact.claims.push({
      claimId: 'claim_retained_timeline_line',
      outputPath: `timeline.${timeline.scopeId}`,
      outputText: timelineText,
      evidenceIds: timelineAtoms.map(atom => atom.evidenceId),
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    }, {
      ...structuredClone(businessClaim),
      claimId: 'claim_duplicate_business_on_timeline_line',
      outputText: timelineText,
    })

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(false)
    expect(validation.value?.claims.some(claim => claim.claimId === 'claim_retained_timeline_line')).toBe(true)
    expect(validation.value?.claims.some(claim => claim.claimId === 'claim_duplicate_business_on_timeline_line')).toBe(false)
    expect(validation.value?.markdown.split(/\r?\n/).filter(line => line.trim() === timelineText)).toHaveLength(1)
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'REDUNDANT_BUSINESS_CLAIM_SERVER_PRUNED', severity: 'warning' }))
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPLANNED_TIMELINE_CLAIM',
      severity: 'error',
      claimId: 'claim_retained_timeline_line',
    }))
    expect(validation.issues.map(item => item.code)).not.toContain('CLAIM_TEXT_NOT_FOUND')
  })

  test('folds a split heading date into the canonical timeline heading and removes its structural claim', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const canonicalHeading = '### 甲公司｜产品经理｜2022 - 至今'
    artifact.markdown = artifact.markdown.replace(canonicalHeading, '### 甲公司｜产品经理\n\n2022 - 至今')
    const timelineAtom = fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    artifact.claims.push({
      claimId: 'claim_split_heading_date',
      outputPath: 'experience.work1.heading',
      outputText: '2022 - 至今',
      evidenceIds: [timelineAtom.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    })

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.value?.markdown).toContain(canonicalHeading)
    expect(validation.value?.markdown.split(/\r?\n/)).not.toContain('2022 - 至今')
    expect(validation.value?.claims.some(claim => claim.claimId === 'claim_split_heading_date')).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'STRUCTURAL_HEADING_CLAIM_SERVER_PRUNED', severity: 'warning' }))
    expect(validation.issues.map(item => item.code)).not.toContain('NUMBER_MISMATCH')
    expect(validation.issues.map(item => item.code)).not.toContain('UNMAPPED_OUTPUT_CLAIM')
  })

  test('does not prune a separate planned timeline line after an already canonical heading', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const timelineAtom = {
      ...structuredClone(resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!),
      evidenceId: 'ev_separate_date_timeline',
      sourceScopeId: 'work_separate_date',
      verbatimText: '2020 - 2021',
      normalizedClaim: '2020 - 2021',
      numericAtoms: [],
      riskFlags: [],
    }
    resume.evidenceAtoms.push(timelineAtom)
    resume.timeline.push({
      scopeId: 'work_separate_date',
      kind: 'experience',
      organization: null,
      title: null,
      start: '2020',
      end: '2021',
      evidenceIds: [timelineAtom.evidenceId],
    })
    plan.scopePlans.push({
      scopeId: 'work_separate_date',
      scopeType: 'experience',
      treatment: 'timeline_line',
      selectedEvidenceIds: [],
      bulletBudget: 0,
      rewriteAngle: '仅用于规范化边界回归',
    })
    const businessClaim = artifact.claims.find(claim => claim.outputPath.includes('bullets'))!
    artifact.markdown = artifact.markdown.replace(
      businessClaim.outputText,
      `${businessClaim.outputText}\n${timelineAtom.verbatimText}`
    )
    artifact.claims.push({
      claimId: 'claim_separate_date_timeline',
      outputPath: 'timeline.work_separate_date',
      outputText: timelineAtom.verbatimText,
      evidenceIds: [timelineAtom.evidenceId],
      transformation: 'verbatim',
      attributionLevel: 'unspecified',
    })
    artifact.usedEvidenceIds.push(timelineAtom.evidenceId)
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.value?.markdown.split(/\r?\n/)).toContain(timelineAtom.verbatimText)
    expect(validation.value?.claims).toContainEqual(expect.objectContaining({
      claimId: 'claim_separate_date_timeline',
      outputPath: 'timeline.work_separate_date',
    }))
    expect(validation.issues.map(item => item.code)).not.toContain('STRUCTURAL_HEADING_CLAIM_SERVER_PRUNED')
    expect(validation.issues.map(item => item.code)).not.toContain('PLANNED_TIMELINE_MISSING')
  })

  test('canonicalizes repeated date-only timeline claims into unique scoped timeline lines', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const baseTimelineAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    for (const [scopeId, organization] of [['work2', '乙公司'], ['work3', '丙公司']] as const) {
      const timelineAtom = {
        ...structuredClone(baseTimelineAtom),
        evidenceId: `ev_timeline_${scopeId}`,
        sourceScopeId: scopeId,
        verbatimText: `${organization}｜产品经理｜2022-至今`,
        normalizedClaim: `${organization}｜产品经理｜2022-至今`,
      }
      resume.evidenceAtoms.push(timelineAtom)
      resume.timeline.push({
        scopeId,
        kind: 'experience',
        organization,
        title: '产品经理',
        start: '2022',
        end: '至今',
        evidenceIds: [timelineAtom.evidenceId],
      })
      plan.scopePlans.push({
        scopeId,
        scopeType: 'experience',
        treatment: 'timeline_line',
        selectedEvidenceIds: [],
        bulletBudget: 0,
        rewriteAngle: '只保留时间线',
      })
    }
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    for (const scopeId of ['work2', 'work3']) {
      const claim = artifact.claims.find(item => item.outputPath === `timeline.${scopeId}`)!
      artifact.markdown = artifact.markdown.replace(claim.outputText, '2022 - 至今')
      claim.outputPath = `experience.${scopeId}.timeline`
      claim.outputText = '2022 - 至今'
    }

    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.value?.markdown).toContain('乙公司｜产品经理｜2022 - 至今')
    expect(validation.value?.markdown).toContain('丙公司｜产品经理｜2022 - 至今')
    expect(validation.value?.markdown.split(/\r?\n/)).not.toContain('2022 - 至今')
    expect(validation.value?.claims.find(item => item.outputPath === 'timeline.work2')?.outputText).toBe('乙公司｜产品经理｜2022 - 至今')
    expect(validation.value?.claims.find(item => item.outputPath === 'timeline.work3')?.outputText).toBe('丙公司｜产品经理｜2022 - 至今')
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: 'TIMELINE_CLAIMS_SERVER_CANONICALIZED', severity: 'warning' }))
    expect(validation.issues.map(item => item.code)).not.toContain('CLAIM_TEXT_AMBIGUOUS')
    expect(validation.issues.map(item => item.code)).not.toContain('UNSUPPORTED_TIMELINE_TUPLE')

    const timelineClaim = validation.value!.claims.find(item => item.outputPath === 'timeline.work2')!
    const judge = normalizeBlockingFactJudgeResult({
      schemaVersion: V5_SCHEMA_VERSION,
      passed: false,
      auditedClaimCount: validation.value!.claims.length,
      issues: [{
        issueId: 'judge-canonical-timeline',
        severity: 'error',
        code: 'number_or_qualifier_change',
        claimId: timelineClaim.claimId,
        evidenceIds: timelineClaim.evidenceIds,
        message: '日期格式误报。',
        safeRepairDirection: '核对时间线。',
      }],
    }, validation.value!, resume)
    expect(judge.passed).toBe(true)
    expect(judge.issues[0].severity).toBe('warning')
  })

  test('keeps a body heading when a separate timeline line has identical canonical metadata', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const bodyTimeline = resume.timeline[0]
    const baseTimelineAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const timelineOnlyAtom = {
      ...structuredClone(baseTimelineAtom),
      evidenceId: 'ev_identical_timeline_only',
      sourceScopeId: 'work_identical_timeline_only',
    }
    resume.evidenceAtoms.push(timelineOnlyAtom)
    resume.timeline.push({
      ...structuredClone(bodyTimeline),
      scopeId: timelineOnlyAtom.sourceScopeId,
      evidenceIds: [timelineOnlyAtom.evidenceId],
    })
    plan.scopePlans.push({
      scopeId: timelineOnlyAtom.sourceScopeId,
      scopeType: bodyTimeline.kind,
      treatment: 'timeline_line',
      selectedEvidenceIds: [],
      bulletBudget: 0,
      rewriteAngle: '仅保留可验证时间线',
    })

    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const timelineText = '甲公司｜产品经理｜2022 - 至今'
    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.value?.markdown.split(/\r?\n/).filter(line => line === `### ${timelineText}`)).toHaveLength(1)
    expect(validation.value?.markdown.split(/\r?\n/).filter(line => line === timelineText)).toHaveLength(1)
    expect(validation.issues.map(item => item.code)).not.toContain('MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH')
    expect(validation.issues.map(item => item.code)).not.toContain('PLANNED_TIMELINE_MISSING')
  })

  test('treats Markdown identity markers and skill labels as presentation-only verbatim differences', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const identity = fixture.resume.evidenceAtoms.find(atom => atom.claimType === 'identity')!
    const skillClaim = artifact.claims.find(claim => claim.outputPath.startsWith('skills'))!
    artifact.markdown = artifact.markdown.replace(skillClaim.outputText, '- SQL')
    skillClaim.outputText = '- SQL'
    artifact.claims.unshift({
      claimId: 'claim_identity_name',
      outputPath: 'identity.name',
      outputText: '# 张三',
      evidenceIds: [identity.evidenceId],
      transformation: 'verbatim',
      attributionLevel: identity.attributionLevel,
    })
    artifact.usedEvidenceIds = [...new Set(artifact.claims.flatMap(claim => claim.evidenceIds))]

    const validation = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.issues.map(item => item.code)).not.toContain('TRANSFORMATION_CONTRACT_MISMATCH')
  })

  test('requires cross-scope summaries to remain locally source-provable', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const summaryText = '参与团队产品迭代并具备 SQL 能力。'
    artifact.markdown = artifact.markdown.replace('\n\n## 工作经历', `\n\n## 个人摘要\n${summaryText}\n\n## 工作经历`)
    artifact.claims.push({
      claimId: 'claim_summary',
      outputPath: 'summary',
      outputText: summaryText,
      evidenceIds: [fixture.deliverable.evidenceId, fixture.skill.evidenceId],
      transformation: 'safe_paraphrase',
      attributionLevel: 'unspecified',
    })
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const unprovable = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    expect(unprovable.passed).toBe(false)
    expect(unprovable.issues.map(item => item.code)).toContain('UNPROVABLE_CLAIM_TEXT')
    expect(unprovable.issues.map(item => item.code)).not.toContain('SCOPE_MIGRATION')

    artifact.claims.at(-1)!.transformation = 'same_scope_merge'
    const rejected = validateGeneratedResumeArtifact({ artifact, resume: fixture.resume, plan: fixture.plan, policy: fixture.policy })
    expect(rejected.issues.map(item => item.code)).toContain('SCOPE_MIGRATION')
  })

  test('blocks arbitrary prose hidden behind a valid evidenceId without calling a fact judge', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    artifact.markdown = artifact.markdown.replace(claim.outputText, '- 参与制定从未在源简历出现的产品路线图')
    claim.outputText = '- 参与制定从未在源简历出现的产品路线图'
    claim.transformation = 'safe_paraphrase'
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume: fixture.resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPROVABLE_CLAIM_TEXT',
      severity: 'error',
    }))
  })

  test('blocks delimiter-free multi-atom text when canonical adjacency is not proven', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const first = resume.evidenceAtoms.find(item => item.evidenceId === fixture.deliverable.evidenceId)!
    first.sourceBlockId = 'B0100'
    first.sourceSpan = { start: 100, end: 106 }
    first.verbatimText = '形成产品方案'
    first.normalizedClaim = first.verbatimText
    const second = {
      ...structuredClone(first),
      evidenceId: 'ev_non_adjacent_merge',
      sourceBlockId: 'B0102',
      sourceSpan: { start: 107, end: 113 },
      verbatimText: '推动团队协作',
      normalizedClaim: '推动团队协作',
    }
    resume.evidenceAtoms.push(second)
    resume.timeline[0].evidenceIds.push(second.evidenceId)
    plan.scopePlans[0].selectedEvidenceIds.push(second.evidenceId)
    plan.scopePlans[0].bulletBudget = 1

    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const claim = artifact.claims.find(item => item.evidenceIds.includes(second.evidenceId))!
    const delimiterFree = claim.outputText.replace(/[；;]/g, '')
    artifact.markdown = artifact.markdown.replace(claim.outputText, delimiterFree)
    claim.outputText = delimiterFree
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPROVABLE_CLAIM_TEXT',
      severity: 'error',
    }))
  })

  test('blocks a negation reversal hidden inside a contiguous source substring', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const sourceAtom = resume.evidenceAtoms.find(item => item.evidenceId === fixture.deliverable.evidenceId)!
    sourceAtom.verbatimText = '从未负责产品路线图'
    sourceAtom.normalizedClaim = sourceAtom.verbatimText
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    artifact.markdown = artifact.markdown.replace(claim.outputText, '- 负责产品路线图')
    claim.outputText = '- 负责产品路线图'
    claim.transformation = 'safe_paraphrase'
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPROVABLE_CLAIM_TEXT',
      severity: 'error',
    }))
  })

  test('preserves semantic numeric symbols in local source proof', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const sourceAtom = resume.evidenceAtoms.find(item => item.evidenceId === fixture.deliverable.evidenceId)!
    sourceAtom.verbatimText = '触达400+用户'
    sourceAtom.normalizedClaim = sourceAtom.verbatimText
    sourceAtom.numericAtoms = [{
      raw: '400',
      valueText: '400',
      unit: null,
      qualifier: null,
      period: null,
      ownerScope: sourceAtom.sourceScopeId,
    }]
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    artifact.markdown = artifact.markdown.replace(claim.outputText, '- 触达400用户')
    claim.outputText = '- 触达400用户'
    claim.transformation = 'safe_paraphrase'
    artifact.renderStats = measureArtifactMarkdown(artifact.markdown)

    const validation = validateGeneratedResumeArtifact({
      artifact,
      resume,
      plan: fixture.plan,
      policy: fixture.policy,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'UNPROVABLE_CLAIM_TEXT',
      severity: 'error',
    }))
  })

  test('does not treat source-supported Prompt engineering as an internal leak', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const atom = resume.evidenceAtoms.find(item => item.evidenceId === fixture.deliverable.evidenceId)!
    atom.verbatimText = '参与 Prompt 工程与模型评测'
    atom.normalizedClaim = atom.verbatimText
    const artifact = renderSourcePreservingArtifact({ resume, plan: fixture.plan })

    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan: fixture.plan, policy: fixture.policy })

    expect(validation.passed).toBe(true)
    expect(validation.issues.map(item => item.code)).not.toContain('INTERNAL_AUDIT_LEAK')
  })

  test('maps identical source-supported bullets to their own scopes deterministically', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const timelineAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const duplicateBusiness = {
      ...structuredClone(fixture.deliverable),
      evidenceId: 'ev_duplicate_business_scope',
      sourceScopeId: 'work2',
      sourceBlockId: 'B9001',
    }
    const duplicateTimeline = {
      ...structuredClone(timelineAtom),
      evidenceId: 'ev_duplicate_timeline_scope',
      sourceScopeId: 'work2',
      sourceBlockId: 'B9000',
      verbatimText: '乙公司｜产品经理｜2021 - 2022',
      normalizedClaim: '乙公司 产品经理 2021 - 2022',
    }
    resume.evidenceAtoms.push(duplicateTimeline, duplicateBusiness)
    resume.timeline.push({
      scopeId: 'work2',
      kind: 'experience',
      organization: '乙公司',
      title: '产品经理',
      start: '2021',
      end: '2022',
      evidenceIds: [duplicateTimeline.evidenceId, duplicateBusiness.evidenceId],
    })
    plan.stableCoreEvidenceIds.push(duplicateBusiness.evidenceId)
    plan.scopePlans.push({
      scopeId: 'work2',
      scopeType: 'experience',
      treatment: 'compress',
      selectedEvidenceIds: [duplicateBusiness.evidenceId],
      bulletBudget: 1,
      rewriteAngle: '逐字保留',
    })
    const artifact = renderSourcePreservingArtifact({ resume, plan })

    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy: fixture.policy })

    expect(artifact.markdown.match(/参与团队产品迭代，交付3个功能/g)).toHaveLength(2)
    expect(validation.passed).toBe(true)
    expect(validation.issues.map(item => item.code)).not.toContain('CLAIM_TEXT_AMBIGUOUS')
    expect(validation.issues.map(item => item.code)).not.toContain('MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH')
  })

  test('maps identical headings and bullets by their deterministic scope order', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const plan = structuredClone(fixture.plan)
    const timelineAtom = resume.evidenceAtoms.find(atom => atom.claimType === 'timeline')!
    const duplicateBusiness = {
      ...structuredClone(fixture.deliverable),
      evidenceId: 'ev_duplicate_business_same_heading',
      sourceScopeId: 'work2',
      sourceBlockId: 'B9001',
    }
    const duplicateTimeline = {
      ...structuredClone(timelineAtom),
      evidenceId: 'ev_duplicate_timeline_same_heading',
      sourceScopeId: 'work2',
      sourceBlockId: 'B9000',
    }
    resume.evidenceAtoms.push(duplicateTimeline, duplicateBusiness)
    resume.timeline.push({
      ...structuredClone(resume.timeline[0]),
      scopeId: 'work2',
      evidenceIds: [duplicateTimeline.evidenceId, duplicateBusiness.evidenceId],
    })
    plan.stableCoreEvidenceIds.push(duplicateBusiness.evidenceId)
    plan.scopePlans.push({
      ...structuredClone(plan.scopePlans[0]),
      scopeId: 'work2',
      selectedEvidenceIds: [duplicateBusiness.evidenceId],
    })
    const artifact = renderSourcePreservingArtifact({ resume, plan })

    const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy: fixture.policy })

    expect(artifact.markdown.match(/### 甲公司｜产品经理｜2022 - 至今/g)).toHaveLength(2)
    expect(validation.passed).toBe(true)
    expect(validation.issues.map(item => item.code)).not.toContain('CLAIM_TEXT_AMBIGUOUS')
    expect(validation.issues.map(item => item.code)).not.toContain('MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH')
  })

  test('rejects skill evidence used as a business scope bullet', () => {
    const fixture = setupPlan()
    const plan = structuredClone(fixture.plan)
    plan.scopePlans[0].selectedEvidenceIds = [fixture.skill.evidenceId]
    plan.stableCoreEvidenceIds = []
    plan.customizedEvidenceIds = [fixture.skill.evidenceId]

    const validation = validateV5ResumePlan({
      resume: fixture.resume,
      job: fixture.job,
      match: fixture.match,
      plan,
      policy: fixture.policy,
      profile: fixture.profile,
      gateMode: 'relaxed_release',
    })

    expect(validation.passed).toBe(false)
    expect(validation.issues.map(item => item.code)).toContain('SCOPE_NON_BUSINESS_EVIDENCE')
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

  test('rejects P09 fact errors contradicted by exact same-scope source-preserving proof', () => {
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
    const normalized = normalizeBlockingFactJudgeResult(result, artifact, fixture.resume)
    expect(normalized.passed).toBe(true)
    expect(normalized.issues[0].severity).toBe('warning')
    expect(normalized.issues[0].code).toBe('scope_migration')

    const numeric = normalizeBlockingFactJudgeResult({
      ...result,
      issues: [{ ...result.issues[0], code: 'number_or_qualifier_change' }],
    }, artifact, fixture.resume)
    expect(numeric.passed).toBe(true)
    expect(numeric.issues[0].severity).toBe('warning')
  })

  test('treats indented Markdown list markers as presentation-only in same-scope merge proof', () => {
    const fixture = setupPlan()
    const resume = structuredClone(fixture.resume)
    const first = resume.evidenceAtoms.find(atom => atom.evidenceId === fixture.deliverable.evidenceId)!
    first.verbatimText = `  - ${first.verbatimText}`
    first.normalizedClaim = first.verbatimText
    const second = {
      ...structuredClone(first),
      evidenceId: 'ev_same_scope_indented_marker',
    }
    resume.evidenceAtoms.push(second)
    const plan = structuredClone(fixture.plan)
    plan.scopePlans[0].selectedEvidenceIds.push(second.evidenceId)
    const artifact = renderSourcePreservingArtifact({ resume, plan })
    const claim = artifact.claims.find(item => item.transformation === 'same_scope_merge')!
    const result: BlockingFactJudgeResult = {
      schemaVersion: V5_SCHEMA_VERSION,
      passed: false,
      auditedClaimCount: artifact.claims.length,
      issues: [{
        issueId: 'judge-indented-list-marker',
        severity: 'error',
        code: 'number_or_qualifier_change',
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '列表符被误判为事实变化。',
        safeRepairDirection: '核对 Markdown 排版。',
      }],
    }

    const normalized = normalizeBlockingFactJudgeResult(result, artifact, resume)

    expect(claim.outputText).not.toContain('  - ')
    expect(normalized.passed).toBe(true)
    expect(normalized.issues[0].severity).toBe('warning')
  })

  test('keeps P09 fact errors blocking when the claim is not exact source-preserving text', () => {
    const fixture = setupPlan()
    const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan: fixture.plan })
    const claim = artifact.claims.find(item => item.outputPath.includes('bullets'))!
    claim.transformation = 'safe_paraphrase'
    claim.outputText = `${claim.outputText}并主导交付`
    const result: BlockingFactJudgeResult = {
      schemaVersion: V5_SCHEMA_VERSION,
      passed: false,
      auditedClaimCount: artifact.claims.length,
      issues: [{
        issueId: 'judge-real-change',
        severity: 'error',
        code: 'attribution_upgrade',
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '输出新增了主导归因。',
        safeRepairDirection: '删除无证据的主导表述。',
      }],
    }
    const normalized = normalizeBlockingFactJudgeResult(result, artifact, fixture.resume)
    expect(normalized.passed).toBe(false)
    expect(normalized.issues[0].severity).toBe('error')
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
    const normalized = normalizeBlockingFactJudgeResult(result, artifact, fixture.resume)
    expect(normalized.passed).toBe(false)
    expect(normalized.auditedClaimCount).toBe(artifact.claims.length)
    expect(normalized.issues.every(item => item.code === 'claim_mapping_insufficient')).toBe(true)
    expect(normalized.issues.every(item => item.severity === 'error')).toBe(true)
  })
})
