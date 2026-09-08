import type { ResumeEvidenceBundle } from '@/v5/types'

/** Presentation only: omit empty/repeated fields, never infer a date, degree or employer. */
export function formatTimelineHeading(item: ResumeEvidenceBundle['timeline'][number]) {
  const names = [...new Set([item.organization, item.title].map(value => value?.trim()).filter(Boolean))]
  const cleanDate = (value: string | null) => value?.trim().replace(/(\d{4})\.\s+(\d{1,2})/gu, '$1.$2')
  let start = cleanDate(item.start)
  const end = cleanDate(item.end)
  // An already stated year range plus the same end year's graduation detail
  // is one interval, not two concatenated intervals. Conflicting years stay visible.
  const range = start?.match(/^(\d{4})\s*[-–—]\s*(\d{4})$/u)
  if (range && end?.match(/^\d{4}/u)?.[0] === range[2]) start = range[1]
  const dates = [start, end].filter(Boolean).join(' - ')
  return [...names, dates].filter(Boolean).join('｜')
}
