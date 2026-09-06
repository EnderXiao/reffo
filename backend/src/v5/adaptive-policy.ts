import type {
  GenerationPolicy,
  JobRequirementBundle,
  ResumeEvidenceBundle,
  ResumeStrategyProfile,
  V5MatchAnalysis,
} from '@/v5/types'
import { V5_ADAPTIVE_POLICY_VERSION } from '@/v5/types'
import {
  buildEvidencePlanningCatalog,
  isBusinessPlanningAnchor,
  type EvidencePlanningCatalog,
} from '@/v5/evidence-routing'

export const ADAPTIVE_V1_CONFIG = Object.freeze({
  version: V5_ADAPTIVE_POLICY_VERSION,
  richness: { sparseMax: 4, standardMax: 12 },
  evidenceShape: {
    workRatio: 0.6,
    workMinimum: 3,
    projectRatio: 0.6,
    projectMinimum: 3,
    researchRatio: 0.5,
    researchMinimum: 2,
    portfolioRatio: 0.5,
  },
  targetDistance: {
    directMustWeighted: 0.75,
    directCoreDirect: 0.67,
    adjacentMustWeighted: 0.5,
    adjacentCoreWeighted: 0.6,
  },
  modes: {
    preserve_sparse: {
      hardTotalListItemMax: 8,
      hardProjectMax: 1,
      stableCoreCoverageMin: 0.9,
      primaryRequirementCoverageMin: 0.5,
      cjk: { softMin: null, hardMin: null, softMax: 900, hardMax: 1200 },
      latin: { softMin: null, hardMin: null, softMax: 420, hardMax: 520 },
    },
    balanced_targeted: {
      hardTotalListItemMax: 14,
      hardProjectMax: 2,
      stableCoreCoverageMin: 0.85,
      primaryRequirementCoverageMin: 0.65,
      cjk: { softMin: 800, hardMin: 420, softMax: 1600, hardMax: 1900 },
      latin: { softMin: 380, hardMin: 200, softMax: 760, hardMax: 900 },
    },
    selective_rich: {
      hardTotalListItemMax: 18,
      hardProjectMax: 3,
      stableCoreCoverageMin: 0.75,
      primaryRequirementCoverageMin: 0.7,
      cjk: { softMin: 1100, hardMin: 650, softMax: 2300, hardMax: 2700 },
      latin: { softMin: 560, hardMin: 320, softMax: 1050, hardMax: 1250 },
    },
  },
})

function eligibleBusinessEvidence(bundle: ResumeEvidenceBundle, catalog: EvidencePlanningCatalog) {
  return bundle.evidenceAtoms.filter(atom => (
    isBusinessPlanningAnchor(catalog, atom.evidenceId)
  ))
}

function renderableBusinessCapacity(
  bundle: ResumeEvidenceBundle,
  hardProjectMax: number,
  catalog: EvidencePlanningCatalog
) {
  const timeline = new Map(bundle.timeline.map(item => [item.scopeId, item]))
  const countsByScope = new Map<string, number>()
  for (const atom of eligibleBusinessEvidence(bundle, catalog)) {
    const scope = timeline.get(atom.sourceScopeId)
    if (
      !scope
      || !['experience', 'internship', 'project', 'research'].includes(scope.kind)
      || !(scope.organization || scope.title || scope.start || scope.end)
    ) continue
    countsByScope.set(scope.scopeId, (countsByScope.get(scope.scopeId) ?? 0) + 1)
  }
  let workCapacity = 0
  const projectCapacities: number[] = []
  for (const [scopeId, count] of countsByScope) {
    const kind = timeline.get(scopeId)?.kind
    if (kind === 'experience' || kind === 'internship') workCapacity += count
    if (kind === 'project' || kind === 'research') projectCapacities.push(count)
  }
  projectCapacities.sort((left, right) => right - left)
  return workCapacity
    + projectCapacities.slice(0, hardProjectMax).reduce((sum, count) => sum + count, 0)
}

function uniqueScopesByKind(bundle: ResumeEvidenceBundle, kinds: string[]) {
  return new Set(bundle.timeline.filter(item => kinds.includes(item.kind)).map(item => item.scopeId)).size
}

