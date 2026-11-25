import { createHash, randomUUID } from 'node:crypto'

export interface RunContext {
  requestId: string
  runId: string
  workflowName: 'resume_optimization' | 'ocr_document_parse'
  workflowVersion: string
  startedAt: string
  signal?: AbortSignal
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
  signal?: AbortSignal
): StepExecutionContext {
  // attemptNumber 当前固定为 1：一次 step 只记录一条 attempt，
  // 阶段级重试/修复由 repairAttempt 和 recovery.* 事件表达，
  // 不要通过此函数伪造 attempt 拓扑。
  return {
    ...runContext,
    stepName,
    stepRunId: randomUUID(),
    attemptId: randomUUID(),
    attemptNumber: 1,
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
