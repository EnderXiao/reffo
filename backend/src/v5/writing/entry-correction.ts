import type { ValidationIssue } from '@/v5/types'
import { SupportedWritingError } from './compiler'
import { entryWritingOutputSchema, entryWritingPayload, type EntryBrief, type EntryWritingPlan } from './entries'
import { EntrySetValidationError, inspectEntrySet } from './entry-set'

const CORRECTABLE = new Set([
  'WRITER_NUMBER_CHANGED', 'WRITER_BOUNDARY_LOST', 'WRITER_NEGATION_LOST',
  'WRITER_OWNERSHIP_UPGRADE', 'WRITER_COLLABORATOR_ADDED', 'WRITER_UNSUPPORTED_TOOL',
  'WRITER_PROFICIENCY_UPGRADE', 'WRITER_INCOMPLETE_METRIC',
])
export type EntryCorrectionPayload = ReturnType<typeof entryWritingPayload> & {
  correction?: {
    attempt: number
    rejectedEntries: ReturnType<typeof entryWritingOutputSchema.parse>['entries']
    issues: Array<{ entryId: string; code: string; message: string }>
  }
}

function ownsIssue(entry: EntryBrief, issue: ValidationIssue) {
  return issue.outputPath === entry.slot.outputPath
    || issue.outputPath?.startsWith(`${entry.entryId}:p`)
    || (entry.slot.kind === 'business_bullet'
      && issue.outputPath?.startsWith(`${entry.section}.${entry.scopeId}.bullets[`))
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
      if (!(error instanceof SupportedWritingError) || attempt >= 2) throw error
      const errors = error.issues.filter(issue => issue.severity === 'error')
      if (!errors.length || errors.some(issue => !CORRECTABLE.has(issue.code))) throw error
      const mapped = errors.map(issue => ({ issue, entries: input.plan.entries.filter(entry => ownsIssue(entry, issue)) }))
      if (mapped.some(item => item.entries.length !== 1)) throw error
      const ids = new Set(mapped.map(item => item.entries[0].entryId))
      const entries = input.plan.entries.filter(entry => ids.has(entry.entryId))
      payload = {
        ...entryWritingPayload({ ...input.plan, entries }),
        correction: { attempt: attempt + 1,
          rejectedEntries: output.entries.filter(entry => ids.has(entry.entryId)),
          issues: mapped.map(({ issue, entries }) => ({ entryId: entries[0].entryId, code: issue.code, message: issue.message })),
        },
      }
      previous = output
    }
  }
}
