import type { ResumeEvidenceBundle } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { targetingSelectionBasis } from '@/v5/targeting/fit'

export const TASK_SUPPORT_POLICY = 'independent-task-evidence-v1' as const

/** Ranking/grouping context only. Never serialize these sets as supported task IDs. */
export function buildTaskRelevanceLinks(input: { fit: JobFitMap; targets: JobTarget[]; resume: ResumeEvidenceBundle }) {
  const targets = new Map(input.targets.map(target => [target.id, target]))
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const links = new Map<string, Set<string>>()
  for (const link of input.fit.links) {
    const target = targets.get(link.targetId)
    if (!target || target.basis === 'unknown') continue
    for (const id of link.evidenceIds) {
      const atom = atoms.get(id)
      if (!atom || !targetingSelectionBasis(link, atom)) continue
      links.set(id, new Set([...(links.get(id) ?? []), ...target.taskIds]))
    }
  }
  return links
}

/** An association helps selection; it does not inherit proof of every related task. */
export function writingLinkRelation(link: JobFitMap['links'][number], target?: JobTarget) {
  if (!target || target.basis === 'unknown' || !['direct', 'transferable', 'weak_signal'].includes(link.status)) return 'unproven'
  if (target.kind !== 'task') return 'related_context'
  if (link.status === 'weak_signal') return 'partial_task_evidence'
  return link.status === 'direct' ? 'direct_task_evidence' : 'transferable_task_evidence'
}

/** Only independent direct/transferable task links populate unqualified task IDs.
 * Partial and related practice retain their selection scores and scoped Writer intents.
 */
export function buildTaskEvidenceLinks(input: { fit: JobFitMap; targets: JobTarget[]; resume: ResumeEvidenceBundle }) {
  const targets = new Map(input.targets.map(target => [target.id, target]))
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const links = new Map<string, Set<string>>()
  for (const link of input.fit.links) {
    const target = targets.get(link.targetId)
    const relation = writingLinkRelation(link, target)
    if (relation !== 'direct_task_evidence' && relation !== 'transferable_task_evidence') continue
    for (const id of link.evidenceIds) {
      const atom = atoms.get(id)
      if (!atom || targetingSelectionBasis(link, atom) !== 'supported') continue
      const tasks = links.get(id) ?? new Set<string>()
      tasks.add(target!.id)
      links.set(id, tasks)
    }
  }
  return links
}
