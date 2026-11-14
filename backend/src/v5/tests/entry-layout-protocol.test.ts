import {expect, test} from 'bun:test'
import {createV5ResultFixture} from './fixtures'
import {createTargetingFixture} from './targeting-fixtures'
import {v4FixtureEntry} from './entry-skeleton-fixtures'
import {buildWritingPlan} from '@/v5/writing/plan'
import {buildEntryWritingPlan, compileEntryWriting, entryWritingOutputSchema, entryWritingPayload,
  entryWritingV4OutputSchema, type WrittenEntry} from '@/v5/writing/entries'
import {writeValidatedEntries, type EntryCorrectionPayload} from '@/v5/writing/entry-correction'
import {safeRecoveredEntry} from '@/v5/writing/detail-ledger'
import {SupportedWritingError} from '@/v5/writing/compiler'
import {collectGaps, serializeWithoutAllGapClauses} from '@/shared/resume-completion'
import {type DetailAssessment} from '@/v5/writing/entry-skeleton'

function fixture(withGap = true) {
  const result = createV5ResultFixture(), targeting = createTargetingFixture()
  const source = result.resumeEvidenceBundle.evidenceAtoms.find(atom => atom.claimType === 'deliverable')!
  source.verbatimText = '参与团队设计门店辅导系统，梳理岗位使用流程并交付页面原型。'
  source.normalizedClaim = source.verbatimText; source.numericAtoms = []
  const input = {resume: result.resumeEvidenceBundle, plan: result.resumePlan,
    policy: {...result.generationPolicy, hardTotalListItemMax: 1}, job: result.jobRequirementBundle, match: result.matchAnalysis,
    targeting: {profile: targeting.candidate.jobSuccessProfile, targets: targeting.targets, fit: targeting.fit}}
  const plan = buildEntryWritingPlan({...input, base: buildWritingPlan(input)})
  const business = plan.entries.find(entry => entry.slot.kind === 'business_bullet')!
  const skill = plan.entries.find(entry => entry.slot.kind === 'skill')!
  const skillFact = skill.facts[0]!
  plan.base.fixedBlocks = [{slotId: skill.slot.slotId, text: skillFact.text, evidenceIds: [skillFact.evidenceId]}]
  plan.entries = [business]
  const payload = entryWritingPayload(plan)
  const wire = entryWritingV4OutputSchema.parse({contractVersion: 'entry-writing-v4', entries: [
    v4FixtureEntry({entryId: business.entryId, paragraphs: [
      'scope', 'problem', 'approach', 'contribution',
    ].map(role => ({role, text: source.verbatimText, evidenceIds: [source.evidenceId]}))}, payload.entries[0]!),
  ]})
  const detail: DetailAssessment = {detailId: 'personal-scope', detailKind: 'role_detail', element: 'responsibility',
    subject: '门店辅导系统', anchorEvidenceIds: [source.evidenceId], targetTaskIds: [], sourceState: 'missing',
    answerEvidenceIds: [], expressionState: 'underspecified', decision: 'supplement', reason: '原实践未明确个人分工。',
    benefit: '补明岗位所需的个人职责范围。'}
  if (withGap) {
    wire.entries[0]!.detailAssessments = [detail]
    wire.entries[0]!.paragraphs[1]!.segments = [
      {kind: 'fact', text: source.verbatimText.slice(0, -1), evidenceIds: [source.evidenceId]},
      {kind: 'optional_gap_clause', detailId: detail.detailId, template: detail.detailKind, candidates: []},
      {kind: 'fact', text: '。', evidenceIds: [source.evidenceId]},
    ]
  }
  const compact = structuredClone(wire)
  type WireSegment = typeof wire.entries[number]['paragraphs'][number]['segments'][number]
  const segments = wire.entries[0]!.paragraphs.flatMap((paragraph, index): WireSegment[] => [
    ...(index ? [{kind: 'fact' as const, text: ' ', evidenceIds: [source.evidenceId]}] : []), ...paragraph.segments,
  ])
  compact.entries[0]!.paragraphs = [{role: 'contribution', segments}]
  const compile = (output: unknown) => compileEntryWriting({output, entryPlan: plan, resume: input.resume, policy: input.policy})
  return {input, plan, business, source, wire, compact, compile, detail}
}

function responseFor(output: ReturnType<typeof fixture>['wire'], payload: EntryCorrectionPayload) {
  return {...output, entries: output.entries.filter(entry => payload.requiredEntryIds.includes(entry.entryId))}
}

