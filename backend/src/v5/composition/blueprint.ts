import type {
  EvidenceAtom,
  GenerationPolicy,
  JobRequirementBundle,
  ResumeEvidenceBundle,
  SourceScopeKind,
  V5ResumePlan,
} from '@/v5/types'
import { plannedContentEvidenceIds } from '@/v5/validators'
import {
  P06_COMPOSITION_CONTRACT_VERSION,
  type CompositionBlueprint,
  type CompositionBlueprintSlot,
  type CompositionSectionKey,
} from '@/v5/composition/contract'
import {
  CompositionBlueprintFeasibilityError,
  validateCompositionBlueprintFeasibility,
} from '@/v5/composition/validator'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { buildTargetEvidenceScores } from '@/v5/planning-quality'

const BUSINESS_CLAIM_TYPES = new Set<EvidenceAtom['claimType']>([
  'responsibility',
  'action',
  'deliverable',
  'result',
])

const ANCILLARY_SECTION_BY_CLAIM_TYPE: Partial<Record<EvidenceAtom['claimType'], CompositionSectionKey>> = {
  certification: 'certifications',
  language: 'languages',
  publication: 'publications',
  patent: 'patents',
  award: 'awards',
  portfolio_link: 'portfolio',
}

const KNOWN_SECTION_KEYS = new Set<CompositionSectionKey>([
  'summary',
  'experience',
  'project',
  'research',
  'education',
  'skills',
  'portfolio',
  'certifications',
  'languages',
  'publications',
  'patents',
  'awards',
  'other',
])

export function compositionSectionForScopeKind(kind: SourceScopeKind): CompositionSectionKey {
  if (kind === 'experience' || kind === 'internship') return 'experience'
  if (kind === 'project') return 'project'
  if (kind === 'research') return 'research'
  if (kind === 'education') return 'education'
  return 'other'
}

function normalizedSectionOrder(policy: GenerationPolicy) {
  const result: CompositionSectionKey[] = []
  for (const section of policy.sectionOrder) {
    if (section === 'identity' || !KNOWN_SECTION_KEYS.has(section as CompositionSectionKey)) continue
    const key = section as CompositionSectionKey
    if (!result.includes(key)) result.push(key)
  }
  return result
}

function slotIdPart(value: string) {
  return encodeURIComponent(value)
}

function slotKindForScope(kind: SourceScopeKind) {
  return ['experience', 'internship', 'project', 'research'].includes(kind)
    ? 'business_bullet' as const
    : 'ancillary' as const
}

