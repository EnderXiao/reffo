import { expect, test } from 'bun:test'
import { createV5ResultFixture } from './fixtures'
import { inspectEntrySkeleton, renderEntrySegments, projectFactSegments, FIVE_ELEMENTS, entrySegmentSchema, type EntrySegment, type EntryCoverage } from '@/v5/writing/entry-skeleton'

function fixture(missing: 'value' | 'unit' | 'month' = 'value') {
  const atom = structuredClone(createV5ResultFixture().resumeEvidenceBundle.evidenceAtoms.find(item => item.claimType === 'deliverable')!)
  const before = missing === 'value' ? '完成率从63.02%提升至' : missing === 'unit' ? '处理时长由40降低至30' : '完成率从63.02%提升至88%'
  const after = missing === 'value' ? '%' : ''
  atom.verbatimText = missing === 'value' ? `${before}[数值缺失]${after}` : `${before}${after}`
  const projection = missing === 'value' ? '完成率基线为63.02%' : missing === 'unit' ? '处理时长基线40、终值30' : '完成率从63.02%提升至88%'
  const segments: EntrySegment[] = [
    {kind: 'fact', text: projection, evidenceIds: [atom.evidenceId]},
    {kind: 'optional_gap_clause', template: 'metric_detail', candidates: [], metric: {evidenceId: atom.evidenceId, object: missing === 'unit' ? '处理时长' : '完成率', missing, before, after}},
    {kind: 'fact', text: '。', evidenceIds: [atom.evidenceId]},
  ]
  const input = {coverage: FIVE_ELEMENTS.map(element => ({element, status: (element === 'result' ? 'ambiguous' : 'known') as EntryCoverage[number]['status'], evidenceIds: [atom.evidenceId]})),
    paragraphs: [{segments, text: projectFactSegments(segments), evidenceIds: [atom.evidenceId]}],
    facts: [{evidenceId: atom.evidenceId, scopeId: atom.sourceScopeId, text: atom.verbatimText}], atoms: [atom],
    scopeId: atom.sourceScopeId, business: true, outputPath: 'project.case.bullets[0]'}
  return {input, segments, atom, gap: segments[1] as Extract<EntrySegment, {kind: 'optional_gap_clause'}>}
}

test.each(['value', 'unit', 'month'] as const)('a sourced comparison supports one missing %s with a safe projection', missing => {
  const f = fixture(missing)
  expect(entrySegmentSchema.safeParse(f.gap).success).toBe(true)
  expect(inspectEntrySkeleton(f.input)).toEqual([])
  const delivered = renderEntrySegments(f.segments)
  expect(delivered).toContain('【待完善：')
  expect(delivered).toContain('让招聘者看清改进效果')
  expect(delivered).not.toContain('无法确认时删去')
  expect(projectFactSegments(f.segments)).not.toContain('待完善')
  expect(renderEntrySegments(f.segments, new Set())).toBe(f.input.paragraphs[0].text)
})

test('a genuinely truncated comparison uses its original missing endpoint without inventing direction', () => {
  const f = fixture()
  f.atom.verbatimText = '完成率从63.02%提升至'
  f.input.facts[0].text = f.atom.verbatimText
  f.gap.metric!.after = ''
  expect(inspectEntrySkeleton(f.input)).toEqual([])
})

test.each(['invented_direction', 'foreign', 'no_comparison', 'lost_number', 'lost_object', 'two_holes', 'future', 'candidate', 'metric_on_other_template', 'date_known', 'unit_known', 'unsafe_insertion', 'known_endpoint', 'known_unit_elsewhere'] as const)('metric cloze rejects %s', mutation => {
  const f = fixture(mutation === 'date_known' ? 'month' : mutation === 'unit_known' || mutation === 'unsafe_insertion' || mutation === 'known_unit_elsewhere' ? 'unit' : 'value')
  if (mutation === 'invented_direction') f.gap.metric!.before = '完成率从63.02%降低至'
  if (mutation === 'foreign') f.gap.metric!.evidenceId = 'foreign'
  if (mutation === 'no_comparison') {f.atom.verbatimText = '完成率63.02%'; f.gap.metric!.before = '完成率63.02%'; f.gap.metric!.after = ''}
  if (mutation === 'lost_number') f.input.paragraphs[0].text = '完成率。'
  if (mutation === 'lost_object') f.input.paragraphs[0].text = '基线63.02%。'
  if (mutation === 'two_holes') f.atom.verbatimText += '[月份缺失]'
  if (mutation === 'future') f.atom.riskFlags.push('future_or_planned')
  if (mutation === 'candidate') f.gap.candidates = [{kind: 'design_deliverables'}]
  if (mutation === 'metric_on_other_template') f.gap.template = 'problem'
  if (mutation === 'date_known') f.atom.verbatimText += '，2026.04'
  if (mutation === 'unit_known') {f.atom.verbatimText += '分钟'; f.gap.metric!.after = '分钟'}
  if (mutation === 'known_endpoint') {f.atom.verbatimText = '完成率从63.02%提升至88%'; f.gap.metric!.after = ''}
  if (mutation === 'known_unit_elsewhere') f.atom.verbatimText += '，单位为分钟'
  if (mutation === 'unsafe_insertion') {f.gap.metric!.before = '处理时长由4'; f.gap.metric!.after = '0降低至30'}
  expect(inspectEntrySkeleton(f.input).some(issue => issue.code === 'WRITER_GAP_CANDIDATE_INVALID')).toBe(true)
})

test('non-metric null is transport-compatible and gives no factual or numeric evidence credit', () => {
  const f = fixture()
  f.gap.template = 'problem'
  f.gap.metric = null
  f.input.coverage.find(item => item.element === 'problem')!.status = 'missing'
  const parsed = entrySegmentSchema.parse(f.gap)
  expect(parsed.kind).toBe('optional_gap_clause')
  expect(inspectEntrySkeleton(f.input)).toEqual([])
  expect(projectFactSegments([parsed])).toBe('')
  expect(projectFactSegments(f.segments)).toBe(f.input.paragraphs[0].text)
  expect(renderEntrySegments(f.segments)).not.toContain('完成率从63.02%提升至')
})

test.each([null, undefined])('metric template requires a real anchor even when the nullable wire schema accepts %s', metric => {
  const f = fixture()
  f.gap.metric = metric
  expect(entrySegmentSchema.safeParse(f.gap).success).toBe(true)
  expect(inspectEntrySkeleton(f.input).some(issue => issue.code === 'WRITER_GAP_CANDIDATE_INVALID')).toBe(true)
})
