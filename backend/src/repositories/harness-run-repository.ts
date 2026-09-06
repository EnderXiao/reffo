import { initializeHarnessDatabase } from '@/repositories/database'
import { randomUUID } from 'node:crypto'
import { env } from '@/config/env'
import { supabaseHarnessRepository } from '@/repositories/harness-supabase'
import type { V5DeliveryDiagnostics } from '@/v5/types'
import { isV5DeliveryDiagnosticsSemanticallyValid } from '@/v5/delivery-gate'

const DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const DELIVERY_DISPOSITIONS = [
  'deliverable',
  'review_required',
  'internal_only',
  'blocked_retryable',
  'blocked_terminal',
] as const

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function isEnum(value: unknown, allowed: readonly string[]) {
  return typeof value === 'string' && allowed.includes(value)
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
}

function isNullableNonNegativeInteger(value: unknown) {
  return value === null || isNonNegativeInteger(value)
}

function isCodeArray(value: unknown) {
  return Array.isArray(value)
    && value.length <= 128
    && value.every(item => typeof item === 'string' && DIAGNOSTIC_CODE.test(item))
}

function isIssueCounts(value: unknown) {
  const counts = record(value)
  if (!counts || Object.keys(counts).length > 128) return false
  return Object.entries(counts).every(([code, count]) => (
    DIAGNOSTIC_CODE.test(code) && isNonNegativeInteger(count)
  ))
}

function isCoverage(value: unknown) {
  const coverage = record(value)
  return Boolean(
    coverage
    && hasExactKeys(coverage, ['numerator', 'denominator'])
    && isNonNegativeInteger(coverage.numerator)
    && isNonNegativeInteger(coverage.denominator)
    && Number(coverage.numerator) <= Number(coverage.denominator)
  )
}

function isStrictV5DeliveryDiagnostics(value: unknown): value is V5DeliveryDiagnostics {
  const diagnostics = record(value)
  if (
    !diagnostics
    || !hasExactKeys(diagnostics, ['version', 'taxonomyVersion', 'outcome', 'tracks', 'provenance', 'metrics'])
    || diagnostics.version !== 'v5-delivery-diagnostics-v2'
    || diagnostics.taxonomyVersion !== 'v5-delivery-taxonomy-v1'
  ) return false

  const outcome = record(diagnostics.outcome)
  const tracks = record(diagnostics.tracks)
  const factSafety = record(tracks?.factSafety)
  const productQuality = record(tracks?.productQuality)
  const provenance = record(diagnostics.provenance)
  if (
    !outcome
    || !hasExactKeys(outcome, ['execution', 'phaseReached', 'disposition', 'decisionReasonCodes'])
    || !isEnum(outcome.execution, ['completed', 'failed'])
    || !isEnum(outcome.phaseReached, [
      'received', 'normalized', 'resume_extracting', 'resume_extracted', 'job_extracting',
      'job_extracted', 'matching', 'matched', 'policy_ready', 'planning', 'planned',
      'drafting', 'drafted', 'reviewing', 'validating', 'repairing_1', 'repairing_2',
      'fact_judging', 'succeeded', 'succeeded_with_safe_fallback',
      'blocked_input_validation', 'blocked_fact_validation', 'blocked_structure_validation',
      'blocked_quality_validation', 'provider_failure', 'workflow_failure',
    ])
    || !isEnum(outcome.disposition, DELIVERY_DISPOSITIONS)
    || !isCodeArray(outcome.decisionReasonCodes)
    || !tracks
    || !hasExactKeys(tracks, ['factSafety', 'productQuality'])
    || !factSafety
    || !hasExactKeys(factSafety, ['status', 'finalIssueCounts', 'rejectedCandidateIssueCounts', 'unclassifiedIssueCount'])
    || !isEnum(factSafety.status, ['pass', 'fail', 'not_run'])
    || !isIssueCounts(factSafety.finalIssueCounts)
    || !isIssueCounts(factSafety.rejectedCandidateIssueCounts)
    || !isNonNegativeInteger(factSafety.unclassifiedIssueCount)
    || !productQuality
    || !hasExactKeys(productQuality, ['status', 'issueCounts'])
    || !isEnum(productQuality.status, ['pass', 'review_required', 'fail', 'not_run'])
    || !isIssueCounts(productQuality.issueCounts)
    || !provenance
    || !hasExactKeys(provenance, ['planOrigin', 'artifactOrigin', 'usedSafeFallback', 'usedAnyFallback', 'interview'])
    || !isEnum(provenance.planOrigin, ['model_primary', 'model_repair', 'deterministic_quality', 'none'])
    || !isEnum(provenance.artifactOrigin, ['model', 'model_repair', 'server_compiler', 'server_renderer', 'emergency', 'none'])
    || typeof provenance.usedSafeFallback !== 'boolean'
    || typeof provenance.usedAnyFallback !== 'boolean'
    || !isEnum(provenance.interview, [
      'generated',
      'deferred',
      'skipped_by_gate',
      'failed_optional',
      'not_reached',
    ])
  ) return false

  if (diagnostics.metrics === null) return true
  const metrics = record(diagnostics.metrics)
  const countKeys = [
    'sourceBlockCount',
    'mappedSourceBlockCount',
    'unmappedSourceBlockCount',
    'highImportanceUnmappedCount',
    'eligibleBusinessEvidenceCount',
    'eligibleBusinessScopeCount',
    'plannedContentEvidenceCount',
    'usedPlannedEvidenceCount',
    'renderedBusinessBulletCount',
    'renderedTotalListItemCount',
    'renderedProjectCount',
    'targetBusinessBulletMin',
    'targetBusinessBulletTarget',
    'targetBusinessBulletMax',
    'outputLengthValue',
    'outputLengthSoftMax',
    'outputLengthHardMax',
  ] as const
  const metricKeys = [
    ...countKeys,
    'plannedEvidenceCoverage',
    'stableCoreCoverage',
    'primaryRequirementCoverage',
    'outputLengthUnit',
    'outputLengthSoftMin',
    'outputLengthHardMin',
  ] as const
  return Boolean(
    metrics
    && hasExactKeys(metrics, metricKeys)
    && countKeys.every(key => isNonNegativeInteger(metrics[key]))
    && isCoverage(metrics.plannedEvidenceCoverage)
    && isCoverage(metrics.stableCoreCoverage)
    && isCoverage(metrics.primaryRequirementCoverage)
    && isEnum(metrics.outputLengthUnit, ['cjk_characters', 'words'])
    && isNullableNonNegativeInteger(metrics.outputLengthSoftMin)
    && isNullableNonNegativeInteger(metrics.outputLengthHardMin)
  )
}

