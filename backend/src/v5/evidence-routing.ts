import type {
  EvidenceAtom,
  JobRequirementBundle,
  RequirementAtom,
  RequirementMatch,
  ResumeEvidenceBundle,
  V5MatchAnalysis,
} from '@/v5/types'
import { hasEditorialSourceText, isBusinessMetadata, sourceBusinessDisplayText } from '@/v5/composition/source-display'
import { businessSourceContinuationGroups } from '@/v5/composition/source-continuation'

export const V5_EVIDENCE_ROUTING_VERSION = 'evidence-routing-v2' as const

export type EvidenceStandaloneClass = 'anchor' | 'supplement' | 'fragment' | 'metadata_only'
export type EvidencePlanningQuality = 'strong' | 'usable' | 'weak' | 'blocked'
export type EvidencePlanningUse = 'business_anchor' | 'same_scope_support' | 'skill_item' | 'ancillary_item'
export type EvidenceRoutingReason =
  | 'source_excluded'
  | 'unsafe_source_text'
  | 'invalid_business_scope'
  | 'adjacent_quantity_split'
  | 'adjacent_metric_split'
  | 'adjacent_continuation_split'
  | 'orphan_metric_fragment'
  | 'dangling_fragment'
  | 'metric_label_only'
  | 'context_only'
  | 'no_independent_business_action'
  | 'qualified_or_conflicting'
  | 'safe_business_anchor'
  | 'safe_skill_item'
  | 'safe_ancillary_item'
  | 'non_renderable_metadata'
  | 'editorial_source_text'

export interface EvidencePlanningAssessment {
  evidenceId: string
  sourceScopeId: string
  standaloneClass: EvidenceStandaloneClass
  quality: EvidencePlanningQuality
  allowedUses: EvidencePlanningUse[]
  reasonCodes: EvidenceRoutingReason[]
  boundedMetricCount: number
  sourceOrder: number
  previousEvidenceId: string | null
  nextEvidenceId: string | null
  continuationGroupId: string | null
}

export interface EvidencePlanningCatalog {
  version: typeof V5_EVIDENCE_ROUTING_VERSION
  assessments: ReadonlyMap<string, EvidencePlanningAssessment>
  orderedEvidenceIds: string[]
  businessAnchorEvidenceIds: string[]
}

export type RequirementPlanningDisposition = 'primary_candidate' | 'secondary_candidate' | 'unroutable'

export interface RequirementEvidenceRoute {
  requirementId: string
  modelStatus: RequirementMatch['status']
  planningDisposition: RequirementPlanningDisposition
  anchorEvidenceIds: string[]
  supportingEvidenceIds: string[]
  rejectedEvidenceIds: string[]
}

export interface RequirementEvidenceRoutes {
  version: typeof V5_EVIDENCE_ROUTING_VERSION
  byRequirement: ReadonlyMap<string, RequirementEvidenceRoute>
  orderedRequirementIds: string[]
}

const BUSINESS_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>(['responsibility', 'action', 'deliverable', 'result'])
const ANCILLARY_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'education',
  'certification',
  'language',
  'award',
  'publication',
  'patent',
  'portfolio_link',
])
const BUSINESS_SCOPE_KINDS = new Set(['experience', 'internship', 'project', 'research'])
const UNSAFE_RISK_FLAGS = new Set(['sensitive_pii', 'prompt_injection_like_text', 'future_or_planned'])
const QUALIFIED_RISK_FLAGS = new Set(['uncertain', 'conflicting'])

