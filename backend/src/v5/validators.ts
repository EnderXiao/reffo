import { createHash } from 'node:crypto'
import type {
  BlockingFactJudgeResult,
  EvidenceAtom,
  GeneratedResumeArtifact,
  GenerationPolicy,
  InterviewPreparation,
  JobRequirementBundle,
  ResumeEvidenceBundle,
  ResumeStrategyProfile,
  ValidationIssue,
  ValidationResult,
  V5MatchAnalysis,
  V5ResumePlan,
} from '@/v5/types'
import {
  buildEvidencePlanningCatalog,
  buildRequirementEvidenceRoutes,
  comparePlanningEvidence,
  isBusinessPlanningAnchor,
} from '@/v5/evidence-routing'
import { areCanonicalAdjacentSourceAtoms } from '@/v5/composition/source-continuation'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { sourceBusinessDisplayText } from '@/v5/composition/source-display'
import { buildTargetEvidenceScores, duplicateTimelineOnlyScopes, hasHighValueEvidenceRole } from '@/v5/planning-quality'
import { inspectSupportedWriting } from '@/v5/writing/facts'
import { deriveWritingSourceExcerpts, sourceAtomsForWritingInspection } from '@/v5/writing/source-excerpts'

const BUSINESS_TYPES = new Set(['responsibility', 'action', 'deliverable', 'result'])
const ANCILLARY_CLAIM_TYPES = new Set(['education', 'certification', 'language', 'award', 'publication', 'patent', 'portfolio_link'])
const PLACEHOLDER_PATTERN = /(?:\bXXX\b|待补充|公司名称|职位名称|项目名称|学校名称|\{\{[^}]+\}\})/i
const INTERNAL_LEAK_PATTERN = /(?:\bev_[a-f0-9]{8,}\b|\breq_[a-f0-9]{8,}\b|\bclaim[_-][a-z0-9]+\b|\b(?:EvidenceAtom|RequirementAtom|validationIssues|usedEvidenceIds|omittedPlannedEvidenceIds|sourceScopeId|evidenceIds|requirementIds)\b)/gi
const DETAILED_ADDRESS_PATTERN = /(?:身份证|身份证号|居民身份证|\d{6}(?:19|20)\d{2}[01]\d[0-3]\d\d{3}[\dXx])|(?:省|市|自治区).{0,20}(?:区|县).{0,20}(?:街道|路|巷|弄|号楼|室)/
const TENURE_PATTERN = /(?:拥有|具备|累计|超过|至少|近)?\s*\d+(?:\.\d+)?\s*年(?:以上)?(?:相关|工作|行业|岗位|开发|产品|管理)?经验/
const NUMBER_PATTERN = /(?:约|近|超过|超|至少|最多|不足|逾)?\s*[¥￥$]?\s*\d+(?:[.,]\d+)*(?:%|％|万|亿|千|百|人|次|个|项|家|天|周|月|年|小时|分钟|QPS|ms|MB|GB)?/gi
const QUALIFIERS = ['约', '近', '超过', '超', '至少', '最多', '不足', '逾']
const CAUSALITY_PATTERN = /(?:从而|因此|进而|由此|带动|使得|thereby|resulting in|which led to)/i
const PHONE_PATTERN = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g
const URL_PATTERN = /https?:\/\/[^\s)]+/gi
const BUSINESS_SECTION_KEYS = new Set(['experience', 'project', 'research', 'other'])
const ANCILLARY_SECTION_CLAIM_TYPES: Record<string, EvidenceAtom['claimType']> = {
  certifications: 'certification',
  languages: 'language',
  publications: 'publication',
  patents: 'patent',
  awards: 'award',
  portfolio: 'portfolio_link',
}

export type V5ValidationGateMode = 'strict' | 'relaxed_release'

export const RELAXED_PLAN_ADVISORY_CODES = new Set([
  'PLAN_QUALITY_UNDER_TARGET',
  'PLAN_SCOPE_DIVERSITY_UNDER_TARGET',
  'PLAN_HIGH_VALUE_TYPE_OMITTED',
  'PRIMARY_REQUIREMENT_UNDERCOVERED',
])

// These checks describe product-quality targets rather than factual safety.
// Relaxed validation keeps them as observable warnings so they do not trigger
// another model rewrite; the deterministic delivery gate decides whether the
// artifact is suitable for user delivery.
export const RELAXED_RELEASE_ADVISORY_CODES = new Set([
  'PLANNED_EVIDENCE_OMITTED',
  'PLANNED_TIMELINE_HAS_BODY',
  'PLANNED_OMIT_SCOPE_RENDERED',
  'PLANNED_SCOPE_UNDER_RENDERED',
  'MISSING_REQUIRED_SECTION',
  'DUPLICATE_EVIDENCE_USE',
  'OUTPUT_CONTENT_UNDERSIZED',
  'PLAN_COVERAGE_REGRESSION',
])

function applyGeneratedArtifactGateMode(
  issues: ValidationIssue[],
  mode: V5ValidationGateMode
) {
  if (mode === 'strict') return issues
  return issues.map(item => (
    item.severity === 'error' && RELAXED_RELEASE_ADVISORY_CODES.has(item.code)
      ? { ...item, severity: 'warning' as const }
      : item
  ))
}

function applyPlanGateMode(issues: ValidationIssue[], mode: V5ValidationGateMode) {
  if (mode === 'strict') return issues
  return issues.map(item => (
    item.severity === 'error' && RELAXED_PLAN_ADVISORY_CODES.has(item.code)
      ? { ...item, severity: 'warning' as const }
      : item
  ))
}

function stableIssueId(parts: string[]) {
  return `issue_${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)}`
}

function issue(input: {
  code: string
  message: string
  expectedConstraint: string
  severity?: ValidationIssue['severity']
  outputPath?: string | null
  claimId?: string | null
  evidenceIds?: string[]
  requirementIds?: string[]
  replacementText?: string | null
}): ValidationIssue {
  return {
    issueId: stableIssueId([input.code, input.outputPath ?? '', input.claimId ?? '', input.message]),
    severity: input.severity ?? 'error',
    code: input.code,
    outputPath: input.outputPath ?? null,
    claimId: input.claimId ?? null,
    evidenceIds: input.evidenceIds ?? [],
    requirementIds: input.requirementIds ?? [],
    message: input.message,
    expectedConstraint: input.expectedConstraint,
    replacementText: input.replacementText ?? null,
  }
}

function duplicates(values: string[]) {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value)
    seen.add(value)
  }
  return [...duplicated]
}

function sameSet(left: string[], right: string[]) {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every(value => b.has(value))
}

export function validateV5MatchAnalysis(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
}): ValidationResult<V5MatchAnalysis> {
  const issues: ValidationIssue[] = []
  const requirementIds = new Set(input.job.requirementAtoms.map(atom => atom.requirementId))
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const deduplicatedMatches: V5MatchAnalysis['requirementMatches'] = []
  const firstMatchByRequirement = new Map<string, V5MatchAnalysis['requirementMatches'][number]>()
  let sameStatusDuplicateCount = 0
  const confidenceRank = { low: 0, medium: 1, high: 2 } as const
  for (const match of input.match.requirementMatches) {
    const existing = firstMatchByRequirement.get(match.requirementId)
    if (!existing || existing.status !== match.status) {
      const copy = { ...match, evidenceIds: [...match.evidenceIds] }
      deduplicatedMatches.push(copy)
      if (!existing) firstMatchByRequirement.set(match.requirementId, copy)
      continue
    }
    existing.evidenceIds = [...new Set([...existing.evidenceIds, ...match.evidenceIds])]
    if (confidenceRank[match.confidence] < confidenceRank[existing.confidence]) existing.confidence = match.confidence
    sameStatusDuplicateCount += 1
  }
  if (sameStatusDuplicateCount > 0) {
    issues.push(issue({
      code: 'REQUIREMENT_MATCHES_SERVER_DEDUPED',
      severity: 'warning',
      outputPath: 'requirementMatches',
      message: `服务端已合并 ${sameStatusDuplicateCount} 条 requirementId 与 status 均相同的机械重复匹配结论。`,
      expectedConstraint: '仅合并同状态重复项、合并证据并取更低置信度；状态冲突仍阻断',
    }))
    input = { ...input, match: { ...input.match, requirementMatches: deduplicatedMatches } }
  }
  const statusByRequirement = new Map(input.match.requirementMatches.map(item => [item.requirementId, item.status]))
  const normalizedGaps: V5MatchAnalysis['gaps'] = input.match.gaps.flatMap(gap => {
    const validRequirementIds = [...new Set(gap.requirementIds.filter(id => requirementIds.has(id)))]
    if (gap.evidenceType === 'direct_missing') {
      const unprovenRequirementIds = validRequirementIds.filter(
        id => statusByRequirement.get(id) === 'currently_unproven'
      )
      if (unprovenRequirementIds.length === 0) return []
      return [{ ...gap, requirementIds: unprovenRequirementIds, evidenceIds: [] }]
    }
    const validEvidenceIds = [...new Set(gap.evidenceIds.filter(id => {
      const atom = evidence.get(id)
      return Boolean(atom && atom.status !== 'excluded')
    }))]
    if (validRequirementIds.length === 0 || validEvidenceIds.length === 0) return []
    return [{ ...gap, requirementIds: validRequirementIds, evidenceIds: validEvidenceIds }]
  })
  if (JSON.stringify(normalizedGaps) !== JSON.stringify(input.match.gaps)) {
    issues.push(issue({
      code: 'ADVISORY_GAPS_SERVER_ALIGNED',
      severity: 'warning',
      outputPath: 'gaps',
      message: '建议性 gaps 已按服务端验证的 requirement status 和 EvidenceAtom 对齐，无法成立的条目已删除。',
      expectedConstraint: 'direct_missing 只保留 currently_unproven 且不得携带证据；其他 gap 必须有合法证据',
    }))
    input = { ...input, match: { ...input.match, gaps: normalizedGaps } }
  }
  const matchesByRequirement = new Map<string, V5MatchAnalysis['requirementMatches']>()
  for (const match of input.match.requirementMatches) {
    matchesByRequirement.set(match.requirementId, [...(matchesByRequirement.get(match.requirementId) ?? []), match])
  }
  for (const requirementId of requirementIds) {
    const matches = matchesByRequirement.get(requirementId) ?? []
    if (matches.length === 0) {
      issues.push(issue({
        code: 'REQUIREMENT_MATCH_MISSING',
        outputPath: 'requirementMatches',
        requirementIds: [requirementId],
        message: `RequirementAtom ${requirementId} 没有匹配结论。`,
        expectedConstraint: '每个需求必须且只能有一条 RequirementMatch',
      }))
    } else if (matches.length > 1) {
      issues.push(issue({
        code: 'REQUIREMENT_MATCH_DUPLICATE',
        outputPath: 'requirementMatches',
        requirementIds: [requirementId],
        message: `RequirementAtom ${requirementId} 出现 ${matches.length} 条匹配结论。`,
        expectedConstraint: '每个需求必须且只能有一条 RequirementMatch',
      }))
    }
  }

  for (const [index, match] of input.match.requirementMatches.entries()) {
    if (!requirementIds.has(match.requirementId)) {
      issues.push(issue({
        code: 'UNKNOWN_REQUIREMENT_ID',
        outputPath: `requirementMatches[${index}].requirementId`,
        requirementIds: [match.requirementId],
        message: `匹配结论引用不存在的 requirementId：${match.requirementId}`,
        expectedConstraint: '匹配只能引用当前 JobRequirementBundle',
      }))
    }
    const requiresEvidence = match.status === 'direct_match' || match.status === 'transferable_match'
    const invalidEvidence = match.evidenceIds.filter(id => !evidence.has(id) || evidence.get(id)?.status === 'excluded')
    if (match.evidenceIds.length > 0 && invalidEvidence.length > 0) {
      issues.push(issue({
        code: 'INVALID_MATCH_EVIDENCE',
        outputPath: `requirementMatches[${index}].evidenceIds`,
        requirementIds: [match.requirementId],
        evidenceIds: invalidEvidence,
        message: '匹配结论引用了不存在或 excluded 的 EvidenceAtom。',
        expectedConstraint: '所有匹配证据引用都必须合法',
      }))
    }
    if (requiresEvidence && (match.evidenceIds.length === 0 || invalidEvidence.length > 0)) {
      issues.push(issue({
        code: 'MATCH_WITHOUT_EVIDENCE',
        outputPath: `requirementMatches[${index}].evidenceIds`,
        requirementIds: [match.requirementId],
        evidenceIds: match.evidenceIds,
        message: 'direct/transferable 匹配缺少全部合法 EvidenceAtom。',
        expectedConstraint: '匹配结论必须引用存在且非 excluded 的证据',
      }))
    }
    if ((match.status === 'currently_unproven' || match.status === 'not_applicable') && match.evidenceIds.length > 0) {
      issues.push(issue({
        code: 'UNPROVEN_MATCH_HAS_EVIDENCE',
        outputPath: `requirementMatches[${index}].evidenceIds`,
        requirementIds: [match.requirementId],
        evidenceIds: match.evidenceIds,
        message: `${match.status} 不得携带伪匹配证据。`,
        expectedConstraint: 'currently_unproven/not_applicable 的 evidenceIds 必须为空',
      }))
    }
  }

  for (const [index, strength] of input.match.strengths.entries()) {
    const invalidRequirements = strength.requirementIds.filter(id => !requirementIds.has(id))
    const invalidEvidence = strength.evidenceIds.filter(id => !evidence.has(id) || evidence.get(id)?.status === 'excluded')
    if (invalidRequirements.length > 0 || invalidEvidence.length > 0) {
      issues.push(issue({
        code: 'INVALID_STRENGTH_REFERENCE',
        outputPath: `strengths[${index}]`,
        requirementIds: invalidRequirements,
        evidenceIds: invalidEvidence,
        message: '优势项包含不存在的需求或证据引用。',
        expectedConstraint: 'strength 必须由当前 requirement/evidence 直接支持',
      }))
    }
  }

  const invalidPositionRequirements = input.match.positioning.primaryRequirementIds.filter(id => !requirementIds.has(id))
  const invalidPositionEvidence = input.match.positioning.primaryEvidenceIds.filter(id => !evidence.has(id) || evidence.get(id)?.status === 'excluded')
  if (invalidPositionRequirements.length > 0 || invalidPositionEvidence.length > 0) {
    issues.push(issue({
      code: 'INVALID_POSITIONING_REFERENCE',
      outputPath: 'positioning',
      requirementIds: invalidPositionRequirements,
      evidenceIds: invalidPositionEvidence,
      message: '候选人定位包含不存在或不可用的引用。',
      expectedConstraint: 'positioning 只能引用当前已验证需求和证据',
    }))
  }

  const matchStatus = new Map(input.match.requirementMatches.map(item => [item.requirementId, item.status]))
  for (const [index, gap] of input.match.gaps.entries()) {
    if (gap.requirementIds.some(id => !requirementIds.has(id))) {
      issues.push(issue({
        code: 'UNKNOWN_REQUIREMENT_ID',
        outputPath: `gaps[${index}].requirementIds`,
        requirementIds: gap.requirementIds.filter(id => !requirementIds.has(id)),
        message: '差距项引用了不存在的 RequirementAtom。',
        expectedConstraint: 'gap 只能引用当前 JobRequirementBundle',
      }))
    }
    const statuses = gap.requirementIds.map(id => matchStatus.get(id))
    if (gap.evidenceType === 'direct_missing') {
      if (gap.evidenceIds.length > 0 || statuses.some(status => status !== 'currently_unproven')) {
        issues.push(issue({
          code: 'DIRECT_MISSING_LEAKED_TO_STRATEGY',
          outputPath: `gaps[${index}]`,
          requirementIds: gap.requirementIds,
          evidenceIds: gap.evidenceIds,
          message: 'direct_missing 与匹配状态或证据引用不一致。',
          expectedConstraint: 'direct_missing 只能对应 currently_unproven 且 evidenceIds 为空',
        }))
      }
    } else if (gap.evidenceIds.length === 0 || gap.evidenceIds.some(id => !evidence.has(id))) {
      issues.push(issue({
        code: 'MATCH_WITHOUT_EVIDENCE',
        outputPath: `gaps[${index}].evidenceIds`,
        requirementIds: gap.requirementIds,
        evidenceIds: gap.evidenceIds,
        message: `${gap.evidenceType} 差距缺少可用证据。`,
        expectedConstraint: 'implicit_evidence/wording_gap 必须引用合法证据',
      }))
    }
  }

  const contextIds = new Set(input.job.sourcedContext.map(context => context.contextId))
  for (const [index, context] of input.match.contextUsed.entries()) {
    if (!contextIds.has(context.contextId)) {
      issues.push(issue({
        code: 'INVALID_CONTEXT_REFERENCE',
        outputPath: `contextUsed[${index}].contextId`,
        message: `引用了不存在或无来源的 contextId：${context.contextId}`,
        expectedConstraint: '只能使用 JobRequirementBundle.sourcedContext 中的 contextId',
      }))
    }
  }

  const importance = new Map(input.job.requirementAtoms.map(atom => [atom.requirementId, atom.importance]))
  const applicable = input.match.requirementMatches.filter(item => item.status !== 'not_applicable')
  const must = applicable.filter(item => importance.get(item.requirementId) === 'must_have')
  const core = applicable.filter(item => importance.get(item.requirementId) === 'core_outcome')
  const expectedInputs = {
    mustHaveApplicable: must.length,
    mustHaveDirect: must.filter(item => item.status === 'direct_match').length,
    mustHaveTransferable: must.filter(item => item.status === 'transferable_match').length,
    coreOutcomeApplicable: core.length,
    coreOutcomeDirect: core.filter(item => item.status === 'direct_match').length,
    coreOutcomeTransferable: core.filter(item => item.status === 'transferable_match').length,
    evidenceClarityRatio: input.resume.evidenceAtoms.length === 0
      ? 0
      : input.resume.evidenceAtoms.filter(atom => atom.status === 'source_supported').length / input.resume.evidenceAtoms.length,
  }
  const scoreMismatch = Object.entries(expectedInputs).some(([key, value]) => {
    const actual = input.match.scoreInputs[key as keyof typeof expectedInputs]
    return Math.abs(actual - value) > 0.0001
  })
  if (scoreMismatch) {
    issues.push(issue({
      code: 'SCORE_INPUT_MISMATCH',
      severity: 'warning',
      outputPath: 'scoreInputs',
      message: '模型 scoreInputs 与 RequirementMatch/EvidenceAtom 的服务端重算结果不一致，已由服务端强制覆盖。',
      expectedConstraint: JSON.stringify(expectedInputs),
    }))
    input = { ...input, match: { ...input.match, scoreInputs: expectedInputs } }
  }

  return { passed: !issues.some(item => item.severity === 'error'), issues, value: input.match }
}

