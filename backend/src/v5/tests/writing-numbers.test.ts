import { expect, test } from 'bun:test'
import { createV5ResultFixture } from './fixtures'
import { inspectSupportedWriting, writingNumbers } from '@/v5/writing/facts'

const source = (text: string) => ({
  ...createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms[0],
  verbatimText: text,
  riskFlags: [],
})

test.each([
  ['2017-2021，2021.06毕业。', ['2017-2021', '2021.06']],
  ['基线63.02，终值88。', ['63.02', '88']],
  ['63.02，88', ['63.02', '88']],
  ['１，２，３', ['1', '2', '3']],
  ['1,200，2,400', ['1,200', '2,400']],
  ['1,200.50，3.7', ['1,200.50', '3.7']],
] as const)('Chinese comma keeps numeric expressions separate: %s', (text, expected) => {
  expect(writingNumbers(text)).toEqual([...expected])
})

test('unchanged date expressions survive Chinese clause separators without accepting changed dates', () => {
  const atom = source('工业设计 | 本科2017-2021（2021.06毕业）')
  const issues = (text: string) => inspectSupportedWriting(text, [atom], 'education.test.bullets[0]').map(issue => issue.code)
  expect(issues('工业设计本科，2017-2021，2021.06毕业。')).not.toContain('WRITER_NUMBER_CHANGED')
  expect(issues('工业设计本科，2017-2022，2021.06毕业。')).toContain('WRITER_NUMBER_CHANGED')
  expect(issues('工业设计本科，2017-2021，2021.07毕业。')).toContain('WRITER_NUMBER_CHANGED')
})

test('Chinese numeric lists retain source checks while ASCII grouped numbers remain distinct quantities', () => {
  const atom = source('记录数值63.02、88；收入1,200.50元。')
  const issues = (text: string) => inspectSupportedWriting(text, [atom], 'body').map(issue => issue.code)
  expect(issues('数值63.02，88，收入1,200.50元。')).not.toContain('WRITER_NUMBER_CHANGED')
  expect(issues('数值63.02，89，收入1,200.50元。')).toContain('WRITER_NUMBER_CHANGED')
  expect(issues('数值63.02，88，收入2,200.50元。')).toContain('WRITER_NUMBER_CHANGED')
  expect(issues('数值63.02，88，收入1，200.50元。')).toContain('WRITER_NUMBER_CHANGED')
})