const BUSINESS_ACTION_PATTERN = /(?:主导|负责|推动|推进|参与|协同|协调|组织|搭建|建立|设计|开发|建设|交付|完成|落地|上线|发布|迭代|优化|改进|分析|调研|访谈|验证|制定|规划|管理|维护|运营|实现|解决|支持|执行|产出|形成|取得|提升|降低|增长|减少|节省|覆盖|触达|转化|留存|恢复|替代|达成|管理|led|owned|drove|built|designed|developed|delivered|launched|implemented|improved|increased|reduced|analyzed|researched|managed|supported|shipped|created|achieved|completed|collaborated|coordinated)/i
const RESULT_CONTEXT_PATTERN = /(?:率|量|额|数|时长|周期|成本|收入|营收|销量|用户|客户|门店|员工|任务|功能|版本|需求|项目|案例|问卷|访谈|覆盖|触达|完成|交付|上线|发布|提升|降低|增长|减少|节省|转化|留存|日活|月活|吞吐|延迟|可用性|准确率|满意度|revenue|users?|customers?|stores?|features?|versions?|conversion|retention|latency|availability|accuracy|throughput)/i
const METRIC_LABEL_PATTERN = /(?:完成率|转化率|留存率|及时率|准确率|满意度|覆盖率|成功率|使用率|增长率|替代率|成本|收入|营收|销量|时长|周期|日活|月活|吞吐|延迟|可用性|指标|metric|rate|revenue|latency|availability|accuracy)$/i
const CONTEXT_ONLY_PATTERN = /^(?:背景|问题|目标|项目背景|项目目标|业务背景|挑战|难点|context|background|objective)\s*[:：]?/i
const CONTINUATION_START_PATTERN = /^(?:的|并|且|以及|同时|其中|包括|此外|从而|进而|及|与|和|、|，|,|；|;)/
const CHINESE_QUANTITY_UNIT_PATTERN = /^(?:家|份|人|个|项|次|万|亿|千|百|天|周|月|年|小时|分钟|元|万元|亿元|台|套|款|场|篇|条|座|所|组|类|%|％)/
const DANGLING_QUANTITY_PATTERN = /(?:\d+(?:[.,]\d+)?\s*\+?)$/
const DANGLING_METRIC_PREFIX_PATTERN = /(?:提升至|提高至|增长至|降低至|减少至|达到|累计|月均|日均|按时完成率|完成率|转化率|留存率|及时率|准确率|满意度|覆盖率|成功率|使用率|增长率|替代率)$/i
const STARTS_WITH_NUMBER_PATTERN = /^(?:约|近|超过|超|至少|最多|不足|逾)?\s*[¥￥$]?\s*\d/
const SENTENCE_END_PATTERN = /[。！？.!?]$/
const DANGLING_PUNCTUATION_PATTERN = /(?:[,，、:：;；/]|(?:以及|并|且|和|与))$/
const SOURCE_NUMBER_PATTERN = /(?:约|近|超过|超|至少|最多|不足|逾)?\s*(?:[¥￥$]\s*)?\d+(?:[.,]\d+)*(?:\s*(?:%|％|\+|万|亿|千|百|人|次|个|项|家|份|台|套|款|场|篇|条|座|所|组|类|天|周|月|年|小时|分钟|元|万元|亿元|QPS|ms|MB|GB))?/gi
const EXPLICIT_NUMBER_BOUND_PATTERN = /(?:[¥￥$]|%|％|\+|万|亿|千|百|人|次|个|项|家|份|台|套|款|场|篇|条|座|所|组|类|天|周|月|年|小时|分钟|元|万元|亿元|QPS|ms|MB|GB)/i

const importanceRank: Record<RequirementAtom['importance'], number> = {
  core_outcome: 4,
  must_have: 3,
  differentiator: 2,
  nice_to_have: 1,
}

const qualityRank: Record<EvidencePlanningQuality, number> = {
  strong: 3,
  usable: 2,
  weak: 1,
  blocked: 0,
}

const claimTypeRank: Partial<Record<EvidenceAtom['claimType'], number>> = {
  result: 4,
  deliverable: 3,
  action: 2,
  responsibility: 1,
  skill: 1,
}

function stableAtomOrder(left: EvidenceAtom, right: EvidenceAtom) {
  return left.sourceSpan.start - right.sourceSpan.start
    || left.sourceSpan.end - right.sourceSpan.end
    || left.sourceBlockId.localeCompare(right.sourceBlockId)
    || left.evidenceId.localeCompare(right.evidenceId)
}

