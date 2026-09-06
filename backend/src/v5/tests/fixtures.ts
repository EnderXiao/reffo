import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildJobRequirementBundle, buildResumeEvidenceBundle } from '@/v5/evidence'
import { assessV5DeliveryGate, buildV5DeliveryDiagnostics } from '@/v5/delivery-gate'
import { calculateV5MatchScore } from '@/v5/match-score'
import { renderSourcePreservingArtifact } from '@/v5/safe-renderer'
import type { JobExtractionCandidate, ResumeExtractionCandidate } from '@/v5/types'
import type { V5MatchAnalysis, V5ResumePlan, V5WorkflowResult } from '@/v5/types'
import { V5_SCHEMA_VERSION } from '@/v5/types'

export const FIXTURE_RESUME = '张三\n甲公司｜产品经理｜2022-至今\n参与团队产品迭代，交付3个功能。\n技能：SQL'
export const FIXTURE_JD = '高级产品经理\n负责产品规划与数据分析\n要求熟练使用SQL'

export function createResumeFixture() {
  const document = canonicalizeSourceDocument(FIXTURE_RESUME, 'resume-fixture').canonicalDocument
  const facts: ResumeExtractionCandidate['factCandidates'] = document.blocks.map((block, index) => ({
    factLocalId: `f${index + 1}`,
    sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length },
    verbatimText: block.text,
    normalizedClaim: block.text,
    claimType: index === 0 ? 'identity' : index === 1 ? 'timeline' : index === 2 ? 'deliverable' : 'skill',
    sourceScopeLocalId: index === 0 ? 'identity' : index === 3 ? 'skills' : 'work1',
    proposedStatus: 'source_supported',
    attributionLevel: index === 2 ? 'contributed' : 'unspecified',
    sourceActionVerb: index === 2 ? '参与' : null,
    qualifiers: index === 2 ? ['团队', '参与'] : [],
    numericAtoms: index === 2 ? [{
      raw: '3个',
      valueText: '3',
      unit: '个',
      qualifier: null,
      period: null,
      ownerScope: 'work1',
    }] : [],
    riskFlags: index === 2 ? ['team_attribution'] : [],
  }))
  const candidate: ResumeExtractionCandidate = {
    schemaVersion: V5_SCHEMA_VERSION,
    identityCandidates: [{ field: 'name', value: '张三', factLocalIds: ['f1'] }],
    timelineCandidates: [{
      scopeLocalId: 'work1',
      kind: 'experience',
      organization: '甲公司',
      title: '产品经理',
      start: '2022',
      end: '至今',
      factLocalIds: ['f2', 'f3'],
    }],
    sectionCandidates: [
      { sectionLocalId: 's1', type: 'experience', title: '工作经历', scopeLocalIds: ['work1'], factLocalIds: ['f2', 'f3'] },
      { sectionLocalId: 's2', type: 'skills', title: '技能', scopeLocalIds: [], factLocalIds: ['f4'] },
    ],
    factCandidates: facts,
    unmappedFragments: [],
    conflicts: [],
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] },
    qualityAssessment: {
      scoreInputs: { identityCompleteness: 80, timelineCompleteness: 90, evidenceResultDensity: 50, clarity: 80, sectionCoverage: 75 },
      strengths: [{ statement: '具备产品交付证据', factLocalIds: ['f3'], sourceBlockIds: ['B0003'] }],
      weaknesses: [{ statement: '结果证据较少', factLocalIds: ['f3'], sourceBlockIds: ['B0003'] }],
      suggestions: [{ statement: '补充可核验结果', sourceBlockIds: ['B0003'] }],
      capabilitySummary: '具备产品迭代与 SQL 证据。',
    },
  }
  return { document, candidate, bundle: buildResumeEvidenceBundle(document, candidate) }
}

export function createJobFixture() {
  const document = canonicalizeSourceDocument(FIXTURE_JD, 'job-fixture').canonicalDocument
  const candidate: JobExtractionCandidate = {
    schemaVersion: V5_SCHEMA_VERSION,
    basicInfo: { title: '高级产品经理', company: null, location: null },
    basicInfoSourceBlockIds: ['B0001'],
    requirementCandidates: document.blocks.slice(1).map((block, index) => ({
      requirementLocalId: `r${index + 1}`,
      sourceBlockId: block.sourceBlockId,
      blockRelativeSpan: { start: 0, end: block.text.length },
      verbatimText: block.text,
      normalizedRequirement: block.text,
      category: index === 0 ? 'responsibility' : 'skill',
      importance: index === 0 ? 'core_outcome' : 'must_have',
      logicGroupLocalId: null,
      logicOperator: null,
      explicitness: 'explicit',
    })),
    explicitCompanySignals: [],
    explicitLocationSignals: [],
    uncertainties: [{ statement: '公司和地点未提供', sourceBlockIds: ['B0001'] }],
    sourcedContextCandidates: [],
    unmappedFragments: [],
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] },
  }
  return { document, candidate, bundle: buildJobRequirementBundle(document, candidate) }
}

