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
}

export type GapSelection = GapSelectionCandidate & {
  disposition: 'selected' | 'omitted_duplicate' | 'omitted_document_budget' | 'omitted_length'
}

const PURPOSE_PRIORITY = {clarify_contribution: 0, explain_key_action: 0,
  identify_deliverable: 1, complete_existing_comparison: 1, identify_object: 2} as const

/** Model decisions propose a supplement; only this document pass admits it. */
export function selectCompletionGaps(candidates: GapSelectionCandidate[], limit = 3): GapSelection[] {
  const remaining = [...candidates]
  const counts = new Map<string, number>(), identities = new Set<string>()
  const result: GapSelection[] = []
  let selected = 0
  while (remaining.length) {
    remaining.sort((a, b) => PURPOSE_PRIORITY[a.purpose] - PURPOSE_PRIORITY[b.purpose]
      || a.taskPriority - b.taskPriority
      || (counts.get(a.entryId) ?? 0) - (counts.get(b.entryId) ?? 0)
      || a.order - b.order || a.path.localeCompare(b.path, 'en', {numeric: true}) || a.index - b.index)
    const item = remaining.shift()!
    const identity = `${item.scopeId ?? item.entryId}:${item.element}`
    if (identities.has(identity)) { result.push({...item, disposition: 'omitted_duplicate'}); continue }
    if (selected >= limit || (counts.get(item.entryId) ?? 0) >= 2) {
      result.push({...item, disposition: 'omitted_document_budget'}); continue
    }
    identities.add(identity)
    counts.set(item.entryId, (counts.get(item.entryId) ?? 0) + 1)
    selected++
    result.push({...item, disposition: 'selected'})
  }
  return result
}
