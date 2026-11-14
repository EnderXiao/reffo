import {describe, expect, test} from 'bun:test'
import {canonicalizeSourceDocument} from '@/v5/canonical-source'
import {validateTargetedJobExtraction} from '@/v5/targeting/profile'
import {prepareTargetedSignalRepair} from '@/v5/targeting/extraction-repair'
import {compileV5Prompt} from '@/v5/prompt-compiler'
import type {TargetedJobExtraction} from '@/v5/targeting/contracts'
import {createJobFixture} from './fixtures'

function fixture(includeQualifications = true) {
  const document = canonicalizeSourceDocument('示例公司\n长沙/15-30K·13薪/3-5年/本科\n负责产品规划。', 'signal-repair').canonicalDocument
  const template = createJobFixture().candidate
  const block = document.blocks[2]!, summary = document.blocks[1]!
  const candidate: TargetedJobExtraction = {...template, basicInfo: {title: null, company: '示例公司', location: '长沙'},
    basicInfoSourceBlockIds: ['B0001', 'B0002'],
    requirementCandidates: [{...template.requirementCandidates[0]!, requirementLocalId: 'r-task',
      sourceBlockId: block.sourceBlockId, verbatimText: block.text, normalizedRequirement: block.text,
      blockRelativeSpan: {start: 0, end: block.text.length}, category: 'responsibility'}],
    explicitCompanySignals: [{statement: '示例公司', requirementLocalIds: ['B0001']}],
    explicitLocationSignals: [{statement: '长沙', requirementLocalIds: ['B0002']}],
    coverageClaim: {mappedSourceBlockIds: document.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: []},
    jobSuccessProfile: {contractVersion: 'job-success-profile-v1', context: [], tasks: [], outcomes: [], successConditions: [],
      attributes: [], requirements: [], unknowns: [], conflicts: []}}
  if (includeQualifications) for (const [category, quote] of [['education', '本科'], ['experience', '3-5年']] as const) {
    const requirementLocalId = `r-${category}`, start = summary.text.indexOf(quote)
    candidate.requirementCandidates.push({...candidate.requirementCandidates[0]!, requirementLocalId,
      sourceBlockId: summary.sourceBlockId, verbatimText: quote, normalizedRequirement: quote, category,
      importance: 'differentiator', blockRelativeSpan: {start, end: start + quote.length}})
    candidate.jobSuccessProfile.requirements.push({requirementLocalId, sourceQuote: quote, condition: 'unclear'})
  }
  return {document, candidate}
}

describe('P02 signal association repair stays local', () => {
  test('signal errors do not conceal independently missing summary qualifications from the single repair', () => {
    const f = fixture(false), checked = validateTargetedJobExtraction(f.document, f.candidate)
    expect(checked.passed).toBe(false)
    expect(checked.issues.filter(issue => issue.code === 'INVALID_SIGNAL_REFERENCE')).toHaveLength(2)
    expect(checked.issues.filter(issue => issue.code === 'JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING')).toHaveLength(2)
    expect(prepareTargetedSignalRepair(checked.value!, checked.issues)).toBeNull()
    const repair = compileV5Prompt({component: 'P02R', envelope: {payload: {originalEnvelope: {payload: {jobTargetingPolicy: 'job-targeted-v2'}},
      currentOutput: checked.value, validationIssues: checked.issues.filter(issue => issue.severity === 'error')}}})
    expect(repair.messages[1]!.content).toContain('INVALID_SIGNAL_REFERENCE')
    expect(repair.messages[1]!.content).toContain('JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING')
  })

  test('signal-only repair keeps source candidates, qualifications and every unrelated field', () => {
    const f = fixture(), before = structuredClone(f.candidate)
    // Quote is unique: retain the existing server span normalization in the repair baseline.
    f.candidate.requirementCandidates[0]!.blockRelativeSpan = {start: 1, end: 2}
    const checked = validateTargetedJobExtraction(f.document, f.candidate)
    expect(checked.issues.some(issue => issue.code === 'JD_QUOTE_SPAN_SERVER_ALIGNED')).toBe(true)
    expect(checked.issues.filter(issue => issue.severity === 'error').map(issue => issue.code))
      .toEqual(['INVALID_SIGNAL_REFERENCE', 'INVALID_SIGNAL_REFERENCE'])
    const repair = prepareTargetedSignalRepair(checked.value!, checked.issues)!
    const model = structuredClone(checked.value!)
    model.explicitCompanySignals[0]!.requirementLocalIds = []
    model.explicitLocationSignals[0]!.requirementLocalIds = []
    // A full transport can regress elsewhere; those changes are outside the repair scope.
    model.requirementCandidates = []
    model.jobSuccessProfile.requirements = []
    model.basicInfo.company = '伪造公司'
    const merged = repair.merge(model)
    expect(merged.requirementCandidates).toEqual(before.requirementCandidates)
    expect(merged.jobSuccessProfile).toEqual(before.jobSuccessProfile)
    expect(merged.basicInfo).toEqual(before.basicInfo)
    expect(merged.explicitCompanySignals[0]!.requirementLocalIds).toEqual([])
    expect(validateTargetedJobExtraction(f.document, merged).passed).toBe(true)
    expect(f.candidate.explicitCompanySignals[0]!.requirementLocalIds).toEqual(['B0001'])
  })

  test('no invalid alias is guessed and model changes cannot replace a signal statement', () => {
    const f = fixture(), checked = validateTargetedJobExtraction(f.document, f.candidate)
    const repair = prepareTargetedSignalRepair(checked.value!, checked.issues)!
    for (const update of [
      {statement: '示例公司', requirementLocalIds: ['B0001']},
      {statement: '虚构公司', requirementLocalIds: []},
      {statement: '示例公司', requirementLocalIds: ['r-task', 'r-task']},
    ]) {
      const model = structuredClone(f.candidate)
      model.explicitCompanySignals[0] = update
      model.explicitLocationSignals[0]!.requirementLocalIds = []
      expect(() => repair.merge(model)).toThrow('P02_SIGNAL_REPAIR_SCOPE_MISMATCH')
    }
  })

  test('valid existing associations are preserved and source quote errors still block profile inspection', () => {
    const f = fixture()
    f.candidate.explicitCompanySignals[0]!.requirementLocalIds.push('r-task')
    const checked = validateTargetedJobExtraction(f.document, f.candidate), repair = prepareTargetedSignalRepair(checked.value!, checked.issues)!
    const model = structuredClone(f.candidate)
    model.explicitCompanySignals[0]!.requirementLocalIds = []
    model.explicitLocationSignals[0]!.requirementLocalIds = []
    expect(() => repair.merge(model)).toThrow('P02_SIGNAL_REPAIR_SCOPE_MISMATCH')
    const invalid = fixture(false)
    invalid.candidate.requirementCandidates[0]!.verbatimText = '原文不存在的要求'
    const rejected = validateTargetedJobExtraction(invalid.document, invalid.candidate)
    expect(rejected.passed).toBe(false)
    expect(rejected.value).toBeUndefined()
    expect(rejected.issues.some(issue => issue.code === 'JD_QUOTE_NOT_FOUND')).toBe(true)
    expect(rejected.issues.some(issue => issue.code === 'JOB_PROFILE_SUMMARY_QUALIFICATION_MISSING')).toBe(false)
  })
})