function selectedPlanEvidence(plan: V5ResumePlan) {
  return new Set([
    ...plan.stableCoreEvidenceIds,
    ...plan.customizedEvidenceIds,
    ...plan.evidencePillars.flatMap(item => item.evidenceIds),
    ...plan.scopePlans.flatMap(item => item.selectedEvidenceIds),
    ...plan.featuredSkillEvidenceIds,
    ...plan.safeKeywordMappings.flatMap(item => item.evidenceIds),
  ])
}

export function plannedBodyEvidenceIds(plan: V5ResumePlan) {
  return new Set([
    ...plan.scopePlans.flatMap(item => item.selectedEvidenceIds),
    ...plan.featuredSkillEvidenceIds,
  ])
}

export function plannedContentEvidenceIds(resume: ResumeEvidenceBundle, plan: V5ResumePlan) {
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const ancillary = [...selectedPlanEvidence(plan)].filter(id => {
    const atom = evidence.get(id)
    return Boolean(atom && ANCILLARY_CLAIM_TYPES.has(atom.claimType))
  })
  return new Set([...plannedBodyEvidenceIds(plan), ...ancillary])
}

function identityEvidenceIds(resume: ResumeEvidenceBundle) {
  return new Set([
    ...resume.identity.name.evidenceIds,
    ...resume.identity.email.evidenceIds,
    ...resume.identity.phone.evidenceIds,
    ...resume.identity.cityLevelLocation.evidenceIds,
    ...resume.identity.links.flatMap(item => item.evidenceIds),
  ])
}

function timelineEvidenceIds(resume: ResumeEvidenceBundle) {
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  return new Set(resume.timeline
    .flatMap(item => item.evidenceIds)
    .filter(id => evidence.get(id)?.claimType === 'timeline'))
}

export function hasRenderableTimelineLine(
  timeline: ResumeEvidenceBundle['timeline'][number],
  evidence: ReadonlyMap<string, EvidenceAtom>
) {
  const hasScopeIdentity = Boolean(timeline.organization?.trim() || timeline.title?.trim())
  const hasDateRange = Boolean(timeline.start?.trim() || timeline.end?.trim())
  const hasUsableTimelineEvidence = timeline.evidenceIds.some(id => {
    const atom = evidence.get(id)
    return Boolean(
      atom
      && atom.claimType === 'timeline'
      && atom.status !== 'excluded'
      && !atom.riskFlags.includes('sensitive_pii')
    )
  })
  return hasScopeIdentity && hasDateRange && hasUsableTimelineEvidence
}

export function artifactEvidenceWhitelistIds(resume: ResumeEvidenceBundle, plan: V5ResumePlan) {
  return new Set([
    ...plannedContentEvidenceIds(resume, plan),
    ...identityEvidenceIds(resume),
    ...timelineEvidenceIds(resume),
  ])
}

export function buildDeterministicV5ResumePlan(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
  policy: GenerationPolicy
  profile: ResumeStrategyProfile
  targetingScores?: ReadonlyMap<string, number>
  targetingTaskEvidence?: ReadonlyMap<string, readonly string[]>
}): V5ResumePlan {
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const requirements = new Map(input.job.requirementAtoms.map(atom => [atom.requirementId, atom]))
  const timeline = new Map(input.resume.timeline.map(item => [item.scopeId, item]))
  const evidenceCatalog = buildEvidencePlanningCatalog(input.resume)
  const targetEvidenceScores = input.targetingScores ?? buildTargetEvidenceScores(input.resume, input.job)
  const requirementRoutes = buildRequirementEvidenceRoutes({
    resume: input.resume,
    job: input.job,
    match: input.match,
    catalog: evidenceCatalog,
  })
  const safeAtom = (id: string) => {
    const atom = evidence.get(id)
    return atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii') ? atom : null
  }
  const contentAtom = (id: string) => {
    const atom = safeAtom(id)
    if (!atom) return null
    if (atom.claimType === 'skill' || ANCILLARY_CLAIM_TYPES.has(atom.claimType)) return atom
    return BUSINESS_TYPES.has(atom.claimType) && isBusinessPlanningAnchor(evidenceCatalog, id) ? atom : null
  }
  const matchedItems = input.match.requirementMatches
    .filter(item => item.status === 'direct_match' || item.status === 'transferable_match')
    .filter(item => (requirementRoutes.byRequirement.get(item.requirementId)?.anchorEvidenceIds.length ?? 0) > 0)
  const matchedByRequirement = new Map(matchedItems.map(item => [
    item.requirementId,
    (requirementRoutes.byRequirement.get(item.requirementId)?.anchorEvidenceIds ?? [])
      .map(id => contentAtom(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom)),
  ]))
  const primaryRequirementIds = requirementRoutes.orderedRequirementIds
    .filter(id => requirements.has(id) && (matchedByRequirement.get(id)?.length ?? 0) > 0)
    .slice(0, 3)
  const primarySet = new Set(primaryRequirementIds)
  const matchesByEvidence = new Map<string, typeof matchedItems>()
  for (const matched of matchedItems) {
    for (const evidenceId of requirementRoutes.byRequirement.get(matched.requirementId)?.anchorEvidenceIds ?? []) {
      matchesByEvidence.set(evidenceId, [...(matchesByEvidence.get(evidenceId) ?? []), matched])
    }
  }
  const importanceRank = { core_outcome: 4, must_have: 3, differentiator: 2, nice_to_have: 1 } as const
  const atomRequirementVector = (atom: EvidenceAtom) => {
    const matches = matchesByEvidence.get(atom.evidenceId) ?? []
    return [
      matches.some(item => primarySet.has(item.requirementId)) ? 1 : 0,
      matches.some(item => primarySet.has(item.requirementId) && item.status === 'direct_match') ? 1 : 0,
      matches.reduce((best, item) => Math.max(
        best,
        importanceRank[requirements.get(item.requirementId)?.importance ?? 'nice_to_have']
      ), 0),
      matches.some(item => item.status === 'direct_match') ? 1 : 0,
    ]
  }
  const compareAtoms = (left: EvidenceAtom, right: EvidenceAtom) => {
    const relevanceDifference = Math.floor((targetEvidenceScores.get(right.evidenceId) ?? 0) / 2)
      - Math.floor((targetEvidenceScores.get(left.evidenceId) ?? 0) / 2)
    if (relevanceDifference) return relevanceDifference
    const leftVector = atomRequirementVector(left)
    const rightVector = atomRequirementVector(right)
    for (let index = 0; index < leftVector.length; index += 1) {
      if (leftVector[index] !== rightVector[index]) return rightVector[index] - leftVector[index]
    }
    return comparePlanningEvidence(left, right, evidenceCatalog)
  }
  const allEligibleBusiness = input.resume.evidenceAtoms
    .filter(atom => isBusinessPlanningAnchor(evidenceCatalog, atom.evidenceId))
    .sort(compareAtoms)
  const projectLikeByScope = new Map<string, EvidenceAtom[]>()
  for (const atom of allEligibleBusiness) {
    const kind = timeline.get(atom.sourceScopeId)?.kind
    if (kind !== 'project' && kind !== 'research') continue
    projectLikeByScope.set(atom.sourceScopeId, [...(projectLikeByScope.get(atom.sourceScopeId) ?? []), atom])
  }
  const permittedProjectScopeIds = new Set([...projectLikeByScope]
    .map(([scopeId, atoms]) => ({
      scopeId,
      primaryMatches: atoms.reduce((sum, atom) => sum + (matchesByEvidence.get(atom.evidenceId) ?? [])
        .filter(match => primarySet.has(match.requirementId)).length, 0),
      atomCount: atoms.length,
      bestAtom: [...atoms].sort(compareAtoms)[0],
    }))
    .sort((left, right) => (
      compareAtoms(left.bestAtom, right.bestAtom)
      || right.primaryMatches - left.primaryMatches
      || right.atomCount - left.atomCount
      || left.scopeId.localeCompare(right.scopeId)
    ))
    .slice(0, input.policy.hardProjectMax)
    .map(item => item.scopeId))
  const eligibleBusiness = allEligibleBusiness.filter(atom => {
    const kind = timeline.get(atom.sourceScopeId)?.kind
    return (kind !== 'project' && kind !== 'research') || permittedProjectScopeIds.has(atom.sourceScopeId)
  })
  const educationScopes = input.resume.timeline.filter(item => item.kind === 'education')
  const eligibleSkills = input.resume.evidenceAtoms
    .filter(atom => (
      atom.claimType === 'skill'
      && evidenceCatalog.assessments.get(atom.evidenceId)?.allowedUses.includes('skill_item')
    ))
    .sort(compareAtoms)
  const reservedItems = Math.min(
    Math.max(0, input.policy.hardTotalListItemMax - input.policy.targetBusinessBulletMin),
    Math.min(2, educationScopes.length) + Math.min(3, eligibleSkills.length)
  )
  const businessTarget = Math.min(
    eligibleBusiness.length,
    input.policy.targetBusinessBulletTarget,
    Math.max(input.policy.targetBusinessBulletMin, input.policy.hardTotalListItemMax - reservedItems)
  )
  const anchorIds: string[] = []
  const anchorSet = new Set<string>()
  const selectedScopeCounts = new Map<string, number>()
  const eligibleBusinessIds = new Set(eligibleBusiness.map(atom => atom.evidenceId))
  const addAnchor = (atom: EvidenceAtom | undefined) => {
    if (!atom || !eligibleBusinessIds.has(atom.evidenceId) || anchorSet.has(atom.evidenceId) || anchorIds.length >= businessTarget) return
    anchorSet.add(atom.evidenceId)
    anchorIds.push(atom.evidenceId)
    selectedScopeCounts.set(atom.sourceScopeId, (selectedScopeCounts.get(atom.sourceScopeId) ?? 0) + 1)
  }
  if (input.targetingTaskEvidence?.size) {
    // Cover supported core tasks before generic legacy qualifications consume the budget.
    const groups = [...input.targetingTaskEvidence.values()].map(ids => eligibleBusiness.filter(atom => ids.includes(atom.evidenceId)))
      .filter(atoms => atoms.length).sort((left, right) => compareAtoms(left[0], right[0]))
    for (const group of groups) {
      if (!group.some(atom => anchorSet.has(atom.evidenceId))) addAnchor(group[0])
    }
  } else {
    for (const requirementId of primaryRequirementIds) {
      addAnchor([...(matchedByRequirement.get(requirementId) ?? [])]
        .filter(atom => BUSINESS_TYPES.has(atom.claimType))
        .sort(compareAtoms)[0])
    }
  }
  while (anchorIds.length < businessTarget) {
    const candidates = eligibleBusiness
      .filter(atom => !anchorSet.has(atom.evidenceId))
      .map(atom => ({
        atom,
        selectedInScope: selectedScopeCounts.get(atom.sourceScopeId) ?? 0,
      }))
    const scopeCap = Math.max(2, Math.ceil(businessTarget / 3))
    const bounded = input.targetingScores ? candidates.filter(item => item.selectedInScope < scopeCap) : candidates
    const candidate = (bounded.length ? bounded : candidates).sort((left, right) => input.targetingScores
      ? compareAtoms(left.atom, right.atom) || left.selectedInScope - right.selectedInScope
      : (
        Number(left.selectedInScope > 0) - Number(right.selectedInScope > 0)
        || left.selectedInScope - right.selectedInScope
        || compareAtoms(left.atom, right.atom)
      ))[0]?.atom
    if (!candidate) break
    addAnchor(candidate)
  }
  const protectedClaimTypes = new Set<EvidenceAtom['claimType']>()
  const ensureClaimType = (claimType: EvidenceAtom['claimType']) => {
    if (anchorIds.some(id => evidence.get(id)?.claimType === claimType)) {
      protectedClaimTypes.add(claimType)
      return
    }
    const candidate = eligibleBusiness.find(atom => atom.claimType === claimType && !anchorSet.has(atom.evidenceId))
    if (!candidate || anchorIds.length === 0) return
    if (input.targetingScores && (targetEvidenceScores.get(candidate.evidenceId) ?? 0)
      < Math.min(...anchorIds.map(id => targetEvidenceScores.get(id) ?? 0))) return
    const replaceIndex = [...anchorIds]
      .map((id, index) => ({ id, index, atom: evidence.get(id)! }))
      .filter(item => !(matchesByEvidence.get(item.id) ?? []).some(match => primarySet.has(match.requirementId)))
      .filter(item => !protectedClaimTypes.has(item.atom.claimType))
      .sort((left, right) => compareAtoms(right.atom, left.atom) || right.id.localeCompare(left.id))[0]?.index
    if (replaceIndex === undefined) return
    const removed = evidence.get(anchorIds[replaceIndex])!
    anchorSet.delete(removed.evidenceId)
    selectedScopeCounts.set(removed.sourceScopeId, Math.max(0, (selectedScopeCounts.get(removed.sourceScopeId) ?? 1) - 1))
    anchorIds[replaceIndex] = candidate.evidenceId
    anchorSet.add(candidate.evidenceId)
    selectedScopeCounts.set(candidate.sourceScopeId, (selectedScopeCounts.get(candidate.sourceScopeId) ?? 0) + 1)
    protectedClaimTypes.add(claimType)
  }
  if (businessTarget >= 4) {
    ensureClaimType('result')
    ensureClaimType('deliverable')
  }
  const enrichmentLimit = Math.min(Math.floor(businessTarget / 2), eligibleBusiness.length - anchorIds.length)
  const enrichmentIds = eligibleBusiness
    .filter(atom => !anchorSet.has(atom.evidenceId))
    .filter(atom => (
      ['result', 'deliverable', 'action', 'responsibility'].includes(atom.claimType)
      || (evidenceCatalog.assessments.get(atom.evidenceId)?.boundedMetricCount ?? 0) > 0
    ))
    .filter(atom => {
      const selectedCount = selectedScopeCounts.get(atom.sourceScopeId) ?? 0
      return selectedCount > 0 && (
        selectedCount >= 2
        || ['project', 'research'].includes(timeline.get(atom.sourceScopeId)?.kind ?? '')
      )
    })
    .slice(0, enrichmentLimit)
    .map(atom => atom.evidenceId)
  const selectedBusinessIds = [...anchorIds, ...enrichmentIds]
  const selectedByScope = new Map<string, string[]>()
  for (const evidenceId of selectedBusinessIds) {
    const atom = evidence.get(evidenceId)!
    selectedByScope.set(atom.sourceScopeId, [...(selectedByScope.get(atom.sourceScopeId) ?? []), atom.evidenceId])
  }
  const duplicateScopes = duplicateTimelineOnlyScopes(input.resume, new Set(selectedByScope.keys()))
  const scopePlans: V5ResumePlan['scopePlans'] = input.resume.timeline
    .filter(item => ['experience', 'internship', 'project', 'research'].includes(item.kind))
    .map(item => {
      const selectedEvidenceIds = selectedByScope.get(item.scopeId) ?? []
      const bulletBudget = selectedScopeCounts.get(item.scopeId) ?? 0
      const isWork = item.kind === 'experience' || item.kind === 'internship'
      const hasVerifiedTimeline = hasRenderableTimelineLine(item, evidence)
      const treatment: V5ResumePlan['scopePlans'][number]['treatment'] = duplicateScopes.has(item.scopeId) ? 'omit' : isWork
        ? bulletBudget >= 2 ? 'expand' : bulletBudget === 1 ? 'compress' : hasVerifiedTimeline ? 'timeline_line' : 'omit'
        : bulletBudget > 0 ? 'include' : 'omit'
      return {
        scopeId: item.scopeId,
        scopeType: item.kind,
        treatment,
        selectedEvidenceIds,
        bulletBudget,
        rewriteAngle: '优先呈现岗位相关结果与交付物，同时保持原始 scope、数字、限定词、阶段和归因边界',
      }
    })
  let remainingListItems = Math.max(0, input.policy.hardTotalListItemMax - businessTarget)
  const educationEvidenceIds: string[] = []
  for (const item of educationScopes.slice(0, Math.min(2, remainingListItems))) {
    const selected = input.resume.evidenceAtoms
      .filter(atom => atom.sourceScopeId === item.scopeId && safeAtom(atom.evidenceId))
      .filter(atom => evidenceCatalog.assessments.get(atom.evidenceId)?.allowedUses.includes('ancillary_item'))
      .filter(atom => ['education', 'award'].includes(atom.claimType))
      .sort(compareAtoms)[0]
    if (selected) {
      educationEvidenceIds.push(selected.evidenceId)
      remainingListItems -= 1
    }
    const hasVerifiedTimeline = hasRenderableTimelineLine(item, evidence)
    scopePlans.push({
      scopeId: item.scopeId,
      scopeType: item.kind,
      treatment: selected ? 'include' : hasVerifiedTimeline ? 'timeline_line' : 'omit',
      selectedEvidenceIds: selected ? [selected.evidenceId] : [],
      bulletBudget: selected ? 1 : 0,
      rewriteAngle: '保留学校、专业或学位、日期和可核验教育事实',
    })
  }
  const featuredSkillEvidenceIds = eligibleSkills.slice(0, Math.min(3, remainingListItems)).map(atom => atom.evidenceId)
  remainingListItems -= featuredSkillEvidenceIds.length
  const ancillaryEvidenceIds = input.resume.evidenceAtoms
    .filter(atom => evidenceCatalog.assessments.get(atom.evidenceId)?.allowedUses.includes('ancillary_item'))
    .filter(atom => atom.claimType !== 'education' && !educationEvidenceIds.includes(atom.evidenceId))
    .sort(compareAtoms)
    .slice(0, remainingListItems)
    .map(atom => atom.evidenceId)
  const selectedPlanIds = [...selectedBusinessIds, ...featuredSkillEvidenceIds, ...educationEvidenceIds, ...ancillaryEvidenceIds]
  const customizedSet = new Set(selectedPlanIds.filter(id => (
    (matchesByEvidence.get(id) ?? []).some(match => primarySet.has(match.requirementId))
  )))
  const customizedEvidenceIds = selectedPlanIds.filter(id => customizedSet.has(id))
  const stableCoreEvidenceIds = selectedPlanIds.filter(id => !customizedSet.has(id))
  const evidencePillars = primaryRequirementIds.flatMap((requirementId, index) => {
    const evidenceIds = (matchedByRequirement.get(requirementId) ?? [])
      .map(atom => atom.evidenceId)
      .filter(id => selectedPlanIds.includes(id))
    if (evidenceIds.length === 0) return []
    return [{
      pillarId: `pillar_${index + 1}`,
      title: requirements.get(requirementId)?.normalizedRequirement ?? `核心需求 ${index + 1}`,
      requirementIds: [requirementId],
      evidenceIds,
      role: 'jd_primary' as const,
    }]
  })

  return {
    schemaVersion: input.resume.schemaVersion,
    strategyProfile: input.profile,
    generationPolicy: input.policy,
    targetValueProposition: input.match.positioning.statement,
    primaryRequirementIds,
    stableCoreEvidenceIds,
    customizedEvidenceIds,
    evidencePillars,
    scopePlans,
    featuredSkillEvidenceIds,
    safeKeywordMappings: [],
    forbiddenRequirementIds: input.match.requirementMatches
      .filter(item => item.status === 'currently_unproven')
      .map(item => item.requirementId),
    omittedHighValueEvidence: eligibleBusiness
      .filter(atom => !selectedBusinessIds.includes(atom.evidenceId))
      .filter(atom => (
        ['result', 'deliverable'].includes(atom.claimType)
        || (evidenceCatalog.assessments.get(atom.evidenceId)?.boundedMetricCount ?? 0) > 0
      ))
      .map(atom => ({
        evidenceId: atom.evidenceId,
        reason: `服务端质量排序后超出 ${businessTarget} 条业务正文目标及同 scope 安全合并容量`,
      })),
    lowerBoundException: null,
  }
}

