import { createHash } from 'node:crypto'
import { SupportedWritingError } from './compiler'
import { writingIssue } from './facts'

export function inspectEntrySet(expected: string[], actual: string[]) {
  const expectedSet = new Set(expected), actualSet = new Set(actual)
  const duplicates = (ids: string[]) => [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
  // 模型可能把正文误写进 ID；诊断只保留合法结构 ID，其余值用摘要标识。
  const safeId = (id: string) => /^entry:\d{1,3}$/u.test(id)
    ? id : `invalid:${createHash('sha256').update(id).digest('hex').slice(0, 16)}`
  const safe = (ids: string[]) => ids.slice(0, 100).map(safeId)
  const missing = expected.filter(id => !actualSet.has(id))
  const unknown = actual.filter(id => !expectedSet.has(id))
  const duplicate = duplicates(actual), duplicateExpected = duplicates(expected)
  return {
    passed: !missing.length && !unknown.length && !duplicate.length && !duplicateExpected.length,
    expectedCount: expected.length, actualCount: actual.length,
    expectedIds: safe(expected), actualIds: safe(actual), missingIds: safe(missing),
    unknownIds: safe([...new Set(unknown)]), duplicateIds: safe(duplicate),
    duplicateExpectedIds: safe(duplicateExpected),
  }
}

export class EntrySetValidationError extends SupportedWritingError {
  constructor(readonly diagnostics: ReturnType<typeof inspectEntrySet>, code = 'ENTRY_SET_INVALID') {
    super([writingIssue(code, 'entries', [], '经历结构与服务端计划不一致。')])
  }
}