function numericSummary(values: number[]) {
  if (values.length === 0) {
    return { sampleCount: 0, total: null, average: null, minimum: null, maximum: null }
  }
  const total = values.reduce((sum, value) => sum + value, 0)
  return {
    sampleCount: values.length,
    total,
    average: total / values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
  }
}

function coverageSummary(
  diagnostics: V5DeliveryDiagnostics[],
  key: 'plannedEvidenceCoverage' | 'stableCoreCoverage' | 'primaryRequirementCoverage'
) {
  let numerator = 0
  let denominator = 0
  let sampleCount = 0
  let notApplicableCount = 0
  let metricsUnavailableCount = 0
  for (const item of diagnostics) {
    if (!item.metrics) {
      metricsUnavailableCount += 1
      continue
    }
    const coverage = item.metrics[key]
    if (coverage.denominator === 0) {
      notApplicableCount += 1
      continue
    }
    numerator += coverage.numerator
    denominator += coverage.denominator
    sampleCount += 1
  }
  return {
    numerator,
    denominator,
    ratio: denominator === 0 ? null : numerator / denominator,
    sampleCount,
    notApplicableCount,
    metricsUnavailableCount,
  }
}

export class HarnessRunRepository {
  private readonly db: ReturnType<typeof initializeHarnessDatabase>

  constructor(db = initializeHarnessDatabase()) {
    this.db = db
  }

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
    if (env.DATABASE_PROVIDER === 'supabase') return supabaseHarnessRepository.getDashboardMetrics()
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
    const deliveryDecisionCounts = this.db
      .query(`
        SELECT delivery_decision, COUNT(*) AS count
        FROM process_runs
        WHERE delivery_decision IS NOT NULL
        GROUP BY delivery_decision
        ORDER BY delivery_decision
      `)
      .all()
    const safetyStatusCounts = this.db
      .query(`
        SELECT safety_status, COUNT(*) AS count
        FROM process_runs
        WHERE safety_status IS NOT NULL
        GROUP BY safety_status
        ORDER BY safety_status
      `)
      .all()
    const productQualityStatusCounts = this.db
      .query(`
        SELECT product_quality_status, COUNT(*) AS count
        FROM process_runs
        WHERE product_quality_status IS NOT NULL
        GROUP BY product_quality_status
        ORDER BY product_quality_status
      `)
      .all()
    const deliverableRunTokenMetrics = this.db
      .query(`
        SELECT
          COUNT(*) AS deliverable_run_count,
          AVG(input_tokens) AS avg_input_tokens_per_run,
          AVG(output_tokens) AS avg_output_tokens_per_run,
          AVG(input_tokens + output_tokens) AS avg_total_tokens_per_run
        FROM (
          SELECT
            process_runs.id,
            COALESCE(SUM(step_attempts.input_tokens), 0) AS input_tokens,
            COALESCE(SUM(step_attempts.output_tokens), 0) AS output_tokens
          FROM process_runs
          LEFT JOIN step_runs ON step_runs.run_id = process_runs.id
          LEFT JOIN step_attempts ON step_attempts.step_run_id = step_runs.id
          WHERE process_runs.delivery_decision = 'deliver'
          GROUP BY process_runs.id
        ) AS deliverable_run_tokens
      `)
      .get()
    const diagnosticRows = this.db
      .query(`
        SELECT diagnostics_version, diagnostics_json
        FROM process_runs
        WHERE workflow_version LIKE '5.%'
          AND status IN ('succeeded', 'failed', 'partial')
      `)
      .all() as Array<{ diagnostics_version: unknown; diagnostics_json: unknown }>
    const validDiagnostics: V5DeliveryDiagnostics[] = []
    let missingDiagnosticsCount = 0
    let invalidDiagnosticsCount = 0
    for (const row of diagnosticRows) {
      if (row.diagnostics_json === null || row.diagnostics_json === undefined) {
        missingDiagnosticsCount += 1
        continue
      }
      if (
        row.diagnostics_version !== 'v5-delivery-diagnostics-v2'
        || typeof row.diagnostics_json !== 'string'
      ) {
        invalidDiagnosticsCount += 1
        continue
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(row.diagnostics_json)
      } catch {
        invalidDiagnosticsCount += 1
        continue
      }
      if (
        !isStrictV5DeliveryDiagnostics(parsed)
        || !isV5DeliveryDiagnosticsSemanticallyValid(parsed)
      ) {
        invalidDiagnosticsCount += 1
        continue
      }
      validDiagnostics.push(parsed)
    }

