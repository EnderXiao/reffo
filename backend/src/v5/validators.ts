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

const BUSINESS_TYPES = new Set(['responsibility', 'action', 'deliverable', 'result'])
const ANCILLARY_CLAIM_TYPES = new Set(['education', 'certification', 'language', 'award', 'publication', 'patent', 'portfolio_link'])
const PLACEHOLDER_PATTERN = /(?:\bXXX\b|待补充|公司名称|职位名称|项目名称|学校名称|\{\{[^}]+\}\})/i
const INTERNAL_LEAK_PATTERN = /(?:\bev_[a-f0-9]{8,}\b|\breq_[a-f0-9]{8,}\b|\bclaim[_-][a-z0-9]+\b|EvidenceAtom|claim map|Prompt|System Prompt|validationIssues|证据等级|内部审计)/i
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
      outputPath: 'scoreInputs',
      message: '模型 scoreInputs 与 RequirementMatch/EvidenceAtom 的服务端重算结果不一致。',
      expectedConstraint: JSON.stringify(expectedInputs),
    }))
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

export function artifactEvidenceWhitelistIds(resume: ResumeEvidenceBundle, plan: V5ResumePlan) {
  return new Set([
    ...plannedContentEvidenceIds(resume, plan),
    ...identityEvidenceIds(resume),
    ...timelineEvidenceIds(resume),
  ])
}