export function createMatchFixture() {
  const resume = createResumeFixture().bundle
  const job = createJobFixture().bundle
  const deliverable = resume.evidenceAtoms.find(item => item.claimType === 'deliverable')!
  const skill = resume.evidenceAtoms.find(item => item.claimType === 'skill')!
  const core = job.requirementAtoms.find(item => item.importance === 'core_outcome')!
  const must = job.requirementAtoms.find(item => item.importance === 'must_have')!
  const match: V5MatchAnalysis = {
    schemaVersion: V5_SCHEMA_VERSION,
    requirementMatches: [
      { requirementId: core.requirementId, status: 'transferable_match', evidenceIds: [deliverable.evidenceId], confidence: 'medium', rationale: '具有产品交付迁移证据' },
      { requirementId: must.requirementId, status: 'direct_match', evidenceIds: [skill.evidenceId], confidence: 'high', rationale: 'SQL 直接证据' },
    ],
    strengths: [{ strengthId: 'st1', requirementIds: [must.requirementId], evidenceIds: [skill.evidenceId], statement: 'SQL 直接匹配' }],
    gaps: [],
    positioning: {
      statement: '以产品交付和 SQL 证据回应岗位。',
      primaryRequirementIds: [core.requirementId, must.requirementId],
      primaryEvidenceIds: [deliverable.evidenceId, skill.evidenceId],
      forbiddenIdentityClaims: ['高级产品经理'],
    },
    scoreInputs: {
      mustHaveApplicable: 1,
      mustHaveDirect: 1,
      mustHaveTransferable: 0,
      coreOutcomeApplicable: 1,
      coreOutcomeDirect: 0,
      coreOutcomeTransferable: 1,
      evidenceClarityRatio: 1,
    },
    contextUsed: [],
  }
  return { resume, job, match, deliverable, skill, core, must }
}

export function createV5ResultFixture(): V5WorkflowResult {
  const fixture = createMatchFixture()
  const strategy = buildAdaptiveStrategy(fixture)
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
    scopePlans: [{ scopeId: scope.scopeId, scopeType: scope.kind, treatment: 'compress', selectedEvidenceIds: [fixture.deliverable.evidenceId], bulletBudget: 1, rewriteAngle: '保留边界' }],
    featuredSkillEvidenceIds: [fixture.skill.evidenceId],
    safeKeywordMappings: [{ requirementId: fixture.must.requirementId, evidenceIds: [fixture.skill.evidenceId], safePhrase: 'SQL' }],
    forbiddenRequirementIds: [],
    omittedHighValueEvidence: [],
    lowerBoundException: null,
  }
  const artifact = renderSourcePreservingArtifact({ resume: fixture.resume, plan })
  const deliveryGate = assessV5DeliveryGate({
    validationPassed: true,
    usedSafeFallback: false,
    hasAdvisoryQualityIssues: false,
  })
  const deliveryDiagnostics = buildV5DeliveryDiagnostics({
    assessment: deliveryGate,
    resume: fixture.resume,
    match: fixture.match,
    plan,
    policy: strategy.policy,
    artifact,
    state: 'succeeded',
    planOrigin: 'model_primary',
    artifactOrigin: 'model',
    usedSafeFallback: false,
    usedAnyFallback: false,
    interview: 'deferred',
    finalValidationIssues: [],
    rejectedCandidateIssues: [],
  })
  return {
    state: 'succeeded',
    releaseStatus: 'preproduction_candidate',
    runId: 'fixture-run',
    resumeEvidenceBundle: fixture.resume,
    jobRequirementBundle: fixture.job,
    matchAnalysis: fixture.match,
    matchScore: calculateV5MatchScore(fixture),
    strategyProfile: strategy.profile,
    generationPolicy: strategy.policy,
    resumePlan: plan,
    artifact,
    usedSafeFallback: false,
    usedAnyFallback: false,
    executionStatus: 'completed',
    qualityGates: {
      factSafety: 'pass',
      contentCompleteness: 'pass',
      deliverability: 'pass',
    },
    deliveryDecision: 'deliver',
    deliveryDiagnostics,
    generationProvenance: {
      planOrigin: 'model_primary',
      artifactOrigin: 'model',
      planRepairCount: 0,
      artifactRepairCount: 0,
      rejectedPlanIssueCodes: [],
    },
    validationIssues: [],
  }
}

export function createHistoricalV5ResultWithInterviewPreparation(): V5WorkflowResult {
  const result = createV5ResultFixture()
  const evidence = result.resumeEvidenceBundle.evidenceAtoms.find(atom => (
    ['responsibility', 'action', 'deliverable', 'result'].includes(atom.claimType)
  ))!
  const requirementIds = result.jobRequirementBundle.requirementAtoms.map(atom => atom.requirementId)
  result.interviewPreparation = {
    schemaVersion: V5_SCHEMA_VERSION,
    questions: [
      ['如何规划产品？', 'core_task'],
      ['请深挖该交付经历。', 'project_deep_dive'],
      ['如何诚实说明差距？', 'gap_or_transfer'],
      ['若优先级变化会如何处理？', 'context_scenario'],
    ].map(([question, category]) => ({
      question,
      category: category as 'core_task' | 'project_deep_dive' | 'gap_or_transfer' | 'context_scenario',
      relatedRequirementIds: requirementIds,
      relatedEvidenceIds: [evidence.evidenceId],
      preparationFocus: '基于真实证据准备',
      assumptionContextIds: [],
    })),
    storyRecommendations: [{
      title: '产品交付',
      scopeId: evidence.sourceScopeId,
      evidenceIds: [evidence.evidenceId],
      background: '准备真实背景',
      knownResult: null,
      preparationGap: '补充可核验反馈',
    }],
    followUpQuestions: [
      { question: '成功标准是什么？', purpose: '确认成功标准', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
      { question: '当前优先挑战是什么？', purpose: '确认挑战', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
      { question: '如何协作？', purpose: '确认协作方式', relatedRequirementIds: requirementIds, assumptionContextIds: [] },
    ],
  }
  result.deliveryDiagnostics.provenance.interview = 'generated'
  return result
}
