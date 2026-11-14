import type { ValidationIssue } from '@/v5/types'
import {createDigest} from '@/harness/run-context'
import type {EntryCorrectionDecision} from './recovery-diagnostics'
import { SupportedWritingError } from './compiler'
import { entryWritingOutputSchema, entryWritingPayload, type EntryBrief, type EntryWritingPlan, type WrittenEntry } from './entries'
import { EntrySetValidationError, inspectEntrySet } from './entry-set'

const CORRECTABLE = new Set([
  'WRITER_ENTRY_LAYOUT_EXCEEDED',
  'WRITER_GAP_OMISSION_INVALID',
  'WRITER_DETAIL_SEED_UNRESOLVED', 'WRITER_COVERAGE_ANSWER_MISSING', 'WRITER_ACTION_RECEIPT_INVALID', 'WRITER_DETAIL_INVALID', 'WRITER_UNCERTAINTY_UNRESOLVED', 'WRITER_DEPENDENT_CLAIM_INVALID',
  'WRITER_NUMBER_CHANGED', 'WRITER_BOUNDARY_LOST', 'WRITER_NEGATION_LOST',
  'WRITER_OWNERSHIP_UPGRADE', 'WRITER_COLLABORATOR_ADDED', 'WRITER_UNSUPPORTED_TOOL',
  'WRITER_PROFICIENCY_UPGRADE', 'WRITER_INCOMPLETE_METRIC',
  'WRITER_SKILL_CASE_REPEATED', 'WRITER_SKILL_DIMENSIONS_REPEATED',
  'WRITER_GAP_ACTION_MISSING', 'WRITER_GAP_DECISION_INVALID', 'WRITER_COVERAGE_INVALID', 'WRITER_KNOWN_ELEMENT_BLANKED', 'WRITER_SEGMENTS_INVALID',
  'WRITER_GAP_BOUNDARY_INVALID', 'WRITER_GAP_CANDIDATE_INVALID', 'WRITER_PROJECTION_MISMATCH',
])
type WrittenParagraph = WrittenEntry['paragraphs'][number]
type CorrectionEntry = Omit<WrittenEntry, 'paragraphs'> & {
  paragraphs: Array<WrittenParagraph | {unitId?: string; role: WrittenParagraph['role']; segments: NonNullable<WrittenParagraph['segments']>}>
}

export type EntryCorrectionPayload = ReturnType<typeof entryWritingPayload> & {
  correction?: {
    attempt: number
    rejectedEntries: CorrectionEntry[]
    issues: Array<{
      entryId: string
      outputPath: string | null
      paragraphIndex: number | null
      paragraphIndices: readonly number[]
      code: string
      subcode?: string
      detailId?: string
      segmentIndex?: number
      preserveParagraphIndices?: number[]
      layoutCorrection?: {currentParagraphCount: number; compiledParagraphCount: number; targetParagraphCount: number;
        totalListItemCount: number; totalListItemLimit: number}
      message: string
      bodyEvidencePolicy?: {
        allowedEvidenceIds: string[]
        contextOnlyEvidenceIds: string[]
      }
    }>
  }
}

function correctionEntry(entry: WrittenEntry): CorrectionEntry {
  // Send the provider its native segment tree. Internal fact projections would
  // otherwise teach a strict-v3 repair to echo forbidden text/evidenceIds keys.
  return {...entry, paragraphs: entry.paragraphs.map(paragraph => paragraph.segments
    ? {...(paragraph.unitId ? {unitId: paragraph.unitId} : {}), role: paragraph.role, segments: paragraph.segments} : paragraph)}
}

function ownsIssue(entry: EntryBrief, issue: ValidationIssue) {
  return issue.outputPath === entry.entryId || issue.outputPath === entry.slot.outputPath
    || issue.outputPath?.startsWith(`${entry.entryId}:p`)
    || (entry.slot.kind === 'business_bullet'
      && issue.outputPath?.startsWith(`${entry.section}.${entry.scopeId}.bullets[`))
}