test('layout correction changes paragraph count while preserving an existing cloze and its true disposition', async () => {
  const f = fixture(), calls: EntryCorrectionPayload[] = []
  const before = structuredClone(f.wire)
  const result = await writeValidatedEntries({plan: f.plan, write: async payload => {
    calls.push(payload)
    return responseFor(payload.correction ? f.compact : f.wire, payload)
  }, validate: f.compile, recoverEntry: () => {throw new Error('layout cannot use source fallback')}})
  expect(calls).toHaveLength(2)
  const issue = calls[1]!.correction!.issues.find(issue => issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')!
  expect(issue.layoutCorrection).toEqual({currentParagraphCount: 4, compiledParagraphCount: 4,
    targetParagraphCount: 1, totalListItemCount: 5, totalListItemLimit: 2})
  expect(issue.paragraphIndices).toEqual([])
  expect(issue.preserveParagraphIndices).toBeUndefined()
  expect(result.repairAttempts).toBe(1)
  expect(collectGaps(result.result.completionDocument)).toHaveLength(1)
  expect(result.result.entryAudits[0]!.detailAssessments).toEqual([f.detail])
  expect(serializeWithoutAllGapClauses(result.result.completionDocument)).toBe(result.result.artifact.markdown)
  expect(f.wire).toEqual(before)
})

test('fixed list slots are counted once even after dynamic paragraphs append to the rendering plan', () => {
  const f = fixture()
  try {f.compile(f.wire); throw new Error('expected layout failure')}
  catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    const issue = (error as SupportedWritingError).issues.find(issue => issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')!
    expect(JSON.parse(issue.expectedConstraint).totalListItemCount).toBe(5)
  }
})

test('a layout candidate cannot pass by removing an effective cloze and changing its supplement to omit', async () => {
  const f = fixture(), stripped = structuredClone(f.compact)
  stripped.entries[0]!.paragraphs[0]!.segments = stripped.entries[0]!.paragraphs[0]!.segments.filter(segment => segment.kind === 'fact')
  stripped.entries[0]!.detailAssessments[0]!.decision = 'omit'
  let calls = 0, recoveries = 0
  try {
    await writeValidatedEntries({plan: f.plan, write: async payload => {
      calls++
      return responseFor(payload.correction ? stripped : f.wire, payload)
    }, validate: f.compile, recoverEntry: (...args) => {recoveries++; return safeRecoveredEntry(...args)}})
    throw new Error('expected a blocked layout')
  } catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    expect((error as SupportedWritingError).recoveryDiagnostics?.finalIssueCodes).toContain('WRITER_ENTRY_LAYOUT_EXCEEDED')
  }
  expect(calls).toBe(3)
  expect(recoveries).toBe(0)
})

test('exhausted layout correction does not clear source paragraphs through local recovery', async () => {
  const f = fixture(false)
  let calls = 0, recoveries = 0
  await expect(writeValidatedEntries({plan: f.plan, write: async payload => {calls++; return responseFor(f.wire, payload)},
    validate: f.compile, recoverEntry: (...args) => {recoveries++; return safeRecoveredEntry(...args)}}))
    .rejects.toBeInstanceOf(SupportedWritingError)
  expect(calls).toBe(3)
  expect(recoveries).toBe(0)
})

test('a layout failure exposed after fact recovery terminates with its new cause without another clearing fallback', async () => {
  const f = fixture(false), invalid = structuredClone(f.compact)
  invalid.entries[0]!.paragraphs = [{role: 'contribution', segments: [{kind: 'fact',
    text: `${f.source.verbatimText}提升转化率999%。`, evidenceIds: [f.source.evidenceId]}]}]
  let calls = 0, recoveries = 0
  try {
    await writeValidatedEntries({plan: f.plan, write: async payload => {calls++; return responseFor(invalid, payload)},
      validate: f.compile, recoverEntry: (entry, rejected) => {
        recoveries++
        if (recoveries > 1) return safeRecoveredEntry(entry, rejected)
        return entryWritingOutputSchema.parse(f.wire).entries[0]! as WrittenEntry
      }})
    throw new Error('expected final layout failure')
  } catch (error) {
    expect(error).toBeInstanceOf(SupportedWritingError)
    expect((error as SupportedWritingError).recoveryDiagnostics).toMatchObject({
      initialIssueCodes: expect.arrayContaining(['WRITER_NUMBER_CHANGED']),
      finalIssueCodes: ['WRITER_ENTRY_LAYOUT_EXCEEDED'], recoveredEntryIds: [],
    })
  }
  expect(calls).toBe(3)
  expect(recoveries).toBe(1)
})
