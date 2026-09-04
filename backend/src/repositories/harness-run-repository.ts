import { initializeHarnessDatabase } from '@/repositories/database'
import { randomUUID } from 'node:crypto'
import {
  aggregateHarnessMetrics,
  evaluateV6ReleaseGate,
  type HarnessMetricAttempt,
  type HarnessMetricEvent,
  type HarnessMetricRun,
  type HarnessMetricStep,
} from '@/repositories/harness-metrics'

export class HarnessRunRepository {
  private readonly db = initializeHarnessDatabase()

  getRun(runId: string) {
    const run = this.db.query('SELECT * FROM process_runs WHERE id = ?').get(runId)

    if (!run) {
      return null
    }

    const steps = this.db
      .query('SELECT * FROM step_runs WHERE run_id = ? ORDER BY started_at ASC')
      .all(runId)
    const attempts = this.db
      .query(
        `
          SELECT step_attempts.*
          FROM step_attempts
          INNER JOIN step_runs ON step_runs.id = step_attempts.step_run_id
          WHERE step_runs.run_id = ?
          ORDER BY step_attempts.started_at ASC
        `
      )
      .all(runId)
    const artifacts = this.db
      .query('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC')
      .all(runId)
    const evaluations = this.db
      .query(
        `
          SELECT evaluations.*
          FROM evaluations
          INNER JOIN step_runs ON step_runs.id = evaluations.step_run_id
          WHERE step_runs.run_id = ?
          ORDER BY evaluations.created_at ASC
        `
      )
      .all(runId)
    const events = this.db
      .query('SELECT * FROM harness_events WHERE run_id = ? ORDER BY occurred_at ASC')
      .all(runId)

    return {
      run,
      steps,
      attempts,
      artifacts,
      evaluations,
      events,
    }
  }

  replayRun(runId: string) {
    const run = this.db.query('SELECT id, status FROM process_runs WHERE id = ?').get(runId)

    if (!run) {
      return null
    }

    const events = this.db
      .query('SELECT * FROM harness_events WHERE run_id = ? ORDER BY occurred_at ASC')
      .all(runId)
      .map((event) => this.parseEvent(event as Record<string, unknown>))

    return { run, events }
  }

  getDashboardMetrics() {
    const runs = this.db.query('SELECT id, status FROM process_runs').all() as HarnessMetricRun[]
    const steps = this.db.query('SELECT id, run_id, step_name, started_at, finished_at FROM step_runs').all() as HarnessMetricStep[]
    const attempts = this.db.query('SELECT id, step_run_id, provider, model, input_tokens, output_tokens, latency_ms, is_repair_attempt FROM step_attempts').all() as HarnessMetricAttempt[]
    const events = this.db.query('SELECT run_id, step_run_id, attempt_id, type, payload_json FROM harness_events').all() as HarnessMetricEvent[]
    const runStatusCounts = this.db
      .query('SELECT status, COUNT(*) AS count FROM process_runs GROUP BY status ORDER BY status ASC')
      .all()
    const stepStatusCounts = this.db
      .query('SELECT step_name, status, COUNT(*) AS count FROM step_runs GROUP BY step_name, status ORDER BY step_name ASC')
      .all()
    const attemptMetrics = this.db
      .query(
        `
          SELECT
            COUNT(*) AS total_attempts,
            AVG(latency_ms) AS avg_latency_ms,
            SUM(input_tokens) AS total_input_tokens,
            SUM(output_tokens) AS total_output_tokens
          FROM step_attempts
        `
      )
      .get()
    const failureSampleCount = this.db.query('SELECT COUNT(*) AS count FROM failure_samples').get()
    const agentStateCounts = this.db
      .query(`
        SELECT workflow_version, agent_state, release_status, used_safe_fallback, COUNT(*) AS count
        FROM process_runs
        WHERE workflow_version LIKE '5.%'
        GROUP BY workflow_version, agent_state, release_status, used_safe_fallback
        ORDER BY workflow_version, agent_state
      `)
      .all()
    const promptMetrics = this.db
      .query(`
        SELECT
          component_prompt_id,
          component_prompt_version,
          model,
          COUNT(*) AS attempts,
          SUM(is_repair_attempt) AS repair_attempts,
          AVG(latency_ms) AS avg_latency_ms,
          SUM(input_tokens) AS input_tokens,
          SUM(output_tokens) AS output_tokens
        FROM step_attempts
        WHERE schema_version = '5.0.0'
        GROUP BY component_prompt_id, component_prompt_version, model
        ORDER BY component_prompt_id, component_prompt_version, model
      `)
      .all()

    const metrics = aggregateHarnessMetrics({ runs, steps, attempts, events })

    return {
      runStatusCounts,
      stepStatusCounts,
      attemptMetrics,
      failureSampleCount,
      agentStateCounts,
      promptMetrics,
      metrics,
      releaseGate: evaluateV6ReleaseGate(metrics),
    }
  }

  buildRegressionDataset(limit = 20) {
    const runs = this.db
      .query(
        `
          SELECT *
          FROM process_runs
          WHERE status IN ('failed', 'partial')
          ORDER BY started_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Record<string, unknown>[]

    return runs.map((run) => ({
      run,
      replay: this.replayRun(String(run.id)),
      evaluations: this.db
        .query(
          `
            SELECT evaluations.*
            FROM evaluations
            INNER JOIN step_runs ON step_runs.id = evaluations.step_run_id
            WHERE step_runs.run_id = ?
            ORDER BY evaluations.created_at ASC
          `
        )
        .all(String(run.id)),
    }))
  }

  createFailureSample(runId: string, reason?: string) {
    const run = this.db.query('SELECT id, status FROM process_runs WHERE id = ?').get(runId) as
      | Record<string, unknown>
      | null

    if (!run) {
      return null
    }

    const eventCountRow = this.db.query('SELECT COUNT(*) AS count FROM harness_events WHERE run_id = ?').get(runId) as
      | { count?: number }
      | null
    const sample = {
      id: randomUUID(),
      run_id: runId,
      reason: reason ?? null,
      status: String(run.status),
      event_count: Number(eventCountRow?.count ?? 0),
      created_at: new Date().toISOString(),
    }

    this.db
      .query(
        `
          INSERT INTO failure_samples (
            id,
            run_id,
            reason,
            status,
            event_count,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(sample.id, sample.run_id, sample.reason, sample.status, sample.event_count, sample.created_at)

    return sample
  }

  createFailureSampleIfAbsent(runId: string, reason?: string) {
    const existing = this.db.query('SELECT * FROM failure_samples WHERE run_id = ? LIMIT 1').get(runId)

    if (existing) {
      return existing
    }

    return this.createFailureSample(runId, reason)
  }

  private parseEvent(event: Record<string, unknown>) {
    const payloadJson = typeof event.payload_json === 'string' ? event.payload_json : '{}'

    return {
      ...event,
      payload: JSON.parse(payloadJson),
      payload_json: undefined,
    }
  }
}
