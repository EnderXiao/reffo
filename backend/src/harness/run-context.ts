import { createHash, randomUUID } from 'node:crypto'

export interface RunContext {
  requestId: string
  runId: string
  workflowName: 'resume_optimization' | 'ocr_document_parse'
  workflowVersion: string
  startedAt: string
}

export interface StepExecutionContext extends RunContext {
  stepName: string
  stepRunId: string
  attemptId: string
  attemptNumber: number
  signal?: AbortSignal
}

export function createRunContext(
  workflowVersion = 'v1',
  workflowName: RunContext['workflowName'] = 'resume_optimization'
): RunContext {
  return {
    requestId: randomUUID(),
    runId: randomUUID(),
    workflowName,
    workflowVersion,
    startedAt: new Date().toISOString(),
  }
}

export function createStepExecutionContext(
  runContext: RunContext,
  stepName: string,
  attemptNumber = 1,
  signal?: AbortSignal
): StepExecutionContext {
  return {
    ...runContext,
    stepName,
    stepRunId: randomUUID(),
    attemptId: randomUUID(),
    attemptNumber,
    signal,
  }
}

export function createDigest(value: unknown) {
  const content = typeof value === 'string' ? value : JSON.stringify(value)

  return createHash('sha256').update(content).digest('hex')
}

function canonicalDigestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalDigestValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, item]) => [key, canonicalDigestValue(item)]),
  )
}

export function createCanonicalDigest(value: unknown) {
  return createDigest(canonicalDigestValue(value))
}
