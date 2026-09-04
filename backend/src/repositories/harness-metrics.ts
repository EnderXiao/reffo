export interface HarnessMetricRun {
  id?: string
  status?: string
}

export interface HarnessMetricStep {
  id?: string
  run_id?: string
  step_name?: string
  started_at?: string | null
  finished_at?: string | null
}

export interface HarnessMetricAttempt {
  id?: string
  step_run_id?: string
  provider?: string | null
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  latency_ms?: number | null
  is_repair_attempt?: number | boolean | null
}

export interface HarnessMetricEvent {
  run_id?: string
  step_run_id?: string | null
  attempt_id?: string | null
  type?: string
  payload_json?: string
  payload?: unknown
}

export interface HarnessMetricPricing {
  inputPerMillionCny: number
  outputPerMillionCny: number
}

export interface V6ReleaseLimits {
  maxLogicalCalls: number
  maxRepairCalls: number
  maxTotalTokens: number
}

export const DEFAULT_HARNESS_METRIC_PRICING: HarnessMetricPricing = {
  // DeepSeek chat default public list price; callers can inject provider-specific rates.
  inputPerMillionCny: 2,
  outputPerMillionCny: 8,
}

export const DEFAULT_V6_RELEASE_LIMITS: V6ReleaseLimits = {
  maxLogicalCalls: 8,
  maxRepairCalls: 1,
  maxTotalTokens: 120_000,
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function parsePayload(event: HarnessMetricEvent) {
  if (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) {
    return event.payload as Record<string, unknown>
  }

  if (typeof event.payload_json !== 'string') return {}

  try {
    const parsed = JSON.parse(event.payload_json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(quantile * sorted.length) - 1)
  return sorted[Math.max(0, index)]
}

function durationMs(step: HarnessMetricStep) {
  if (!step.started_at || !step.finished_at) return 0
  const duration = Date.parse(step.finished_at) - Date.parse(step.started_at)
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function isRepairAttempt(attempt: HarnessMetricAttempt, reason?: string) {
  return reason === 'validation_repair' || reason === 'deterministic_repair'
    || attempt.is_repair_attempt === true || attempt.is_repair_attempt === 1
}

function classifyEvaluation(payload: Record<string, unknown>) {
  const evaluator = String(payload.evaluatorName ?? '').toLowerCase()
  return evaluator.includes('llm') || evaluator.includes('judge') ? 'semantic' : 'deterministic'
}

export interface HarnessStageMetrics {
  stepName: string
  runs: number
  llmCalls: number
  repairCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgLatencyMs: number
  p95LatencyMs: number
}

export interface HarnessMetrics {
  runCount: number
  runStatusCounts: Record<string, number>
  llmCalls: number
  semanticGateCalls: number
  repairCalls: number
  networkRetryCalls: number
  deterministicGateEvaluations: number
  physicalAttempts: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  avgLatencyMs: number
  p95LatencyMs: number
  estimatedCostCny: number
  stageMetrics: HarnessStageMetrics[]
  safetyIncidents: number
  chunkIntegrityFailures: number
}

export function aggregateHarnessMetrics(input: {
  runs: HarnessMetricRun[]
  steps: HarnessMetricStep[]
  attempts: HarnessMetricAttempt[]
  events: HarnessMetricEvent[]
  pricing?: HarnessMetricPricing
}): HarnessMetrics {
  const pricing = input.pricing ?? DEFAULT_HARNESS_METRIC_PRICING
  const runStatusCounts: Record<string, number> = {}
  input.runs.forEach((run) => {
    const status = String(run.status ?? 'unknown')
    runStatusCounts[status] = (runStatusCounts[status] ?? 0) + 1
  })

  const eventByAttempt = new Map<string, Record<string, unknown>>()
  input.events.forEach((event) => {
    if (!event.attempt_id || (event.type !== 'provider.requested' && event.type !== 'provider.responded')) return
    const payload = parsePayload(event)
    eventByAttempt.set(event.attempt_id, { ...eventByAttempt.get(event.attempt_id), ...payload })
  })

  const stageMap = new Map<string, HarnessStageMetrics>()
  const stepByIdMap = new Map<string, HarnessMetricStep>()
  const stageLatencies = new Map<string, number[]>()
  input.steps.forEach((step) => { if (step.id) stepByIdMap.set(step.id, step) })
  const latencyValues: number[] = []
  let semanticGateCalls = 0
  let repairCalls = 0
  let networkRetryCalls = 0
  let inputTokens = 0
  let outputTokens = 0
  let physicalAttempts = 0
  let llmCalls = 0

  input.attempts.forEach((attempt) => {
    const metadata = attempt.id ? eventByAttempt.get(attempt.id) : undefined
    const reason = typeof metadata?.callReason === 'string' ? metadata.callReason : undefined
    const hasProvider = Boolean(attempt.provider || attempt.model || metadata)
    if (!hasProvider) return

    llmCalls += 1
    const attemptInput = finiteNumber(attempt.input_tokens)
    const attemptOutput = finiteNumber(attempt.output_tokens)
    const latency = finiteNumber(attempt.latency_ms)
    inputTokens += attemptInput
    outputTokens += attemptOutput
    if (latency > 0) latencyValues.push(latency)
    physicalAttempts += Math.max(1, finiteNumber(metadata?.physicalAttempts) || 1)
    if (reason === 'semantic_gate') semanticGateCalls += 1
    if (reason === 'network_retry') networkRetryCalls += 1
    if (isRepairAttempt(attempt, reason)) repairCalls += 1

    const stepName = stepByIdMap.get(attempt.step_run_id ?? '')?.step_name ?? 'unknown'
    const stage = stageMap.get(stepName) ?? {
      stepName,
      runs: 0,
      llmCalls: 0,
      repairCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
    }
    stage.llmCalls += 1
    stage.repairCalls += isRepairAttempt(attempt, reason) ? 1 : 0
    stage.inputTokens += attemptInput
    stage.outputTokens += attemptOutput
    stage.totalTokens += attemptInput + attemptOutput
    stageMap.set(stepName, stage)
  })

  input.steps.forEach((step) => {
    const name = step.step_name ?? 'unknown'
    const stage = stageMap.get(name) ?? {
      stepName: name,
      runs: 0,
      llmCalls: 0,
      repairCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
    }
    stage.runs += 1
    const duration = durationMs(step)
    if (duration > 0) {
      const currentTotal = stage.avgLatencyMs * (stage.runs - 1)
      stage.avgLatencyMs = (currentTotal + duration) / stage.runs
      const durations = stageLatencies.get(name) ?? []
      durations.push(duration)
      stageLatencies.set(name, durations)
    }
    stageMap.set(name, stage)
  })

  const deterministicGateEvaluations = input.events
    .filter((event) => event.type === 'evaluation.completed')
    .filter((event) => classifyEvaluation(parsePayload(event)) === 'deterministic').length
  const safetyIncidents = input.events.filter((event) => event.type === 'workflow.failed'
    && /fact|safety|unsafe/i.test(String(parsePayload(event).errorCode ?? ''))).length
  const chunkIntegrityFailures = input.events.filter((event) => /chunk/i.test(String(parsePayload(event).errorCode ?? ''))
    && /failed|missing|duplicate|order|integrity/i.test(String(parsePayload(event).errorCode ?? ''))).length

  const estimatedCostCny = Number(((inputTokens / 1_000_000) * pricing.inputPerMillionCny
    + (outputTokens / 1_000_000) * pricing.outputPerMillionCny).toFixed(6))
  const stages = Array.from(stageMap.values()).map((stage) => ({
    ...stage,
    avgLatencyMs: Number(stage.avgLatencyMs.toFixed(2)),
    p95LatencyMs: percentile(stageLatencies.get(stage.stepName) ?? [], 0.95),
  })).sort((left, right) => left.stepName.localeCompare(right.stepName))

  return {
    runCount: input.runs.length,
    runStatusCounts,
    llmCalls,
    semanticGateCalls,
    repairCalls,
    networkRetryCalls,
    deterministicGateEvaluations,
    physicalAttempts,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    avgLatencyMs: latencyValues.length === 0 ? 0 : Number((latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length).toFixed(2)),
    p95LatencyMs: percentile(latencyValues, 0.95),
    estimatedCostCny,
    stageMetrics: stages,
    safetyIncidents,
    chunkIntegrityFailures,
  }
}

export interface V6ReleaseGateResult {
  passed: boolean
  checks: {
    logicalCalls: boolean
    repairCalls: boolean
    totalTokens: boolean
    factSafety: boolean
    chunkIntegrity: boolean
  }
  failures: string[]
}

export function evaluateV6ReleaseGate(metrics: HarnessMetrics, limits = DEFAULT_V6_RELEASE_LIMITS): V6ReleaseGateResult {
  const checks = {
    logicalCalls: metrics.llmCalls <= limits.maxLogicalCalls,
    repairCalls: metrics.repairCalls <= limits.maxRepairCalls,
    totalTokens: metrics.totalTokens <= limits.maxTotalTokens,
    factSafety: metrics.safetyIncidents === 0,
    chunkIntegrity: metrics.chunkIntegrityFailures === 0,
  }
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  return { passed: failures.length === 0, checks, failures }
}
