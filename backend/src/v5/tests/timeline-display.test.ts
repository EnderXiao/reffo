import { expect, test } from 'bun:test'
import { formatTimelineHeading } from '@/v5/composition/timeline-display'
import { createV5ResultFixture } from '@/v5/tests/fixtures'

test('timeline and education headings share one formatter without guessing missing facts', () => {
  const scope = createV5ResultFixture().resumeEvidenceBundle.timeline[0]
  const input = { ...scope, organization: ' 某大学 ', title: '某大学', start: '2022.09', end: null }
  const before = structuredClone(input)
  expect(formatTimelineHeading(input)).toBe('某大学｜2022.09')
  expect(input).toEqual(before)
  expect(formatTimelineHeading({ ...input, organization: null, title: '研究实践', start: null })).toBe('研究实践')
  expect(formatTimelineHeading({ ...input, start: '2021-2024', end: '2024.12毕业' })).toBe('某大学｜2021 - 2024.12毕业')
  expect(formatTimelineHeading({ ...input, start: '2021-2023', end: '2024.12毕业' })).toBe('某大学｜2021-2023 - 2024.12毕业')
})
