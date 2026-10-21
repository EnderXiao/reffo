import { describe, expect, test } from 'bun:test'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildJobRequirementBundle, validateJobExtractionCandidate } from '@/v5/evidence'
import { buildJobTargets, validateTargetedJobExtraction } from '@/v5/targeting/profile'
import { buildRequirementAnalysis } from '@/v5/targeting/presentation'
import type { TargetedJobExtraction } from '@/v5/targeting/contracts'
import { createJobFixture } from '@/v5/tests/fixtures'

function summaryFixture(summary = '长沙/15-30K·13薪/3-5年/本科') {
  const document = canonicalizeSourceDocument(`海外产品经理（c端）\n${summary}\n负责产品规划。`, 'summary-job').canonicalDocument
  const source = createJobFixture().candidate
  const block = document.blocks[2]
  const candidate: TargetedJobExtraction = {
    ...source,
    basicInfo: { title: '海外产品经理（c端）', company: null, location: '长沙' },
    basicInfoSourceBlockIds: ['B0001', 'B0002'],
    requirementCandidates: [{
      ...source.requirementCandidates[0], sourceBlockId: block.sourceBlockId,
      verbatimText: block.text, normalizedRequirement: block.text,
      blockRelativeSpan: { start: 0, end: block.text.length },
    }],
    coverageClaim: { mappedSourceBlockIds: document.blocks.map(item => item.sourceBlockId), unmappedSourceBlockIds: [] },
    jobSuccessProfile: {
      contractVersion: 'job-success-profile-v1', context: [], tasks: [], outcomes: [], successConditions: [], attributes: [],
      requirements: [], unknowns: [], conflicts: [],
    },
  }
  return { document, candidate }
}

function addQualification(fixture: ReturnType<typeof summaryFixture>, quote: string, category: 'education' | 'experience') {
  const block = fixture.document.blocks[1]
  const id = `r-${category}`
  const start = block.text.indexOf(quote)
  fixture.candidate.requirementCandidates.push({
    ...fixture.candidate.requirementCandidates[0], requirementLocalId: id, sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start, end: start + quote.length }, verbatimText: quote, normalizedRequirement: quote,
    category, importance: 'differentiator',
  })
  fixture.candidate.jobSuccessProfile.requirements.push({ requirementLocalId: id, sourceQuote: quote, condition: 'unclear' })
}

function addWholeSummaryRequirement(fixture: ReturnType<typeof summaryFixture>) {
  const block = fixture.document.blocks[1]
  fixture.candidate.requirementCandidates.push({
    ...fixture.candidate.requirementCandidates[0], requirementLocalId: 'r-summary', sourceBlockId: block.sourceBlockId,
    blockRelativeSpan: { start: 0, end: block.text.length }, verbatimText: block.text, normalizedRequirement: block.text,
    category: 'other', importance: 'nice_to_have',
  })
  fixture.candidate.jobSuccessProfile.requirements.push({ requirementLocalId: 'r-summary', sourceQuote: block.text, condition: 'unclear' })
}

function qualitativeConflictFixture(qualitativeText: string, description = '摘要与正文的年限口径不一致') {
  const fixture = summaryFixture()
  fixture.document = canonicalizeSourceDocument(`海外产品经理（c端）\n${fixture.document.blocks[1].text}\n${qualitativeText}`, 'summary-job').canonicalDocument
  const block = fixture.document.blocks[2]
  fixture.candidate.requirementCandidates[0] = {
    ...fixture.candidate.requirementCandidates[0], verbatimText: block.text, normalizedRequirement: block.text,
    blockRelativeSpan: { start: 0, end: block.text.length }, category: 'experience', importance: 'differentiator',
  }
  addQualification(fixture, '3-5年', 'experience')
  addQualification(fixture, '本科', 'education')
  fixture.candidate.jobSuccessProfile.conflicts = [{ sourceBlockIds: ['B0002', 'B0003'], description }]
  return fixture
}