function buildMetrics(bundle: ResumeEvidenceBundle, catalog: EvidencePlanningCatalog) {
  const business = eligibleBusinessEvidence(bundle, catalog)
  const portfolioEvidenceCount = bundle.evidenceAtoms.filter(
    atom => atom.status !== 'excluded' && atom.claimType === 'portfolio_link'
  ).length
  return {
    eligibleBusinessEvidenceCount: new Set(business.map(atom => atom.evidenceId)).size,
    resultEvidenceCount: business.filter(atom => atom.claimType === 'result').length,
    experienceScopeCount: uniqueScopesByKind(bundle, ['experience', 'internship']),
    projectScopeCount: uniqueScopesByKind(bundle, ['project']),
    researchScopeCount: uniqueScopesByKind(bundle, ['research']),
    portfolioEvidenceCount,
    highImportanceUnmappedCount: bundle.extractionCoverage.highImportanceUnmappedCount,
  }
}

function classifyRichness(count: number): ResumeStrategyProfile['evidenceRichness'] {
  if (count <= ADAPTIVE_V1_CONFIG.richness.sparseMax) return 'sparse'
  if (count <= ADAPTIVE_V1_CONFIG.richness.standardMax) return 'standard'
  return 'rich'
}

function classifyEvidenceShape(
  bundle: ResumeEvidenceBundle,
  catalog: EvidencePlanningCatalog
): ResumeStrategyProfile['evidenceShape'] {
  const business = eligibleBusinessEvidence(bundle, catalog)
  const total = business.length
  if (total === 0) return 'mixed'
  const scopeKind = new Map(bundle.timeline.map(item => [item.scopeId, item.kind]))
  const count = (kinds: string[]) => business.filter(atom => kinds.includes(scopeKind.get(atom.sourceScopeId) ?? '')).length
  const workCount = count(['experience', 'internship'])
  const projectCount = count(['project'])
  const researchCount = count(['research'])
  const portfolioCount = bundle.evidenceAtoms.filter(atom => atom.status !== 'excluded' && atom.claimType === 'portfolio_link').length

  if (workCount >= ADAPTIVE_V1_CONFIG.evidenceShape.workMinimum && workCount / total >= ADAPTIVE_V1_CONFIG.evidenceShape.workRatio) {
    return 'experience_led'
  }
  if (projectCount >= ADAPTIVE_V1_CONFIG.evidenceShape.projectMinimum && projectCount / total >= ADAPTIVE_V1_CONFIG.evidenceShape.projectRatio) {
    return 'project_led'
  }
  if (researchCount >= ADAPTIVE_V1_CONFIG.evidenceShape.researchMinimum && researchCount / total >= ADAPTIVE_V1_CONFIG.evidenceShape.researchRatio) {
    return 'research_led'
  }
  if (portfolioCount > 0 && projectCount / total >= ADAPTIVE_V1_CONFIG.evidenceShape.portfolioRatio) {
    return 'portfolio_led'
  }
  return 'mixed'
}

function classifyCareerStage(bundle: ResumeEvidenceBundle): ResumeStrategyProfile['careerStage'] {
  const fullTime = bundle.timeline.filter(item => item.kind === 'experience')
  const earlyKinds = bundle.timeline.filter(item => ['education', 'internship', 'project'].includes(item.kind))
  if (fullTime.length === 0 && earlyKinds.length > 0) return 'student_or_early'

  const leadershipScope = new Set(bundle.evidenceAtoms
    .filter(atom => atom.status !== 'excluded')
    .filter(atom => /团队|组织|预算|业务范围|管理|带领|直属|汇报线/.test(`${atom.verbatimText} ${atom.normalizedClaim}`))
    .map(atom => atom.sourceScopeId))
  const explicitSeniorTimeline = fullTime.some(item => /总监|负责人|lead|head|director|vp|副总裁/i.test(item.title ?? ''))
  if (explicitSeniorTimeline && leadershipScope.size > 0) return 'senior_or_leadership'
  if (fullTime.length >= 2) return 'experienced'
  if (fullTime.length === 1) return earlyKinds.length > 0 ? 'mixed' : 'experienced'
  return 'unknown'
}

function weightedCoverage(statuses: Array<V5MatchAnalysis['requirementMatches'][number]['status']>) {
  if (statuses.length === 0) return null
  return statuses.reduce((sum, status) => sum + (status === 'direct_match' ? 1 : status === 'transferable_match' ? 0.6 : 0), 0) / statuses.length
}

