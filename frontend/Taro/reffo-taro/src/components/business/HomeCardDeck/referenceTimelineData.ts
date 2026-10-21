import type {ReferenceTimelineItem} from './useReferenceTimeline.h5'

const DAYS_BY_MONTH = [3, 9, 15, 22, 27]

export const REFERENCE_TIMELINE_ITEMS: ReferenceTimelineItem[] = Array.from({length: 12}, (_, monthIndex) => {
  const month = monthIndex + 1
  return DAYS_BY_MONTH.map(day => ({
    id: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    timestamp: new Date(2026, monthIndex, day, 12, 0, 0).getTime(),
    label: `${month}月`,
    fineLabel: String(day),
    group: String(month),
  }))
}).flat()
