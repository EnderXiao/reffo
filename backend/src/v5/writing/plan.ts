import type { GenerationPolicy, JobRequirementBundle, ResumeEvidenceBundle, V5MatchAnalysis, V5ResumePlan } from '@/v5/types'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import type { CompositionBlueprint } from '@/v5/composition/contract'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { buildTargetEvidenceScores } from '@/v5/planning-quality'
import { buildWritingFact, SUPPORTED_WRITING_POLICY, type WritingFact } from '@/v5/writing/facts'
import type { JobFitMap, JobSuccessProfile } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { targetingEvidenceScores, targetingSelectionBasis } from '@/v5/targeting/fit'
import { deriveWritingSourceExcerpts } from '@/v5/writing/source-excerpts'
import { buildSlotEditorialGuides, editorialTerms, overviewDetailOverlaps, WRITING_EDITORIAL_VERSION, type SlotEditorialGuide } from '@/v5/writing/editorial'

export interface WritingPlan {
  version: typeof SUPPORTED_WRITING_POLICY
  blueprint: CompositionBlueprint
  facts: WritingFact[]
  coreEvidenceIdsBySlot: Record<string, string[]>
  expandedEvidenceIds: Record<string, string[]>
  positioning: string
  guidance: string
  outputLength: GenerationPolicy['outputLength']
  targeting?: { profile: JobSuccessProfile; targets: JobTarget[]; fit: JobFitMap }
  editorial?: { version: typeof WRITING_EDITORIAL_VERSION; slots: Record<string, SlotEditorialGuide> }
}

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
function terms(text: string) {
  return new Set([...segmenter.segment(text.toLowerCase())]
    .filter(part => part.isWordLike && part.segment.length > 1)
    .map(part => part.segment)
    .filter(word => !/^(?:负责|参与|产品|项目|工作|进行|完成|相关|业务|团队|能力)$/u.test(word)))
}
function overlap(a: Set<string>, b: Set<string>) {
  return [...a].filter(word => b.has(word)).length
}

