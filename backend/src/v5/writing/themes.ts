import type { CompositionBlueprint } from '@/v5/composition/contract'
import type { JobTarget } from '@/v5/targeting/profile'
import type { WritingFact } from '@/v5/writing/facts'
import { editorialTerms, termOverlap } from '@/v5/writing/editorial'

export const WRITING_THEME_VERSION = 'writing-themes-v1' as const
export interface WritingTheme {
  anchorEvidenceId: string
  supportingEvidenceIds: string[]
  targetTaskIds: string[]
  detailSlotIds: string[]
}

/** Source-anchored editorial candidates, not a semantic ability certification. */
export function buildWritingThemes(input: {
  facts: WritingFact[]
  blueprint: CompositionBlueprint
  taskLinks: ReadonlyMap<string, ReadonlySet<string>>
  relevanceTaskLinks?: ReadonlyMap<string, ReadonlySet<string>>
  targets: JobTarget[]
  mode: 'summary' | 'skill'
  limit: number
}): WritingTheme[] {
  const tasks = input.targets.filter(target => target.kind === 'task')
  const taskById = new Map(tasks.map(task => [task.id, task]))
  const eligible = input.facts.filter(fact => !fact.contextForEvidenceId
    && (input.mode === 'skill' ? ['action', 'responsibility', 'deliverable'] : ['action', 'responsibility', 'deliverable', 'result']).includes(fact.claimType))
  const terms = new Map(input.facts.map(fact => [fact.evidenceId, editorialTerms(fact.text)]))
  const relevanceLinks = input.relevanceTaskLinks ?? input.taskLinks
  const relevance = (fact: WritingFact) => {
    const linked = [...(relevanceLinks.get(fact.evidenceId) ?? [])].flatMap(id => taskById.get(id) ?? [])
    return Math.max(0, ...linked.map(task => termOverlap(terms.get(fact.evidenceId)!, editorialTerms(task.text)) * 3
      + (task.priority === 'core' ? 3 : 1))) + (fact.claimType === 'responsibility' ? 0 : 2)
      + (input.mode === 'summary' && input.blueprint.slots.some(slot => slot.kind === 'business_bullet'
        && slot.sectionKey === 'project' && slot.allowedEvidenceIds.includes(fact.evidenceId)) ? 2 : 0)
  }
  // A long generic duty list should not crowd concrete, job-related practices out
  // of a small theme budget. Responsibilities remain usable for sparse sources.
  const practiceRank = (fact: WritingFact) => {
    const relevant = [...(relevanceLinks.get(fact.evidenceId) ?? [])].some(id => {
      const task = taskById.get(id)
      return task && termOverlap(terms.get(fact.evidenceId)!, editorialTerms(task.text)) > 0
    })
    return relevant ? fact.claimType === 'responsibility' ? 1 : 2 : 0
  }
  const ranked = [...eligible].sort((a, b) => practiceRank(b) - practiceRank(a) || relevance(b) - relevance(a)
    || a.text.length - b.text.length || a.evidenceId.localeCompare(b.evidenceId))
  const anchors: WritingFact[] = []
  for (const fact of ranked) {
    if (anchors.length >= input.limit) break
    const words = terms.get(fact.evidenceId)!
    if (anchors.some(anchor => {
      const other = terms.get(anchor.evidenceId)!, overlap = termOverlap(words, other)
      return words.size && other.size && overlap / Math.min(words.size, other.size) >= 0.6
    })) continue
    anchors.push(fact)
  }
  return anchors.map(anchor => {
    // Same JD task alone does not prove that two actions use the same method.
    const support = input.mode === 'skill' ? input.facts.filter(fact => fact.claimType === 'skill'
      && termOverlap(terms.get(anchor.evidenceId)!, terms.get(fact.evidenceId)!) >= 2).slice(0, 1) : []
    return { anchorEvidenceId: anchor.evidenceId, supportingEvidenceIds: support.map(fact => fact.evidenceId),
      targetTaskIds: [...(input.taskLinks.get(anchor.evidenceId) ?? [])].filter(id => taskById.has(id)).sort(),
      detailSlotIds: input.blueprint.slots.filter(slot => slot.kind === 'business_bullet'
        && slot.allowedEvidenceIds.includes(anchor.evidenceId)).map(slot => slot.slotId) }
  })
}
