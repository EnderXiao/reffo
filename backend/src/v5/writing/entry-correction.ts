import type { ValidationIssue } from '@/v5/types'
import { SupportedWritingError } from './compiler'
import { entryWritingOutputSchema, entryWritingPayload, type EntryBrief, type EntryWritingPlan, type WrittenEntry } from './entries'
import { EntrySetValidationError, inspectEntrySet } from './entry-set'

const CORRECTABLE = new Set([
  'WRITER_NUMBER_CHANGED', 'WRITER_BOUNDARY_LOST', 'WRITER_NEGATION_LOST',
  'WRITER_OWNERSHIP_UPGRADE', 'WRITER_COLLABORATOR_ADDED', 'WRITER_UNSUPPORTED_TOOL',
  'WRITER_PROFICIENCY_UPGRADE', 'WRITER_INCOMPLETE_METRIC',
  'WRITER_GAP_ACTION_MISSING', 'WRITER_GAP_DECISION_INVALID', 'WRITER_COVERAGE_INVALID', 'WRITER_KNOWN_ELEMENT_BLANKED', 'WRITER_SEGMENTS_INVALID',
  'WRITER_GAP_BOUNDARY_INVALID', 'WRITER_GAP_CANDIDATE_INVALID', 'WRITER_PROJECTION_MISMATCH',
])
type WrittenParagraph = WrittenEntry['paragraphs'][number]
type CorrectionEntry = Omit<WrittenEntry, 'paragraphs'> & {
  paragraphs: Array<WrittenParagraph | {role: WrittenParagraph['role']; segments: NonNullable<WrittenParagraph['segments']>}>
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
    ? {role: paragraph.role, segments: paragraph.segments} : paragraph)}
}

function ownsIssue(entry: EntryBrief, issue: ValidationIssue) {
  return issue.outputPath === entry.slot.outputPath
    || issue.outputPath?.startsWith(`${entry.entryId}:p`)
    || (entry.slot.kind === 'business_bullet'
      && issue.outputPath?.startsWith(`${entry.section}.${entry.scopeId}.bullets[`))
}

function evidenceScope(entry: EntryBrief, issue: ValidationIssue) {
  const allowedEvidenceIds = entry.facts.map(fact => fact.evidenceId)
  const allowed = new Set(allowedEvidenceIds)
  const contextOnlyEvidenceIds = entry.gapContextFacts.filter(fact => entry.scopeId !== null
    && fact.scopeId === entry.scopeId && !allowed.has(fact.evidenceId)).map(fact => fact.evidenceId)
  const contextOnly = new Set(contextOnlyEvidenceIds)
  const invalid = issue.evidenceIds.filter(id => !allowed.has(id))
  const duplicateCount = issue.evidenceIds.length - new Set(issue.evidenceIds).size
  return {
    policy: {allowedEvidenceIds, contextOnlyEvidenceIds},
    invalidCount: invalid.length,
    contextOnlyCount: invalid.filter(id => contextOnly.has(id)).length,
    unknownCount: invalid.filter(id => !contextOnly.has(id)).length,
    duplicateCount,
    correctable: issue.code === 'WRITER_EVIDENCE_INVALID' && invalid.length > 0
      && duplicateCount === 0 && invalid.every(id => contextOnly.has(id)),
  }
}

/** 仅纠正可定位的事实错误；保留其他条目，每次重新校验完整成品。 */
export async function writeValidatedEntries<T>(input: {
  plan: EntryWritingPlan
  write: (payload: EntryCorrectionPayload, attempt: number) => Promise<unknown>
  validate: (output: unknown) => T
}) {
  let payload: EntryCorrectionPayload = entryWritingPayload(input.plan)
  let previous: ReturnType<typeof entryWritingOutputSchema.parse> | undefined
  for (let attempt = 0; ; attempt++) {
    const response = entryWritingOutputSchema.parse(await input.write(payload, attempt))
    const diagnostics = inspectEntrySet(payload.requiredEntryIds, response.entries.map(entry => entry.entryId))
    if (!diagnostics.passed) throw new EntrySetValidationError(diagnostics)
    const replacements = new Map(response.entries.map(entry => [entry.entryId, entry]))
    const output = previous ? { ...previous, entries: previous.entries.map(entry => replacements.get(entry.entryId) ?? entry) } : response
    try {
      return { result: input.validate(output), repairAttempts: attempt }
    } catch (error) {
      if (!(error instanceof SupportedWritingError)) throw error
      const errors = error.issues.filter(issue => issue.severity === 'error')
      const mapped = errors.map(issue => {
        const entries = input.plan.entries.filter(entry => ownsIssue(entry, issue))
        return {issue, entries, scope: entries.length === 1 ? evidenceScope(entries[0], issue) : undefined}
      })
      // Only server-known locations and reference counts are logged; never text,
      // raw model IDs or error messages that may contain resume material.
      console.warn('[entry-writer.validation]', JSON.stringify({attempt, issues: mapped.map(({issue, entries, scope}) => ({
        code: issue.code, outputPath: issue.outputPath,
        entryId: entries.length === 1 ? entries[0].entryId : null,
        ...(issue.code === 'WRITER_EVIDENCE_INVALID' && scope ? {
          invalidReferenceCount: scope.invalidCount, contextOnlyReferenceCount: scope.contextOnlyCount,
          unknownReferenceCount: scope.unknownCount, duplicateReferenceCount: scope.duplicateCount,
        } : {}),
        correctionEligible: entries.length === 1 && (CORRECTABLE.has(issue.code) || scope?.correctable === true),
      }))}))
      if (attempt >= 2 || !errors.length || mapped.some(({issue, entries, scope}) => entries.length !== 1
        || (!CORRECTABLE.has(issue.code) && !scope?.correctable))) throw error
      const ids = new Set(mapped.map(item => item.entries[0].entryId))
      const entries = input.plan.entries.filter(entry => ids.has(entry.entryId))
      payload = {
        ...entryWritingPayload({ ...input.plan, entries }),
        correction: { attempt: attempt + 1,
          rejectedEntries: output.entries.filter(entry => ids.has(entry.entryId)).map(correctionEntry),
          issues: mapped.map(({ issue, entries, scope }) => {
            const paragraphIndices = error.sourceParagraphIndicesByPath.get(issue.outputPath ?? '') ?? []
            return { entryId: entries[0].entryId, outputPath: issue.outputPath ?? null,
              paragraphIndex: paragraphIndices.length === 1 ? paragraphIndices[0] : null,
              paragraphIndices, code: issue.code, message: issue.message,
              ...(scope?.correctable ? {bodyEvidencePolicy: scope.policy} : {}) }
          }),
        },
      }
      previous = output
    }
  }
}
