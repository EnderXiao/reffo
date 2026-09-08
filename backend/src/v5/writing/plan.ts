import type { GenerationPolicy, JobRequirementBundle, ResumeEvidenceBundle, V5MatchAnalysis, V5ResumePlan } from '@/v5/types'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import type { CompositionBlueprint } from '@/v5/composition/contract'
import type { P06CompositionOutput } from '@/v5/composition/contract'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { buildTargetEvidenceScores } from '@/v5/planning-quality'
import { buildWritingFact, SUPPORTED_WRITING_POLICY, type WritingFact } from '@/v5/writing/facts'
import type { JobFitMap, JobSuccessProfile } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { targetingEvidenceScores } from '@/v5/targeting/fit'
import { deriveWritingSourceExcerpts } from '@/v5/writing/source-excerpts'
import { buildSlotEditorialGuides, editorialTerms, overviewDetailOverlaps, WRITING_EDITORIAL_VERSION, type SlotEditorialGuide } from '@/v5/writing/editorial'
import { buildWritingIntents, WRITING_INTENT_VERSION, type WritingIntent } from '@/v5/writing/intents'
import { deriveWritingContexts, WRITING_CONTEXT_VERSION } from '@/v5/writing/context'
import { isPracticeSkillEvidence, PRACTICE_SKILL_POLICY } from '@/v5/writing/skills'
import { educationDetailPriority } from '@/v5/writing/education'
import { buildWritingThemes, WRITING_THEME_VERSION, type WritingTheme } from '@/v5/writing/themes'
import { applyDocumentEditorialPlan, type DocumentEditorialBrief, type STRUCTURAL_WRITING_POLICY } from '@/v5/writing/structure'
import { deriveEducationIdentity, type EducationIdentity } from '@/v5/writing/identity'
import { buildTaskEvidenceLinks, buildTaskRelevanceLinks, writingLinkRelation, TASK_SUPPORT_POLICY } from '@/v5/writing/task-support'

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
  editorialIntents?: WritingIntent[]
  editorialIntentVersion?: typeof WRITING_INTENT_VERSION
  summaryPriorityEvidenceIds?: string[]
  skillPolicy?: typeof PRACTICE_SKILL_POLICY
  summaryThemes?: WritingTheme[]
  skillThemes?: Record<string, WritingTheme>
  documentEditorial?: DocumentEditorialBrief
  fixedBlocks?: P06CompositionOutput['blocks']
  educationIdentity?: EducationIdentity[]
  taskSupportPolicy?: typeof TASK_SUPPORT_POLICY
  /** Server-created entry adapter only; permits distinct paragraphs to cite a long source. */
  entryParagraphGroups?: Record<string, string>
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
  editorialPolicy?: typeof STRUCTURAL_WRITING_POLICY
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
    for (const [id, tasks] of buildTaskRelevanceLinks({ ...input.targeting, resume: input.resume })) {
      semanticLinks.set(id, tasks)
    }
  }
  const supportedTaskLinks = input.targeting
    ? buildTaskEvidenceLinks({ ...input.targeting, resume: input.resume }) : semanticLinks
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
      .filter(id => factById.has(id)).sort((a, b) => {
        const timeline = input.resume.timeline.find(item => item.scopeId === scope.scopeId)
        const educationRank = input.targeting && timeline?.kind === 'education'
          ? educationDetailPriority(atoms.get(b)!, timeline) - educationDetailPriority(atoms.get(a)!, timeline) : 0
        return educationRank || Number(overlaps.has(a)) - Number(overlaps.has(b)) || rank(b) - rank(a) || a.localeCompare(b)
      })
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
        .filter(slot => !input.targeting || slot.sectionKey === 'education' || groups.get(slot.slotId)!.some(member =>
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
  const summaryThemes = input.targeting ? buildWritingThemes({ facts: facts.filter(fact => bodyIds.has(fact.evidenceId)),
    blueprint, taskLinks: supportedTaskLinks, relevanceTaskLinks: semanticLinks, targets: input.targeting.targets, mode: 'summary', limit: 2 }) : undefined
  const summaryPriorityEvidenceIds = summaryThemes?.map(theme => theme.anchorEvidenceId) ?? []
  if (summary) {
    // Summary may synthesize separate experiences, never merge their ownership or results.
    summary.scopeId = null
    const ranked = facts.filter(fact => (!input.targeting || bodyIds.has(fact.evidenceId)) && ['action', 'responsibility', 'deliverable', 'result'].includes(fact.claimType))
      .sort((a, b) => Number(overlaps.has(a.evidenceId)) - Number(overlaps.has(b.evidenceId)) || rank(b.evidenceId) - rank(a.evidenceId) || a.evidenceId.localeCompare(b.evidenceId))
      .map(fact => fact.evidenceId)
    summary.allowedEvidenceIds = [...new Set([...summaryPriorityEvidenceIds, ...ranked])].slice(0, 6)
    if (summaryThemes?.length) summary.allowedEvidenceIds = summaryPriorityEvidenceIds
    coreEvidenceIdsBySlot[summary.slotId] = []
  }
  blueprint.requiredBodyEvidenceIds = [...new Set(Object.values(coreEvidenceIdsBySlot).flat())]
  const usedIds = new Set(blueprint.slots.flatMap(slot => slot.allowedEvidenceIds))
  const selectedFacts = input.targeting ? facts.filter(fact => usedIds.has(fact.evidenceId)) : facts
  let skillPolicy: typeof PRACTICE_SKILL_POLICY | undefined
  const skillThemes: Record<string, WritingTheme> = {}
  if (input.targeting && blueprint.sectionOrder.includes('skills')) {
    const pool = selectedFacts.filter(fact => {
      const atom = atoms.get(fact.evidenceId)
      return atom && isPracticeSkillEvidence(atom, input.plan)
    }).map(fact => fact.evidenceId)
    const practiceCount = pool.filter(id => atoms.get(id)?.claimType !== 'skill').length
    const skillSlots = blueprint.slots.filter(slot => slot.kind === 'skill')
    if (practiceCount) {
      skillPolicy = PRACTICE_SKILL_POLICY
      const themes = buildWritingThemes({ facts: selectedFacts.filter(fact => pool.includes(fact.evidenceId)),
        blueprint, taskLinks: supportedTaskLinks, relevanceTaskLinks: semanticLinks, targets: input.targeting.targets, mode: 'skill', limit: Math.min(3, Math.max(1, skillSlots.length || 3)) })
      const removedSlots = new Set(skillSlots.slice(themes.length).map(slot => slot.slotId))
      blueprint.slots = blueprint.slots.filter(slot => !removedSlots.has(slot.slotId))
      for (const id of removedSlots) delete coreEvidenceIdsBySlot[id]
      skillSlots.splice(themes.length)
      if (!skillSlots.length) {
        const available = Math.max(0, input.policy.hardTotalListItemMax - blueprint.slots.filter(slot => slot.kind !== 'summary').length)
        for (let index = 0; index < Math.min(3, themes.length, available); index++) {
          const slot: CompositionBlueprint['slots'][number] = { slotId: `skills:${index}`, kind: 'skill', sectionKey: 'skills',
            scopeId: null, outputPath: `skills[${index}]`, order: blueprint.slots.length, required: true, allowedEvidenceIds: [] }
          blueprint.slots.push(slot)
          skillSlots.push(slot)
        }
      }
      for (const [index, slot] of skillSlots.entries()) {
        const theme = themes[index]
        slot.scopeId = null
        slot.allowedEvidenceIds = [theme.anchorEvidenceId, ...theme.supportingEvidenceIds]
        coreEvidenceIdsBySlot[slot.slotId] = [theme.anchorEvidenceId]
        skillThemes[slot.slotId] = theme
      }
      blueprint.requiredBodyEvidenceIds = [...new Set(blueprint.slots.filter(slot => slot.kind !== 'skill')
        .flatMap(slot => coreEvidenceIdsBySlot[slot.slotId] ?? []))]
    }
  }
  if (input.targeting) {
    for (const context of deriveWritingContexts(input.resume, input.plan)) {
      const owner = blueprint.slots.find(slot => slot.kind === 'business_bullet' && slot.allowedEvidenceIds.includes(context.anchorEvidenceId))
      const atom = atoms.get(context.evidenceId)
      const fact = atom && buildWritingFact(atom)
      if (!owner || !fact) continue
      selectedFacts.push({ ...fact, requiredNumbers: [], contextForEvidenceId: context.anchorEvidenceId, contextRole: context.role })
      owner.allowedEvidenceIds.push(context.evidenceId)
      expandedEvidenceIds[context.evidenceId] = [context.evidenceId]
    }
  }
  const result: WritingPlan = {
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
    ...(input.editorialPolicy ? { educationIdentity: deriveEducationIdentity(input.resume.evidenceAtoms) } : {}),
    ...(skillPolicy ? { skillPolicy } : {}),
    ...(input.targeting ? { summaryThemes, skillThemes } : {}),
    ...(input.targeting ? { targeting: input.targeting, taskSupportPolicy: TASK_SUPPORT_POLICY } : {}),
    ...(input.targeting ? { summaryPriorityEvidenceIds } : {}),
    ...(input.targeting ? { editorialIntentVersion: WRITING_INTENT_VERSION, editorialIntents: buildWritingIntents({
      resume: input.resume, targets: input.targeting.targets, fit: input.targeting.fit,
      selectedEvidenceIds: new Set(selectedFacts.map(fact => fact.evidenceId)),
    }) } : {}),
    ...(input.targeting ? { editorial: { version: WRITING_EDITORIAL_VERSION, slots: buildSlotEditorialGuides({
      blueprint, facts: selectedFacts, coreBySlot: coreEvidenceIdsBySlot, taskLinks: supportedTaskLinks,
      targets: input.targeting.targets, overlaps, outputLength: input.policy.outputLength,
      methodSkills: skillPolicy === PRACTICE_SKILL_POLICY,
    }) } } : {}),
  }
  return input.editorialPolicy ? applyDocumentEditorialPlan(result, input.job) : result
}

export function writingPayload(plan: WritingPlan) {
  const selected = new Set(plan.facts.map(fact => fact.evidenceId))
  const relevantLinks = plan.targeting?.fit.links.filter(link => ['direct', 'transferable', 'weak_signal'].includes(link.status) && link.evidenceIds.some(id => selected.has(id))) ?? []
  const targetIds = new Set(relevantLinks.map(link => link.targetId))
  const relatedTaskIds = new Set(plan.targeting?.targets.filter(target => targetIds.has(target.id)).flatMap(target => target.taskIds) ?? [])
  return {
    writingPolicy: plan.version,
    ...(plan.skillPolicy ? { skillPolicy: plan.skillPolicy } : {}),
    ...(plan.summaryThemes ? { themeVersion: WRITING_THEME_VERSION } : {}),
    ...(plan.targeting ? { factPlacement: 'slot-local-v1' as const } : {}),
    ...(plan.documentEditorial ? { documentEditorial: plan.documentEditorial } : {}),
    ...(plan.educationIdentity?.length ? { candidateIdentity: { education: plan.educationIdentity } } : {}),
    ...(plan.fixedBlocks?.length ? { sourceRenderedSkills: plan.fixedBlocks } : {}),
    positioning: plan.positioning,
    guidance: plan.guidance,
    outputLength: plan.outputLength,
    blueprint: {
      contractVersion: plan.blueprint.contractVersion,
      slots: plan.blueprint.slots.filter(slot=>!plan.fixedBlocks?.some(block=>block.slotId === slot.slotId)).map(slot => ({
        slotId: slot.slotId, kind: slot.kind, required: slot.required,
        allowedEvidenceIds: slot.allowedEvidenceIds,
        coreEvidenceIds: plan.coreEvidenceIdsBySlot[slot.slotId],
        ...(plan.targeting ? { facts: plan.facts.filter(fact => slot.allowedEvidenceIds.includes(fact.evidenceId)) } : {}),
        ...(slot.kind === 'summary' && plan.summaryPriorityEvidenceIds?.length ? { preferredEvidenceIds: plan.summaryPriorityEvidenceIds } : {}),
        ...(slot.kind === 'summary' && plan.summaryThemes?.length ? { editorial: { role: 'positioning', themes: plan.summaryThemes } } : {}),
        ...(plan.skillThemes?.[slot.slotId] ? { editorial: { role: 'method', theme: plan.skillThemes[slot.slotId] } } : {}),
        ...(plan.editorial?.slots[slot.slotId] ? { editorial: compactEditorialGuide(plan.editorial.slots[slot.slotId]) } : {}),
      })),
    },
    ...(!plan.targeting ? { facts: plan.facts } : {}),
    ...(plan.editorial ? { editorialVersion: plan.editorial.version, contextVersion: WRITING_CONTEXT_VERSION } : {}),
    ...(plan.targeting ? { jobTargeting: {
      ...(plan.taskSupportPolicy === TASK_SUPPORT_POLICY ? { taskSupportPolicy: TASK_SUPPORT_POLICY } : {}),
      tasks: plan.targeting.profile.tasks.filter(task => task.priority === 'core' || plan.targeting!.targets.some(target => targetIds.has(target.id) && target.taskIds.includes(task.id)))
        .map(({ id, text, priority, provenance }) => ({ id, text, priority, basis: provenance.basis })),
      successConditions: plan.targeting.profile.successConditions.filter(condition => targetIds.has(condition.id) || condition.taskIds.some(id => relatedTaskIds.has(id)))
        .map(({ id, text, taskIds, provenance }) => ({ id, text, taskIds, basis: provenance.basis })),
      otherTargets: plan.targeting.targets.filter(target => targetIds.has(target.id) && !['task', 'condition'].includes(target.kind))
        .map(({ id, kind, text, basis, taskIds, dimension }) => ({ id, kind, text, basis, taskIds, ...(dimension ? { dimension } : {}) })),
      // Analysis prose is not a fact source. Keep intent references, never a ready-made summary.
      narrativeIntents: plan.targeting.fit.narratives.filter(item => item.evidenceIds.every(id => selected.has(id)))
        .map(({ targetIds, evidenceIds }) => ({ targetIds, evidenceIds })),
      links: relevantLinks.map(link => ({ targetId: link.targetId, status: link.status,
        ...(plan.taskSupportPolicy === TASK_SUPPORT_POLICY ? {
          relation: writingLinkRelation(link, plan.targeting!.targets.find(target => target.id === link.targetId)),
        } : {}),
        evidenceIds: link.evidenceIds.filter(id => selected.has(id)) })),
      ...(plan.editorialIntents ? { intentVersion: plan.editorialIntentVersion ?? 'writing-intent-v1', editorialIntents: plan.editorialIntents } : {}),
    } } : {}),
  }
}

function compactEditorialGuide(guide: SlotEditorialGuide) {
  return {
    role: guide.role,
    ...(guide.targetTaskIds.length ? {targetTaskIds: guide.targetTaskIds} : {}),
    ...(guide.emphasis.length ? {emphasis: guide.emphasis} : {}),
    ...(guide.priorityEvidenceIds?.length ? { priorityEvidenceIds: guide.priorityEvidenceIds } : {}),
    lengthHint: {target: guide.lengthHint.target, max: guide.lengthHint.max},
    ...(guide.avoidRepeatingSlotIds.length ? {avoidRepeatingSlotIds: guide.avoidRepeatingSlotIds} : {}),
  }
}