function classifyTargetDistance(
  jd: JobRequirementBundle,
  match: V5MatchAnalysis
): { distance: ResumeStrategyProfile['targetDistance']; confidence: ResumeStrategyProfile['confidence'] } {
  const importance = new Map(jd.requirementAtoms.map(atom => [atom.requirementId, atom.importance]))
  const applicable = match.requirementMatches.filter(item => item.status !== 'not_applicable')
  if (applicable.some(item => item.status === 'conflicting_evidence')) return { distance: 'transition', confidence: 'medium' }
  const mustStatuses = applicable.filter(item => importance.get(item.requirementId) === 'must_have').map(item => item.status)
  const coreStatuses = applicable.filter(item => importance.get(item.requirementId) === 'core_outcome').map(item => item.status)
  if (coreStatuses.length === 0) return { distance: 'adjacent', confidence: 'low' }

  const mustWeighted = weightedCoverage(mustStatuses)
  const coreWeighted = weightedCoverage(coreStatuses) ?? 0
  const coreDirect = coreStatuses.filter(status => status === 'direct_match').length / coreStatuses.length
  const direct = (mustWeighted === null || mustWeighted >= ADAPTIVE_V1_CONFIG.targetDistance.directMustWeighted)
    && coreDirect >= ADAPTIVE_V1_CONFIG.targetDistance.directCoreDirect
  if (direct) return { distance: 'direct', confidence: 'high' }
  const adjacent = (mustWeighted === null || mustWeighted >= ADAPTIVE_V1_CONFIG.targetDistance.adjacentMustWeighted)
    && coreWeighted >= ADAPTIVE_V1_CONFIG.targetDistance.adjacentCoreWeighted
  return adjacent ? { distance: 'adjacent', confidence: 'high' } : { distance: 'transition', confidence: 'high' }
}

function sectionOrder(
  shape: ResumeStrategyProfile['evidenceShape'],
  career: ResumeStrategyProfile['careerStage'],
  bundle: ResumeEvidenceBundle
) {
  const base = shape === 'experience_led'
    ? ['identity', 'summary', 'experience', 'project', 'research', 'skills', 'education', 'other']
    : shape === 'project_led' && career === 'student_or_early'
      ? ['identity', 'summary', 'education', 'project', 'experience', 'skills', 'other']
      : shape === 'project_led'
        ? ['identity', 'summary', 'experience', 'project', 'skills', 'education', 'other']
        : shape === 'research_led'
          ? ['identity', 'summary', 'research', 'publications', 'education', 'experience', 'project', 'skills', 'other']
          : shape === 'portfolio_led'
            ? ['identity', 'portfolio', 'summary', 'project', 'experience', 'skills', 'education', 'other']
            : ['identity', 'summary', 'experience', 'project', 'research', 'skills', 'education', 'other']
  const claimTypes = new Set(bundle.evidenceAtoms
    .filter(atom => atom.status !== 'excluded')
    .map(atom => atom.claimType))
  const extras = [
    claimTypes.has('portfolio_link') ? 'portfolio' : null,
    claimTypes.has('publication') ? 'publications' : null,
    claimTypes.has('patent') ? 'patents' : null,
    claimTypes.has('certification') ? 'certifications' : null,
    claimTypes.has('language') ? 'languages' : null,
    claimTypes.has('award') ? 'awards' : null,
  ].filter((value): value is string => Boolean(value && !base.includes(value)))
  const otherIndex = base.indexOf('other')
  base.splice(otherIndex < 0 ? base.length : otherIndex, 0, ...extras)
  return base
}

function outputIsCjk(language: string) {
  return /zh|ja|ko|cjk/i.test(language)
}

