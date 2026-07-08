import { initializeDatabase } from '@/repositories/database'
import { randomUUID } from 'node:crypto'

export class HarnessRunRepository {
  private readonly db = initializeDatabase()

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

    return {
      runStatusCounts,
      stepStatusCounts,
      attemptMetrics,
      failureSampleCount,
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

  private parseEvent(event: Record<string, unknown>) {
    const payloadJson = typeof event.payload_json === 'string' ? event.payload_json : '{}'

    return {
      ...event,
      payload: JSON.parse(payloadJson),
      payload_json: undefined,
    }
  }
}

export const harnessRunRepository = new HarnessRunRepository()
