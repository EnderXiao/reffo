import type { ValidationIssue } from '@/v5/types'

export type V6ContextMode = 'full' | 'scoped' | 'patch'

export interface RepairContextInput {
  runId: string
  originalEnvelope: unknown
  currentOutput: unknown
  validationIssues: ValidationIssue[]
  mode?: V6ContextMode
}

type JsonRecord = Record<string, unknown>

function pathSegments(path: string) {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map(item => item.trim())
    .filter(Boolean)
}

function readPath(value: unknown, path: string) {
  let current = value
  for (const segment of pathSegments(path)) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
    } else if (typeof current === 'object' && current !== null) {
      current = (current as JsonRecord)[segment]
    } else {
      return undefined
    }
  }
  return current
}

function setPath(target: JsonRecord, path: string, value: unknown) {
  const segments = pathSegments(path)
  if (segments.length === 0) return
  let current = target
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      current[segment] = value
      return
    }
    const next = segments[index + 1]
    const child = current[segment]
    if (typeof child !== 'object' || child === null || Array.isArray(child)) {
      current[segment] = /^\d+$/.test(next) ? [] : {}
    }
    current = current[segment] as JsonRecord
  })
}

function collectReferencedRecords(root: unknown, ids: Set<string>) {
  const records: unknown[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as JsonRecord
    const recordId = ['evidenceId', 'requirementId', 'sourceBlockId', 'claimId', 'scopeId']
      .map(key => record[key])
      .find(item => typeof item === 'string' && ids.has(item))
    if (recordId) records.push(value)
    for (const child of Object.values(record)) visit(child)
  }
  visit(root)
  return [...new Set(records)]
}

function scopedOutput(currentOutput: unknown, validationIssues: ValidationIssue[]) {
  const fields: JsonRecord = {}
  for (const issue of validationIssues) {
    if (!issue.outputPath) continue
    const value = readPath(currentOutput, issue.outputPath)
    if (value !== undefined) setPath(fields, issue.outputPath, value)
  }
  return fields
}

/**
 * Single repair-envelope shape. Keeping this in one module lets V6 replace
 * full-context repair with scoped/patch context without changing workflow code.
 */
export function buildRepairContext(input: RepairContextInput) {
  const mode = input.mode ?? 'scoped'
  if (mode === 'full') {
    return {
      runId: input.runId,
      originalEnvelope: input.originalEnvelope,
      currentOutput: input.currentOutput,
      validationIssues: input.validationIssues,
    }
  }

  if (mode === 'patch') {
    const issueIds = new Set(input.validationIssues.flatMap(issue => [
      ...issue.evidenceIds,
      ...issue.requirementIds,
      ...(issue.claimId ? [issue.claimId] : []),
    ]))
    return {
      runId: input.runId,
      fields: scopedOutput(input.currentOutput, input.validationIssues),
      patchHints: input.validationIssues.map(issue => ({
        outputPath: issue.outputPath,
        replacementText: issue.replacementText,
        expectedConstraint: issue.expectedConstraint,
      })),
      relatedRecords: collectReferencedRecords(input.originalEnvelope, issueIds),
    }
  }

  return {
    runId: input.runId,
    fields: scopedOutput(input.currentOutput, input.validationIssues),
    relatedRecords: collectReferencedRecords(
      input.originalEnvelope,
      new Set(input.validationIssues.flatMap(issue => [
        ...issue.evidenceIds,
        ...issue.requirementIds,
        ...(issue.claimId ? [issue.claimId] : []),
      ])),
    ),
    validationIssues: input.validationIssues,
  }
}