function sameScopeAdjacent(left: EvidenceAtom, right: EvidenceAtom) {
  if (left.sourceScopeId !== right.sourceScopeId) return false
  if (left.sourceBlockId === right.sourceBlockId) return false
  const leftBlockOrdinal = /^B(\d+)$/.exec(left.sourceBlockId)?.[1]
  const rightBlockOrdinal = /^B(\d+)$/.exec(right.sourceBlockId)?.[1]
  if (
    leftBlockOrdinal === undefined
    || rightBlockOrdinal === undefined
    || Number(rightBlockOrdinal) !== Number(leftBlockOrdinal) + 1
  ) return false
  const gap = right.sourceSpan.start - left.sourceSpan.end
  return gap >= 0 && gap <= 4
}

function normalizedSourceText(atom: EvidenceAtom) {
  return sourceBusinessDisplayText(atom.verbatimText)
}

function isOrphanMetricFragment(text: string) {
  if (!/\d/.test(text)) return false
  const stripped = text
    .replace(SOURCE_NUMBER_PATTERN, '')
    .replace(/[\s\-–—>→~～至到:：,，.。/|()（）]+/g, '')
  return stripped.length === 0
}

function isMetricLabelOnly(text: string) {
  if (text.length > 36 || !METRIC_LABEL_PATTERN.test(text)) return false
  const compactMetricPair = /^[A-Za-z\u4e00-\u9fff]{1,12}(?:替代|升级|改造)?[、,，/][A-Za-z\u4e00-\u9fff]{1,12}(?:率|指标)$/i
  return compactMetricPair.test(text)
    || (!BUSINESS_ACTION_PATTERN.test(text) && (/[、,，/:：]/.test(text) || METRIC_LABEL_PATTERN.test(text)))
}

function hasRenderableBusinessScope(bundle: ResumeEvidenceBundle, atom: EvidenceAtom) {
  const scope = bundle.timeline.find(item => item.scopeId === atom.sourceScopeId)
  return Boolean(
    scope
    && BUSINESS_SCOPE_KINDS.has(scope.kind)
    && (scope.organization || scope.title || scope.start || scope.end)
  )
}

function boundedMetricCount(text: string) {
  const matches = [...text.matchAll(SOURCE_NUMBER_PATTERN)]
  let count = 0
  for (const match of matches) {
    const raw = match[0]
    if (EXPLICIT_NUMBER_BOUND_PATTERN.test(raw)) {
      count += 1
      continue
    }
    const index = match.index ?? 0
    const nearby = text.slice(Math.max(0, index - 14), index + raw.length + 14)
    if (RESULT_CONTEXT_PATTERN.test(nearby) && BUSINESS_ACTION_PATTERN.test(text)) count += 1
  }
  return count
}