export function buildWritingPlan(input: {
  resume: ResumeEvidenceBundle
  plan: V5ResumePlan
  policy: GenerationPolicy
  match: V5MatchAnalysis
  job: JobRequirementBundle
  targeting?: WritingPlan['targeting']
}): WritingPlan {
  const blueprint = buildCompositionBlueprint(input)
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const requested = new Set(blueprint.slots.flatMap(slot => slot.allowedEvidenceIds))
  const expandedEvidenceIds: Record<string, string[]> = {}
  const excerpts = new Map(deriveWritingSourceExcerpts(input.resume, input.plan).map(excerpt => [excerpt.anchorEvidenceId, excerpt]))
  const assemblyByHead = new Map(deriveEvidenceAssemblies(input.resume, input.plan)
    .filter(assembly => assembly.kind.startsWith('companion_'))
    .map(assembly => [assembly.anchorEvidenceId, assembly]))
  const facts = [...requested].flatMap(id => {
    const atom = atoms.get(id)
    if (!atom) return []
    const assembly = assemblyByHead.get(id)
    const members = assembly ? assembly.memberEvidenceIds.map(member => atoms.get(member)!) : [atom]
    if (members.some(member => !member)) return []
    const excerpt = !assembly ? excerpts.get(id) : undefined
    const source = assembly ? {
      ...atom,
      verbatimText: members.map(member => member.verbatimText).join(assembly.joiner === 'source_concat' ? '' : '；'),
    } : excerpt ? { ...atom, verbatimText: `${atom.verbatimText}；${excerpt.text}` } : atom
    const fact = buildWritingFact(source)
    if (!fact) return []
    if (excerpt) fact.sourceExcerpts = [{ evidenceId: excerpt.evidenceId, sourceSpan: excerpt.sourceSpan }]
    expandedEvidenceIds[id] = [...members.map(member => member.evidenceId), ...(excerpt ? [excerpt.evidenceId] : [])]
    return [fact]
  })
  const factById = new Map(facts.map(fact => [fact.evidenceId, fact]))
  const scores = input.targeting ? targetingEvidenceScores(input.targeting.fit, input.targeting.targets, input.resume) : buildTargetEvidenceScores(input.resume, input.job)
  const primary = new Set(input.targeting ? [] : input.match.positioning.primaryEvidenceIds)
  const semanticLinks = new Map<string, Set<string>>()
  for (const match of input.match.requirementMatches) {
    for (const id of match.evidenceIds) semanticLinks.set(id, new Set([...(semanticLinks.get(id) ?? []), match.requirementId]))
  }
  if (input.targeting) {
    semanticLinks.clear()
    const targets = new Map(input.targeting.targets.map(target => [target.id, target]))
    for (const link of input.targeting.fit.links) {
      for (const id of link.evidenceIds) {
        const atom = atoms.get(id)
        if (atom && targetingSelectionBasis(link, atom)) semanticLinks.set(id, new Set([...(semanticLinks.get(id) ?? []), ...(targets.get(link.targetId)?.taskIds ?? [])]))
      }
    }
  }
  const rank = (id: string) => (scores.get(id) ?? 0) + (primary.has(id) ? 12 : 0)
  const primaryDetailIds = new Set<string>()
  for (const slot of blueprint.slots.filter(slot => slot.kind === 'business_bullet' && slot.sectionKey === 'project')) {
    const selected = slot.allowedEvidenceIds.filter(id => factById.has(id) && !primaryDetailIds.has(id))
      .sort((a, b) => rank(b) - rank(a) || a.localeCompare(b))[0]
    if (selected) primaryDetailIds.add(selected)
  }
  const overlaps = input.targeting ? overviewDetailOverlaps({ resume: input.resume, blueprint, facts, taskLinks: semanticLinks, primaryDetailIds }) : new Map<string, string[]>()
  const coreEvidenceIdsBySlot: Record<string, string[]> = {}

  for (const scope of input.plan.scopePlans) {
    const slots = blueprint.slots.filter(slot => slot.scopeId === scope.scopeId && slot.kind !== 'summary')
    if (slots.length === 0) continue
    const allowed = [...new Set(slots.flatMap(slot => slot.allowedEvidenceIds))]
      .filter(id => factById.has(id)).sort((a, b) => Number(overlaps.has(a)) - Number(overlaps.has(b)) || rank(b) - rank(a) || a.localeCompare(b))
    const assigned = new Set<string>()
    // Respect fixed continuation/education slots before distributing flexible facts.
    for (const slot of slots) {
      const candidates = allowed.filter(id => !assigned.has(id) && slot.allowedEvidenceIds.includes(id))
      const chosen = candidates[0]
      if (!chosen) throw new Error('WRITER_PLAN_UNFILLABLE: 当前计划槽位没有可写事实')
      assigned.add(chosen)
      coreEvidenceIdsBySlot[slot.slotId] = [chosen]
    }
    const groups = new Map(slots.map(slot => [slot.slotId, [...coreEvidenceIdsBySlot[slot.slotId]]]))
    for (const id of allowed.filter(value => !assigned.has(value))) {
      const legal = slots.filter(slot => slot.allowedEvidenceIds.includes(id))
        .filter(slot => !input.targeting || groups.get(slot.slotId)!.some(member =>
          overlap(semanticLinks.get(id) ?? new Set(), semanticLinks.get(member) ?? new Set()) > 0
          || overlap(editorialTerms(factById.get(id)!.text), editorialTerms(factById.get(member)!.text)) >= 2))
      const bounded = legal.filter(slot => groups.get(slot.slotId)!.length < 3)
      const candidates = input.targeting ? bounded : bounded.length ? bounded : legal
      const textTerms = terms(factById.get(id)!.text)
      const score = (slotId: string) => {
        const group = groups.get(slotId)!
        return Math.max(...group.map(member =>
          overlap(semanticLinks.get(id) ?? new Set(), semanticLinks.get(member) ?? new Set()) * 2
          + overlap(textTerms, terms(factById.get(member)!.text))))
          - group.reduce((sum, member) => sum + factById.get(member)!.text.length, 0) / 80
      }
      candidates.sort((a, b) => score(b.slotId) - score(a.slotId) || a.order - b.order)
      if (candidates[0]) groups.get(candidates[0].slotId)!.push(id)
    }
    for (const slot of slots) slot.allowedEvidenceIds = groups.get(slot.slotId)!
  }
  for (const slot of blueprint.slots.filter(slot => slot.kind !== 'summary')) {
    slot.allowedEvidenceIds = slot.allowedEvidenceIds.filter(id => factById.has(id))
    coreEvidenceIdsBySlot[slot.slotId] ??= slot.allowedEvidenceIds.slice(0, 1)
    if (slot.allowedEvidenceIds.length === 0) throw new Error('WRITER_PLAN_UNFILLABLE: 不可把编辑说明填入成品')
  }
  const summary = blueprint.slots.find(slot => slot.kind === 'summary')
  const bodyIds = new Set(blueprint.slots.filter(slot => slot.kind !== 'summary').flatMap(slot => slot.allowedEvidenceIds))
  if (summary) {
    // Summary may synthesize separate experiences, never merge their ownership or results.
    summary.scopeId = null
    summary.allowedEvidenceIds = facts.filter(fact => (!input.targeting || bodyIds.has(fact.evidenceId)) && ['action', 'responsibility', 'deliverable', 'result'].includes(fact.claimType))
      .sort((a, b) => Number(overlaps.has(a.evidenceId)) - Number(overlaps.has(b.evidenceId)) || rank(b.evidenceId) - rank(a.evidenceId) || a.evidenceId.localeCompare(b.evidenceId))
      .slice(0, 6).map(fact => fact.evidenceId)
    coreEvidenceIdsBySlot[summary.slotId] = []
  }
  blueprint.requiredBodyEvidenceIds = [...new Set(Object.values(coreEvidenceIdsBySlot).flat())]
  const usedIds = new Set(blueprint.slots.flatMap(slot => slot.allowedEvidenceIds))
  const selectedFacts = input.targeting ? facts.filter(fact => usedIds.has(fact.evidenceId)) : facts
  return {
    version: SUPPORTED_WRITING_POLICY,
    blueprint,
    facts: selectedFacts,
    coreEvidenceIdsBySlot,
    expandedEvidenceIds,
    positioning: input.targeting
      ? '围绕核心岗位任务组织已有经历；岗位要求与匹配意见均不是个人事实。'
      : input.match.positioning.statement,
    guidance: input.plan.strategyProfile.evidenceRichness === 'sparse'
      ? '材料简略：展开已知职责的职业含义，不凑数字和条数。'
      : '按岗位问题组织代表性贡献，保留差异，不全量搬运。',
    outputLength: input.policy.outputLength,
    ...(input.targeting ? { targeting: input.targeting } : {}),
    ...(input.targeting ? { editorial: { version: WRITING_EDITORIAL_VERSION, slots: buildSlotEditorialGuides({
      blueprint, facts: selectedFacts, coreBySlot: coreEvidenceIdsBySlot, taskLinks: semanticLinks,
      targets: input.targeting.targets, overlaps, unit: input.policy.outputLength.unit,
    }) } } : {}),
  }
}