describe('explicit qualifications in mixed recruiting summaries', () => {
  test('rejects coverage by basic info alone when education and years were omitted', () => {
    const fixture = summaryFixture()
    expect(validateJobExtractionCandidate(fixture.document, fixture.candidate).passed).toBe(true)

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(false)
    const missing = checked.issues.filter(issue => issue.code === 'JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING')
    expect(missing).toHaveLength(2)
    expect(missing.map(issue => issue.message).join('\n')).toContain('3-5年')
    expect(missing.map(issue => issue.message).join('\n')).toContain('本科')
  })

  test('allows shared basic-info coverage and two independent quotes to reach matching and presentation', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    expect(checked.issues).toEqual([])
    const candidate = checked.value!
    const bundle = buildJobRequirementBundle(fixture.document, candidate)
    const targets = buildJobTargets(candidate, bundle)
    expect(targets.filter(target => target.kind === 'requirement').map(target => target.text)).toEqual(['负责产品规划。', '3-5年', '本科'])
    expect(new Set(targets.map(target => target.id)).size).toBe(3)
    expect(bundle.requirementAtoms.filter(atom => atom.sourceBlockId === 'B0002').map(atom => atom.category)).toEqual(['experience', 'education'])
    expect(buildRequirementAnalysis(candidate, fixture.document)?.externalRequirements.map(item => item.text)).toEqual(['3-5年', '本科'])
    expect(candidate.jobSuccessProfile.requirements.every(item => item.condition === 'unclear')).toBe(true)
    expect(bundle.requirementAtoms.some(atom => atom.importance === 'must_have')).toBe(false)
  })

  test('requires each qualification category and its profile condition instead of accepting partial extraction', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '本科', 'education')
    let checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)
    expect(checked.issues.filter(issue => issue.code === 'JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING')).toHaveLength(1)

    addQualification(fixture, '3-5年', 'experience')
    fixture.candidate.jobSuccessProfile.requirements = fixture.candidate.jobSuccessProfile.requirements.filter(item => item.requirementLocalId !== 'r-experience')
    checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)
    expect(checked.passed).toBe(false)
    expect(checked.issues.some(issue => issue.message.includes('3-5年'))).toBe(true)
  })

  test('does not add years to unitless ranges or infer language and visa requirements from the overseas title', () => {
    const fixture = summaryFixture('长沙/15-30K·13薪/3-5产品经理/本科')
    addQualification(fixture, '本科', 'education')
    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    const bundle = buildJobRequirementBundle(fixture.document, checked.value!)
    expect(buildJobTargets(checked.value!, bundle).map(target => target.text)).toEqual(['负责产品规划。', '本科'])
  })

  test('accepts explicit qualification labels with exact source spans', () => {
    const fixture = summaryFixture('长沙｜薪资面议｜经验：3年以上｜学历：本科及以上学历')
    addQualification(fixture, '3年以上', 'experience')
    addQualification(fixture, '本科及以上学历', 'education')

    expect(validateTargetedJobExtraction(fixture.document, fixture.candidate).passed).toBe(true)
  })

  test('still rejects qualifications whose quote does not exist in the source', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '硕士', 'education')

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(false)
    expect(checked.issues.some(issue => issue.code === 'JD_QUOTE_NOT_FOUND')).toBe(true)
  })

  test('removes an extra metadata requirement and all local references while preserving the separate qualifications', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')
    addWholeSummaryRequirement(fixture)
    fixture.candidate.explicitLocationSignals = [{ statement: '长沙', requirementLocalIds: ['r-summary'] }]
    fixture.candidate.jobSuccessProfile.tasks.push({
      id: 'job:task:t1', text: '产品规划', priority: 'core', requirementLocalIds: ['r1', 'r-summary'],
      provenance: { basis: 'explicit', sourceBlockIds: ['B0003'], confidence: 'high', reason: '' },
    })

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    const value = checked.value!
    expect(value.requirementCandidates.map(item => item.requirementLocalId)).toEqual(['r1', 'r-experience', 'r-education'])
    expect(value.jobSuccessProfile.requirements.map(item => item.requirementLocalId)).toEqual(['r-experience', 'r-education'])
    expect(value.jobSuccessProfile.tasks[0].requirementLocalIds).toEqual(['r1'])
    expect(value.explicitLocationSignals).toEqual([{ statement: '长沙', requirementLocalIds: [] }])
    expect(value.basicInfo.location).toBe('长沙')
    expect(checked.issues.some(issue => issue.code === 'JOB_PROFILE_SUMMARY_METADATA_REMOVED' && issue.severity === 'warning')).toBe(true)
    expect(validateTargetedJobExtraction(fixture.document, value).passed).toBe(true)
  })

  test('retains block coverage when the extra metadata requirement was its only basic-info coverage', () => {
    const fixture = summaryFixture()
    fixture.candidate.basicInfo.location = null
    fixture.document.blocks[1].text = '15-30K·13薪/3-5年/本科'
    fixture.document.blocks[1].canonicalEnd = fixture.document.blocks[1].canonicalStart + fixture.document.blocks[1].text.length
    fixture.candidate.basicInfoSourceBlockIds = ['B0001']
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')
    addWholeSummaryRequirement(fixture)

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    expect(checked.value?.basicInfoSourceBlockIds).toContain('B0002')
    expect(validateTargetedJobExtraction(fixture.document, checked.value!).passed).toBe(true)
  })

  test('does not remove a compound source block that contains a real business task', () => {
    const fixture = summaryFixture('长沙/3-5年/本科/负责产品规划与增长')
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')
    addWholeSummaryRequirement(fixture)

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    expect(checked.value?.requirementCandidates.some(item => item.requirementLocalId === 'r-summary')).toBe(true)
  })

  test('asks for targeted repair instead of preserving a task supported only by metadata', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')
    addWholeSummaryRequirement(fixture)
    fixture.candidate.jobSuccessProfile.tasks.push({
      id: 'job:task:t1', text: '符合长沙薪资水平', priority: 'core', requirementLocalIds: ['r-summary'],
      provenance: { basis: 'explicit', sourceBlockIds: ['B0002'], confidence: 'high', reason: '' },
    })

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(false)
    expect(checked.issues.some(issue => issue.code === 'JOB_PROFILE_METADATA_NODE_INVALID')).toBe(true)
  })

  test('never accepts a hyphen-normalized quote when the source uses a different dash', () => {
    const fixture = summaryFixture('长沙/15–30K·13薪/3–5年/本科')
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(false)
    expect(checked.issues.some(issue => issue.code === 'JD_QUOTE_NOT_FOUND')).toBe(true)
  })

  test.each(['长沙/15-30K', '15-30K·13薪', '13薪/3-5年/本科', '3-5年/本科', '长沙', '15-30K', '13薪'])(
    'removes metadata fragments without losing exact standalone qualifications: %s', quote => {
      const fixture = summaryFixture()
      addQualification(fixture, '3-5年', 'experience')
      addQualification(fixture, '本科', 'education')
      addWholeSummaryRequirement(fixture)
      const metadata = fixture.candidate.requirementCandidates.at(-1)!
      const start = fixture.document.blocks[1].text.indexOf(quote)
      Object.assign(metadata, { category: 'location', verbatimText: quote, normalizedRequirement: quote,
        blockRelativeSpan: { start, end: start + quote.length } })
      fixture.candidate.jobSuccessProfile.requirements.at(-1)!.sourceQuote = quote

      const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

      expect(checked.passed).toBe(true)
      expect(checked.value?.requirementCandidates.filter(item => item.sourceBlockId === 'B0002').map(item => item.verbatimText)).toEqual(['3-5年', '本科'])
      expect(checked.value?.basicInfoSourceBlockIds).toContain('B0002')
    },
  )

  test('retains a complete qualification quote that includes its original field label', () => {
    const fixture = summaryFixture('长沙/15-30K·13薪/经验：3-5年/学历：本科')
    addQualification(fixture, '经验：3-5年', 'experience')
    addQualification(fixture, '学历：本科', 'education')

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    expect(checked.value?.requirementCandidates.filter(item => item.sourceBlockId === 'B0002').map(item => item.verbatimText)).toEqual(['经验：3-5年', '学历：本科'])
  })

  test.each(['长沙/需每周到岗5天/本科', '长沙/需接受出差/本科'])(
    'retains actual location constraints in a non-metadata source: %s', summary => {
      const fixture = summaryFixture(summary)
      addQualification(fixture, '本科', 'education')
      addWholeSummaryRequirement(fixture)
      fixture.candidate.requirementCandidates.at(-1)!.category = 'location'

      const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

      expect(checked.passed).toBe(true)
      expect(checked.value?.requirementCandidates.some(item => item.requirementLocalId === 'r-summary')).toBe(true)
    },
  )

  test('rejects a fabricated metadata quote before considering cleanup', () => {
    const fixture = summaryFixture()
    addQualification(fixture, '3-5年', 'experience')
    addQualification(fixture, '本科', 'education')
    addWholeSummaryRequirement(fixture)
    fixture.candidate.requirementCandidates.at(-1)!.verbatimText = '长沙/30-50K'

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(false)
    expect(checked.issues.some(item => item.code === 'JD_QUOTE_NOT_FOUND')).toBe(true)
    expect(checked.issues.some(item => item.code === 'JOB_PROFILE_SUMMARY_METADATA_REMOVED')).toBe(false)
  })

  test.each(['具备多年产品全盘操盘经验。', '具备一定的产品经验。', '具备丰富的产品实践经验。'])(
    'moves a qualitative years comparison to source-linked uncertainty: %s', text => {
      const fixture = qualitativeConflictFixture(text)
      const before = structuredClone(fixture.candidate)

      const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

      expect(checked.passed).toBe(true)
      expect(checked.value?.jobSuccessProfile.conflicts).toEqual([])
      expect(checked.value?.jobSuccessProfile.unknowns.some(item => item.includes('经验口径待确认') && item.includes('3-5年'))).toBe(true)
      expect(checked.value?.uncertainties.find(item => item.statement.includes('经验口径待确认'))?.sourceBlockIds).toEqual(['B0002', 'B0003'])
      expect(checked.issues.some(issue => issue.code === 'JOB_PROFILE_QUALITATIVE_YEARS_ALIGNED' && issue.severity === 'warning')).toBe(true)
      expect(fixture.candidate).toEqual(before)
    },
  )

  test.each([
    ['具备多年产品经验，要求8年以上经验。', '正文要求8年以上，与摘要3-5年的年限范围冲突'],
    ['具备多年产品经验，需八年以上经验。', '正文要求八年以上，与摘要3-5年的年限范围冲突'],
    ['具备多年产品经验，不接受经验不足的候选人。', '摘要与正文的年限口径不一致'],
    ['具备多年产品经验及硕士学历。', '学历要求冲突：正文要求硕士，摘要为本科'],
    ['具备多年产品经验，负责海外增长。', '业务要求与职责差异存在冲突'],
  ])('preserves real numeric, negative or unrelated conflicts: %s', (text, description) => {
    const fixture = qualitativeConflictFixture(text, description)

    const checked = validateTargetedJobExtraction(fixture.document, fixture.candidate)

    expect(checked.passed).toBe(true)
    expect(checked.value?.jobSuccessProfile.conflicts).toEqual(fixture.candidate.jobSuccessProfile.conflicts)
    expect(checked.issues.some(issue => issue.code === 'JOB_PROFILE_QUALITATIVE_YEARS_ALIGNED')).toBe(false)
  })
})
