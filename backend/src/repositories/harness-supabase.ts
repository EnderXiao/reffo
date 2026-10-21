import { randomUUID } from 'node:crypto'
import type { HarnessEvent } from '@/harness/events'
import { env } from '@/config/env'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import {
  aggregateHarnessMetrics,
  evaluateV6ReleaseGate,
  type HarnessMetricAttempt,
  type HarnessMetricEvent,
  type HarnessMetricRun,
  type HarnessMetricStep,
} from '@/repositories/harness-metrics'

interface HarnessEventRow {
  id: string
  type: string
  version: number
  run_id: string
  request_id: string
  step_run_id: string | null
  attempt_id: string | null
  occurred_at: string
  payload_json: unknown
}

interface HarnessFailureSampleRow {
  id: string
  run_id: string
  reason: string | null
  status: string
  event_count: number
  created_at: string
}

function client() {
  return createSupabaseRestClient({ useServiceRole: true })
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toMetricEvent(event: HarnessEventRow): HarnessMetricEvent {
  return {
    run_id: event.run_id,
    step_run_id: event.step_run_id,
    attempt_id: event.attempt_id,
    type: event.type,
    payload_json: JSON.stringify(parsePayload(event.payload_json)),
  }
}

function indexEvents(rows: HarnessEventRow[]) {
  const runMap = new Map<string, HarnessMetricRun & Record<string, unknown>>()
  const stepMap = new Map<string, HarnessMetricStep & Record<string, unknown>>()
  const attemptMap = new Map<string, HarnessMetricAttempt & Record<string, unknown>>()
  const evaluations: Record<string, unknown>[] = []
  const artifacts: Record<string, unknown>[] = []

  for (const event of rows) {
    const payload = parsePayload(event.payload_json)
    if (event.run_id && !runMap.has(event.run_id)) runMap.set(event.run_id, { id: event.run_id, status: 'running' })
    const run = event.run_id ? runMap.get(event.run_id) : undefined
    if (event.type === 'workflow.started' && run) {
      Object.assign(run, {
        request_id: event.request_id,
        workflow_name: payload.workflowName,
        workflow_version: payload.workflowVersion,
        input_digest: payload.inputDigest,
        started_at: payload.startedAt ?? event.occurred_at,
        release_status: payload.releaseStatus,
      })
    }
    if (/^workflow\.(succeeded|failed|partial)$/.test(event.type) && run) {
      run.status = event.type.replace('workflow.', '')
      Object.assign(run, {
        finished_at: payload.finishedAt ?? event.occurred_at,
        error_code: payload.errorCode,
        error_message: payload.errorMessage,
        agent_state: payload.agentState,
        used_safe_fallback: payload.usedSafeFallback,
      })
    }

    if (event.step_run_id) {
      const step = stepMap.get(event.step_run_id) ?? { id: event.step_run_id, run_id: event.run_id, step_name: 'unknown_step', status: 'running' }
      stepMap.set(event.step_run_id, step)
      if (event.type === 'step.started') Object.assign(step, { step_name: payload.stepName ?? step.step_name, started_at: payload.startedAt ?? event.occurred_at })
      if (/^step\.(succeeded|failed|partial)$/.test(event.type)) Object.assign(step, {
        status: event.type.replace('step.', ''),
        finished_at: payload.finishedAt ?? event.occurred_at,
        error_code: payload.errorCode,
        error_message: payload.errorMessage,
      })
    }

    if (event.attempt_id) {
      const attempt = attemptMap.get(event.attempt_id) ?? { id: event.attempt_id, step_run_id: event.step_run_id ?? undefined, attempt_number: 1, status: 'running' }
      attemptMap.set(event.attempt_id, attempt)
      if (event.type === 'attempt.started') Object.assign(attempt, { attempt_number: payload.attemptNumber ?? 1, started_at: event.occurred_at })
      if (event.type === 'provider.requested') Object.assign(attempt, {
        provider: payload.provider,
        model: payload.model,
        prompt_version: payload.promptVersion,
        temperature: payload.temperature,
        max_output_tokens: payload.maxOutputTokens,
        is_repair_attempt: parsePayload(payload.promptManifest).repairAttempt ? 1 : 0,
      })
      if (event.type === 'provider.responded') Object.assign(attempt, {
        provider: payload.provider,
        model: payload.model,
        provider_request_id: payload.providerRequestId,
        finish_reason: payload.finishReason,
        input_tokens: payload.inputTokens,
        output_tokens: payload.outputTokens,
        latency_ms: payload.latencyMs,
        raw_output_digest: payload.outputDigest,
      })
      if (/^attempt\.(succeeded|failed)$/.test(event.type)) Object.assign(attempt, {
        status: event.type.replace('attempt.', ''),
        finished_at: payload.finishedAt ?? event.occurred_at,
        error_code: payload.errorCode,
        error_message: payload.errorMessage,
      })
    }

    if (event.type === 'evaluation.completed') evaluations.push({
      id: event.id,
      step_run_id: event.step_run_id,
      evaluator_name: payload.evaluatorName,
      evaluator_version: payload.evaluatorVersion ?? 'v1',
      passed: payload.passed ? 1 : 0,
      score: payload.score,
      issues_json: JSON.stringify(payload.issues ?? []),
      created_at: event.occurred_at,
    })
    if (event.type === 'output.parsed') artifacts.push({
      id: event.id,
      run_id: event.run_id,
      step_run_id: event.step_run_id,
      type: payload.outputName ?? 'output',
      content_type: 'application/json',
      content_digest: payload.outputDigest ?? '',
      summary: payload.summary ?? null,
      storage_ref: null,
      redaction_policy: 'digest_only',
      created_at: event.occurred_at,
    })
  }

  return {
    runs: [...runMap.values()] as HarnessMetricRun[],
    steps: [...stepMap.values()] as HarnessMetricStep[],
    attempts: [...attemptMap.values()] as HarnessMetricAttempt[],
    evaluations,
    artifacts,
  }
}

export class SupabaseHarnessRepository {
  async persistEvent(event: HarnessEvent) {
    await client().request('/rest/v1/harness_events', {
      method: 'POST',
      searchParams: { on_conflict: 'id' },
      prefer: 'resolution=ignore-duplicates',
      body: {
        id: event.id,
        type: event.type,
        version: event.version,
        run_id: event.runId,
        request_id: event.requestId,
        step_run_id: event.stepRunId ?? null,
        attempt_id: event.attemptId ?? null,
        occurred_at: event.occurredAt,
        payload_json: event.payload,
      },
    })
  }

  async listEvents(runId?: string) {
    const rows = await client().request<HarnessEventRow[]>('/rest/v1/harness_events', {
      searchParams: {
        select: 'id,type,version,run_id,request_id,step_run_id,attempt_id,occurred_at,payload_json',
        ...(runId ? { run_id: `eq.${runId}` } : {}),
        order: 'occurred_at.asc',
      },
    })
    return rows
  }

  async getRun(runId: string) {
    const rows = await this.listEvents(runId)
    if (rows.length === 0) return null
    const indexed = indexEvents(rows)
    return {
      run: indexed.runs[0],
      steps: indexed.steps,
      attempts: indexed.attempts,
      artifacts: indexed.artifacts,
      evaluations: indexed.evaluations,
      events: rows.map(toMetricEvent),
    }
  }

  async replayRun(runId: string) {
    const rows = await this.listEvents(runId)
    if (rows.length === 0) return null
    const indexed = indexEvents(rows)
    return { run: indexed.runs[0], events: rows.map((event) => ({ ...toMetricEvent(event), payload: parsePayload(event.payload_json) })) }
  }

  async getDashboardMetrics() {
    const rows = await this.listEvents()
    const indexed = indexEvents(rows)
    const metrics = aggregateHarnessMetrics({
      runs: indexed.runs,
      steps: indexed.steps,
      attempts: indexed.attempts,
      events: rows.map(toMetricEvent),
    })
    return {
      runStatusCounts: Object.entries(metrics.runStatusCounts).map(([status, count]) => ({ status, count })),
      stepStatusCounts: Object.entries(indexed.steps.reduce<Record<string, number>>((counts, step) => {
        const key = `${step.step_name}:${(step as Record<string, unknown>).status ?? 'unknown'}`
        counts[key] = (counts[key] ?? 0) + 1
        return counts
      }, {})).map(([key, count]) => {
        const [step_name, status] = key.split(':')
        return { step_name, status, count }
      }),
      attemptMetrics: {
        total_attempts: indexed.attempts.length,
        avg_latency_ms: indexed.attempts.reduce((sum, attempt) => sum + Number(attempt.latency_ms ?? 0), 0) / Math.max(1, indexed.attempts.length),
        total_input_tokens: indexed.attempts.reduce((sum, attempt) => sum + Number(attempt.input_tokens ?? 0), 0),
        total_output_tokens: indexed.attempts.reduce((sum, attempt) => sum + Number(attempt.output_tokens ?? 0), 0),
      },
      failureSampleCount: { count: 0 },
      agentStateCounts: [],
      promptMetrics: [],
      metrics,
      releaseGate: evaluateV6ReleaseGate(metrics),
    }
  }

  async buildRegressionDataset(limit = 20) {
    const rows = await this.listEvents()
    const indexed = indexEvents(rows)
    return indexed.runs
      .filter(run => run.status === 'failed' || run.status === 'partial')
      .slice(0, limit)
      .map(run => ({ run, replay: rows.filter(event => event.run_id === run.id).map(event => ({ ...toMetricEvent(event), payload: parsePayload(event.payload_json) })), evaluations: [] }))
  }

  async createFailureSample(runId: string, reason?: string) {
    const run = await this.getRun(runId)
    if (!run) return null
    const sample = await client().request<HarnessFailureSampleRow[]>('/rest/v1/harness_failure_samples', {
      method: 'POST',
      searchParams: { on_conflict: 'run_id' },
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: {
        id: randomUUID(),
        run_id: runId,
        reason: reason ?? null,
        status: String((run.run as Record<string, unknown>).status ?? 'failed'),
        event_count: run.events.length,
      },
    })
    return sample[0] ?? null
  }

  async createFailureSampleIfAbsent(runId: string, reason?: string) {
    const existing = await client().request<HarnessFailureSampleRow[]>('/rest/v1/harness_failure_samples', {
      searchParams: { select: '*', run_id: `eq.${runId}`, limit: 1 },
    })
    return existing[0] ?? this.createFailureSample(runId, reason)
  }

  async cleanup() {
    const cutoff = new Date(Date.now() - env.HARNESS_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    if (env.HARNESS_RETENTION_DAYS > 0) {
      await client().request('/rest/v1/harness_events', { method: 'DELETE', searchParams: { occurred_at: `lt.${cutoff}` } })
      await client().request('/rest/v1/harness_failure_samples', { method: 'DELETE', searchParams: { created_at: `lt.${cutoff}` } })
    }

    if (env.HARNESS_MAX_RUNS > 0) {
      const rows = await client().request<Array<{ run_id: string; occurred_at: string }>>('/rest/v1/harness_events', {
        searchParams: {
          select: 'run_id,occurred_at',
          order: 'occurred_at.desc',
          limit: Math.max(env.HARNESS_MAX_RUNS + 1, 1000),
        },
      })
      const recentRunIds: string[] = []
      const seen = new Set<string>()
      rows.forEach((row) => {
        if (!seen.has(row.run_id)) {
          seen.add(row.run_id)
          recentRunIds.push(row.run_id)
        }
      })
      const staleRunIds = recentRunIds.slice(env.HARNESS_MAX_RUNS)
      for (let index = 0; index < staleRunIds.length; index += 100) {
        const chunk = staleRunIds.slice(index, index + 100)
        const runFilter = `in.(${chunk.join(',')})`
        await client().request('/rest/v1/harness_events', { method: 'DELETE', searchParams: { run_id: runFilter } })
        await client().request('/rest/v1/harness_failure_samples', { method: 'DELETE', searchParams: { run_id: runFilter } })
      }
    }
  }
}

export const supabaseHarnessRepository = new SupabaseHarnessRepository()