export function writingPayload(plan: WritingPlan) {
  const selected = new Set(plan.facts.map(fact => fact.evidenceId))
  const relevantLinks = plan.targeting?.fit.links.filter(link => ['direct', 'transferable', 'weak_signal'].includes(link.status) && link.evidenceIds.some(id => selected.has(id))) ?? []
  const targetIds = new Set(relevantLinks.map(link => link.targetId))
  const relatedTaskIds = new Set(plan.targeting?.targets.filter(target => targetIds.has(target.id)).flatMap(target => target.taskIds) ?? [])
  return {
    writingPolicy: plan.version,
    positioning: plan.positioning,
    guidance: plan.guidance,
    outputLength: plan.outputLength,
    blueprint: {
      contractVersion: plan.blueprint.contractVersion,
      slots: plan.blueprint.slots.map(slot => ({
        slotId: slot.slotId, kind: slot.kind, required: slot.required,
        allowedEvidenceIds: slot.allowedEvidenceIds,
        coreEvidenceIds: plan.coreEvidenceIdsBySlot[slot.slotId],
        ...(plan.editorial?.slots[slot.slotId] ? { editorial: compactEditorialGuide(plan.editorial.slots[slot.slotId]) } : {}),
      })),
    },
    facts: plan.facts,
    ...(plan.editorial ? { editorialVersion: plan.editorial.version } : {}),
    ...(plan.targeting ? { jobTargeting: {
      tasks: plan.targeting.profile.tasks.filter(task => task.priority === 'core' || plan.targeting!.targets.some(target => targetIds.has(target.id) && target.taskIds.includes(task.id)))
        .map(({ id, text, priority, provenance }) => ({ id, text, priority, basis: provenance.basis })),
      successConditions: plan.targeting.profile.successConditions.filter(condition => targetIds.has(condition.id) || condition.taskIds.some(id => relatedTaskIds.has(id)))
        .map(({ id, text, taskIds, provenance }) => ({ id, text, taskIds, basis: provenance.basis })),
      otherTargets: plan.targeting.targets.filter(target => targetIds.has(target.id) && !['task', 'condition'].includes(target.kind))
        .map(({ id, kind, text, basis, taskIds, dimension }) => ({ id, kind, text, basis, taskIds, ...(dimension ? { dimension } : {}) })),
      // Analysis prose is not a fact source. Keep intent references, never a ready-made summary.
      narrativeIntents: plan.targeting.fit.narratives.filter(item => item.evidenceIds.every(id => selected.has(id)))
        .map(({ targetIds, evidenceIds }) => ({ targetIds, evidenceIds })),
      links: relevantLinks.map(({ targetId, status, evidenceIds }) => ({ targetId, status, evidenceIds: evidenceIds.filter(id => selected.has(id)) })),
    } } : {}),
  }
}

function compactEditorialGuide(guide: SlotEditorialGuide) {
  return {
    ...(guide.role !== 'contribution' ? {role: guide.role} : {}),
    ...(guide.targetTaskIds.length ? {targetTaskIds: guide.targetTaskIds} : {}),
    ...(guide.emphasis.length ? {emphasis: guide.emphasis} : {}),
    lengthHint: {target: guide.lengthHint.target, max: guide.lengthHint.max},
    ...(guide.avoidRepeatingSlotIds.length ? {avoidRepeatingSlotIds: guide.avoidRepeatingSlotIds} : {}),
  }
}