function addReason(
  reasons: Map<string, Set<EvidenceRoutingReason>>,
  evidenceId: string,
  reason: EvidenceRoutingReason
) {
  const values = reasons.get(evidenceId) ?? new Set<EvidenceRoutingReason>()
  values.add(reason)
  reasons.set(evidenceId, values)
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

export function buildEvidencePlanningCatalog(bundle: ResumeEvidenceBundle): EvidencePlanningCatalog {
  const orderedAtoms = [...bundle.evidenceAtoms].sort(stableAtomOrder)
  const sourceContinuations = businessSourceContinuationGroups(orderedAtoms)
  const completeByHead = new Map(sourceContinuations.map(group => [group[0].evidenceId,
    group.map(normalizedSourceText).join('')]))
  const continuationTails = new Set(sourceContinuations.flatMap(group => group.slice(1).map(atom => atom.evidenceId)))
  const reasons = new Map<string, Set<EvidenceRoutingReason>>()
  const previousById = new Map<string, string>()
  const nextById = new Map<string, string>()
  const continuationById = new Map<string, string>()
  const continuationLinks = new Map<string, Set<string>>()

  const byScope = new Map<string, EvidenceAtom[]>()
  for (const atom of orderedAtoms) {
    byScope.set(atom.sourceScopeId, [...(byScope.get(atom.sourceScopeId) ?? []), atom])
  }
  for (const atoms of byScope.values()) {
    for (let index = 1; index < atoms.length; index += 1) {
      const previous = atoms[index - 1]
      const current = atoms[index]
      if (!sameScopeAdjacent(previous, current)) continue
      const previousText = normalizedSourceText(previous)
      const currentText = normalizedSourceText(current)
      const splitQuantity = DANGLING_QUANTITY_PATTERN.test(previousText)
        && CHINESE_QUANTITY_UNIT_PATTERN.test(currentText)
      const splitMetric = DANGLING_METRIC_PREFIX_PATTERN.test(previousText)
        && STARTS_WITH_NUMBER_PATTERN.test(currentText)
      const continuation = CONTINUATION_START_PATTERN.test(currentText)
        && !SENTENCE_END_PATTERN.test(previousText)
      if (!splitQuantity && !splitMetric && !continuation) continue
      previousById.set(current.evidenceId, previous.evidenceId)
      nextById.set(previous.evidenceId, current.evidenceId)
      continuationLinks.set(previous.evidenceId, new Set([
        ...(continuationLinks.get(previous.evidenceId) ?? []),
        current.evidenceId,
      ]))
      continuationLinks.set(current.evidenceId, new Set([
        ...(continuationLinks.get(current.evidenceId) ?? []),
        previous.evidenceId,
      ]))
      if (splitQuantity) {
        addReason(reasons, previous.evidenceId, 'adjacent_quantity_split')
        addReason(reasons, current.evidenceId, 'adjacent_quantity_split')
      } else if (splitMetric) {
        addReason(reasons, previous.evidenceId, 'adjacent_metric_split')
        addReason(reasons, current.evidenceId, 'adjacent_metric_split')
      } else {
        addReason(reasons, previous.evidenceId, 'adjacent_continuation_split')
        addReason(reasons, current.evidenceId, 'adjacent_continuation_split')
      }
    }
  }

  const atomById = new Map(orderedAtoms.map(atom => [atom.evidenceId, atom]))
  const visitedContinuationIds = new Set<string>()
  for (const atom of orderedAtoms) {
    if (visitedContinuationIds.has(atom.evidenceId) || !continuationLinks.has(atom.evidenceId)) continue
    const pending = [atom.evidenceId]
    const members: string[] = []
    while (pending.length > 0) {
      const evidenceId = pending.pop()!
      if (visitedContinuationIds.has(evidenceId)) continue
      visitedContinuationIds.add(evidenceId)
      members.push(evidenceId)
      pending.push(...(continuationLinks.get(evidenceId) ?? []))
    }
    members.sort((left, right) => stableAtomOrder(atomById.get(left)!, atomById.get(right)!))
    const groupId = `continuation:${atom.sourceScopeId}:${members.join(':')}`
    for (const evidenceId of members) continuationById.set(evidenceId, groupId)
  }

  const assessments = new Map<string, EvidencePlanningAssessment>()
  orderedAtoms.forEach((atom, sourceOrder) => {
    const text = completeByHead.get(atom.evidenceId) ?? normalizedSourceText(atom)
    const atomReasons = reasons.get(atom.evidenceId) ?? new Set<EvidenceRoutingReason>()
    if (completeByHead.has(atom.evidenceId)) {
      for (const reason of ['adjacent_quantity_split', 'adjacent_metric_split', 'adjacent_continuation_split'] as const) atomReasons.delete(reason)
    }
    const hasUnsafeRisk = atom.riskFlags.some(flag => UNSAFE_RISK_FLAGS.has(flag))
    const hasQualifiedRisk = atom.status === 'source_qualified' || atom.riskFlags.includes('uncertain')
    // A complete source-qualified action remains usable with its original
    // wording. Explicit ambiguity/conflict is not converted to certainty.
    const hasUncertainRisk = atom.riskFlags.includes('conflicting')
      || (atom.riskFlags.some(flag => QUALIFIED_RISK_FLAGS.has(flag))
        && /(?:可能|疑似|不确定|尚不明确|无法确认|待确认|需确认)/u.test(text))
    const business = BUSINESS_CLAIM_TYPES.has(atom.claimType)
    const metricCount = boundedMetricCount(text)
    let standaloneClass: EvidenceStandaloneClass = 'metadata_only'
    let quality: EvidencePlanningQuality = 'blocked'
    let allowedUses: EvidencePlanningUse[] = []

    if (atom.status === 'excluded') {
      atomReasons.add('source_excluded')
    } else if (hasUnsafeRisk) {
      atomReasons.add('unsafe_source_text')
    } else if (business && isBusinessMetadata(atom, bundle)) {
      atomReasons.add('non_renderable_metadata')
    } else if (business && hasEditorialSourceText(text)) {
      atomReasons.add('editorial_source_text')
    } else if (business && !hasRenderableBusinessScope(bundle, atom)) {
      atomReasons.add('invalid_business_scope')
    } else if (business) {
      if (isOrphanMetricFragment(text)) atomReasons.add('orphan_metric_fragment')
      if (DANGLING_PUNCTUATION_PATTERN.test(text)) atomReasons.add('dangling_fragment')
      if (/^的/u.test(text)) atomReasons.add('dangling_fragment')
      if (isMetricLabelOnly(text)) atomReasons.add('metric_label_only')
      const isFragment = continuationTails.has(atom.evidenceId) || atomReasons.has('adjacent_quantity_split')
        || atomReasons.has('adjacent_metric_split')
        || atomReasons.has('adjacent_continuation_split')
        || atomReasons.has('orphan_metric_fragment')
        || atomReasons.has('dangling_fragment')
      if (isFragment) {
        standaloneClass = 'fragment'
        allowedUses = ['same_scope_support']
      } else if (atomReasons.has('metric_label_only')) {
        standaloneClass = 'metadata_only'
      } else if (CONTEXT_ONLY_PATTERN.test(text) || !BUSINESS_ACTION_PATTERN.test(text)) {
        atomReasons.add(CONTEXT_ONLY_PATTERN.test(text) ? 'context_only' : 'no_independent_business_action')
        standaloneClass = 'supplement'
        quality = 'weak'
        allowedUses = ['same_scope_support']
      } else if (hasUncertainRisk) {
        atomReasons.add('qualified_or_conflicting')
        standaloneClass = 'supplement'
        quality = 'weak'
        allowedUses = ['same_scope_support']
      } else {
        if (hasQualifiedRisk) atomReasons.add('qualified_or_conflicting')
        atomReasons.add('safe_business_anchor')
        standaloneClass = 'anchor'
        quality = hasQualifiedRisk
          ? 'usable'
          : (atom.claimType === 'result' || atom.claimType === 'deliverable' || metricCount > 0)
            ? 'strong'
            : 'usable'
        allowedUses = ['business_anchor']
      }
    } else if (atom.claimType === 'skill') {
      atomReasons.add('safe_skill_item')
      standaloneClass = 'anchor'
      quality = hasQualifiedRisk || hasUncertainRisk ? 'weak' : 'usable'
      allowedUses = ['skill_item']
    } else if (ANCILLARY_CLAIM_TYPES.has(atom.claimType)) {
      atomReasons.add('safe_ancillary_item')
      standaloneClass = 'anchor'
      quality = hasQualifiedRisk || hasUncertainRisk ? 'weak' : 'usable'
      allowedUses = ['ancillary_item']
    } else {
      atomReasons.add('non_renderable_metadata')
    }

    assessments.set(atom.evidenceId, {
      evidenceId: atom.evidenceId,
      sourceScopeId: atom.sourceScopeId,
      standaloneClass,
      quality,
      allowedUses,
      reasonCodes: [...atomReasons].sort((left, right) => left.localeCompare(right)),
      boundedMetricCount: standaloneClass === 'anchor' ? metricCount : 0,
      sourceOrder,
      previousEvidenceId: previousById.get(atom.evidenceId) ?? null,
      nextEvidenceId: nextById.get(atom.evidenceId) ?? null,
      continuationGroupId: continuationById.get(atom.evidenceId) ?? null,
    })
  })

  return {
    version: V5_EVIDENCE_ROUTING_VERSION,
    assessments,
    orderedEvidenceIds: orderedAtoms.map(atom => atom.evidenceId),
    businessAnchorEvidenceIds: orderedAtoms
      .filter(atom => assessments.get(atom.evidenceId)?.allowedUses.includes('business_anchor'))
      .map(atom => atom.evidenceId),
  }
}

export function getEvidencePlanningAssessment(
  catalog: EvidencePlanningCatalog,
  evidenceId: string
) {
  return catalog.assessments.get(evidenceId) ?? null
}

export function isBusinessPlanningAnchor(catalog: EvidencePlanningCatalog, evidenceId: string) {
  return catalog.assessments.get(evidenceId)?.allowedUses.includes('business_anchor') ?? false
}

export function comparePlanningEvidence(
  left: EvidenceAtom,
  right: EvidenceAtom,
  catalog: EvidencePlanningCatalog
) {
  const leftAssessment = catalog.assessments.get(left.evidenceId)
  const rightAssessment = catalog.assessments.get(right.evidenceId)
  const leftVector = [
    qualityRank[leftAssessment?.quality ?? 'blocked'],
    claimTypeRank[left.claimType] ?? 0,
    Math.min(leftAssessment?.boundedMetricCount ?? 0, 3),
    left.status === 'source_supported' ? 1 : 0,
    left.attributionLevel === 'owned' || left.attributionLevel === 'drove' ? 2
      : left.attributionLevel === 'contributed' || left.attributionLevel === 'supported' ? 1 : 0,
    Math.max(0, 10 - left.riskFlags.length),
  ]
  const rightVector = [
    qualityRank[rightAssessment?.quality ?? 'blocked'],
    claimTypeRank[right.claimType] ?? 0,
    Math.min(rightAssessment?.boundedMetricCount ?? 0, 3),
    right.status === 'source_supported' ? 1 : 0,
    right.attributionLevel === 'owned' || right.attributionLevel === 'drove' ? 2
      : right.attributionLevel === 'contributed' || right.attributionLevel === 'supported' ? 1 : 0,
    Math.max(0, 10 - right.riskFlags.length),
  ]
  for (let index = 0; index < leftVector.length; index += 1) {
    if (leftVector[index] !== rightVector[index]) return rightVector[index] - leftVector[index]
  }
  return (leftAssessment?.sourceOrder ?? Number.MAX_SAFE_INTEGER)
    - (rightAssessment?.sourceOrder ?? Number.MAX_SAFE_INTEGER)
    || left.evidenceId.localeCompare(right.evidenceId)
}

function evidenceAllowedForRequirement(
  atom: EvidenceAtom,
  assessment: EvidencePlanningAssessment,
  requirement: RequirementAtom,
  match: RequirementMatch
) {
  if (assessment.allowedUses.includes('business_anchor')) {
    return ['responsibility', 'outcome', 'experience', 'other', 'skill'].includes(requirement.category)
  }
  if (assessment.allowedUses.includes('skill_item')) {
    return requirement.category === 'skill'
      && match.status === 'direct_match'
      && match.confidence !== 'low'
  }
  if (assessment.allowedUses.includes('ancillary_item')) {
    const typeByCategory: Partial<Record<RequirementAtom['category'], EvidenceAtom['claimType'][]>> = {
      education: ['education'],
      certification: ['certification'],
      language: ['language'],
    }
    return typeByCategory[requirement.category]?.includes(atom.claimType) ?? false
  }
  return false
}

export function buildRequirementEvidenceRoutes(input: {
  job: JobRequirementBundle
  match: V5MatchAnalysis
  resume: ResumeEvidenceBundle
  catalog?: EvidencePlanningCatalog
}): RequirementEvidenceRoutes {
  const catalog = input.catalog ?? buildEvidencePlanningCatalog(input.resume)
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const requirements = new Map(input.job.requirementAtoms.map(atom => [atom.requirementId, atom]))
  const routes = new Map<string, RequirementEvidenceRoute>()
  const matches = [...input.match.requirementMatches].sort((left, right) => left.requirementId.localeCompare(right.requirementId))

  for (const match of matches) {
    const requirement = requirements.get(match.requirementId)
    const anchors: EvidenceAtom[] = []
    const supportingEvidenceIds: string[] = []
    const rejectedEvidenceIds: string[] = []
    for (const evidenceId of sortedUnique(match.evidenceIds)) {
      const atom = evidence.get(evidenceId)
      const assessment = catalog.assessments.get(evidenceId)
      if (!atom || !assessment || !requirement || !['direct_match', 'transferable_match'].includes(match.status)) {
        rejectedEvidenceIds.push(evidenceId)
      } else if (evidenceAllowedForRequirement(atom, assessment, requirement, match)) {
        anchors.push(atom)
      } else if (assessment.allowedUses.includes('same_scope_support')) {
        supportingEvidenceIds.push(evidenceId)
      } else {
        rejectedEvidenceIds.push(evidenceId)
      }
    }
    anchors.sort((left, right) => comparePlanningEvidence(left, right, catalog))
    const anchorEvidenceIds = anchors.map(atom => atom.evidenceId)
    const planningDisposition: RequirementPlanningDisposition = anchorEvidenceIds.length === 0
      ? 'unroutable'
      : match.confidence === 'low'
        ? 'secondary_candidate'
        : 'primary_candidate'
    routes.set(match.requirementId, {
      requirementId: match.requirementId,
      modelStatus: match.status,
      planningDisposition,
      anchorEvidenceIds,
      supportingEvidenceIds: sortedUnique(supportingEvidenceIds),
      rejectedEvidenceIds: sortedUnique(rejectedEvidenceIds),
    })
  }

  const orderedRequirementIds = [...routes.keys()].sort((leftId, rightId) => {
    const left = routes.get(leftId)!
    const right = routes.get(rightId)!
    const leftRequirement = requirements.get(leftId)
    const rightRequirement = requirements.get(rightId)
    const leftMatch = input.match.requirementMatches.find(item => item.requirementId === leftId)
    const rightMatch = input.match.requirementMatches.find(item => item.requirementId === rightId)
    const leftVector = [
      left.planningDisposition === 'primary_candidate' ? 2 : left.planningDisposition === 'secondary_candidate' ? 1 : 0,
      leftRequirement ? importanceRank[leftRequirement.importance] : 0,
      input.match.positioning.primaryRequirementIds.includes(leftId) ? 1 : 0,
      leftMatch?.status === 'direct_match' ? 2 : leftMatch?.status === 'transferable_match' ? 1 : 0,
      leftMatch?.confidence === 'high' ? 2 : leftMatch?.confidence === 'medium' ? 1 : 0,
    ]
    const rightVector = [
      right.planningDisposition === 'primary_candidate' ? 2 : right.planningDisposition === 'secondary_candidate' ? 1 : 0,
      rightRequirement ? importanceRank[rightRequirement.importance] : 0,
      input.match.positioning.primaryRequirementIds.includes(rightId) ? 1 : 0,
      rightMatch?.status === 'direct_match' ? 2 : rightMatch?.status === 'transferable_match' ? 1 : 0,
      rightMatch?.confidence === 'high' ? 2 : rightMatch?.confidence === 'medium' ? 1 : 0,
    ]
    for (let index = 0; index < leftVector.length; index += 1) {
      if (leftVector[index] !== rightVector[index]) return rightVector[index] - leftVector[index]
    }
    return leftId.localeCompare(rightId)
  })

  return { version: V5_EVIDENCE_ROUTING_VERSION, byRequirement: routes, orderedRequirementIds }
}