function evidenceScope(entry: EntryBrief, issue: ValidationIssue, plan: EntryWritingPlan) {
  const allowedEvidenceIds = entry.facts.map(fact => fact.evidenceId)
  const allowed = new Set(allowedEvidenceIds)
  const contextOnlyEvidenceIds = entry.gapContextFacts.filter(fact => entry.scopeId !== null
    && fact.scopeId === entry.scopeId && !allowed.has(fact.evidenceId)).map(fact => fact.evidenceId)
  const contextOnly = new Set(contextOnlyEvidenceIds)
  const otherEntryFactIds = entry.scopeId === null && ['summary', 'skills'].includes(entry.section)
    ? [...new Set(plan.entries.flatMap(item => item.facts.map(fact => fact.evidenceId)))].filter(id => !allowed.has(id)) : []
  const knownOutsidePool = new Set(otherEntryFactIds)
  const invalid = issue.evidenceIds.filter(id => !allowed.has(id))
  const duplicateCount = issue.evidenceIds.length - new Set(issue.evidenceIds).size
  return {
    policy: {allowedEvidenceIds, contextOnlyEvidenceIds, ...(otherEntryFactIds.length ? {knownOutsidePoolEvidenceIds: otherEntryFactIds} : {})},
    invalidCount: invalid.length,
    contextOnlyCount: invalid.filter(id => contextOnly.has(id)).length,
    unknownCount: invalid.filter(id => !contextOnly.has(id) && !knownOutsidePool.has(id)).length,
    knownOutsidePoolCount: invalid.filter(id => knownOutsidePool.has(id)).length,
    duplicateCount,
    correctable: issue.code === 'WRITER_EVIDENCE_INVALID' && invalid.length > 0
      && duplicateCount === 0 && invalid.every(id => contextOnly.has(id) || knownOutsidePool.has(id)),
  }
}

function paragraphLocations(error: SupportedWritingError, issue: ValidationIssue): readonly number[] {
  // Skeleton issues already point to an original draft paragraph. Their entry
  // outputPath can be the first bullet and must not override that precise index.
  return issue.paragraphIndex === undefined ? error.sourceParagraphIndicesByPath.get(issue.outputPath ?? '') ?? []
    : [issue.paragraphIndex]
}

function layoutCorrection(issue: ValidationIssue) {
  if (issue.code !== 'WRITER_ENTRY_LAYOUT_EXCEEDED') return undefined
  try {
    const value: unknown = JSON.parse(issue.expectedConstraint ?? '')
    if (!value || typeof value !== 'object') return undefined
    const row = value as Record<string, unknown>
    const fields = ['currentParagraphCount', 'compiledParagraphCount', 'targetParagraphCount', 'totalListItemCount', 'totalListItemLimit'] as const
    if (fields.some(key => typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || (row[key] as number) < 1)) return undefined
    return Object.fromEntries(fields.map(key => [key, row[key]])) as NonNullable<EntryCorrectionPayload['correction']>['issues'][number]['layoutCorrection']
  } catch {return undefined}
}

