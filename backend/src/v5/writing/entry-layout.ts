import type { GenerationPolicy } from '@/v5/types'

export const ENTRY_LAYOUT_VERSION = 'entry-layout-v2' as const

/** Source selection uses the normal budget. Presentation may separate its
 * meaning into a few more bullets without increasing the document word cap.
 */
export function entryLayoutItemLimit(policy: GenerationPolicy) {
  return policy.hardTotalListItemMax + Math.min(6, Math.ceil(policy.hardTotalListItemMax / 3))
}

export function entryParagraphLimit(business: boolean, compressed: boolean) {
  return business ? compressed ? 2 : 4 : 1
}

/** Allocate a bounded rewrite, never remove content here. Counts are measured
 * after safe joins and exact duplicate removal, including server-fixed bullets.
 */
export function planEntryLayoutCorrections(
  entries: Array<{entryId: string; currentParagraphCount: number; paragraphLimit: number}>,
  totalListItemCount: number, hardLimit: number,
) {
  const targets = new Map(entries.map(entry => [entry.entryId, entry.currentParagraphCount]))
  let excess = totalListItemCount - hardLimit
  // Per-entry limits guide allocation; they are not a reason to collapse
  // meaningful paragraphs when the whole document already fits.
  for (const entry of entries) {
    const reduction = Math.min(Math.max(0, excess), Math.max(0, entry.currentParagraphCount - entry.paragraphLimit))
    targets.set(entry.entryId, entry.currentParagraphCount - reduction)
    excess -= reduction
  }
  while (excess > 0) {
    const entry = [...entries].filter(item => targets.get(item.entryId)! > 1).sort((a, b) =>
      Number(targets.get(a.entryId)! < a.currentParagraphCount) - Number(targets.get(b.entryId)! < b.currentParagraphCount)
      || targets.get(b.entryId)! - targets.get(a.entryId)!)[0]
    if (!entry) break
    targets.set(entry.entryId, targets.get(entry.entryId)! - 1)
    excess--
  }
  return entries.flatMap(entry => {
    const targetParagraphCount = targets.get(entry.entryId)!
    return targetParagraphCount < entry.currentParagraphCount ? [{...entry, targetParagraphCount}] : []
  })
}

export function canCompactEntryParagraphs(
  left: { role: string; text: string }, right: { role: string; text: string },
  unit: GenerationPolicy['outputLength']['unit'],
) {
  const sameRole = left.role === right.role
  const actionToResult = ['approach', 'contribution', 'method'].includes(left.role) && right.role === 'outcome'
  if (!sameRole && !actionToResult) return false
  const text = `${left.text} ${right.text}`
  const size = unit === 'cjk_characters' ? [...text].length : text.trim().split(/\s+/u).length
  return size <= (unit === 'cjk_characters' ? 140 : 80)
}