export function validateV5ResumePlan(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
  plan: V5ResumePlan
  policy: GenerationPolicy
  profile: ResumeStrategyProfile
  gateMode?: V5ValidationGateMode
}): ValidationResult<V5ResumePlan> {
  const issues: ValidationIssue[] = []
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const evidenceCatalog = buildEvidencePlanningCatalog(input.resume)
  const requirementRoutes = buildRequirementEvidenceRoutes({
    resume: input.resume,
    job: input.job,
    match: input.match,
    catalog: evidenceCatalog,
  })
  const normalizedScopePlans = input.plan.scopePlans
  let normalizedPlan = input.plan
  const requirementIds = new Set(input.job.requirementAtoms.map(atom => atom.requirementId))
  const currentlyUnproven = new Set(input.match.requirementMatches
    .filter(item => item.status === 'currently_unproven')
    .map(item => item.requirementId))
  if (JSON.stringify(input.plan.generationPolicy) !== JSON.stringify(input.policy)) {
    issues.push(issue({
      code: 'POLICY_MUTATION',
      outputPath: 'generationPolicy',
      message: 'ResumePlan 修改了服务端固定 GenerationPolicy。',
      expectedConstraint: '计划必须逐字段保留服务端策略',
    }))
  }
  if (JSON.stringify(input.plan.strategyProfile) !== JSON.stringify(input.profile)) {
    issues.push(issue({
      code: 'STRATEGY_PROFILE_MUTATION',
      outputPath: 'strategyProfile',
      message: 'ResumePlan 修改了服务端固定 StrategyProfile。',
      expectedConstraint: '计划必须逐字段保留服务端自适应档案',
    }))
  }
  const allSelected = selectedPlanEvidence(input.plan)
  for (const evidenceId of allSelected) {
    const atom = evidence.get(evidenceId)
    if (!atom) {
      issues.push(issue({
        code: 'UNKNOWN_EVIDENCE_ID',
        outputPath: 'resumePlan',
        evidenceIds: [evidenceId],
        message: `计划引用不存在的 evidenceId：${evidenceId}`,
        expectedConstraint: '所有 evidenceId 必须存在于当前证据目录',
      }))
    } else if (atom.status === 'excluded') {
      issues.push(issue({
        code: 'EXCLUDED_EVIDENCE_SELECTED',
        outputPath: 'resumePlan',
        evidenceIds: [evidenceId],
        message: `计划选中了 excluded 证据：${evidenceId}`,
        expectedConstraint: 'excluded EvidenceAtom 绝对不得进入计划',
      }))
    } else if (atom.riskFlags.includes('sensitive_pii')) {
      issues.push(issue({
        code: 'SENSITIVE_PII_EVIDENCE_SELECTED',
        outputPath: 'resumePlan',
        evidenceIds: [evidenceId],
        message: `计划选中了 sensitive_pii 证据：${evidenceId}`,
        expectedConstraint: '详细隐私证据不得进入生成计划；身份联系方式只能走已验证 identity 字段',
      }))
    } else if (BUSINESS_TYPES.has(atom.claimType) && !isBusinessPlanningAnchor(evidenceCatalog, evidenceId)) {
      issues.push(issue({
        code: 'NON_STANDALONE_BUSINESS_EVIDENCE_SELECTED',
        outputPath: 'resumePlan',
        evidenceIds: [evidenceId],
        message: `计划把不能独立成句的业务证据作为正文：${evidenceId}`,
        expectedConstraint: 'fragment、metadata_only 和 supplement 只能留在路由目录中，当前单 atom 计划不得把它们独立用于正文',
      }))
    }
  }

  const evidenceRequiringAssignment = new Set([
    ...input.plan.stableCoreEvidenceIds,
    ...input.plan.customizedEvidenceIds,
    ...input.plan.evidencePillars.flatMap(item => item.evidenceIds),
    ...input.plan.safeKeywordMappings.flatMap(item => item.evidenceIds),
  ])
  const scopeAssignedEvidence = new Set(input.plan.scopePlans.flatMap(item => item.selectedEvidenceIds))
  const featuredSkillEvidence = new Set(input.plan.featuredSkillEvidenceIds)
  const unassignedEvidence = [...evidenceRequiringAssignment].filter(id => {
    const atom = evidence.get(id)
    if (!atom) return false
    if (BUSINESS_TYPES.has(atom.claimType) || atom.claimType === 'education') {
      return !scopeAssignedEvidence.has(id)
    }
    if (atom.claimType === 'skill') return !featuredSkillEvidence.has(id)
    if (ANCILLARY_CLAIM_TYPES.has(atom.claimType)) return false
    return true
  })
  if (unassignedEvidence.length > 0) {
    issues.push(issue({
      code: 'PLANNED_EVIDENCE_NOT_ASSIGNED',
      outputPath: 'scopePlans',
      evidenceIds: unassignedEvidence,
      message: 'stable/customized/pillar/keyword 证据没有分配到具体 scope 或 featured skills。',
      expectedConstraint: '业务和教育证据必须进入对应 scopePlans，技能必须 featured；证书/语言/奖项/论文/专利/作品集可由 stable/customized/pillar 显式选择',
    }))
  }
  const layerOverlap = input.plan.stableCoreEvidenceIds.filter(id => input.plan.customizedEvidenceIds.includes(id))
  if (layerOverlap.length > 0) {
    issues.push(issue({
      code: 'PLAN_LAYER_DUPLICATE',
      outputPath: 'stableCoreEvidenceIds',
      evidenceIds: layerOverlap,
      message: 'stable core 与 customized evidence 存在重复。',
      expectedConstraint: '两个用途列表保持不重复',
    }))
  }

  const timelineByScope = new Map(input.resume.timeline.map(item => [item.scopeId, item]))
  const scopePlans = new Map<string, V5ResumePlan['scopePlans']>()
  for (const plan of normalizedScopePlans) scopePlans.set(plan.scopeId, [...(scopePlans.get(plan.scopeId) ?? []), plan])
  for (const timeline of input.resume.timeline.filter(item => ['experience', 'internship', 'project', 'research'].includes(item.kind))) {
    const plans = scopePlans.get(timeline.scopeId) ?? []
    if (plans.length === 0) {
      issues.push(issue({
        code: 'SCOPE_PLAN_MISSING',
        outputPath: 'scopePlans',
        message: `业务 scope 缺少计划：${timeline.scopeId}`,
        expectedConstraint: '每个工作/实习/项目/研究 scope 必须恰好出现一次',
      }))
    } else if (plans.length > 1) {
      issues.push(issue({
        code: 'SCOPE_PLAN_DUPLICATE',
        outputPath: 'scopePlans',
        message: `业务 scope 出现多次计划：${timeline.scopeId}`,
        expectedConstraint: '每个业务 scope 必须恰好出现一次',
      }))
    }
  }

  for (const [index, scopePlan] of normalizedScopePlans.entries()) {
    const timeline = timelineByScope.get(scopePlan.scopeId)
    if (!timeline) {
      issues.push(issue({
        code: 'UNKNOWN_SCOPE_PLAN',
        outputPath: `scopePlans[${index}].scopeId`,
        message: `scope plan 引用了不存在的时间线 scope：${scopePlan.scopeId}`,
        expectedConstraint: 'scopePlans 只能引用 ResumeEvidenceBundle.timeline 中的 scope',
      }))
      continue
    }
    if (scopePlan.scopeType !== timeline.kind) {
      issues.push(issue({
        code: 'SCOPE_TYPE_MISMATCH',
        outputPath: `scopePlans[${index}].scopeType`,
        message: `scopeType=${scopePlan.scopeType} 与时间线 kind=${timeline.kind} 不一致。`,
        expectedConstraint: 'scopeType 必须逐字等于对应 timeline.kind',
      }))
    }
    const allowedTreatments = ['experience', 'internship'].includes(timeline.kind)
      ? new Set(['expand', 'compress', 'timeline_line', 'omit'])
      : ['project', 'research'].includes(timeline.kind)
        ? new Set(['include', 'omit'])
        : new Set(['include', 'timeline_line', 'omit'])
    if (!allowedTreatments.has(scopePlan.treatment)) {
      issues.push(issue({
        code: 'SCOPE_TREATMENT_MISMATCH',
        outputPath: `scopePlans[${index}].treatment`,
        message: `${timeline.kind} scope 不允许 treatment=${scopePlan.treatment}。`,
        expectedConstraint: `允许值：${[...allowedTreatments].join('|')}`,
      }))
    }
    const duplicatedEvidenceIds = duplicates(scopePlan.selectedEvidenceIds)
    if (duplicatedEvidenceIds.length > 0) {
      issues.push(issue({
        code: 'DUPLICATE_PLAN_EVIDENCE_ID',
        outputPath: `scopePlans[${index}].selectedEvidenceIds`,
        evidenceIds: duplicatedEvidenceIds,
        message: '同一 scope plan 重复选择了 EvidenceAtom。',
        expectedConstraint: 'selectedEvidenceIds 必须去重',
      }))
    }
    const selectedAtoms = scopePlan.selectedEvidenceIds
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(
        atom
        && atom.status !== 'excluded'
        && !atom.riskFlags.includes('sensitive_pii')
        && (!BUSINESS_TYPES.has(atom.claimType) || isBusinessPlanningAnchor(evidenceCatalog, atom.evidenceId))
      ))
    if (selectedAtoms.some(atom => atom.sourceScopeId !== scopePlan.scopeId)) {
      issues.push(issue({
        code: 'SCOPE_MIGRATION',
        outputPath: `scopePlans[${index}].selectedEvidenceIds`,
        evidenceIds: scopePlan.selectedEvidenceIds,
        message: 'scope plan 选择了其他 scope 的证据。',
        expectedConstraint: 'scope plan 只能选择相同 sourceScopeId 的证据',
      }))
    }
    const metadataEvidence = selectedAtoms.filter(atom => atom.claimType === 'identity' || atom.claimType === 'timeline')
    if (metadataEvidence.length > 0) {
      issues.push(issue({
        code: 'SCOPE_METADATA_SELECTED_AS_BODY',
        outputPath: `scopePlans[${index}].selectedEvidenceIds`,
        evidenceIds: metadataEvidence.map(atom => atom.evidenceId),
        message: 'scope plan 把身份或时间线元数据当作正文证据。',
        expectedConstraint: 'identity/timeline EvidenceAtom 只能用于已验证元数据展示，不得满足正文预算',
      }))
    }
    if (
      ['experience', 'internship', 'project', 'research'].includes(timeline.kind)
      && selectedAtoms.some(atom => !BUSINESS_TYPES.has(atom.claimType))
    ) {
      const nonBusinessEvidence = selectedAtoms.filter(atom => !BUSINESS_TYPES.has(atom.claimType))
      issues.push(issue({
        code: 'SCOPE_NON_BUSINESS_EVIDENCE',
        outputPath: `scopePlans[${index}].selectedEvidenceIds`,
        evidenceIds: nonBusinessEvidence.map(atom => atom.evidenceId),
        message: '工作、项目或研究 scope 把技能、教育或其他非业务事实计入了正文预算。',
        expectedConstraint: '业务 scope 只能选择 responsibility/action/deliverable/result EvidenceAtom',
      }))
    }
    if (scopePlan.treatment === 'omit') {
      if (scopePlan.selectedEvidenceIds.length > 0 || scopePlan.bulletBudget !== 0) {
        issues.push(issue({
          code: 'OMIT_WITH_BUSINESS_CLAIM',
          outputPath: `scopePlans[${index}]`,
          evidenceIds: scopePlan.selectedEvidenceIds,
          message: 'omit scope 仍携带正文证据或 bullet 预算。',
          expectedConstraint: 'omit 的 selectedEvidenceIds 必须为空且 bulletBudget 必须为 0',
        }))
      }
      continue
    }
    if (scopePlan.treatment === 'expand' && selectedAtoms.length < 2) {
      issues.push(issue({
        code: 'EXPAND_WITH_INSUFFICIENT_EVIDENCE',
        outputPath: `scopePlans[${index}]`,
        evidenceIds: scopePlan.selectedEvidenceIds,
        message: 'expand 少于 2 条独立合法证据。',
        expectedConstraint: '证据不足 2 条时必须降为 compress',
      }))
    }
    if (scopePlan.treatment === 'compress' && selectedAtoms.length < 1) {
      issues.push(issue({
        code: 'COMPRESS_WITHOUT_EVIDENCE',
        outputPath: `scopePlans[${index}]`,
        message: 'compress 没有正文证据。',
        expectedConstraint: '没有正文证据时只能 timeline_line',
      }))
    }
    if (scopePlan.treatment === 'timeline_line' && (selectedAtoms.length > 0 || scopePlan.bulletBudget !== 0)) {
      issues.push(issue({
        code: 'TIMELINE_WITH_BUSINESS_CLAIM',
        outputPath: `scopePlans[${index}]`,
        evidenceIds: scopePlan.selectedEvidenceIds,
        message: 'timeline_line 包含业务证据或 bullet 预算。',
        expectedConstraint: 'timeline_line 只能使用身份时间线元数据',
      }))
    }
    if (scopePlan.treatment === 'timeline_line') {
      const hasVerifiedTimeline = hasRenderableTimelineLine(timeline, evidence)
      if (!hasVerifiedTimeline) {
        issues.push(issue({
          code: 'TIMELINE_WITHOUT_VERIFIED_EVIDENCE',
          outputPath: `scopePlans[${index}]`,
          evidenceIds: timeline.evidenceIds,
          message: 'timeline_line 没有可验证的时间线证据，无法安全渲染。',
          expectedConstraint: '只有同时具备 organization/title 至少一项、start/end 至少一项及合法 timeline EvidenceAtom 的 scope 才能进入 timeline_line；否则必须 omit 或回到提取阶段修复',
        }))
      }
    }
    if (scopePlan.treatment === 'expand' && (scopePlan.bulletBudget < 2 || scopePlan.bulletBudget > selectedAtoms.length)) {
      issues.push(issue({
        code: 'INVALID_SCOPE_BULLET_BUDGET',
        outputPath: `scopePlans[${index}].bulletBudget`,
        message: 'expand 的 bulletBudget 必须在 2 与合法证据数量之间。',
        expectedConstraint: `2 <= bulletBudget <= ${selectedAtoms.length}`,
      }))
    }
    if (scopePlan.treatment === 'compress' && scopePlan.bulletBudget !== 1) {
      issues.push(issue({
        code: 'INVALID_SCOPE_BULLET_BUDGET',
        outputPath: `scopePlans[${index}].bulletBudget`,
        message: 'compress 必须保留且仅预算 1 条正文。',
        expectedConstraint: 'bulletBudget=1',
      }))
    }
    if (scopePlan.treatment === 'include' && selectedAtoms.length < 1) {
      issues.push(issue({
        code: 'INCLUDE_WITHOUT_EVIDENCE',
        outputPath: `scopePlans[${index}]`,
        message: 'include 项目/研究没有正文证据。',
        expectedConstraint: 'include 必须至少有一条证据',
      }))
    }
    if (scopePlan.treatment === 'include' && (scopePlan.bulletBudget < 1 || scopePlan.bulletBudget > selectedAtoms.length)) {
      issues.push(issue({
        code: 'INVALID_SCOPE_BULLET_BUDGET',
        outputPath: `scopePlans[${index}].bulletBudget`,
        message: 'include 的 bulletBudget 必须在 1 与合法证据数量之间。',
        expectedConstraint: `1 <= bulletBudget <= ${selectedAtoms.length}`,
      }))
    }
  }

  for (const evidenceId of input.plan.featuredSkillEvidenceIds) {
    if (evidence.get(evidenceId)?.claimType !== 'skill') {
      issues.push(issue({
        code: 'JD_ONLY_SKILL_SELECTED',
        outputPath: 'featuredSkillEvidenceIds',
        evidenceIds: [evidenceId],
        message: 'featured skill 未引用合法 skill EvidenceAtom。',
        expectedConstraint: '技能区只能使用 claimType=skill 的证据',
      }))
    }
  }
  const requirementStatus = new Map(input.match.requirementMatches.map(item => [item.requirementId, item.status]))
  const unsafeRequirement = [
    ...input.plan.primaryRequirementIds,
    ...input.plan.safeKeywordMappings.map(item => item.requirementId),
  ].filter(id => (
    !requirementIds.has(id)
    || !['direct_match', 'transferable_match'].includes(requirementStatus.get(id) ?? '')
  ))
  if (unsafeRequirement.length > 0) {
    issues.push(issue({
      code: 'DIRECT_MISSING_LEAKED_TO_STRATEGY',
      outputPath: 'primaryRequirementIds',
      requirementIds: unsafeRequirement,
      message: '不存在、未证明、不适用或存在冲突的需求进入了正文计划。',
      expectedConstraint: '只有 direct_match/transferable_match 可以进入正文计划；currently_unproven 必须 forbidden',
    }))
  }
  const missingForbidden = [...currentlyUnproven].filter(id => !input.plan.forbiddenRequirementIds.includes(id))
  if (missingForbidden.length > 0) {
    issues.push(issue({
      code: 'UNPROVEN_REQUIREMENT_NOT_FORBIDDEN',
      outputPath: 'forbiddenRequirementIds',
      requirementIds: missingForbidden,
      message: '存在 currently_unproven 需求未进入禁止正文列表。',
      expectedConstraint: '所有 currently_unproven requirement 必须明确 forbidden',
    }))
  }
  const projectCount = normalizedScopePlans.filter(item => (
    item.treatment === 'include'
    && ['project', 'research'].includes(timelineByScope.get(item.scopeId)?.kind ?? '')
  )).length
  const plannedContentEvidence = plannedContentEvidenceIds(input.resume, input.plan)
  const scopeAndSkillEvidence = plannedBodyEvidenceIds(input.plan)
  const ancillaryListItemBudget = [...plannedContentEvidence]
    .filter(id => !scopeAndSkillEvidence.has(id))
    .length
  const bulletBudget = normalizedScopePlans.reduce((sum, item) => sum + item.bulletBudget, 0)
    + input.plan.featuredSkillEvidenceIds.length
    + ancillaryListItemBudget
  if (projectCount > input.policy.hardProjectMax || bulletBudget > input.policy.hardTotalListItemMax) {
    issues.push(issue({
      code: 'PLAN_BUDGET_EXCEEDED',
      outputPath: 'scopePlans',
      message: `计划预算为 ${bulletBudget} 条、${projectCount} 个项目，超过策略硬上限。`,
      expectedConstraint: `最多 ${input.policy.hardTotalListItemMax} 条列表项、${input.policy.hardProjectMax} 个项目`,
    }))
  }

  const primaryIds = new Set(input.plan.primaryRequirementIds)
  const matchEvidenceByRequirement = new Map(input.match.requirementMatches.map(item => [
    item.requirementId,
    new Set(requirementRoutes.byRequirement.get(item.requirementId)?.anchorEvidenceIds ?? []),
  ]))
  for (const [index, pillar] of input.plan.evidencePillars.entries()) {
    const unknownRequirements = pillar.requirementIds.filter(id => !requirementIds.has(id))
    if (unknownRequirements.length > 0) {
      issues.push(issue({
        code: 'UNKNOWN_REQUIREMENT_ID',
        outputPath: `evidencePillars[${index}].requirementIds`,
        requirementIds: unknownRequirements,
        message: 'evidence pillar 引用了不存在的 RequirementAtom。',
        expectedConstraint: 'pillar requirementIds 必须来自当前 JobRequirementBundle',
      }))
    }
    const unmatchedRequirements = pillar.requirementIds.filter(requirementId => (
      requirementIds.has(requirementId)
      && !pillar.evidenceIds.some(id => matchEvidenceByRequirement.get(requirementId)?.has(id))
    ))
    if (unmatchedRequirements.length > 0) {
      issues.push(issue({
        code: 'PILLAR_EVIDENCE_NOT_MATCHED',
        outputPath: `evidencePillars[${index}]`,
        requirementIds: unmatchedRequirements,
        evidenceIds: pillar.evidenceIds,
        message: 'pillar 用与 RequirementMatch 无关的证据声明需求覆盖。',
        expectedConstraint: 'pillar 中每个 requirement 至少有一个 evidenceId 出现在对应 RequirementMatch 中',
      }))
    }
  }
  for (const [index, mapping] of input.plan.safeKeywordMappings.entries()) {
    const matchedEvidence = matchEvidenceByRequirement.get(mapping.requirementId)
    if (!matchedEvidence || !mapping.evidenceIds.some(id => matchedEvidence.has(id))) {
      issues.push(issue({
        code: 'KEYWORD_EVIDENCE_NOT_MATCHED',
        outputPath: `safeKeywordMappings[${index}]`,
        requirementIds: [mapping.requirementId],
        evidenceIds: mapping.evidenceIds,
        message: 'safe keyword mapping 没有对应 RequirementMatch 的证据支持。',
        expectedConstraint: '关键词对齐只能基于该需求已匹配的 EvidenceAtom',
      }))
    }
  }
  const primaryCovered = [...primaryIds].filter(requirementId => input.plan.evidencePillars.some(pillar => (
    pillar.requirementIds.includes(requirementId)
    && pillar.evidenceIds.some(id => matchEvidenceByRequirement.get(requirementId)?.has(id))
  ))).length
  const primaryRatio = input.plan.primaryRequirementIds.length === 0 ? 1 : primaryCovered / input.plan.primaryRequirementIds.length
  const eligibleBusinessEvidenceCount = evidenceCatalog.businessAnchorEvidenceIds.length
  const potentialPrimaryCovered = [...primaryIds].filter(requirementId => (
    (matchEvidenceByRequirement.get(requirementId)?.size ?? 0) > 0
  )).length
  const potentialPrimaryRatio = input.plan.primaryRequirementIds.length === 0
    ? 1
    : potentialPrimaryCovered / input.plan.primaryRequirementIds.length
  const lowerBoundExceptionEligible = eligibleBusinessEvidenceCount < input.policy.targetBusinessBulletMin
    || potentialPrimaryRatio < input.policy.primaryRequirementCoverageMin
  if (input.plan.lowerBoundException && !lowerBoundExceptionEligible) {
    issues.push(issue({
      code: 'LOWER_BOUND_EXCEPTION_NOT_ELIGIBLE',
      outputPath: 'lowerBoundException',
      message: '完整证据目录足以满足业务正文和核心需求覆盖，不能使用下限例外。',
      expectedConstraint: '只有服务端判断可用业务证据或可匹配核心需求证据不足时才允许例外',
    }))
  }
  if (lowerBoundExceptionEligible) {
    const reasons = [
      eligibleBusinessEvidenceCount < input.policy.targetBusinessBulletMin
        ? `可用业务证据 ${eligibleBusinessEvidenceCount} 条，低于策略下限 ${input.policy.targetBusinessBulletMin} 条`
        : null,
      potentialPrimaryRatio < input.policy.primaryRequirementCoverageMin
        ? `可证明核心需求覆盖率 ${potentialPrimaryRatio.toFixed(2)}，低于策略下限 ${input.policy.primaryRequirementCoverageMin.toFixed(2)}`
        : null,
    ].filter((reason): reason is string => Boolean(reason))
    normalizedPlan = {
      ...normalizedPlan,
      lowerBoundException: `服务端确定性下限例外：${reasons.join('；')}。`,
    }
  }
  const hasValidLowerBoundException = lowerBoundExceptionEligible
  const plannedBusinessBulletBudget = normalizedScopePlans
    .filter(item => ['experience', 'internship', 'project', 'research'].includes(timelineByScope.get(item.scopeId)?.kind ?? ''))
    .reduce((sum, item) => sum + item.bulletBudget, 0)
  if (plannedBusinessBulletBudget < input.policy.targetBusinessBulletMin && !hasValidLowerBoundException) {
    issues.push(issue({
      code: 'PLAN_BUSINESS_BUDGET_UNDER_TARGET',
      outputPath: 'scopePlans',
      message: `计划只有 ${plannedBusinessBulletBudget} 条业务正文预算，低于策略下限。`,
      expectedConstraint: `业务正文预算不少于 ${input.policy.targetBusinessBulletMin}`,
    }))
  }
  const targetExceptionEligible = eligibleBusinessEvidenceCount < input.policy.targetBusinessBulletTarget
  if (plannedBusinessBulletBudget < input.policy.targetBusinessBulletTarget && !targetExceptionEligible) {
    issues.push(issue({
      code: 'PLAN_QUALITY_UNDER_TARGET',
      outputPath: 'scopePlans',
      message: `计划只有 ${plannedBusinessBulletBudget} 条业务正文预算，虽然可能达到最低值，但低于质量目标 ${input.policy.targetBusinessBulletTarget}。`,
      expectedConstraint: '证据容量充足时必须达到服务端质量目标；minimum 只用于阻断下限，不能作为正常目标',
    }))
  }
  if (
    input.policy.targetBusinessBulletMin > input.policy.targetBusinessBulletTarget
    || input.policy.targetBusinessBulletTarget > input.policy.targetBusinessBulletMax
  ) {
    issues.push(issue({
      code: 'INVALID_BUSINESS_BULLET_POLICY',
      outputPath: 'generationPolicy',
      message: '业务正文预算不满足 min <= target <= max。',
      expectedConstraint: 'GenerationPolicy 的最小值、质量目标和最大值必须单调递增',
    }))
  }
  const selectedBusinessAtoms = [...plannedBodyEvidenceIds(normalizedPlan)]
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(atom && BUSINESS_TYPES.has(atom.claimType)))
  const eligibleBusinessScopes = new Set(evidenceCatalog.businessAnchorEvidenceIds
    .map(id => evidence.get(id)?.sourceScopeId)
    .filter((scopeId): scopeId is string => Boolean(scopeId)))
  const selectedBusinessScopes = new Set(selectedBusinessAtoms.map(atom => atom.sourceScopeId))
  const eligibleWorkScopeCount = [...eligibleBusinessScopes]
    .filter(scopeId => ['experience', 'internship'].includes(timelineByScope.get(scopeId)?.kind ?? ''))
    .length
  const eligibleProjectScopeCount = [...eligibleBusinessScopes]
    .filter(scopeId => ['project', 'research'].includes(timelineByScope.get(scopeId)?.kind ?? ''))
    .length
  const feasibleBusinessScopeCount = eligibleWorkScopeCount
    + Math.min(eligibleProjectScopeCount, input.policy.hardProjectMax)
  const requiredScopeCount = Math.min(
    feasibleBusinessScopeCount,
    plannedBusinessBulletBudget,
    Math.max(1, Math.ceil(input.policy.targetBusinessBulletTarget / 3))
  )
  if (selectedBusinessScopes.size < requiredScopeCount && !targetExceptionEligible) {
    issues.push(issue({
      code: 'PLAN_SCOPE_DIVERSITY_UNDER_TARGET',
      outputPath: 'scopePlans',
      evidenceIds: selectedBusinessAtoms.map(atom => atom.evidenceId),
      message: `计划只覆盖 ${selectedBusinessScopes.size} 个业务 scope，低于当前证据容量要求的 ${requiredScopeCount} 个。`,
      expectedConstraint: '富集简历必须覆盖多个相关职业或项目 scope，不能由单一经历垄断正文预算',
    }))
  }
  for (const claimType of ['result', 'deliverable'] as const) {
    const eligible = evidenceCatalog.businessAnchorEvidenceIds.some(id => {
      const atom = evidence.get(id)!
      return selectedBusinessScopes.has(atom.sourceScopeId) && hasHighValueEvidenceRole(atom, claimType)
    })
    if (eligible && input.policy.targetBusinessBulletTarget >= 4 && !selectedBusinessAtoms.some(atom => hasHighValueEvidenceRole(atom, claimType))) {
      issues.push(issue({
        code: 'PLAN_HIGH_VALUE_TYPE_OMITTED',
        outputPath: 'scopePlans',
        message: `已选经历存在完整 ${claimType} 事实，但质量计划全部遗漏了该类高价值内容。`,
        expectedConstraint: '已选经历有可用成果时须保留；按源文内容兼容复合事实，不因未选项目或单一模型标签阻断',
      }))
    }
  }
  const selectedIds = selectedPlanEvidence(normalizedPlan)
  const expectedOmittedHighValue = evidenceCatalog.businessAnchorEvidenceIds
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(atom))
    .filter(atom => (
      ['result', 'deliverable'].includes(atom.claimType)
      || (evidenceCatalog.assessments.get(atom.evidenceId)?.boundedMetricCount ?? 0) > 0
    ))
    .filter(atom => !selectedIds.has(atom.evidenceId))
    .map(atom => ({
      evidenceId: atom.evidenceId,
      reason: '服务端质量计划未选中；已显式记录，供召回率和人工抽查使用',
    }))
  if (!sameSet(
    normalizedPlan.omittedHighValueEvidence.map(item => item.evidenceId),
    expectedOmittedHighValue.map(item => item.evidenceId)
  )) {
    issues.push(issue({
      code: 'OMITTED_HIGH_VALUE_SERVER_ALIGNED',
      severity: 'warning',
      outputPath: 'omittedHighValueEvidence',
      evidenceIds: expectedOmittedHighValue.map(item => item.evidenceId),
      message: '高价值遗漏清单已由服务端按完整证据目录重算。',
      expectedConstraint: '所有未选中的结果、交付物和数字证据必须可审计，不能由模型隐瞒',
    }))
    normalizedPlan = { ...normalizedPlan, omittedHighValueEvidence: expectedOmittedHighValue }
  }
  if (primaryRatio < input.policy.primaryRequirementCoverageMin && !hasValidLowerBoundException) {
    issues.push(issue({
      code: 'PRIMARY_REQUIREMENT_UNDERCOVERED',
      outputPath: 'evidencePillars',
      message: 'primary requirement 覆盖低于策略下限且没有合法例外。',
      expectedConstraint: `覆盖率不低于 ${input.policy.primaryRequirementCoverageMin}`,
    }))
  }

  const gatedIssues = applyPlanGateMode(issues, input.gateMode ?? 'strict')
  return {
    passed: !gatedIssues.some(item => item.severity === 'error'),
    issues: gatedIssues,
    value: normalizedPlan,
  }
}

