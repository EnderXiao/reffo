import type { GenerationPolicy } from '@/v5/types'

export const ENTRY_LAYOUT_VERSION = 'entry-layout-v2' as const

/** Source selection uses the normal budget. Presentation may separate its
 * meaning into a few more bullets without increasing the document word cap.
 */
export function entryLayoutItemLimit(policy: GenerationPolicy) {
  return policy.hardTotalListItemMax + Math.min(6, Math.ceil(policy.hardTotalListItemMax / 3))
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