export function buildCompositionBlueprint(input: {
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
  job?: JobRequirementBundle
}): CompositionBlueprint {
  const { resume, plan, policy } = input
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const sectionOrder = normalizedSectionOrder(policy)
  const sectionRank = new Map(sectionOrder.map((section, index) => [section, index]))
  const timelineRank = new Map(resume.timeline.map((item, index) => [item.scopeId, index]))
  const scopePlanById = new Map(plan.scopePlans.map(item => [item.scopeId, item]))
  const slots: CompositionBlueprintSlot[] = []
  const continuationHeads = new Set(deriveEvidenceAssemblies(resume, plan)
    .filter(assembly => assembly.kind === 'companion_concat').map(assembly => assembly.anchorEvidenceId))

  const summaryCandidates = [...plannedContentEvidenceIds(resume, plan)].filter(id => {
    const atom = evidence.get(id)
    return Boolean(atom && BUSINESS_CLAIM_TYPES.has(atom.claimType))
  })
  const relevance = input.job ? buildTargetEvidenceScores(resume, input.job) : new Map<string, number>()
  // One source-proven summary unit. Offering every body atom encourages a
  // second full resume in the summary and conflicts with single-scope proof.
  const summaryEvidenceIds = summaryCandidates.sort((left, right) => (
    (relevance.get(right) ?? 0) - (relevance.get(left) ?? 0)
    || Number(plan.customizedEvidenceIds.includes(right)) - Number(plan.customizedEvidenceIds.includes(left))
    || (evidence.get(left)?.verbatimText.length ?? 0) - (evidence.get(right)?.verbatimText.length ?? 0)
    || left.localeCompare(right)
  )).slice(0, 1)
  if (policy.summaryPolicy !== 'omit_if_unsupported'
    && policy.targetBusinessBulletTarget > 0
    && summaryEvidenceIds.length > 0
  ) {
    slots.push({
      slotId: 'summary:0',
      kind: 'summary',
      sectionKey: 'summary',
      scopeId: evidence.get(summaryEvidenceIds[0])!.sourceScopeId,
      outputPath: 'summary[0]',
      order: 0,
      required: true,
      allowedEvidenceIds: summaryEvidenceIds,
    })
  }

  for (const timeline of resume.timeline) {
    const scopePlan = scopePlanById.get(timeline.scopeId)
    if (!scopePlan || !['expand', 'compress', 'include'].includes(scopePlan.treatment)) continue
    const sectionKey = compositionSectionForScopeKind(timeline.kind)
    const fixedHeads = scopePlan.selectedEvidenceIds.filter(id => continuationHeads.has(id))
    for (let index = 0; index < scopePlan.bulletBudget; index += 1) {
      slots.push({
        slotId: `scope:${slotIdPart(timeline.scopeId)}:bullet:${index}`,
        kind: slotKindForScope(timeline.kind),
        sectionKey,
        scopeId: timeline.scopeId,
        outputPath: `${sectionKey}.${timeline.scopeId}.bullets[${index}]`,
        order: 0,
        required: true,
        allowedEvidenceIds: index < fixedHeads.length ? [fixedHeads[index]]
          : scopePlan.selectedEvidenceIds.filter(id => !continuationHeads.has(id)),
      })
    }
  }

  for (const [index, evidenceId] of plan.featuredSkillEvidenceIds.entries()) {
    slots.push({
      slotId: `skills:${index}`,
      kind: 'skill',
      sectionKey: 'skills',
      scopeId: null,
      outputPath: `skills[${index}]`,
      order: 0,
      required: true,
      allowedEvidenceIds: [evidenceId],
    })
  }

  const scopeEvidenceIds = new Set(plan.scopePlans.flatMap(item => item.selectedEvidenceIds))
  const featuredSkillIds = new Set(plan.featuredSkillEvidenceIds)
  const standaloneEvidence = [...plannedContentEvidenceIds(resume, plan)]
    .filter(id => !scopeEvidenceIds.has(id) && !featuredSkillIds.has(id))
    .map(id => evidence.get(id))
    .filter((atom): atom is EvidenceAtom => Boolean(atom))
    .flatMap(atom => {
      const sectionKey = ANCILLARY_SECTION_BY_CLAIM_TYPE[atom.claimType]
      return sectionKey ? [{ atom, sectionKey }] : []
    })
  const standaloneCount = new Map<CompositionSectionKey, number>()
  for (const { atom, sectionKey } of standaloneEvidence) {
    const index = standaloneCount.get(sectionKey) ?? 0
    standaloneCount.set(sectionKey, index + 1)
    slots.push({
      slotId: `${sectionKey}:${index}`,
      kind: 'ancillary',
      sectionKey,
      scopeId: null,
      outputPath: `${sectionKey}[${index}]`,
      order: 0,
      required: true,
      allowedEvidenceIds: [atom.evidenceId],
    })
  }

  const kindRank = { summary: 0, business_bullet: 1, skill: 2, ancillary: 3 } as const
  slots.sort((left, right) => (
    (sectionRank.get(left.sectionKey) ?? Number.MAX_SAFE_INTEGER)
      - (sectionRank.get(right.sectionKey) ?? Number.MAX_SAFE_INTEGER)
    || (left.scopeId === null ? Number.MAX_SAFE_INTEGER : timelineRank.get(left.scopeId) ?? Number.MAX_SAFE_INTEGER)
      - (right.scopeId === null ? Number.MAX_SAFE_INTEGER : timelineRank.get(right.scopeId) ?? Number.MAX_SAFE_INTEGER)
    || kindRank[left.kind] - kindRank[right.kind]
    || left.outputPath.localeCompare(right.outputPath)
  ))

  const blueprint: CompositionBlueprint = {
    contractVersion: P06_COMPOSITION_CONTRACT_VERSION,
    outputLanguage: plan.strategyProfile.outputLanguage,
    sectionOrder,
    requiredBodyEvidenceIds: [...plannedContentEvidenceIds(resume, plan)],
    slots: slots.map((slot, order) => ({ ...slot, order })),
  }
  const feasibility = validateCompositionBlueprintFeasibility({ blueprint, resume, plan })
  if (!feasibility.passed) throw new CompositionBlueprintFeasibilityError(feasibility.issues)
  return blueprint
}
