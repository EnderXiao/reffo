import {describe, expect, test} from 'bun:test'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting} from '@/v5/writing/entries'
import {canCompactEntryParagraphs, entryLayoutItemLimit, planEntryLayoutCorrections} from '@/v5/writing/entry-layout'
import {SupportedWritingError} from '@/v5/writing/compiler'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'

describe('bounded entry layout correction', () => {
  test('26 compiled bullets against 24 selects only the exact two-paragraph reduction', () => {
    const entries = [{entryId: 'entry:a', currentParagraphCount: 5, paragraphLimit: 4},
      {entryId: 'entry:b', currentParagraphCount: 3, paragraphLimit: 4},
      {entryId: 'entry:c', currentParagraphCount: 2, paragraphLimit: 2}]
    const before = structuredClone(entries)
    const corrections = planEntryLayoutCorrections(entries, 26, 24)
    expect(corrections.map(item => [item.entryId, item.targetParagraphCount])).toEqual([['entry:a', 4], ['entry:b', 2]])
    expect(corrections.reduce((sum, item) => sum + item.currentParagraphCount - item.targetParagraphCount, 0)).toBe(2)
    expect(entries).toEqual(before)
  })

  test('a complete document within its bound keeps meaningful paragraphs despite per-entry hints', () => {
    expect(planEntryLayoutCorrections([{entryId: 'entry:a', currentParagraphCount: 4, paragraphLimit: 2}], 24, 24)).toEqual([])
  })

  test('irreducible fixed and single-paragraph entries never receive an empty-entry target', () => {
    expect(planEntryLayoutCorrections([{entryId: 'entry:a', currentParagraphCount: 1, paragraphLimit: 4}], 26, 24)).toEqual([])
  })

  test('no valid short join is a local rewrite rather than permission to join long paragraphs', () => {
    const left = {role: 'scope', text: '已记录的责任范围。'.repeat(12)}
    const right = {role: 'problem', text: '已经明确的业务问题。'.repeat(12)}
    expect(canCompactEntryParagraphs(left, right, 'cjk_characters')).toBe(false)
    expect(planEntryLayoutCorrections([{entryId: 'entry:a', currentParagraphCount: 2, paragraphLimit: 4}], 25, 24))
      .toEqual([{entryId: 'entry:a', currentParagraphCount: 2, paragraphLimit: 4, targetParagraphCount: 1}])
  })

  test('a compile that cannot safely join exposes whole-entry correction before global budget validation', () => {
    const result = createV5ResultFixture(), targeting = createTargetingFixture()
    const input = {resume: result.resumeEvidenceBundle, plan: result.resumePlan,
      policy: {...result.generationPolicy, hardTotalListItemMax: 1}, job: result.jobRequirementBundle, match: result.matchAnalysis,
      targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit}}
    const base = buildWritingPlan(input)
    const entryPlan = buildEntryWritingPlan({...input, base})
    const output = {contractVersion: 'entry-writing-v1' as const, entries: entryPlan.entries.map(entry => {
      const fact = entry.facts.find(fact => entry.coreEvidenceIds.includes(fact.evidenceId)) ?? entry.facts[0]!
      const roles = entry.slot.kind === 'business_bullet' ? ['scope', 'problem', 'approach', 'contribution'] as const : ['detail'] as const
      return {entryId: entry.entryId, paragraphs: roles.map(role => ({role, text: fact.text, evidenceIds: [fact.evidenceId]}))}
    })}
    const before = structuredClone(output)
    let failure: SupportedWritingError | undefined
    try { compileEntryWriting({output, entryPlan, resume: input.resume, policy: input.policy}) } catch (error) {
      if (!(error instanceof SupportedWritingError)) throw error
      failure = error
    }
    expect(failure).toBeDefined()
    const layout = failure!.issues.filter(issue => issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')
    expect(layout).toHaveLength(1)
    expect(layout[0]!.outputPath).toBe(entryPlan.entries.find(entry => entry.slot.kind === 'business_bullet')!.entryId)
    const counts = JSON.parse(layout[0]!.expectedConstraint)
    expect(counts.currentParagraphCount).toBe(4)
    expect(counts.compiledParagraphCount).toBe(4)
    expect(counts.targetParagraphCount).toBeLessThan(4)
    expect(counts.totalListItemLimit).toBe(entryLayoutItemLimit(input.policy))
    const maximumPossibleItems = (entryPlan.base.fixedBlocks?.length ?? 0) + output.entries.reduce((sum, entry) =>
      sum + (entryPlan.entries.find(item => item.entryId === entry.entryId)!.slot.kind === 'summary' ? 0 : entry.paragraphs.length), 0)
    expect(counts.totalListItemCount).toBeLessThanOrEqual(maximumPossibleItems)
    expect(failure!.sourceParagraphIndicesByPath.has(layout[0]!.outputPath!)).toBe(false)
    expect(failure!.issues.some(issue => issue.code === 'BUDGET_EXCEEDED')).toBe(false)
    expect(output).toEqual(before)
  })
})