export function buildAdaptiveStrategy(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
  requestedOutputLanguage?: string
}): { profile: ResumeStrategyProfile; policy: GenerationPolicy; requiresResolution: boolean } {
  const evidenceCatalog = buildEvidencePlanningCatalog(input.resume)
  const metrics = buildMetrics(input.resume, evidenceCatalog)
  const maximumRenderableBusinessCount = renderableBusinessCapacity(
    input.resume,
    ADAPTIVE_V1_CONFIG.modes.selective_rich.hardProjectMax,
    evidenceCatalog
  )
  const evidenceRichness = classifyRichness(Math.min(
    metrics.eligibleBusinessEvidenceCount,
    maximumRenderableBusinessCount
  ))
  const evidenceShape = classifyEvidenceShape(input.resume, evidenceCatalog)
  const careerStage = classifyCareerStage(input.resume)
  const target = classifyTargetDistance(input.job, input.match)
  const outputLanguage = input.requestedOutputLanguage?.trim() || input.resume.sourceDocument.primaryLanguage
  const confidence: ResumeStrategyProfile['confidence'] = target.confidence === 'low' || careerStage === 'unknown' ? 'low' : 'high'
  const profile: ResumeStrategyProfile = {
    profileVersion: V5_ADAPTIVE_POLICY_VERSION,
    careerStage,
    evidenceShape,
    evidenceRichness,
    targetDistance: target.distance,
    outputLanguage,
    confidence,
    reasons: [
      { signal: `evidence_richness:${evidenceRichness}`, evidenceIds: [], requirementIds: [] },
      { signal: `evidence_shape:${evidenceShape}`, evidenceIds: [], requirementIds: [] },
      { signal: `career_stage:${careerStage}`, evidenceIds: [], requirementIds: [] },
      { signal: `target_distance:${target.distance}`, evidenceIds: [], requirementIds: input.match.positioning.primaryRequirementIds },
    ],
    metrics,
  }

  const mode: GenerationPolicy['mode'] = evidenceRichness === 'sparse'
    ? 'preserve_sparse'
    : evidenceRichness === 'rich'
      ? 'selective_rich'
      : 'balanced_targeted'
  const modeConfig = ADAPTIVE_V1_CONFIG.modes[mode]
  const languageBudget = outputIsCjk(outputLanguage) ? modeConfig.cjk : modeConfig.latin
  const businessCount = Math.min(
    metrics.eligibleBusinessEvidenceCount,
    renderableBusinessCapacity(input.resume, modeConfig.hardProjectMax, evidenceCatalog)
  )
  const targetBusinessBulletMin = mode === 'preserve_sparse' ? Math.min(businessCount, 2)
    : mode === 'balanced_targeted' ? Math.min(businessCount, 5)
      : Math.min(businessCount, 7)
  const targetBusinessBulletMax = mode === 'preserve_sparse' ? Math.min(businessCount, 5)
    : mode === 'balanced_targeted' ? Math.min(businessCount, 9)
      : Math.min(businessCount, 12)
  const targetBusinessBulletTarget = targetBusinessBulletMax
  let summaryPolicy: GenerationPolicy['summaryPolicy'] = evidenceRichness === 'sparse'
    ? businessCount < 2 ? 'omit_if_unsupported' : 'one_sentence'
    : evidenceRichness === 'rich' ? 'one_to_three_sentences' : 'one_to_two_sentences'
  if (target.distance === 'transition' && summaryPolicy === 'one_to_three_sentences') summaryPolicy = 'one_to_two_sentences'

  const policy: GenerationPolicy = {
    policyVersion: V5_ADAPTIVE_POLICY_VERSION,
    mode,
    sectionOrder: sectionOrder(evidenceShape, careerStage, input.resume),
    summaryPolicy,
    targetBusinessBulletMin,
    targetBusinessBulletTarget,
    targetBusinessBulletMax,
    hardTotalListItemMax: modeConfig.hardTotalListItemMax,
    hardProjectMax: modeConfig.hardProjectMax,
    stableCoreCoverageMin: modeConfig.stableCoreCoverageMin,
    primaryRequirementCoverageMin: modeConfig.primaryRequirementCoverageMin,
    preferredDirectEvidenceRatio: target.distance === 'direct'
      ? { min: 0.6, max: 0.75 }
      : target.distance === 'adjacent'
        ? { min: 0.5, max: 0.65 }
        : { min: 0.4, max: 0.55 },
    outputLength: {
      unit: outputIsCjk(outputLanguage) ? 'cjk_characters' : 'words',
      softMin: languageBudget.softMin,
      hardMin: languageBudget.hardMin,
      softMax: languageBudget.softMax,
      hardMax: languageBudget.hardMax,
    },
    fallbackPolicy: confidence === 'low' ? 'balanced_default' : 'source_preserving',
  }

  return {
    profile,
    policy,
    requiresResolution: confidence === 'low' && (careerStage === 'unknown' || evidenceShape === 'mixed'),
  }
}