    const deliveryDispositionCounts = DELIVERY_DISPOSITIONS.flatMap(disposition => {
      const count = validDiagnostics.filter(item => item.outcome.disposition === disposition).length
      return count > 0 ? [{ disposition, count }] : []
    })
    const safeFallbackUseCount = validDiagnostics.filter(item => item.provenance.usedSafeFallback).length
    const anyFallbackUseCount = validDiagnostics.filter(item => item.provenance.usedAnyFallback).length
    const fallbackMetrics = {
      eligibleDiagnosticsCount: validDiagnostics.length,
      safeFallbackUseCount,
      safeFallbackUseRate: validDiagnostics.length === 0
        ? null
        : safeFallbackUseCount / validDiagnostics.length,
      anyFallbackUseCount,
      anyFallbackUseRate: validDiagnostics.length === 0
        ? null
        : anyFallbackUseCount / validDiagnostics.length,
    }
    const coverageMetrics = {
      plannedEvidenceCoverage: coverageSummary(validDiagnostics, 'plannedEvidenceCoverage'),
      stableCoreCoverage: coverageSummary(validDiagnostics, 'stableCoreCoverage'),
      primaryRequirementCoverage: coverageSummary(validDiagnostics, 'primaryRequirementCoverage'),
    }
    const diagnosticsWithMetrics = validDiagnostics.flatMap(item => item.metrics ? [item.metrics] : [])
    const businessBulletMetrics = {
      actual: numericSummary(diagnosticsWithMetrics.map(item => item.renderedBusinessBulletCount)),
      target: numericSummary(diagnosticsWithMetrics.map(item => item.targetBusinessBulletTarget)),
      minimum: numericSummary(diagnosticsWithMetrics.map(item => item.targetBusinessBulletMin)),
      maximum: numericSummary(diagnosticsWithMetrics.map(item => item.targetBusinessBulletMax)),
    }
    const outputLengthMetrics = (['cjk_characters', 'words'] as const).flatMap(unit => {
      const rows = diagnosticsWithMetrics.filter(item => item.outputLengthUnit === unit)
      if (rows.length === 0) return []
      return [{
        unit,
        actual: numericSummary(rows.map(item => item.outputLengthValue)),
        softMinimum: numericSummary(rows.flatMap(item => (
          item.outputLengthSoftMin === null ? [] : [item.outputLengthSoftMin]
        ))),
        hardMinimum: numericSummary(rows.flatMap(item => (
          item.outputLengthHardMin === null ? [] : [item.outputLengthHardMin]
        ))),
        softMaximum: numericSummary(rows.map(item => item.outputLengthSoftMax)),
        hardMaximum: numericSummary(rows.map(item => item.outputLengthHardMax)),
      }]
    })
    const diagnosticsV2Counts = {
      validCount: validDiagnostics.length,
      missingCount: missingDiagnosticsCount,
      invalidCount: invalidDiagnosticsCount,
    }

    return {
      runStatusCounts,
      stepStatusCounts,
      attemptMetrics,
      failureSampleCount,
      agentStateCounts,
      promptMetrics,
      deliveryDecisionCounts,
      safetyStatusCounts,
      productQualityStatusCounts,
      deliverableRunTokenMetrics,
      deliveryDispositionCounts,
      fallbackMetrics,
      coverageMetrics,
      businessBulletMetrics,
      outputLengthMetrics,
      diagnosticsV2Counts,
    }
  }

  buildRegressionDataset(limit = 20) {
    if (env.DATABASE_PROVIDER === 'supabase') return supabaseHarnessRepository.buildRegressionDataset(limit)
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
    if (env.DATABASE_PROVIDER === 'supabase') return supabaseHarnessRepository.createFailureSample(runId, reason)
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
    if (env.DATABASE_PROVIDER === 'supabase') return supabaseHarnessRepository.createFailureSampleIfAbsent(runId, reason)
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
