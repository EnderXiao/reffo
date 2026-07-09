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
