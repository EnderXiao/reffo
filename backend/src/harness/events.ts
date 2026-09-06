import { randomUUID } from 'node:crypto'

export type WorkflowStatus = 'running' | 'succeeded' | 'failed' | 'partial'

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'partial'

export type HarnessEventType =
  | 'workflow.started'
  | 'workflow.succeeded'
  | 'workflow.failed'
  | 'workflow.partial'
  | 'workflow.state.changed'
  | 'step.started'
  | 'step.succeeded'
  | 'step.failed'
  | 'step.partial'
  | 'attempt.started'
  | 'attempt.succeeded'
  | 'attempt.failed'
  | 'recovery.planned'
  | 'recovery.started'
  | 'recovery.succeeded'
  | 'recovery.failed'
  | 'provider.requested'
  | 'provider.responded'
  | 'output.parsed'
  | 'output.validated'
  | 'extraction.validation.observed'
  | 'evaluation.completed'

export interface HarnessEvent<TPayload = Record<string, unknown>> {
  id: string
  type: HarnessEventType
  version: 1
  runId: string
  requestId: string
  stepRunId?: string
  attemptId?: string
  occurredAt: string
  payload: TPayload
}

export interface CreateHarnessEventInput<TPayload> {
  type: HarnessEventType
  runId: string
  requestId: string
  stepRunId?: string
  attemptId?: string
  payload: TPayload
}

export function createHarnessEvent<TPayload extends Record<string, unknown>>(
  input: CreateHarnessEventInput<TPayload>
): HarnessEvent<TPayload> {
  return {
    id: randomUUID(),
    type: input.type,
    version: 1,
    runId: input.runId,
    requestId: input.requestId,
    stepRunId: input.stepRunId,
    attemptId: input.attemptId,
    occurredAt: new Date().toISOString(),
    payload: input.payload,
  }
}