function mergeCorrectedEntry(original: WrittenEntry, replacement: WrittenEntry, preserved: readonly number[],
  issues: NonNullable<EntryCorrectionPayload['correction']>['issues']): WrittenEntry {
  const gapIssue = (code: string) => /GAP|DETAIL|COVERAGE|UNCERTAINTY|DEPENDENT|SEGMENT|PROJECTION/u.test(code)
  const protectedParagraphs = original.paragraphs.flatMap((paragraph, index) => paragraph.segments?.some(segment => segment.kind !== 'fact')
    && !issues.some(issue => gapIssue(issue.code) && (!issue.paragraphIndices.length || issue.paragraphIndices.includes(index))) ? [index] : [])
  if (issues.some(issue => issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')) {
    const before = protectedParagraphs.flatMap(index => original.paragraphs[index].segments!.filter(segment => segment.kind !== 'fact'))
    const after = replacement.paragraphs.flatMap(paragraph => paragraph.segments?.filter(segment => segment.kind !== 'fact') ?? [])
    // Reflow may move a valid cloze, but cannot remove or replace it as a shortcut.
    const key = (segment: typeof before[number]) => segment.kind === 'dependent_claim' ? `claim:${segment.claimId}` : `detail:${segment.detailId}`
    if (before.some(segment => after.filter(candidate => key(candidate) === key(segment)).length !== 1)) return original
    const requiredEvidence = new Set(original.paragraphs.flatMap(paragraph => paragraph.evidenceIds)
      .filter(id => !issues.some(issue => issue.code === 'WRITER_EVIDENCE_INVALID' && issue.bodyEvidencePolicy
        && !issue.bodyEvidencePolicy.allowedEvidenceIds.includes(id))))
    const actualEvidence = new Set(replacement.paragraphs.flatMap(paragraph => paragraph.evidenceIds))
    if ([...requiredEvidence].some(id => !actualEvidence.has(id))) return original
    const protectedById = new Map(before.map(segment => [key(segment), segment]))
    const protectedDetailIds = new Set(before.flatMap(segment => segment.kind === 'dependent_claim' ? segment.requiredDetailIds : segment.detailId ? [segment.detailId] : []))
    return {...replacement, paragraphs: replacement.paragraphs.map(paragraph => ({...paragraph,
      segments: paragraph.segments?.map(segment => segment.kind === 'fact' ? segment : protectedById.get(key(segment)) ?? segment)})),
      detailAssessments: [...(replacement.detailAssessments ?? []).filter(detail => !protectedDetailIds.has(detail.detailId)),
        ...(original.detailAssessments ?? []).filter(detail => protectedDetailIds.has(detail.detailId))]}
  }
  if (!preserved.length && !protectedParagraphs.length) return replacement
  // Paragraph indices are the correction contract. A different count cannot be
  // mapped safely, including metadata that refers to the old units.
  if (replacement.paragraphs.length !== original.paragraphs.length) return original
  const protectedDetails = original.paragraphs.filter((_, index) => protectedParagraphs.includes(index))
  const kept = original.paragraphs.filter((_, index) => preserved.includes(index))
  const unitIds = new Set(kept.flatMap(paragraph => paragraph.unitId ? [paragraph.unitId] : []))
  const detailIds = new Set([...kept, ...protectedDetails].flatMap(paragraph => paragraph.segments?.flatMap(segment =>
    segment.kind === 'optional_gap_clause' ? segment.detailId ? [segment.detailId] : []
      : segment.kind === 'dependent_claim' ? segment.requiredDetailIds : []) ?? []))
  const keptEvidenceIds = new Set(kept.flatMap(paragraph => paragraph.evidenceIds))
  // Source-known details have no gap node. Keep their disposition as well when
  // both anchor and answer are still rendered by an untouched paragraph.
  for (const detail of original.detailAssessments ?? []) if (['keep', 'use_source'].includes(detail.decision) && detail.answerEvidenceIds.length
    && detail.anchorEvidenceIds.some(id => keptEvidenceIds.has(id))
    && detail.answerEvidenceIds.every(id => keptEvidenceIds.has(id))) detailIds.add(detail.detailId)
  const claimIds = new Set([...kept, ...protectedDetails].flatMap(paragraph => paragraph.segments?.flatMap(segment => segment.kind === 'dependent_claim' ? [segment.claimId] : []) ?? []))
  const keptDetails = original.detailAssessments?.filter(detail => detailIds.has(detail.detailId)) ?? []
  const keptResolutions = original.uncertaintyResolutions?.filter(item => item.claimId && claimIds.has(item.claimId)) ?? []
  const resolutionIds = new Set(keptResolutions.map(item => item.uncertaintyId))
  const keptReceipts = original.actionReceipts?.filter(item => item.unitIds.length && item.unitIds.every(id => unitIds.has(id))) ?? []
  const receiptIds = new Set(keptReceipts.map(item => item.actionId))
  const paragraphs = replacement.paragraphs.map((paragraph, index) => {
    if (preserved.includes(index)) return original.paragraphs[index]
    if (!protectedParagraphs.includes(index)) return paragraph
    const before = original.paragraphs[index].segments!
    const oldGaps = before.filter(segment => segment.kind !== 'fact')
    const newGaps = paragraph.segments?.filter(segment => segment.kind !== 'fact') ?? []
    if (createDigest(oldGaps) === createDigest(newGaps)) return paragraph
    const newFacts = paragraph.segments?.filter(segment => segment.kind === 'fact') ?? []
    if (before.filter(segment => segment.kind === 'fact').length !== newFacts.length) return original.paragraphs[index]
    let factIndex = 0
    const segments = before.map(segment => segment.kind === 'fact' ? newFacts[factIndex++] : segment)
    return {...paragraph, segments}
  })
  return {...replacement, paragraphs,
    ...(original.detailAssessments || replacement.detailAssessments ? {detailAssessments: [
      ...(replacement.detailAssessments ?? []).filter(detail => !detailIds.has(detail.detailId)), ...keptDetails]} : {}),
    ...(original.uncertaintyResolutions || replacement.uncertaintyResolutions ? {uncertaintyResolutions: [
      ...(replacement.uncertaintyResolutions ?? []).filter(item => !resolutionIds.has(item.uncertaintyId)), ...keptResolutions]} : {}),
    ...(original.actionReceipts || replacement.actionReceipts ? {actionReceipts: [
      ...(replacement.actionReceipts ?? []).filter(item => !receiptIds.has(item.actionId)), ...keptReceipts]} : {}),
  }
}

/** 仅纠正可定位的事实错误；保留其他条目，每次重新校验完整成品。 */
export async function writeValidatedEntries<T>(input: {
  plan: EntryWritingPlan
  write: (payload: EntryCorrectionPayload, attempt: number) => Promise<unknown>
  validate: (output: unknown) => T
  recoverEntry?: (entry: EntryBrief, rejected?: {written: WrittenEntry; issues: ValidationIssue[];
    otherEntries?: WrittenEntry[]; renderedSkills?: Array<{text: string; evidenceIds: string[]}>;
    sourceParagraphIndices?: readonly number[]}) => WrittenEntry
  onDecision?: (decision: EntryCorrectionDecision) => void
}) {
  let payload: EntryCorrectionPayload = entryWritingPayload(input.plan)
  let previous: ReturnType<typeof entryWritingOutputSchema.parse> | undefined
  let initialIssueCodes: string[] | undefined
  const decisions: EntryCorrectionDecision[] = []
  const record = (decision: EntryCorrectionDecision) => {decisions.push(decision); input.onDecision?.(decision)}
  const mapErrors = (error: SupportedWritingError) => error.issues.filter(issue => issue.severity === 'error').map(issue => {
    const entries = input.plan.entries.filter(entry => ownsIssue(entry, issue))
    return {issue, entries, scope: entries.length === 1 ? evidenceScope(entries[0], issue, input.plan) : undefined}
  })
  const eligible = (items: ReturnType<typeof mapErrors>) => items.length > 0 && items.every(item => item.entries.length === 1
    && (CORRECTABLE.has(item.issue.code) || item.scope?.correctable === true))
  const fail = (error: SupportedWritingError, recoveredEntryIds: string[] = []): never => {
    error.recoveryDiagnostics = {initialIssueCodes: initialIssueCodes ?? [], finalIssueCodes: [...new Set(error.issues
      .filter(issue => issue.severity === 'error').map(issue => issue.code))], recoveredEntryIds, decisions: [...decisions]}
    throw error
  }
  for (let attempt = 0; ; attempt++) {
    const response = entryWritingOutputSchema.parse(await input.write(payload, attempt))
    const diagnostics = inspectEntrySet(payload.requiredEntryIds, response.entries.map(entry => entry.entryId))
    if (!diagnostics.passed) throw new EntrySetValidationError(diagnostics)
    const replacements = new Map(response.entries.map(entry => [entry.entryId, entry]))
    const output = previous ? { ...previous, entries: previous.entries.map(entry => {
      const replacement = replacements.get(entry.entryId)
      if (!replacement) return entry
      const preserved = payload.correction?.issues.find(issue => issue.entryId === entry.entryId)?.preserveParagraphIndices ?? []
      // A local correction cannot silently edit or drop unrelated paragraphs.
      return mergeCorrectedEntry(entry, replacement, preserved, payload.correction?.issues.filter(issue => issue.entryId === entry.entryId) ?? [])
    }) } : response
    try {
      return { result: input.validate(output), repairAttempts: attempt }
    } catch (error) {
      if (!(error instanceof SupportedWritingError)) throw error
      initialIssueCodes ??= [...new Set(error.issues.filter(issue => issue.severity === 'error').map(issue => issue.code))]
      const mapped = mapErrors(error)
      const correctable = eligible(mapped)
      const disposition = correctable && attempt < 2 ? 'repair' : correctable && input.recoverEntry ? 'local_recovery' : 'blocked'
      for (const entryId of new Set(mapped.map(item => item.entries.length === 1 ? item.entries[0].entryId : null))) {
        const issues = mapped.filter(item => (item.entries.length === 1 ? item.entries[0].entryId : null) === entryId).map(item => item.issue)
        record({attempt, entryId, disposition, issueCodes: [...new Set(issues.map(issue => issue.code))],
          issueSubcodes: [...new Set(issues.flatMap(issue => issue.subcode ? [issue.subcode] : []))],
          paragraphIndices: [...new Set(issues.flatMap(issue => paragraphLocations(error, issue)))],
          candidateDigest: createDigest(output.entries.find(entry => entry.entryId === entryId) ?? null),
          ...(disposition === 'blocked' ? {outcome: 'blocked' as const} : {})})
      }
      console.warn('[entry-writer.validation]', JSON.stringify({attempt, issues: mapped.map(({issue, entries, scope}) => ({
        code: issue.code, ...(issue.subcode ? {subcode: issue.subcode} : {}), outputPath: issue.outputPath,
        entryId: entries.length === 1 ? entries[0].entryId : null,
        ...(issue.code === 'WRITER_EVIDENCE_INVALID' && scope ? {
          invalidReferenceCount: scope.invalidCount, contextOnlyReferenceCount: scope.contextOnlyCount,
          unknownReferenceCount: scope.unknownCount, duplicateReferenceCount: scope.duplicateCount,
          knownOutsidePoolReferenceCount: scope.knownOutsidePoolCount,
        } : {}),
        correctionEligible: entries.length === 1 && (CORRECTABLE.has(issue.code) || scope?.correctable === true),
      }))}))
      if (attempt >= 2 && input.recoverEntry && correctable && !mapped.some(item => item.issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')) {
        const recoveredIds = new Set<string>()
        const triedUnits = new Set<string>()
        let recoveryOutput = output
        let currentError = error
        let pending = mapped
        const localLimit = output.entries.reduce((sum, entry) => sum + entry.paragraphs.length + (entry.detailAssessments?.length ?? 0) + 1, 0)
        for (let round = 0; round < localLimit; round++) {
          if (pending.some(item => item.issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED')) fail(currentError, [...recoveredIds]
            .filter(id => !pending.some(item => item.entries[0]?.entryId === id)))
          const failedIds = new Set(pending.map(item => item.entries[0].entryId))
          const unitKeys = pending.map(({issue, entries}) => JSON.stringify([entries[0].entryId, issue.code,
            issue.subcode, issue.detailId, paragraphLocations(currentError, issue), issue.segmentIndex]))
          if (unitKeys.some(key => triedUnits.has(key))) {
            for (const id of failedIds) record({attempt, entryId: id, disposition: 'blocked', outcome: 'blocked',
              issueCodes: [...new Set(pending.filter(item => item.entries[0].entryId === id).map(item => item.issue.code))]})
            fail(currentError, [...recoveredIds].filter(id => !failedIds.has(id)))
          }
          unitKeys.forEach(key => triedUnits.add(key))
          let changed = false
          try {
            recoveryOutput = {...recoveryOutput, entries: recoveryOutput.entries.map(entry => {
              if (!failedIds.has(entry.entryId)) return entry
              const issues = pending.filter(item => item.entries[0].entryId === entry.entryId).map(item => item.issue)
              const recovered = input.recoverEntry!(input.plan.entries.find(brief => brief.entryId === entry.entryId)!, {
                written: entry, issues, otherEntries: recoveryOutput.entries.filter(other => other.entryId !== entry.entryId
                  && input.plan.entries.some(brief => brief.entryId === other.entryId && brief.slot.kind === 'business_bullet')),
                renderedSkills: (input.plan.base.fixedBlocks ?? []).filter(block => input.plan.base.blueprint.slots
                  .some(slot => slot.slotId === block.slotId && slot.kind === 'skill')),
                ...(issues.every(issue => paragraphLocations(currentError, issue).length) ? {
                  sourceParagraphIndices: [...new Set(issues.flatMap(issue => paragraphLocations(currentError, issue)))],
                } : {}),
              })
              const progressed = createDigest(recovered) !== createDigest(entry)
              changed ||= progressed
              recoveredIds.add(entry.entryId)
              record({attempt, entryId: entry.entryId, disposition: 'local_recovery', outcome: progressed ? 'applied' : 'unchanged',
                issueCodes: [...new Set(issues.map(issue => issue.code))], candidateDigest: createDigest(recovered)})
              return recovered
            })}
          } catch (recoveryError) {
            if (recoveryError instanceof SupportedWritingError) fail(recoveryError, [...recoveredIds].filter(id => !failedIds.has(id)))
            throw recoveryError
          }
          try {
            const result = input.validate(recoveryOutput)
            for (const entryId of recoveredIds) record({attempt, entryId, disposition: 'local_recovery', outcome: 'validated', issueCodes: []})
            return {result, repairAttempts: attempt, recoveredEntryIds: [...recoveredIds]}
          } catch (nextError) {
            if (!(nextError instanceof SupportedWritingError)) throw nextError
            currentError = nextError
            pending = mapErrors(nextError)
            if (!changed || !eligible(pending)) fail(nextError, [...recoveredIds].filter(id => !pending.some(item => item.entries[0]?.entryId === id)))
          }
        }
        fail(currentError, [...recoveredIds].filter(id => !pending.some(item => item.entries[0]?.entryId === id)))
      }
      if (attempt >= 2 || !correctable) fail(error)
      const ids = new Set(mapped.map(item => item.entries[0].entryId))
      const entries = input.plan.entries.filter(entry => ids.has(entry.entryId))
      payload = {
        ...entryWritingPayload({ ...input.plan, entries }),
        correction: { attempt: attempt + 1,
          rejectedEntries: output.entries.filter(entry => ids.has(entry.entryId)).map(correctionEntry),
          issues: mapped.map(({ issue, entries, scope }) => {
            const paragraphIndices = paragraphLocations(error, issue)
            const allIssues = mapped.filter(item => item.entries[0].entryId === entries[0].entryId)
            const affected = new Set(allIssues.flatMap(item => paragraphLocations(error, item.issue)))
            const preserveParagraphIndices = !allIssues.some(item => item.issue.code === 'WRITER_ENTRY_LAYOUT_EXCEEDED') && allIssues.every(item => paragraphLocations(error, item.issue).length)
              ? output.entries.find(entry => entry.entryId === entries[0].entryId)!.paragraphs.map((_, index) => index).filter(index => !affected.has(index)) : []
            return { entryId: entries[0].entryId, outputPath: issue.outputPath ?? null,
              paragraphIndex: paragraphIndices.length === 1 ? paragraphIndices[0] : null,
              paragraphIndices, code: issue.code, message: issue.message,
              ...(layoutCorrection(issue) ? {layoutCorrection: layoutCorrection(issue)} : {}),
              ...(issue.subcode ? {subcode: issue.subcode} : {}), ...(issue.detailId ? {detailId: issue.detailId} : {}),
              ...(issue.segmentIndex === undefined ? {} : {segmentIndex: issue.segmentIndex}),
              ...(preserveParagraphIndices.length ? {preserveParagraphIndices} : {}),
              ...(scope?.correctable ? {bodyEvidencePolicy: scope.policy} : {}) }
          }),
        },
      }
      previous = output
    }
  }
}
