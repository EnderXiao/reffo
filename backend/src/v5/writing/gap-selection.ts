import type { GapDecision } from './entry-skeleton'

export interface GapSelectionCandidate {
  entryId: string
  scopeId: string | null
  element: GapDecision['element']
  purpose: Extract<GapDecision, {action: 'supplement'}>['purpose']
  taskPriority: number
  order: number
  path: string
  index: number
  detailId?: string
  detailKind?: string
  subject?: string
  anchorEvidenceIds?: string[]
  parentScopeId?: string
}
export type GapSelection = GapSelectionCandidate & { disposition: 'selected' | 'omitted_duplicate' }
const PURPOSE_PRIORITY = {clarify_contribution: 0, explain_key_action: 0,
  identify_deliverable: 1, complete_existing_comparison: 1, identify_object: 2} as const

/** Priority organizes useful details; it is never a quota or a hidden Top N. */
export function selectCompletionGaps(candidates: GapSelectionCandidate[]): GapSelection[] {
  const identities = new Set<string>()
  const detailedResearchParents = new Set(candidates.filter(item => item.detailKind === 'research_finding' && item.parentScopeId)
    .map(item => item.parentScopeId!))
  return [...candidates].sort((a, b) => a.taskPriority - b.taskPriority
    || PURPOSE_PRIORITY[a.purpose] - PURPOSE_PRIORITY[b.purpose]
    || a.order - b.order || a.path.localeCompare(b.path, 'en', {numeric: true}) || a.index - b.index)
    .map(item => {
      // Keep the precise child-project request; a broad job overview would ask
      // the user to repeat a finding without identifying an additional study.
      if (item.detailKind === 'research_finding' && item.scopeId && detailedResearchParents.has(item.scopeId)) {
        return {...item, disposition: 'omitted_duplicate' as const}
      }
      const identity = item.detailId ? JSON.stringify([item.scopeId ?? item.entryId, item.detailKind,
        item.subject?.replace(/\s+/gu, '').toLowerCase(), [...(item.anchorEvidenceIds ?? [])].sort()])
        : `${item.scopeId ?? item.entryId}:${item.element}`
      if (identities.has(identity)) return {...item, disposition: 'omitted_duplicate' as const}
      identities.add(identity)
      return {...item, disposition: 'selected' as const}
    })
}