export function validateV5ResumePlan(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
  plan: V5ResumePlan
  policy: GenerationPolicy
  profile: ResumeStrategyProfile
}): ValidationResult<V5ResumePlan> {
  const issues: ValidationIssue[] = []
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const normalizedScopePlans = input.plan.scopePlans
  const normalizedPlan = input.plan
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
    }
  }

  const assignedAncillaryEvidence = plannedContentEvidenceIds(input.resume, input.plan)
  const evidenceRequiringAssignment = new Set([
    ...input.plan.stableCoreEvidenceIds,
    ...input.plan.customizedEvidenceIds,
    ...input.plan.evidencePillars.flatMap(item => item.evidenceIds),
    ...input.plan.safeKeywordMappings.flatMap(item => item.evidenceIds),
  ])
  const unassignedEvidence = [...evidenceRequiringAssignment].filter(id => !assignedAncillaryEvidence.has(id))
  if (unassignedEvidence.length > 0) {
    issues.push(issue({
      code: 'PLANNED_EVIDENCE_NOT_ASSIGNED',
      outputPath: 'scopePlans',
      evidenceIds: unassignedEvidence,
      message: 'stable/customized/pillar/keyword 证据没有分配到具体 scope 或 featured skills。',
      expectedConstraint: '业务证据必须进入 scopePlans，技能必须 featured；教育/证书/语言/奖项/论文/专利/作品集可由 stable/customized/pillar 显式选择',
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
        atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii')
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
    new Set(item.evidenceIds.filter(id => {
      const atom = evidence.get(id)
      return Boolean(atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii'))
    })),
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
  const eligibleBusinessEvidenceCount = input.resume.evidenceAtoms.filter(atom => (
    atom.status !== 'excluded'
    && !atom.riskFlags.includes('sensitive_pii')
    && BUSINESS_TYPES.has(atom.claimType)
  )).length
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
  const hasValidLowerBoundException = Boolean(input.plan.lowerBoundException && lowerBoundExceptionEligible)
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
  if (primaryRatio < input.policy.primaryRequirementCoverageMin && !hasValidLowerBoundException) {
    issues.push(issue({
      code: 'PRIMARY_REQUIREMENT_UNDERCOVERED',
      outputPath: 'evidencePillars',
      message: 'primary requirement 覆盖低于策略下限且没有合法例外。',
      expectedConstraint: `覆盖率不低于 ${input.policy.primaryRequirementCoverageMin}`,
    }))
  }

  return { passed: !issues.some(item => item.severity === 'error'), issues, value: normalizedPlan }
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

function claimMarkdownContext(markdown: string, outputText: string) {
  if (!outputText.trim() || outputText.includes('\n')) return null
  let currentSection: string | null = null
  let currentTimelineHeading: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const section = line.trim().match(/^##\s+(.+)/)
    if (section) {
      currentSection = sectionKey(section[1])
      currentTimelineHeading = null
      continue
    }
    const heading = line.trim().match(/^###\s+(.+)/)
    if (heading) {
      currentTimelineHeading = heading[1].trim()
      continue
    }
    if (line.trim() === outputText.trim()) {
      return { section: currentSection, timelineHeading: currentTimelineHeading }
    }
  }
  return null
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
    const body = lines.slice(index + 1, end).some(line => {
      const value = line.trim()
      return Boolean(value && !/^[-*_]{3,}$/.test(value) && !/^(?:公司|岗位|时间|地点|角色)\s*[:：]/.test(value))
    })
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
}): ValidationResult<GeneratedResumeArtifact> {
  const issues: ValidationIssue[] = []
  const { artifact, resume, plan, policy } = input
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const plannedBody = plannedContentEvidenceIds(resume, plan)
  const allowedIdentityEvidence = identityEvidenceIds(resume)
  const allowedTimelineEvidence = timelineEvidenceIds(resume)
  const scopeIdsByHeading = new Map<string, Set<string>>()
  for (const timeline of resume.timeline) {
    const heading = timelineHeading(timeline)
    if (!heading) continue
    scopeIdsByHeading.set(heading, new Set([...(scopeIdsByHeading.get(heading) ?? []), timeline.scopeId]))
  }
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
  for (const claim of artifact.claims) {
    const occurrences = countExactMarkdownLines(artifact.markdown, claim.outputText)
    if (occurrences === 0) {
      issues.push(issue({
        code: 'CLAIM_TEXT_NOT_FOUND',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim.outputText 无法在 Markdown 中定位。',
        expectedConstraint: '每个 claim 文本必须出现在 Markdown',
      }))
    } else if (occurrences > 1) {
      issues.push(issue({
        code: 'CLAIM_TEXT_AMBIGUOUS',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim.outputText 在 Markdown 中出现多次，无法唯一定位。',
        expectedConstraint: 'claim.outputText 必须可唯一定位',
      }))
    }
    const allowedForPath = /^identity(?:\.|\[|$)/i.test(claim.outputPath)
      ? allowedIdentityEvidence
      : /^timeline(?:\.|\[|$)/i.test(claim.outputPath)
        ? allowedTimelineEvidence
        : plannedBody
    const unplannedEvidence = claim.evidenceIds.filter(id => !allowedForPath.has(id))
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
    if (atoms.length !== claim.evidenceIds.length || atoms.some(atom => atom.status === 'excluded')) {
      issues.push(issue({
        code: 'INVALID_CLAIM_EVIDENCE',
        outputPath: claim.outputPath,
        claimId: claim.claimId,
        evidenceIds: claim.evidenceIds,
        message: 'claim 引用不存在或 excluded 的 EvidenceAtom。',
        expectedConstraint: 'claim 只能引用合法、可用证据',
      }))
      continue
    }
    const markdownContext = claimMarkdownContext(artifact.markdown, claim.outputText)
    if (markdownContext?.section && BUSINESS_SECTION_KEYS.has(markdownContext.section)) {
      if (/^timeline(?:\.|\[|$)/i.test(claim.outputPath)) {
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
        const headingScopes = markdownContext.timelineHeading
          ? scopeIdsByHeading.get(markdownContext.timelineHeading)
          : undefined
        if (!headingScopes || atoms.some(atom => !headingScopes.has(atom.sourceScopeId))) {
          issues.push(issue({
            code: 'MARKDOWN_SCOPE_ATTRIBUTION_MISMATCH',
            outputPath: claim.outputPath,
            claimId: claim.claimId,
            evidenceIds: claim.evidenceIds,
            message: '业务正文所在三级标题与证据的 sourceScopeId 不一致，或正文缺少可验证 scope 标题。',
            expectedConstraint: '每条工作/项目/研究正文必须位于其同一 timeline scope 的完整标题下',
          }))
        }
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
    if (scopes.size > 1 || (claim.transformation === 'same_scope_merge' && atoms.length < 2)) {
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
      && (atoms.length !== 1 || claim.outputText.replace(/^[-*+]\s+/, '').trim() !== atoms[0].verbatimText.trim())
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
  if (INTERNAL_LEAK_PATTERN.test(artifact.markdown)) {
    issues.push(issue({ code: 'INTERNAL_AUDIT_LEAK', message: 'Markdown 泄漏内部证据、Prompt 或审计话术。', expectedConstraint: '用户可见简历不得包含内部字段' }))
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

  const used = new Set(claimEvidence)
  const coverageEligible = (evidenceId: string) => {
    const atom = evidence.get(evidenceId)
    return Boolean(atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii'))
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
  const eligibleBusinessEvidenceCount = resume.evidenceAtoms.filter(atom => (
    atom.status !== 'excluded'
    && !atom.riskFlags.includes('sensitive_pii')
    && BUSINESS_TYPES.has(atom.claimType)
  )).length
  const lowerBoundExceptionEligible = Boolean(plan.lowerBoundException) && (
    eligibleBusinessEvidenceCount < policy.targetBusinessBulletMin
    || (plan.primaryRequirementIds.length > 0 && primaryEvidence.size === 0)
  )
  if (
    stableCoverage < policy.stableCoreCoverageMin
    || (primaryCoverage < policy.primaryRequirementCoverageMin && !lowerBoundExceptionEligible)
    || (stats.businessBulletCount < policy.targetBusinessBulletMin && !lowerBoundExceptionEligible)
  ) {
    issues.push(issue({
      code: 'PLAN_COVERAGE_REGRESSION',
      outputPath: 'usedEvidenceIds',
      evidenceIds: [...primaryEvidence].filter(id => !used.has(id)),
      message: `计划覆盖回归：stable=${stableCoverage.toFixed(2)}，primary=${primaryCoverage.toFixed(2)}，business=${stats.businessBulletCount}。`,
      expectedConstraint: `stable>=${policy.stableCoreCoverageMin}，primary>=${policy.primaryRequirementCoverageMin}，business>=${policy.targetBusinessBulletMin} 或存在合法例外`,
    }))
  }

  return {
    passed: !issues.some(item => item.severity === 'error'),
    issues,
    value: { ...artifact, renderStats: stats },
  }
}

export function normalizeBlockingFactJudgeResult(
  result: BlockingFactJudgeResult,
  artifact: GeneratedResumeArtifact
): BlockingFactJudgeResult {
  const claims = new Map(artifact.claims.map(claim => [claim.claimId, claim]))
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
