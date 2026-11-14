import type {WorkflowDecisionDiagnostics} from '@/v5/types'

export type EntryCorrectionDecision = WorkflowDecisionDiagnostics['entryCorrections'][number]
export interface WritingRecoveryDiagnostics {
  initialIssueCodes: string[]
  finalIssueCodes: string[]
  recoveredEntryIds: string[]
  decisions: EntryCorrectionDecision[]
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {}
const codes = (value: unknown) => Array.isArray(value)
  ? [...new Set(value.filter((item): item is string => typeof item === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/u.test(item)))].slice(0, 100) : []
const entryId = (value: unknown): value is string => typeof value === 'string' && /^entry:\d{1,6}$/u.test(value)
const index = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000

/** Only server-shaped locations, hashes and categories cross persistence boundaries. */
export function sanitizeWritingRecoveryDiagnostics(value: unknown): WritingRecoveryDiagnostics | undefined {
  const source = record(value)
  if (!Array.isArray(source.decisions)) return undefined
  const decisions: EntryCorrectionDecision[] = []
  for (const item of source.decisions.slice(0, 200)) {
    const row = record(item)
    if (!index(row.attempt) || row.entryId !== null && !entryId(row.entryId)
      || !['repair', 'local_recovery', 'blocked'].includes(String(row.disposition))) continue
    decisions.push({attempt: row.attempt, entryId: row.entryId as string | null,
      disposition: row.disposition as EntryCorrectionDecision['disposition'], issueCodes: codes(row.issueCodes),
      ...(Array.isArray(row.issueSubcodes) ? {issueSubcodes: codes(row.issueSubcodes)} : {}),
      ...(Array.isArray(row.paragraphIndices) ? {paragraphIndices: [...new Set(row.paragraphIndices.filter(index))]} : {}),
      ...(typeof row.candidateDigest === 'string' && /^[a-f0-9]{64}$/u.test(row.candidateDigest) ? {candidateDigest: row.candidateDigest} : {}),
      ...(['applied', 'unchanged', 'validated', 'blocked'].includes(String(row.outcome))
        ? {outcome: row.outcome as EntryCorrectionDecision['outcome']} : {}),
    })
  }
  return {initialIssueCodes: codes(source.initialIssueCodes), finalIssueCodes: codes(source.finalIssueCodes),
    recoveredEntryIds: Array.isArray(source.recoveredEntryIds) ? [...new Set(source.recoveredEntryIds.filter(entryId))].slice(0, 100) : [], decisions}
}