function countExactMarkdownLines(markdown: string, outputText: string) {
  const target = outputText.trim()
  if (!target || target.includes('\n')) return markdown.includes(target) ? 1 : 0
  return markdown.split(/\r?\n/).filter(line => line.trim() === target).length
}

export function measureArtifactMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  let currentSection: string | null = null
  let totalListItemCount = 0
  let businessBulletCount = 0
  let projectCount = 0
  for (const line of lines) {
    const section = line.trim().match(/^##\s+(.+)/)
    if (section) {
      currentSection = sectionKey(section[1])
      continue
    }
    if (/^###\s+/.test(line.trim()) && currentSection === 'project') projectCount += 1
    if (!/^\s*[-*+]\s+/.test(line)) continue
    totalListItemCount += 1
    if (currentSection && BUSINESS_SECTION_KEYS.has(currentSection)) {
      businessBulletCount += 1
    }
  }
  return {
    businessBulletCount,
    totalListItemCount,
    projectCount,
    cjkCharacterCount: (markdown.match(/[\u3400-\u9FFF]/gu) ?? []).length,
    wordCount: (markdown.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length,
  }
}

function structuralContentLines(markdown: string) {
  return markdown.split(/\r?\n/).map(line => line.trim()).filter(line => {
    if (!line || /^#{1,6}\s+/.test(line) || /^[-*_]{3,}$/.test(line)) return false
    if (/^(?:工作经历|项目经历|教育背景|专业技能|其他经历|Experience|Projects?|Education|Skills)$/i.test(line)) return false
    return true
  })
}

function sectionKey(title: string) {
  const normalized = title.toLowerCase().replace(/[*_`]/g, '').trim()
  if (/摘要|概述|简介|summary|profile/.test(normalized)) return 'summary'
  if (/工作|任职|实习|experience/.test(normalized)) return 'experience'
  if (/项目|project/.test(normalized)) return 'project'
  if (/论文|发表|publication/.test(normalized)) return 'publications'
  if (/研究|research/.test(normalized)) return 'research'
  if (/技能|skill/.test(normalized)) return 'skills'
  if (/教育|education/.test(normalized)) return 'education'
  if (/证书|certification/.test(normalized)) return 'certifications'
  if (/语言|language/.test(normalized)) return 'languages'
  if (/专利|patent/.test(normalized)) return 'patents'
  if (/荣誉|奖项|award|honou?r/.test(normalized)) return 'awards'
  if (/作品|portfolio/.test(normalized)) return 'portfolio'
  if (/其他|other/.test(normalized)) return 'other'
  return null
}

function timelineHeading(item: ResumeEvidenceBundle['timeline'][number]) {
  return [
    item.organization,
    item.title,
    [item.start, item.end].filter(Boolean).join(' - '),
  ].filter(Boolean).join('｜')
}

function timelineHeadingFormattingSignature(value: string) {
  return value.replace(/[\s｜|/·—–-]+/g, '')
}

function claimMarkdownContexts(markdown: string, outputText: string) {
  if (!outputText.trim() || outputText.includes('\n')) return []
  let currentSection: string | null = null
  let currentTimelineHeading: string | null = null
  let currentTimelineHeadingLineIndex: number | null = null
  const contexts: Array<{
    lineIndex: number
    section: string | null
    timelineHeading: string | null
    timelineHeadingLineIndex: number | null
  }> = []
  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    const section = line.trim().match(/^##\s+(.+)/)
    if (section) {
      currentSection = sectionKey(section[1])
      currentTimelineHeading = null
      currentTimelineHeadingLineIndex = null
      continue
    }
    const heading = line.trim().match(/^###\s+(.+)/)
    if (heading) {
      currentTimelineHeading = heading[1].trim()
      currentTimelineHeadingLineIndex = lineIndex
      continue
    }
    if (line.trim() === outputText.trim()) {
      contexts.push({
        lineIndex,
        section: currentSection,
        timelineHeading: currentTimelineHeading,
        timelineHeadingLineIndex: currentTimelineHeadingLineIndex,
      })
    }
  }
  return contexts
}

function timelineScopeByMarkdownHeadingLine(markdown: string, resume: ResumeEvidenceBundle) {
  const actualByKey = new Map<string, number[]>()
  let currentSection: string | null = null
  for (const [lineIndex, line] of markdown.split(/\r?\n/).entries()) {
    const section = line.trim().match(/^##\s+(.+)/)
    if (section) {
      currentSection = sectionKey(section[1])
      continue
    }
    const heading = line.trim().match(/^###\s+(.+)/)
    if (!heading || !currentSection) continue
    const key = `${currentSection}\u0000${heading[1].trim()}`
    actualByKey.set(key, [...(actualByKey.get(key) ?? []), lineIndex])
  }

  const expectedByKey = new Map<string, string[]>()
  for (const timeline of resume.timeline) {
    const heading = timelineHeading(timeline)
    if (!heading) continue
    const key = `${timelineSectionKey(timeline.kind)}\u0000${heading}`
    expectedByKey.set(key, [...(expectedByKey.get(key) ?? []), timeline.scopeId])
  }

  const scopeByLine = new Map<number, string>()
  for (const [key, lineIndexes] of actualByKey) {
    const scopeIds = expectedByKey.get(key) ?? []
    if (scopeIds.length !== lineIndexes.length) continue
    for (const [index, lineIndex] of lineIndexes.entries()) {
      scopeByLine.set(lineIndex, scopeIds[index])
    }
  }
  return scopeByLine
}

function hasSubstantiveScopeBody(lines: string[]) {
  return lines.some(line => {
    const value = line.trim()
    return Boolean(
      value
      && !/^[-*_]{3,}$/.test(value)
      && !/^(?:公司|岗位|时间|地点|角色)\s*[:：]/.test(value)
    )
  })
}

function pruneEmptyMarkdownScopes(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const emptyScopeLineIndexes = new Set<number>()

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^###\s+/.test(lines[index].trim())) continue
    let end = index + 1
    while (end < lines.length && !/^#{2,3}\s+/.test(lines[end].trim())) end += 1
    if (!hasSubstantiveScopeBody(lines.slice(index + 1, end))) emptyScopeLineIndexes.add(index)
  }

  const withoutEmptyScopes = lines.filter((_, index) => !emptyScopeLineIndexes.has(index))
  const emptySectionLineIndexes = new Set<number>()
  for (let index = 0; index < withoutEmptyScopes.length; index += 1) {
    if (!/^##\s+/.test(withoutEmptyScopes[index].trim())) continue
    let end = index + 1
    while (end < withoutEmptyScopes.length && !/^##\s+/.test(withoutEmptyScopes[end].trim())) end += 1
    if (!withoutEmptyScopes.slice(index + 1, end).some(line => line.trim())) emptySectionLineIndexes.add(index)
  }

  return withoutEmptyScopes
    .filter((_, index) => !emptySectionLineIndexes.has(index))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function isTimelineOutputPath(outputPath: string) {
  return outputPath.split(/[.\[\]]+/).some(segment => segment.toLowerCase() === 'timeline')
}

function timelineClaimScopeIds(
  claim: GeneratedResumeArtifact['claims'][number],
  evidence: ReadonlyMap<string, EvidenceAtom>
) {
  return [...new Set(claim.evidenceIds
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(atom && atom.claimType === 'timeline'))
    .map(atom => atom.sourceScopeId))]
}

function isHeadingOutputPath(outputPath: string) {
  return outputPath.split(/[.\[\]]+/).some(segment => segment.toLowerCase() === 'heading')
}

function isStandaloneDateRangeLine(value: string) {
  return /^(?:\d{4}(?:\s*[./年-]\s*\d{1,2}(?:月)?)?)\s*(?:-|–|—|至|到)\s*(?:\d{4}(?:\s*[./年-]\s*\d{1,2}(?:月)?)?|至今|现在|present)$/i.test(value.trim())
}

function normalizedTimelineDisplayLine(value: string) {
  return value.trim().replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').trim()
}

function isBareTimelineDisplayLine(value: string) {
  return !/^(?:#{1,6}|[-*+]|\d+[.)]|>)\s+/.test(value.trim())
}

function timelineSectionKey(kind: ResumeEvidenceBundle['timeline'][number]['kind']) {
  if (kind === 'experience' || kind === 'internship') return 'experience'
  if (kind === 'project') return 'project'
  if (kind === 'research') return 'research'
  if (kind === 'education') return 'education'
  return 'other'
}

function markdownSectionAtLine(lines: string[], targetIndex: number) {
  let currentSection: string | null = null
  for (let index = 0; index <= targetIndex; index += 1) {
    const heading = lines[index].trim().match(/^##\s+(.+)/)
    if (heading) currentSection = sectionKey(heading[1])
  }
  return currentSection
}

function normalizeArtifactMetadata(input: {
  artifact: GeneratedResumeArtifact
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
}) {
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const lines = input.artifact.markdown.split(/\r?\n/)
  const markerAlignedClaims = input.artifact.claims.map(claim => {
    if (countExactMarkdownLines(input.artifact.markdown, claim.outputText) === 1) return claim
    const target = claim.outputText.replace(/^[-*+]\s+/, '').trim()
    const candidates = lines.filter(line => line.trim().replace(/^[-*+]\s+/, '').trim() === target)
    return candidates.length === 1 ? { ...claim, outputText: candidates[0].trim() } : claim
  })
  const allowedTimelineEvidence = timelineEvidenceIds(input.resume)
  const timelineByScope = new Map(input.resume.timeline.map(item => [item.scopeId, item]))
  const scopePlanById = new Map(input.plan.scopePlans.map(item => [item.scopeId, item]))
  const claimedTimelineLineIndexes = new Set<number>()
  const timelineAlignedClaims = markerAlignedClaims.flatMap(claim => {
    if (!isTimelineOutputPath(claim.outputPath)) return [claim]
    const timelineEvidence = claim.evidenceIds.filter(id => allowedTimelineEvidence.has(id))
    if (timelineEvidence.length === 0) return [claim]
    const scopeIds = [...new Set(timelineEvidence
      .map(id => evidence.get(id)?.sourceScopeId)
      .filter((scopeId): scopeId is string => Boolean(scopeId)))]
    if (scopeIds.length !== 1) return [{ ...claim, evidenceIds: timelineEvidence }]
    const scopeId = scopeIds[0]
    const timeline = timelineByScope.get(scopeId)
    const matchingLineIndexes = lines.flatMap((line, index) => (
      !claimedTimelineLineIndexes.has(index)
      && isBareTimelineDisplayLine(line)
      && normalizedTimelineDisplayLine(line) === normalizedTimelineDisplayLine(claim.outputText)
        ? [index]
        : []
    ))
    if (matchingLineIndexes.length === 0) return []
    if (!timeline || scopePlanById.get(scopeId)?.treatment !== 'timeline_line') {
      return [{ ...claim, evidenceIds: timelineEvidence }]
    }
    const candidates = matchingLineIndexes.filter(index => (
      markdownSectionAtLine(lines, index) === timelineSectionKey(timeline.kind)
    ))
    if (candidates.length === 0) return []
    const lineIndex = candidates[0]
    const canonicalText = timelineHeading(timeline)
    if (!canonicalText) return []
    claimedTimelineLineIndexes.add(lineIndex)
    lines[lineIndex] = canonicalText
    return [{
      ...claim,
      outputPath: `timeline.${scopeId}`,
      outputText: canonicalText,
      evidenceIds: timelineEvidence,
    }]
  })
  const transformationAlignedClaims = timelineAlignedClaims.map(claim => {
    if (claim.transformation !== 'verbatim') return claim
    const atoms = claim.evidenceIds
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom))
    if (atoms.length !== 1) return claim
    const atom = atoms[0]
    if (
      normalizedVerbatimText(claim.outputText, claim.outputPath, atom)
      === normalizedVerbatimText(atom.verbatimText, claim.outputPath, atom)
    ) return claim
    return { ...claim, transformation: 'safe_paraphrase' as const }
  })
  const allowedTimelineHeadings = new Set(input.resume.timeline.map(timelineHeading).filter(Boolean))
  const headingRequirements = new Map<number, Set<string>>()
  const splitHeadingDateCandidates = new Map<number, { lineIndex: number; canonicalHeading: string }>()

  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].trim().match(/^###\s+(.+)/)
    if (!heading) continue
    const currentHeading = heading[1].trim()
    if (allowedTimelineHeadings.has(currentHeading)) {
      headingRequirements.set(index, new Set([currentHeading]))
      continue
    }
    let end = index + 1
    while (end < lines.length && !/^#{2,3}\s+/.test(lines[end].trim())) end += 1
    const dateLines = lines
      .slice(index + 1, end)
      .map((line, offset) => ({ line: line.trim(), index: index + 1 + offset }))
      .filter(item => isStandaloneDateRangeLine(item.line))
    for (const dateLine of dateLines) {
      const combined = timelineHeadingFormattingSignature(`${currentHeading}｜${dateLine.line}`)
      const matching = [...allowedTimelineHeadings].filter(candidate => timelineHeadingFormattingSignature(candidate) === combined)
      if (matching.length === 1) {
        headingRequirements.set(index, new Set([matching[0]]))
        splitHeadingDateCandidates.set(index, {
          lineIndex: dateLine.index,
          canonicalHeading: matching[0],
        })
        break
      }
    }
  }

  for (const claim of transformationAlignedClaims) {
    const claimLineIndexes = lines.flatMap((line, index) => line.trim() === claim.outputText.trim() ? [index] : [])
    if (claimLineIndexes.length !== 1) continue
    const atoms = claim.evidenceIds.map(id => evidence.get(id)).filter((atom): atom is EvidenceAtom => Boolean(atom))
    const businessScopes = [...new Set(atoms.filter(atom => BUSINESS_TYPES.has(atom.claimType)).map(atom => atom.sourceScopeId))]
    if (businessScopes.length !== 1) continue
    const requiredTimeline = timelineByScope.get(businessScopes[0])
    if (!requiredTimeline) continue
    const requiredHeading = timelineHeading(requiredTimeline)
    if (!requiredHeading) continue
    for (let index = claimLineIndexes[0] - 1; index >= 0; index -= 1) {
      if (/^##\s+/.test(lines[index].trim())) break
      if (!/^###\s+/.test(lines[index].trim())) continue
      const currentHeading = lines[index].trim().replace(/^###\s+/, '')
      const currentSignature = timelineHeadingFormattingSignature(currentHeading)
      const requiredSignature = timelineHeadingFormattingSignature(requiredHeading)
      if (currentSignature !== requiredSignature && !requiredSignature.startsWith(currentSignature)) break
      headingRequirements.set(index, new Set([...(headingRequirements.get(index) ?? []), requiredHeading]))
      break
    }
  }

  const structuralDateLineIndexes = new Set<number>()
  for (const [index, requirements] of headingRequirements) {
    if (requirements.size !== 1) continue
    const canonicalHeading = [...requirements][0]
    lines[index] = `### ${canonicalHeading}`
    const splitDate = splitHeadingDateCandidates.get(index)
    if (splitDate?.canonicalHeading === canonicalHeading) {
      structuralDateLineIndexes.add(splitDate.lineIndex)
    }
  }
  const structuralAlignedClaims = transformationAlignedClaims.filter(claim => {
    const matchingLineIndexes = lines.flatMap((line, index) => line.trim() === claim.outputText.trim() ? [index] : [])
    if (isHeadingOutputPath(claim.outputPath) && matchingLineIndexes.length === 0) return false
    return matchingLineIndexes.length === 0 || !matchingLineIndexes.every(index => (
      structuralDateLineIndexes.has(index) || /^###\s+/.test(lines[index].trim())
    ))
  })
  const redundantClaimIds = new Set<string>()
  const redundantClaimLineIndexes = new Set<number>()
  const seenBusinessEvidence = new Set<string>()
  for (const claim of structuralAlignedClaims) {
    if (/^identity(?:\.|\[|$)/i.test(claim.outputPath) || isTimelineOutputPath(claim.outputPath) || /summary/i.test(claim.outputPath)) continue
    const atoms = claim.evidenceIds.map(id => evidence.get(id)).filter((atom): atom is EvidenceAtom => Boolean(atom))
    const businessEvidenceIds = atoms.filter(atom => BUSINESS_TYPES.has(atom.claimType)).map(atom => atom.evidenceId)
    const isPureBusinessClaim = atoms.length === claim.evidenceIds.length && businessEvidenceIds.length === atoms.length
    const matchingLineIndexes = lines.flatMap((line, index) => line.trim() === claim.outputText.trim() ? [index] : [])
    if (
      isPureBusinessClaim
      && businessEvidenceIds.every(id => seenBusinessEvidence.has(id))
      && matchingLineIndexes.length === 1
    ) {
      redundantClaimIds.add(claim.claimId)
      redundantClaimLineIndexes.add(matchingLineIndexes[0])
      continue
    }
    for (const evidenceId of businessEvidenceIds) seenBusinessEvidence.add(evidenceId)
  }
  const claims = structuralAlignedClaims.filter(claim => !redundantClaimIds.has(claim.claimId))
  const retainedOutputTexts = new Set(claims.map(claim => claim.outputText.trim()))
  const markdown = pruneEmptyMarkdownScopes(lines
    .filter((line, index) => (
      !structuralDateLineIndexes.has(index)
      && !(redundantClaimLineIndexes.has(index) && !retainedOutputTexts.has(line.trim()))
    ))
    .join('\n'))
  const usedEvidenceIds = [...new Set(claims.flatMap(claim => claim.evidenceIds))]
  const plannedEvidenceIds = [...plannedContentEvidenceIds(input.resume, input.plan)]
  const omittedPlannedEvidenceIds = plannedEvidenceIds.filter(id => !usedEvidenceIds.includes(id))
  return {
    ...input.artifact,
    markdown,
    claims,
    usedEvidenceIds,
    omittedPlannedEvidenceIds,
    renderStats: measureArtifactMarkdown(markdown),
  }
}

function inspectMarkdownStructure(markdown: string) {
  const lines = markdown.split(/\r?\n/)
  const emptyScopes: string[] = []
  const sectionOrder: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const section = lines[index].match(/^##\s+(.+)/)
    if (section) {
      const key = sectionKey(section[1])
      if (key) sectionOrder.push(key)
    }
    const scope = lines[index].match(/^###\s+(.+)/)
    if (!scope) continue
    let end = index + 1
    while (end < lines.length && !/^#{2,3}\s+/.test(lines[end])) end += 1
    const body = hasSubstantiveScopeBody(lines.slice(index + 1, end))
    if (!body) emptyScopes.push(scope[1].trim())
  }
  return { emptyScopes, sectionOrder }
}

function attributionRank(level: EvidenceAtom['attributionLevel']) {
  return { unspecified: 0, supported: 1, contributed: 2, drove: 3, owned: 4 }[level]
}

function hasUnsafeStrongVerb(claim: string, atoms: EvidenceAtom[]) {
  if (!/(?:主导|统筹|独立|全权|全面负责|owned|led|spearheaded)/i.test(claim)) return false
  return !atoms.some(atom => /(?:主导|统筹|独立|全权|全面负责|owned|led|spearheaded)/i.test(`${atom.sourceActionVerb ?? ''} ${atom.verbatimText}`))
}

function normalizedNumbers(value: string) {
  return (value.match(NUMBER_PATTERN) ?? []).map(item => item.replace(/\s/g, ''))
}

function normalizedVerbatimText(value: string, outputPath: string, atom: EvidenceAtom) {
  let normalized = value.trim().replace(/^[-*+]\s+/, '').trim()
  if (/^identity\.name$/i.test(outputPath)) normalized = normalized.replace(/^#{1,6}\s+/, '').trim()
  if (atom.claimType === 'skill' && /^skills?(?:\.|\[|$)/i.test(outputPath)) {
    normalized = normalized.replace(/^(?:专业技能|技能|skills?)\s*[:：]\s*/i, '').trim()
  }
  return normalized
}

function canonicalProofText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    // Keep symbols that carry numeric range, sign, percentage or technology
    // semantics. Treating `400+` and `400` (or `C++` and `C`) as equal would
    // silently discard a source qualifier.
    .replace(/[^\p{L}\p{N}+<>≥≤~≈%％&/\-]+/gu, '')
}

function sourcePreservingClaimText(
  claim: GeneratedResumeArtifact['claims'][number],
  atoms: EvidenceAtom[]
) {
  if (atoms.length === 0) return false
  let displayed = normalizedVerbatimText(claim.outputText, claim.outputPath, atoms[0])
  if (/^summary(?:\.|\[|$)/i.test(claim.outputPath)) {
    displayed = displayed.replace(/^(?:职业概述|职业摘要|professional summary|summary)\s*[:：]\s*/i, '')
  }
  const output = canonicalProofText(displayed)
  const sources = atoms
    .map(atom => canonicalProofText(normalizedVerbatimText(atom.verbatimText, claim.outputPath, atom)))
    .filter(Boolean)
  if (!output || sources.length !== atoms.length) return false
  const displaySources = atoms.map(atom => canonicalProofText(BUSINESS_TYPES.has(atom.claimType)
    ? sourceBusinessDisplayText(atom.verbatimText) : normalizedVerbatimText(atom.verbatimText, claim.outputPath, atom)))
  if (output === displaySources.join('') && (atoms.length === 1
    || (displayed.match(/[；;]/g) ?? []).length >= atoms.length - 1
    || areCanonicalAdjacentSourceAtoms(atoms))) return true
  // A contiguous substring is not a proof of equivalent meaning: for example,
  // “从未负责…” contains “负责…”. Without an LLM fact judge, retain the whole
  // evidence unit (apart from presentation punctuation), or merge whole units.
  if (sources.length === 1) return sources[0] === output
  const hasSemicolonBoundaries = (displayed.match(/[；;]/g) ?? []).length >= sources.length - 1
  if (!hasSemicolonBoundaries) {
    return output === sources.join('') && areCanonicalAdjacentSourceAtoms(atoms)
  }
  // Original evidence units may themselves contain semicolons. Matching the
  // ordered, complete units proves preservation without mistaking their
  // internal punctuation for additional evidence boundaries.
  if (output === sources.join('')) return true

  const segments = displayed
    .split(/[；;]/)
    .map(canonicalProofText)
    .filter(Boolean)
  if (segments.length !== sources.length) return false
  const unmatched = [...sources]
  return segments.every(segment => {
    const index = unmatched.findIndex(source => source === segment)
    if (index < 0) return false
    unmatched.splice(index, 1)
    return true
  })
}

function unsupportedInternalLeakTokens(markdown: string, resume: ResumeEvidenceBundle) {
  const sourceTexts = resume.evidenceAtoms.map(atom => atom.verbatimText)
  return [...markdown.matchAll(INTERNAL_LEAK_PATTERN)]
    .map(match => match[0])
    .filter(token => !sourceTexts.some(text => text.includes(token)))
}

function validateClaimNumbers(claim: GeneratedResumeArtifact['claims'][number], atoms: EvidenceAtom[]) {
  const issues: ValidationIssue[] = []
  const allowedRaw = atoms.flatMap(atom => atom.numericAtoms.map(item => item.raw.replace(/\s/g, '')))
  const allowedVerbatim = atoms.map(atom => atom.verbatimText.replace(/\s/g, ''))
  for (const numeric of normalizedNumbers(claim.outputText)) {
    if (!allowedRaw.some(raw => raw.includes(numeric) || numeric.includes(raw)) && !allowedVerbatim.some(text => text.includes(numeric))) {
      issues.push(issue({
        code: 'NUMBER_MISMATCH',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: `输出数字“${numeric}”无法由 claim 的证据原子支持。`,
        expectedConstraint: '数字、单位、限定词、周期和归属必须来自同一证据',
      }))
    }
  }
  for (const atom of atoms) {
    for (const numericAtom of atom.numericAtoms) {
      if (!claim.outputText.includes(numericAtom.valueText)) continue
      const missingQualifier = numericAtom.qualifier && !claim.outputText.includes(numericAtom.qualifier)
      const sourceQualifier = QUALIFIERS.find(value => numericAtom.raw.includes(value))
      if (missingQualifier || (sourceQualifier && !claim.outputText.includes(sourceQualifier))) {
        issues.push(issue({
          code: 'QUALIFIER_LOSS',
          outputPath: claim.outputPath,
          claimId: claim.claimId,
          evidenceIds: claim.evidenceIds,
          message: `数字“${numericAtom.valueText}”丢失源限定词。`,
          expectedConstraint: '数字限定词不可拆分或改变',
        }))
      }
    }
  }
  return issues
}

export function validateGeneratedResumeArtifact(input: {
  artifact: GeneratedResumeArtifact
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
  gateMode?: V5ValidationGateMode
  /** Internal versioned Writer path only; never selected by an HTTP request. */
  textPolicy?: 'source_preserving' | 'supported_writing_v1'
}): ValidationResult<GeneratedResumeArtifact> {
  const issues: ValidationIssue[] = []
  const { resume, plan, policy } = input
  const evidenceCatalog = buildEvidencePlanningCatalog(resume)
  const artifact = normalizeArtifactMetadata({ artifact: input.artifact, resume, plan })
  const originalStructure = inspectMarkdownStructure(input.artifact.markdown)
  const normalizedStructure = inspectMarkdownStructure(artifact.markdown)
  if (normalizedStructure.emptyScopes.length < originalStructure.emptyScopes.length) {
    issues.push(issue({
      code: 'EMPTY_STRUCTURE_SERVER_PRUNED',
      severity: 'warning',
      outputPath: 'markdown',
      message: `服务端已删除 ${originalStructure.emptyScopes.length - normalizedStructure.emptyScopes.length} 个无正文的三级标题及其空章节。`,
      expectedConstraint: '空 scope 不承载候选人事实，必须省略且不得因此补造正文',
    }))
  }
  const originalClaims = new Map(input.artifact.claims.map(claim => [claim.claimId, claim]))
  const alignedTransformationClaims = artifact.claims.filter(claim => (
    originalClaims.get(claim.claimId)?.transformation !== claim.transformation
  ))
  if (alignedTransformationClaims.length > 0) {
    issues.push(issue({
      code: 'TRANSFORMATION_METADATA_SERVER_ALIGNED',
      severity: 'warning',
      outputPath: 'claims',
      evidenceIds: [...new Set(alignedTransformationClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已将 ${alignedTransformationClaims.length} 条非逐字 claim 的 transformation 从 verbatim 对齐为 safe_paraphrase。`,
      expectedConstraint: '只校正描述文本变换方式的元数据，不修改候选人事实文本',
    }))
  }
  if (
    !sameSet(input.artifact.usedEvidenceIds, artifact.usedEvidenceIds)
    || !sameSet(input.artifact.omittedPlannedEvidenceIds, artifact.omittedPlannedEvidenceIds)
  ) {
    issues.push(issue({
      code: 'ARTIFACT_EVIDENCE_SETS_SERVER_ALIGNED',
      severity: 'warning',
      outputPath: 'usedEvidenceIds/omittedPlannedEvidenceIds',
      message: '服务端已按 claims 与计划正文白名单重算 usedEvidenceIds 和 omittedPlannedEvidenceIds。',
      expectedConstraint: '集合元数据由服务端确定性计算，不修改 Markdown、claim 文本或证据映射',
    }))
  }
  const normalizedClaimsById = new Map(artifact.claims.map(claim => [claim.claimId, claim]))
  const timelineEvidenceAlignedClaims = input.artifact.claims.filter(claim => {
    const normalized = normalizedClaimsById.get(claim.claimId)
    return normalized && isTimelineOutputPath(claim.outputPath) && !sameSet(claim.evidenceIds, normalized.evidenceIds)
  })
  if (timelineEvidenceAlignedClaims.length > 0) {
    issues.push(issue({
      code: 'TIMELINE_EVIDENCE_SERVER_ALIGNED',
      severity: 'warning',
      outputPath: 'claims',
      evidenceIds: [...new Set(timelineEvidenceAlignedClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已从 ${timelineEvidenceAlignedClaims.length} 条时间线 claim 中移除非 timeline 证据引用。`,
      expectedConstraint: '时间线 claim 只描述已验证任职元数据，不得重复引用业务正文证据',
    }))
  }
  const canonicalizedTimelineClaims = input.artifact.claims.filter(claim => {
    const normalized = normalizedClaimsById.get(claim.claimId)
    return normalized
      && isTimelineOutputPath(claim.outputPath)
      && (normalized.outputPath !== claim.outputPath || normalized.outputText !== claim.outputText)
  })
  if (canonicalizedTimelineClaims.length > 0) {
    issues.push(issue({
      code: 'TIMELINE_CLAIMS_SERVER_CANONICALIZED',
      severity: 'warning',
      outputPath: 'markdown/claims',
      evidenceIds: [...new Set(canonicalizedTimelineClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已将 ${canonicalizedTimelineClaims.length} 条计划内 timeline_line 按唯一 timeline scope 规范为完整时间线文本和路径。`,
      expectedConstraint: '只使用同 scope 的已验证 timeline 元数据生成 organization｜title｜start - end，不改写业务正文',
    }))
  }
  const removedClaims = input.artifact.claims.filter(claim => !normalizedClaimsById.has(claim.claimId))
  const structuralHeadingClaims = removedClaims.filter(claim => (
    isHeadingOutputPath(claim.outputPath) || isStandaloneDateRangeLine(claim.outputText)
  ))
  const structuralHeadingClaimIds = new Set(structuralHeadingClaims.map(claim => claim.claimId))
  const staleClaims = removedClaims.filter(claim => (
    !structuralHeadingClaimIds.has(claim.claimId)
    && countExactMarkdownLines(input.artifact.markdown, claim.outputText) === 0
  ))
  const redundantClaims = removedClaims.filter(claim => (
    !structuralHeadingClaimIds.has(claim.claimId)
    && countExactMarkdownLines(input.artifact.markdown, claim.outputText) === 1
  ))
  if (structuralHeadingClaims.length > 0) {
    issues.push(issue({
      code: 'STRUCTURAL_HEADING_CLAIM_SERVER_PRUNED',
      severity: 'warning',
      outputPath: 'markdown/claims',
      evidenceIds: [...new Set(structuralHeadingClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已删除 ${structuralHeadingClaims.length} 条把三级标题或独立日期误登记为正文的 claim，并将时间线信息归入规范标题。`,
      expectedConstraint: '三级标题和其重复日期属于服务端结构，不作为候选人正文 claim',
    }))
  }
  if (staleClaims.length > 0) {
    issues.push(issue({
      code: 'STALE_TIMELINE_CLAIM_SERVER_PRUNED',
      severity: 'warning',
      outputPath: 'claims',
      evidenceIds: [...new Set(staleClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已删除 ${staleClaims.length} 条在 Markdown 中不存在的旧时间线 claim 元数据。`,
      expectedConstraint: '删除悬空 claim 记录，不增加、删除或改写 Markdown 事实文本',
    }))
  }
  if (redundantClaims.length > 0) {
    issues.push(issue({
      code: 'REDUNDANT_BUSINESS_CLAIM_SERVER_PRUNED',
      severity: 'warning',
      outputPath: 'markdown/claims',
      evidenceIds: [...new Set(redundantClaims.flatMap(claim => claim.evidenceIds))],
      message: `服务端已删除 ${redundantClaims.length} 条全部证据均已在前文使用的重复业务 claim 及其唯一对应行。`,
      expectedConstraint: '仅删除可由相同原子证据确定性证明完全重复的后置 claim；部分重叠继续阻断',
    }))
  }
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const companionAssemblyByMembers = new Map(deriveEvidenceAssemblies(resume, plan)
    .filter(assembly => assembly.kind.startsWith('companion_'))
    .map(assembly => [JSON.stringify(assembly.memberEvidenceIds), assembly]))
  const writingExcerpts = input.textPolicy === 'supported_writing_v1' ? deriveWritingSourceExcerpts(resume, plan) : []
  const timelineByScope = new Map(resume.timeline.map(item => [item.scopeId, item]))
  const scopePlanById = new Map(plan.scopePlans.map(item => [item.scopeId, item]))
  const plannedBody = plannedContentEvidenceIds(resume, plan)
  const allowedIdentityEvidence = identityEvidenceIds(resume)
  const allowedTimelineEvidence = timelineEvidenceIds(resume)
  const scopeIdsByHeading = new Map<string, Set<string>>()
  for (const timeline of resume.timeline) {
    const heading = timelineHeading(timeline)
    if (!heading) continue
    scopeIdsByHeading.set(heading, new Set([...(scopeIdsByHeading.get(heading) ?? []), timeline.scopeId]))
  }
  const scopeIdByHeadingLine = timelineScopeByMarkdownHeadingLine(artifact.markdown, resume)
  if (!artifact.markdown.trim()) {
    issues.push(issue({ code: 'EMPTY_MARKDOWN', message: 'Artifact markdown 为空。', expectedConstraint: '最终 Markdown 必须非空' }))
  }
  for (const duplicate of duplicates(artifact.claims.map(claim => claim.claimId))) {
    issues.push(issue({
      code: 'DUPLICATE_CLAIM_ID',
      claimId: duplicate,
      message: `claimId 重复：${duplicate}`,
      expectedConstraint: '每个 claimId 必须唯一',
    }))
  }

  const bodyEvidenceUse = new Map<string, string[]>()
  const verifiedBusinessClaimIds = new Set<string>()
  for (const claim of artifact.claims) {
    const isIdentityClaim = /^identity(?:\.|\[|$)/i.test(claim.outputPath)
    const companionAssembly = !isIdentityClaim
      && !isTimelineOutputPath(claim.outputPath)
      ? companionAssemblyByMembers.get(JSON.stringify(claim.evidenceIds))
      : undefined
    const companionEvidenceIds = new Set(companionAssembly?.memberEvidenceIds ?? [])
    for (const excerpt of writingExcerpts) {
      if (claim.evidenceIds.includes(excerpt.anchorEvidenceId) && claim.evidenceIds.includes(excerpt.evidenceId)) {
        companionEvidenceIds.add(excerpt.evidenceId)
      }
    }
    const markdownContexts = claimMarkdownContexts(artifact.markdown, claim.outputText)
    if (markdownContexts.length === 0) {
      issues.push(issue({
        code: 'CLAIM_TEXT_NOT_FOUND',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim.outputText 无法在 Markdown 中定位。',
        expectedConstraint: '每个 claim 文本必须出现在 Markdown',
      }))
    }
    const allowedForPath = isIdentityClaim
      ? allowedIdentityEvidence
      : isTimelineOutputPath(claim.outputPath)
        ? allowedTimelineEvidence
        : plannedBody
    const unplannedEvidence = claim.evidenceIds.filter(id => (
      !allowedForPath.has(id) && !companionEvidenceIds.has(id)
    ))
    if (unplannedEvidence.length > 0) {
      issues.push(issue({
        code: 'UNPLANNED_EVIDENCE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: unplannedEvidence,
        message: 'claim 使用了 ResumePlan 未分配到该输出区域的证据。',
        expectedConstraint: '正文只能使用 scopePlans/featured skills；身份与时间线只能使用各自已验证元数据证据',
      }))
    }
    const atoms = claim.evidenceIds.map(id => evidence.get(id)).filter((atom): atom is EvidenceAtom => Boolean(atom))
    const invalidAtoms = atoms.filter(atom => (
      atom.status === 'excluded'
      || (isIdentityClaim ? atom.claimType !== 'identity' : atom.riskFlags.includes('sensitive_pii'))
    ))
    if (atoms.length !== claim.evidenceIds.length || invalidAtoms.length > 0) {
      issues.push(issue({
        code: 'INVALID_CLAIM_EVIDENCE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 引用不存在、excluded、路径类型不匹配或正文敏感 PII EvidenceAtom。',
        expectedConstraint: '固定 identity 只接受 claimType=identity 且非 excluded 的证据；其他正文还必须排除 sensitive_pii',
      }))
      continue
    }
    if (isTimelineOutputPath(claim.outputPath)) {
      const timelineScopes = timelineClaimScopeIds(claim, evidence)
      const plannedAsTimelineLine = timelineScopes.length === 1
        && scopePlanById.get(timelineScopes[0])?.treatment === 'timeline_line'
      if (!plannedAsTimelineLine) {
        issues.push(issue({
          code: 'UNPLANNED_TIMELINE_CLAIM',
          outputPath: claim.outputPath,
          claimId: claim.claimId,
          evidenceIds: claim.evidenceIds,
          message: '非 timeline_line 计划下出现了独立时间线 claim，不能作为额外候选人陈述发布。',
          expectedConstraint: '独立 timeline claim 必须且只能对应一个 treatment=timeline_line 的已验证 scope；其他 scope 的时间线只允许作为三级结构标题',
        }))
      }
    }
    const businessScopes = new Set(atoms
      .filter(atom => BUSINESS_TYPES.has(atom.claimType))
      .map(atom => atom.sourceScopeId))
    const scopeMatchedContexts = businessScopes.size === 1
      ? markdownContexts.filter(context => {
          const assignedScope = context.timelineHeadingLineIndex === null
            ? undefined
            : scopeIdByHeadingLine.get(context.timelineHeadingLineIndex)
          if (assignedScope) return assignedScope === [...businessScopes][0]
          const headingScopes = context.timelineHeading
            ? scopeIdsByHeading.get(context.timelineHeading)
            : undefined
          return headingScopes?.has([...businessScopes][0]) === true
        })
      : markdownContexts
    if (markdownContexts.length > 1 && scopeMatchedContexts.length !== 1) {
      issues.push(issue({
        code: 'CLAIM_TEXT_AMBIGUOUS',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim.outputText 在相同 scope/章节内仍出现多次，无法由代码唯一定位。',
        expectedConstraint: '重复正文只有在各自证据 scope 能唯一对应时才允许',
      }))
    }
    const markdownContext = scopeMatchedContexts.length === 1
      ? scopeMatchedContexts[0]
      : markdownContexts[0] ?? null
    if (markdownContext?.section && BUSINESS_SECTION_KEYS.has(markdownContext.section)) {
      if (isTimelineOutputPath(claim.outputPath)) {
        if (atoms.some(atom => atom.claimType !== 'timeline')) {
          issues.push(issue({
            code: 'TIMELINE_BODY_EVIDENCE_MISMATCH',
            outputPath: claim.outputPath,
            claimId: claim.claimId,
            evidenceIds: claim.evidenceIds,
            message: 'timeline_line 使用了业务正文或其他非时间线证据。',
            expectedConstraint: 'timeline_line 只能引用 claimType=timeline 的已验证元数据',
          }))
        }
      } else {
        const assignedScope = markdownContext.timelineHeadingLineIndex === null
          ? undefined
          : scopeIdByHeadingLine.get(markdownContext.timelineHeadingLineIndex)
        const headingScopes = markdownContext.timelineHeading
          ? scopeIdsByHeading.get(markdownContext.timelineHeading)
          : undefined
        const invalidScope = assignedScope
          ? atoms.some(atom => atom.sourceScopeId !== assignedScope)
          : !headingScopes || atoms.some(atom => !headingScopes.has(atom.sourceScopeId))
        const nonBusinessAtoms = atoms.filter(atom => (
          !companionEvidenceIds.has(atom.evidenceId)
          && (
            !BUSINESS_TYPES.has(atom.claimType)
            || !isBusinessPlanningAnchor(evidenceCatalog, atom.evidenceId)
          )
        ))
        if (invalidScope) {
          issues.push(issue({
            code: 'MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH',
            outputPath: claim.outputPath,
            claimId: claim.claimId,
            evidenceIds: claim.evidenceIds,
            message: '业务正文所在三级标题与证据的 sourceScopeId 不一致，或正文缺少可验证 scope 标题。',
            expectedConstraint: '每条工作/项目/研究正文必须位于其同一 timeline scope 的完整标题下',
          }))
        }
        if (nonBusinessAtoms.length > 0) {
          issues.push(issue({
            code: 'BUSINESS_SCOPE_EVIDENCE_MISMATCH',
            outputPath: claim.outputPath,
            claimId: claim.claimId,
            evidenceIds: nonBusinessAtoms.map(atom => atom.evidenceId),
            message: '业务正文使用了非业务证据，或把不能独立成句的片段当作 bullet。',
            expectedConstraint: '工作、项目、研究和其他经历正文只能使用证据路由目录允许的独立 business anchor',
          }))
        }
        if (!invalidScope && nonBusinessAtoms.length === 0) verifiedBusinessClaimIds.add(claim.claimId)
      }
    }
    if (markdownContext?.section === 'skills' && atoms.some(atom => (
      atom.claimType !== 'skill' || !plan.featuredSkillEvidenceIds.includes(atom.evidenceId)
    ))) {
      issues.push(issue({
        code: 'SKILL_SECTION_EVIDENCE_MISMATCH',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '技能区使用了非 skill 或非 featuredSkillEvidenceIds 的证据。',
        expectedConstraint: '技能区只能引用计划明确选择的 skill EvidenceAtom',
      }))
    }
    const expectedAncillaryType = markdownContext?.section
      ? ANCILLARY_SECTION_CLAIM_TYPES[markdownContext.section]
      : undefined
    if (expectedAncillaryType && atoms.some(atom => atom.claimType !== expectedAncillaryType)) {
      issues.push(issue({
        code: 'ANCILLARY_SECTION_EVIDENCE_MISMATCH',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: `章节 ${markdownContext?.section} 使用了不属于该事实类型的证据。`,
        expectedConstraint: `该章节只能引用 claimType=${expectedAncillaryType} 的计划证据`,
      }))
    }
    const scopes = new Set(atoms.map(atom => atom.sourceScopeId))
    const isSummaryClaim = /^summary(?:\.|\[|$)/i.test(claim.outputPath)
    const invalidCrossScope = scopes.size > 1 && (!isSummaryClaim || claim.transformation === 'same_scope_merge')
    if (invalidCrossScope || (claim.transformation === 'same_scope_merge' && atoms.length < 2)) {
      issues.push(issue({
        code: 'SCOPE_MIGRATION',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 跨 scope 合并，或 same_scope_merge 未引用至少两个同 scope 证据。',
        expectedConstraint: '合并事实必须全部属于同一 sourceScopeId',
      }))
    }
    if (
      claim.transformation === 'verbatim'
      && (
        atoms.length !== 1
        || normalizedVerbatimText(claim.outputText, claim.outputPath, atoms[0])
          !== normalizedVerbatimText(atoms[0].verbatimText, claim.outputPath, atoms[0])
      )
    ) {
      issues.push(issue({
        code: 'TRANSFORMATION_CONTRACT_MISMATCH',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 声明 verbatim，但输出并非单一证据的逐字内容。',
        expectedConstraint: 'verbatim 必须逐字等于唯一 EvidenceAtom（允许 Markdown 列表符）',
      }))
    }
    if (
      !/^identity(?:\.|\[|$)/i.test(claim.outputPath)
      && !isTimelineOutputPath(claim.outputPath)
      && input.textPolicy !== 'supported_writing_v1'
      && !sourcePreservingClaimText(claim, atoms)
    ) {
      issues.push(issue({
        code: 'UNPROVABLE_CLAIM_TEXT',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 包含本地代码无法从引用证据逐字或受控压缩证明的新增语义。',
        expectedConstraint: '无 LLM 事实 Judge 时，正文只能完整保留单条证据，或用分号合并完整的同 scope 原文',
      }))
    }
    if (input.textPolicy === 'supported_writing_v1' && !isIdentityClaim && !isTimelineOutputPath(claim.outputPath)) {
      issues.push(...inspectSupportedWriting(claim.outputText, sourceAtomsForWritingInspection(atoms, writingExcerpts), claim.outputPath))
    }
    const weakestRank = Math.min(...atoms.map(atom => attributionRank(atom.attributionLevel)))
    if (attributionRank(claim.attributionLevel) > weakestRank || hasUnsafeStrongVerb(claim.outputText, atoms)) {
      issues.push(issue({
        code: 'ATTRIBUTION_UPGRADE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 的归因等级或贡献动词强于源证据。',
        expectedConstraint: '输出归因不得强于引用证据中的最弱共同级别',
      }))
    }
    issues.push(...validateClaimNumbers(claim, atoms))
    if (TENURE_PATTERN.test(claim.outputText) && !atoms.some(atom => TENURE_PATTERN.test(atom.verbatimText))) {
      issues.push(issue({
        code: 'DATE_DERIVED_TENURE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '输出出现源证据未明示的经验年限。',
        expectedConstraint: '不得从日期推算 X 年经验',
      }))
    }
    if (atoms.some(atom => atom.riskFlags.includes('future_or_planned')) && !/(?:规划|计划|方案|研究阶段|待立项|未上线|拟)/.test(claim.outputText)) {
      issues.push(issue({
        code: 'STAGE_UPGRADE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'future_or_planned 证据在输出中丢失阶段边界。',
        expectedConstraint: '规划、研究、未上线等限定必须保留',
      }))
    }
    if (atoms.some(atom => atom.riskFlags.includes('team_attribution')) && !/(?:团队|参与|协助|支持|配合|协同)/.test(claim.outputText)) {
      issues.push(issue({
        code: 'ATTRIBUTION_UPGRADE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '团队归因证据在输出中被写成无边界的个人成果。',
        expectedConstraint: 'team_attribution 必须保留团队或参与边界',
      }))
    }
    if (
      CAUSALITY_PATTERN.test(claim.outputText)
      && !atoms.some(atom => CAUSALITY_PATTERN.test(atom.verbatimText))
    ) {
      issues.push(issue({
        code: 'CAUSALITY_INVENTED',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: '输出新增了源证据没有明示的因果关系。',
        expectedConstraint: '只能并列压缩事实，不得把并列或相关改写为因果',
      }))
    }
    if (!/summary/i.test(claim.outputPath)) {
      for (const evidenceId of claim.evidenceIds) {
        if (!BUSINESS_TYPES.has(evidence.get(evidenceId)?.claimType ?? '')) continue
        bodyEvidenceUse.set(evidenceId, [...(bodyEvidenceUse.get(evidenceId) ?? []), claim.claimId])
      }
    }
  }

  const coveredLines = structuralContentLines(artifact.markdown)
  for (const line of coveredLines) {
    const normalized = line.replace(/^[-*+]\s+/, '').trim()
    if (!artifact.claims.some(claim => claim.outputText.trim() === line || claim.outputText.replace(/^[-*+]\s+/, '').trim() === normalized)) {
      issues.push(issue({
        code: 'UNMAPPED_OUTPUT_CLAIM',
        outputPath: null,
        message: `Markdown 中存在未映射候选人陈述：“${normalized.slice(0, 80)}”`,
        expectedConstraint: '每个候选人事实必须有 claim map',
      }))
    }
  }

  const claimEvidence = [...new Set(artifact.claims.flatMap(claim => claim.evidenceIds))]
  if (!sameSet(claimEvidence, artifact.usedEvidenceIds)) {
    issues.push(issue({
      code: 'USED_EVIDENCE_SET_MISMATCH',
      outputPath: 'usedEvidenceIds',
      evidenceIds: artifact.usedEvidenceIds,
      message: 'usedEvidenceIds 不等于 claims 引用集合。',
      expectedConstraint: 'usedEvidenceIds 必须由服务端按 claims 去重集合计算',
    }))
  }
  const plannedEvidence = [...plannedBody]
  const expectedOmitted = plannedEvidence.filter(id => !claimEvidence.includes(id))
  if (!sameSet(expectedOmitted, artifact.omittedPlannedEvidenceIds)) {
    issues.push(issue({
      code: 'OMITTED_PLANNED_SET_MISMATCH',
      outputPath: 'omittedPlannedEvidenceIds',
      evidenceIds: artifact.omittedPlannedEvidenceIds,
      message: 'omittedPlannedEvidenceIds 与计划正文白名单减去实际使用集合不一致。',
      expectedConstraint: '该字段必须由服务端按计划证据与 claims 引用集合重算',
    }))
  }
  if (expectedOmitted.length > 0) {
    issues.push(issue({
      code: 'PLANNED_EVIDENCE_OMITTED',
      outputPath: 'omittedPlannedEvidenceIds',
      evidenceIds: expectedOmitted,
      message: `成品遗漏了 ${expectedOmitted.length} 条计划内证据。`,
      expectedConstraint: '可交付成品必须使用全部计划证据；无法安全表达时应回到规划阶段调整，不能静默省略',
    }))
  }
  const contentClaims = artifact.claims.filter(claim => (
    !/^identity(?:\.|\[|$)/i.test(claim.outputPath)
    && !isTimelineOutputPath(claim.outputPath)
    && !/^summary(?:\.|\[|$)/i.test(claim.outputPath)
  ))
  for (const scopePlan of plan.scopePlans) {
    const timeline = resume.timeline.find(item => item.scopeId === scopePlan.scopeId)
    const plannedScopeEvidence = new Set(scopePlan.selectedEvidenceIds)
    const scopeContentClaims = contentClaims.filter(claim => claim.evidenceIds.some(id => plannedScopeEvidence.has(id)))
    const scopeTimelineClaims = artifact.claims.filter(claim => (
      isTimelineOutputPath(claim.outputPath)
      && (
        claim.outputPath === `timeline.${scopePlan.scopeId}`
        || timelineClaimScopeIds(claim, evidence).includes(scopePlan.scopeId)
      )
    ))
    if (scopePlan.treatment === 'timeline_line') {
      const canonicalTimeline = timeline ? timelineHeading(timeline) : ''
      if (
        !canonicalTimeline
        || scopeTimelineClaims.length !== 1
        || scopeTimelineClaims[0].outputText.trim() !== canonicalTimeline
        || countExactMarkdownLines(artifact.markdown, canonicalTimeline) !== 1
      ) {
        issues.push(issue({
          code: 'PLANNED_TIMELINE_MISSING',
          outputPath: `timeline.${scopePlan.scopeId}`,
          claimId: scopeTimelineClaims[0]?.claimId ?? null,
          evidenceIds: timeline?.evidenceIds ?? [],
          message: `计划中的 timeline_line 未在成品中恰好完整呈现：${scopePlan.scopeId}。`,
          expectedConstraint: '每个 timeline_line 必须由服务端验证的 organization｜title｜start - end 组成，并恰好出现一次',
        }))
      }
      if (scopeContentClaims.length > 0) {
        issues.push(issue({
          code: 'PLANNED_TIMELINE_HAS_BODY',
          outputPath: `timeline.${scopePlan.scopeId}`,
          evidenceIds: scopeContentClaims.flatMap(claim => claim.evidenceIds),
          message: 'timeline_line scope 出现了未计划的业务正文。',
          expectedConstraint: 'timeline_line 只展示任职元数据，不承载业务 claim',
        }))
      }
      continue
    }
    if (scopePlan.treatment === 'omit') {
      if (scopeContentClaims.length > 0 || scopeTimelineClaims.length > 0) {
        issues.push(issue({
          code: 'PLANNED_OMIT_SCOPE_RENDERED',
          outputPath: `scope.${scopePlan.scopeId}`,
          evidenceIds: [...scopeContentClaims, ...scopeTimelineClaims].flatMap(claim => claim.evidenceIds),
          message: '计划省略的 scope 仍出现在成品中。',
          expectedConstraint: 'treatment=omit 的 scope 必须零输出',
        }))
      }
      continue
    }
    if (scopeContentClaims.length !== scopePlan.bulletBudget) {
      issues.push(issue({
        code: 'PLANNED_SCOPE_UNDER_RENDERED',
        outputPath: `scope.${scopePlan.scopeId}`,
        evidenceIds: scopePlan.selectedEvidenceIds,
        message: `scope ${scopePlan.scopeId} 计划 ${scopePlan.bulletBudget} 条正文，实际生成 ${scopeContentClaims.length} 条。`,
        expectedConstraint: 'expand/compress/include 的实际正文数量必须与服务端计划预算一致',
      }))
    }
  }
  const summaryRequired = policy.summaryPolicy !== 'omit_if_unsupported'
    && policy.targetBusinessBulletTarget > 0
  const summaryClaims = artifact.claims.filter(claim => /^summary(?:\.|\[|$)/i.test(claim.outputPath))
  if (summaryRequired && summaryClaims.length === 0) {
    issues.push(issue({
      code: 'MISSING_REQUIRED_SECTION',
      outputPath: 'summary',
      message: '策略要求职业摘要，但成品没有摘要 claim。',
      expectedConstraint: `summaryPolicy=${policy.summaryPolicy} 时至少输出一条完全由计划证据支持的摘要`,
    }))
  }
  if (resume.identity.name.value && !artifact.claims.some(claim => (
    claim.outputPath === 'identity.name' && claim.outputText.replace(/^#\s+/, '').trim() === resume.identity.name.value
  ))) {
    issues.push(issue({
      code: 'MISSING_REQUIRED_IDENTITY',
      outputPath: 'identity.name',
      evidenceIds: resume.identity.name.evidenceIds,
      message: '源简历存在已验证姓名，但成品未呈现。',
      expectedConstraint: '已验证姓名必须由服务端结构层保留',
    }))
  }
  const availableContacts = [
    resume.identity.email.value ? 'identity.email' : null,
    resume.identity.phone.value ? 'identity.phone' : null,
    ...resume.identity.links.map((_, index) => `identity.links[${index}]`),
  ].filter((value): value is string => Boolean(value))
  if (availableContacts.length > 0 && !artifact.claims.some(claim => availableContacts.includes(claim.outputPath))) {
    issues.push(issue({
      code: 'MISSING_REQUIRED_IDENTITY',
      outputPath: 'identity.contact',
      message: '源简历存在已验证联系方式，但成品一个都没有保留。',
      expectedConstraint: '至少保留一个已授权且有证据的邮箱、电话或个人链接',
    }))
  }
  for (const [evidenceId, claimIds] of bodyEvidenceUse) {
    if (claimIds.length > 1) {
      issues.push(issue({
        code: 'DUPLICATE_EVIDENCE_USE',
        evidenceIds: [evidenceId],
        message: `同一业务证据在多个正文 claim 重复：${claimIds.join('、')}`,
        expectedConstraint: '同一业务 EvidenceAtom 在正文最多使用一次',
      }))
    }
  }

  const structure = inspectMarkdownStructure(artifact.markdown)
  const headings = artifact.markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)
  for (const heading of headings) {
    const level = heading[1].length
    const title = heading[2].trim()
    if (level === 1) {
      const allowed = new Set([resume.identity.name.value, 'Resume', '简历'].filter((value): value is string => Boolean(value)))
      if (!allowed.has(title)) {
        issues.push(issue({
          code: 'HEADING_POLICY_VIOLATION',
          outputPath: 'markdown',
          message: `一级标题不是已验证姓名或通用简历标题：“${title}”`,
          expectedConstraint: '一级标题只能使用已验证姓名；姓名为空时只能使用通用标题',
        }))
      }
    } else if (level === 2 && !sectionKey(title)) {
      issues.push(issue({
        code: 'HEADING_POLICY_VIOLATION',
        outputPath: 'markdown',
        message: `存在策略未识别的二级章节：“${title}”`,
        expectedConstraint: '二级章节必须属于 GenerationPolicy 允许的标准章节',
      }))
    } else if (level > 3) {
      issues.push(issue({
        code: 'HEADING_POLICY_VIOLATION',
        outputPath: 'markdown',
        message: `不允许使用 ${level} 级标题承载候选人事实。`,
        expectedConstraint: '仅允许一级姓名、二级章节和三级已验证时间线标题',
      }))
    }
  }
  for (const emptyScope of structure.emptyScopes) {
    issues.push(issue({
      code: 'EMPTY_SCOPE',
      outputPath: emptyScope,
      message: `工作或项目标题没有合法正文：${emptyScope}`,
      expectedConstraint: '独立工作/项目标题后必须至少一条正文',
    }))
  }
  const policyOrder = policy.sectionOrder.filter(item => structure.sectionOrder.includes(item))
  if (JSON.stringify(structure.sectionOrder) !== JSON.stringify(policyOrder)) {
    issues.push(issue({
      code: 'SECTION_ORDER_MISMATCH',
      outputPath: 'markdown',
      message: `章节顺序 ${structure.sectionOrder.join(' > ')} 不符合策略。`,
      expectedConstraint: policy.sectionOrder.join(' > '),
    }))
  }
  if (PLACEHOLDER_PATTERN.test(artifact.markdown)) {
    issues.push(issue({ code: 'PLACEHOLDER_PRESENT', message: 'Markdown 包含占位符。', expectedConstraint: '不得输出任何占位符' }))
  }
  const unsupportedInternalLeaks = unsupportedInternalLeakTokens(artifact.markdown, resume)
  if (unsupportedInternalLeaks.length > 0) {
    issues.push(issue({
      code: 'INTERNAL_AUDIT_LEAK',
      message: `Markdown 泄漏源简历未出现的内部字段或 ID：${[...new Set(unsupportedInternalLeaks)].join('、')}。`,
      expectedConstraint: '只拦截模型新增的内部字段或 ID；源简历中的 Prompt 等正常职业术语必须保留',
    }))
  }
  if (/```/.test(artifact.markdown)) {
    issues.push(issue({ code: 'INTERNAL_AUDIT_LEAK', message: 'Markdown 包含代码块。', expectedConstraint: '投递简历不得包含代码块' }))
  }
  if (DETAILED_ADDRESS_PATTERN.test(artifact.markdown)) {
    issues.push(issue({ code: 'PII_POLICY_VIOLATION', message: 'Markdown 可能包含详细住址或身份证件信息。', expectedConstraint: '只允许城市级地点和授权联系方式' }))
  }
  const emails = artifact.markdown.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  const allowedEmails = resume.identity.email.value ? [resume.identity.email.value.toLowerCase()] : []
  if (emails.some(value => !allowedEmails.includes(value.toLowerCase()))) {
    issues.push(issue({ code: 'PII_POLICY_VIOLATION', message: 'Markdown 出现未由身份证据授权的邮箱。', expectedConstraint: '联系方式必须来自已验证身份证据' }))
  }
  const phones = artifact.markdown.match(PHONE_PATTERN) ?? []
  const normalizedAllowedPhone = resume.identity.phone.value?.replace(/\D/g, '') ?? ''
  if (phones.some(value => value.replace(/\D/g, '') !== normalizedAllowedPhone)) {
    issues.push(issue({ code: 'PII_POLICY_VIOLATION', message: 'Markdown 出现未由身份证据授权的手机号。', expectedConstraint: '联系方式必须来自已验证身份证据' }))
  }
  const urls = artifact.markdown.match(URL_PATTERN) ?? []
  const allowedUrls = new Set(resume.identity.links.map(item => item.url.replace(/[.,;]+$/, '')))
  if (urls.some(value => !allowedUrls.has(value.replace(/[.,;]+$/, '')))) {
    issues.push(issue({ code: 'PII_POLICY_VIOLATION', message: 'Markdown 出现未由身份证据授权的链接。', expectedConstraint: '个人链接必须来自已验证身份证据' }))
  }

  const allowedTimelineHeadings = new Set(resume.timeline.map(timelineHeading).filter(Boolean))
  for (const heading of artifact.markdown.matchAll(/^###\s+(.+)$/gm)) {
    const title = heading[1].trim()
    if (!allowedTimelineHeadings.has(title)) {
      issues.push(issue({
        code: 'UNSUPPORTED_TIMELINE_TUPLE',
        outputPath: 'markdown',
        message: `三级标题无法整体对应同一条已验证时间线：“${title}”`,
        expectedConstraint: '三级标题必须逐字等于同一 timeline 条目的 organization｜title｜start - end 组合，禁止 scopeId',
      }))
    }
  }

  const stats = measureArtifactMarkdown(artifact.markdown)
  if (JSON.stringify(stats) !== JSON.stringify(artifact.renderStats)) {
    issues.push(issue({
      code: 'RENDER_STATS_MISMATCH',
      outputPath: 'renderStats',
      message: '模型 renderStats 与服务端重算不一致。',
      expectedConstraint: JSON.stringify(stats),
      severity: 'warning',
    }))
  }
  const lengthValue = policy.outputLength.unit === 'cjk_characters' ? stats.cjkCharacterCount : stats.wordCount
  if (stats.totalListItemCount > policy.hardTotalListItemMax || stats.projectCount > policy.hardProjectMax || lengthValue > policy.outputLength.hardMax) {
    issues.push(issue({
      code: 'BUDGET_EXCEEDED',
      outputPath: 'markdown',
      message: `服务端统计 ${stats.totalListItemCount} 条列表、${stats.projectCount} 个项目、长度 ${lengthValue}，超过硬预算。`,
      expectedConstraint: `列表<=${policy.hardTotalListItemMax}，项目<=${policy.hardProjectMax}，长度<=${policy.outputLength.hardMax}`,
    }))
  }
  if (policy.outputLength.hardMin !== null) {
    const countUnits = (value: string) => policy.outputLength.unit === 'cjk_characters'
      ? (value.match(/[\u3400-\u9FFF]/gu) ?? []).length
      : (value.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) ?? []).length
    const plannedSourceCapacity = [...plannedBody]
      .map(id => evidence.get(id)?.verbatimText ?? '')
      .reduce((sum, value) => sum + countUnits(value), 0)
    const timelineCapacity = plan.scopePlans
      .filter(item => item.treatment === 'timeline_line')
      .map(item => resume.timeline.find(timeline => timeline.scopeId === item.scopeId))
      .filter((item): item is ResumeEvidenceBundle['timeline'][number] => Boolean(item))
      .reduce((sum, item) => sum + countUnits(timelineHeading(item)), 0)
    const minimumPerBullet = policy.outputLength.unit === 'cjk_characters' ? 24 : 14
    const capacityAwareFloor = Math.max(
      policy.targetBusinessBulletTarget * minimumPerBullet,
      Math.floor((plannedSourceCapacity + timelineCapacity) * 0.5)
    )
    const effectiveHardMin = Math.min(policy.outputLength.hardMin, capacityAwareFloor)
    if (lengthValue < effectiveHardMin) {
      issues.push(issue({
        code: 'OUTPUT_CONTENT_UNDERSIZED',
        outputPath: 'markdown',
        message: `成品长度 ${lengthValue} 明显低于当前计划和源证据容量推导出的安全下限 ${effectiveHardMin}。`,
        expectedConstraint: '不能通过删除章节或极端压缩满足事实安全；长度不足时必须修复或阻断',
      }))
    }
  }

  const used = new Set(claimEvidence)
  const coverageEligible = (evidenceId: string) => {
    const atom = evidence.get(evidenceId)
    return Boolean(
      atom
      && atom.status !== 'excluded'
      && !atom.riskFlags.includes('sensitive_pii')
      && (!BUSINESS_TYPES.has(atom.claimType) || isBusinessPlanningAnchor(evidenceCatalog, evidenceId))
    )
  }
  const eligibleStable = plan.stableCoreEvidenceIds.filter(coverageEligible)
  const stableCoverage = eligibleStable.length === 0 ? 1
    : eligibleStable.filter(id => used.has(id)).length / eligibleStable.length
  const primaryEvidence = new Set(plan.evidencePillars
    .filter(pillar => pillar.requirementIds.some(id => plan.primaryRequirementIds.includes(id)))
    .flatMap(pillar => pillar.evidenceIds)
    .filter(coverageEligible))
  const primaryCoverage = primaryEvidence.size === 0
    ? (plan.primaryRequirementIds.length === 0 ? 1 : 0)
    : [...primaryEvidence].filter(id => used.has(id)).length / primaryEvidence.size
  const eligibleBusinessEvidenceCount = evidenceCatalog.businessAnchorEvidenceIds.length
  const lowerBoundExceptionEligible = Boolean(plan.lowerBoundException) && (
    eligibleBusinessEvidenceCount < policy.targetBusinessBulletTarget
    || (plan.primaryRequirementIds.length > 0 && primaryEvidence.size === 0)
  )
  const minimumBusinessBulletFloor = Math.min(
    policy.targetBusinessBulletMin,
    eligibleBusinessEvidenceCount
  )
  const verifiedBusinessBulletCount = verifiedBusinessClaimIds.size
  if (verifiedBusinessBulletCount < minimumBusinessBulletFloor) {
    issues.push(issue({
      code: 'MINIMUM_BUSINESS_CONTENT_MISSING',
      outputPath: 'markdown',
      message: `成品只有 ${verifiedBusinessBulletCount} 条经证据类型与 scope 验证的业务正文，低于代码底线 ${minimumBusinessBulletFloor} 条。`,
      expectedConstraint: '有可用业务证据时，成品至少达到策略 minimum；质量 target 仅用于告警',
    }))
  }
  if (
    stableCoverage < policy.stableCoreCoverageMin
    || (primaryCoverage < policy.primaryRequirementCoverageMin && !lowerBoundExceptionEligible)
    || (stats.businessBulletCount < policy.targetBusinessBulletTarget && !lowerBoundExceptionEligible)
  ) {
    issues.push(issue({
      code: 'PLAN_COVERAGE_REGRESSION',
      outputPath: 'usedEvidenceIds',
      evidenceIds: [...primaryEvidence].filter(id => !used.has(id)),
      message: `计划覆盖回归：stable=${stableCoverage.toFixed(2)}，primary=${primaryCoverage.toFixed(2)}，business=${stats.businessBulletCount}。`,
      expectedConstraint: `stable>=${policy.stableCoreCoverageMin}，primary>=${policy.primaryRequirementCoverageMin}，business>=${policy.targetBusinessBulletTarget} 或存在合法例外`,
    }))
  }

  const gatedIssues = applyGeneratedArtifactGateMode(issues, input.gateMode ?? 'strict')
  return {
    passed: !gatedIssues.some(item => item.severity === 'error'),
    issues: gatedIssues,
    value: { ...artifact, renderStats: stats },
  }
}

export function normalizeBlockingFactJudgeResult(
  result: BlockingFactJudgeResult,
  artifact: GeneratedResumeArtifact,
  resume: ResumeEvidenceBundle
): BlockingFactJudgeResult {
  const claims = new Map(artifact.claims.map(claim => [claim.claimId, claim]))
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const issues = result.issues.map(item => {
    const claim = item.claimId ? claims.get(item.claimId) : undefined
    const evidenceOutsideClaim = claim
      ? item.evidenceIds.filter(id => !claim.evidenceIds.includes(id))
      : item.evidenceIds
    const invalidMapping = !claim || evidenceOutsideClaim.length > 0
    if (invalidMapping) {
      return {
        ...item,
        severity: 'error' as const,
        code: 'claim_mapping_insufficient' as const,
        message: !claim
          ? `P09 issue 未映射到 Artifact 中真实存在的 claim：${item.claimId ?? 'null'}。`
          : `P09 issue 引用了该 claim 未使用的 evidenceIds：${evidenceOutsideClaim.join('、')}。`,
        safeRepairDirection: '拒绝使用该 Judge 结论放行，重新核对 claim 与 evidence 映射。',
      }
    }
    if (item.code === 'writing_quality_only') {
      return { ...item, severity: item.severity === 'info' ? 'info' as const : 'warning' as const }
    }
    const atoms = claim.evidenceIds
      .map(id => evidence.get(id))
      .filter((atom): atom is EvidenceAtom => Boolean(atom))
    const hasCompleteEvidence = atoms.length === claim.evidenceIds.length && atoms.length > 0
    const sameScope = hasCompleteEvidence && new Set(atoms.map(atom => atom.sourceScopeId)).size === 1
    const normalizedOutput = claim.outputText.replace(/^[-*+]\s+/, '').trim()
    const exactVerbatim = claim.transformation === 'verbatim'
      && atoms.length === 1
      && normalizedVerbatimText(claim.outputText, claim.outputPath, atoms[0])
        === normalizedVerbatimText(atoms[0].verbatimText, claim.outputPath, atoms[0])
    const exactSameScopeMerge = claim.transformation === 'same_scope_merge'
      && atoms.length >= 2
      && sameScope
      && normalizedOutput === atoms
        .map(atom => atom.verbatimText.trim().replace(/^[-*+]\s+/, '').trim())
        .join('；')
    const canonicalTimelineProof = isTimelineOutputPath(claim.outputPath)
      && sameScope
      && atoms.every(atom => atom.claimType === 'timeline')
      && resume.timeline.some(item => (
        item.scopeId === atoms[0]?.sourceScopeId && timelineHeading(item) === claim.outputText.trim()
      ))
    const sourcePreservingProof = exactVerbatim || exactSameScopeMerge || canonicalTimelineProof
    const semanticFactCode = item.code !== 'claim_mapping_insufficient'
    if (sourcePreservingProof && sameScope && semanticFactCode) {
      return {
        ...item,
        severity: 'warning' as const,
        message: `Judge 结论已被确定性源文保真证明否定：claim 仅逐字使用同一 sourceScopeId 的已映射证据。原结论：${item.message}`,
        safeRepairDirection: '无需改写；保留源文和现有 claim-evidence 映射。',
      }
    }
    return item
  })
  return {
    ...result,
    auditedClaimCount: artifact.claims.length,
    issues,
    passed: issues.every(item => item.severity !== 'error'),
  }
}

export function validateInterviewPreparation(input: {
  preparation: InterviewPreparation
  artifact: GeneratedResumeArtifact
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
}): ValidationResult<InterviewPreparation> {
  const issues: ValidationIssue[] = []
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const requirements = new Set(input.job.requirementAtoms.map(atom => atom.requirementId))
  const contexts = new Set(input.job.sourcedContext.map(item => item.contextId))
  const scopes = new Set(input.resume.timeline.map(item => item.scopeId))
  const checkReferences = (path: string, evidenceIds: string[], requirementIds: string[], contextIds: string[]) => {
    const invalidEvidence = evidenceIds.filter(id => !evidence.has(id) || evidence.get(id)?.status === 'excluded')
    const invalidRequirements = requirementIds.filter(id => !requirements.has(id))
    const invalidContexts = contextIds.filter(id => !contexts.has(id))
    if (invalidEvidence.length > 0 || invalidRequirements.length > 0 || invalidContexts.length > 0) {
      issues.push(issue({
        code: 'INVALID_INTERVIEW_REFERENCE',
        outputPath: path,
        evidenceIds: invalidEvidence,
        requirementIds: invalidRequirements,
        message: '面试建议包含不存在、excluded 或无来源的引用。',
        expectedConstraint: '所有 evidence/requirement/context ID 必须来自当前已验证输入',
      }))
    }
  }

  for (const [index, question] of input.preparation.questions.entries()) {
    checkReferences(
      `questions[${index}]`,
      question.relatedEvidenceIds,
      question.relatedRequirementIds,
      question.assumptionContextIds
    )
  }
  for (const [index, story] of input.preparation.storyRecommendations.entries()) {
    checkReferences(`storyRecommendations[${index}]`, story.evidenceIds, [], [])
    if (!scopes.has(story.scopeId) || story.evidenceIds.some(id => evidence.get(id)?.sourceScopeId !== story.scopeId)) {
      issues.push(issue({
        code: 'INTERVIEW_SCOPE_MISMATCH',
        outputPath: `storyRecommendations[${index}].scopeId`,
        evidenceIds: story.evidenceIds,
        message: '故事准备的 scope 与证据归属不一致。',
        expectedConstraint: '故事只能引用同一真实 source scope',
      }))
    }
    if (story.knownResult) {
      const atoms = story.evidenceIds.map(id => evidence.get(id)).filter((atom): atom is EvidenceAtom => Boolean(atom))
      const resultAtoms = atoms.filter(atom => atom.claimType === 'result' || atom.claimType === 'deliverable')
      const unsupportedNumbers = normalizedNumbers(story.knownResult).filter(number => (
        !resultAtoms.some(atom => atom.verbatimText.replace(/\s/g, '').includes(number))
      ))
      if (resultAtoms.length === 0 || unsupportedNumbers.length > 0) {
        issues.push(issue({
          code: 'UNSUPPORTED_INTERVIEW_RESULT',
          outputPath: `storyRecommendations[${index}].knownResult`,
          evidenceIds: story.evidenceIds,
          message: 'knownResult 没有结果/交付证据，或包含未授权数字。',
          expectedConstraint: '没有结果证据时 knownResult 必须为 null，并填写 preparationGap',
        }))
      }
    } else if (!story.preparationGap) {
      issues.push(issue({
        code: 'INTERVIEW_RESULT_GAP_MISSING',
        outputPath: `storyRecommendations[${index}].preparationGap`,
        evidenceIds: story.evidenceIds,
        message: 'knownResult 为空时缺少真实可核验信息准备提醒。',
        expectedConstraint: 'knownResult=null 时 preparationGap 必须非空',
      }))
    }
  }
  for (const [index, followUp] of input.preparation.followUpQuestions.entries()) {
    checkReferences(`followUpQuestions[${index}]`, [], followUp.relatedRequirementIds, followUp.assumptionContextIds)
  }

  return { passed: !issues.some(item => item.severity === 'error'), issues, value: input.preparation }
}
