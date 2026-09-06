import { randomUUID } from 'node:crypto'
import { initializeHarnessDatabase, resetHarnessDatabaseConnection } from '@/repositories/database'
import type { HarnessEvent } from '@/harness/events'
import { enqueueHarnessWrite } from '@/harness/subscribers/write-queue'
import { env } from '@/config/env'
import { supabaseHarnessRepository } from '@/repositories/harness-supabase'
import type { V5DeliveryDiagnostics } from '@/v5/types'
import { isV5DeliveryDiagnosticsSemanticallyValid } from '@/v5/delivery-gate'
import { sanitizeP01ValidationObservation } from '@/v5/p01-validation-diagnostics'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

const SAFE_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const EXECUTION_STATUSES = ['completed', 'failed'] as const
const RESUME_AGENT_STATES = [
  'received',
  'normalized',
  'resume_extracting',
  'resume_extracted',
  'job_extracting',
  'job_extracted',
  'matching',
  'matched',
  'policy_ready',
  'planning',
  'planned',
  'drafting',
  'drafted',
  'reviewing',
  'validating',
  'repairing_1',
  'repairing_2',
  'fact_judging',
  'succeeded',
  'succeeded_with_safe_fallback',
  'blocked_input_validation',
  'blocked_fact_validation',
  'blocked_structure_validation',
  'blocked_quality_validation',
  'provider_failure',
  'workflow_failure',
] as const
const DELIVERY_DISPOSITIONS = [
  'deliverable',
  'review_required',
  'internal_only',
  'blocked_retryable',
  'blocked_terminal',
] as const
const FACT_SAFETY_STATUSES = ['pass', 'fail', 'not_run'] as const
const PRODUCT_QUALITY_STATUSES = ['pass', 'review_required', 'fail', 'not_run'] as const
const PLAN_ORIGINS = ['model_primary', 'model_repair', 'deterministic_quality', 'none'] as const
const ARTIFACT_ORIGINS = ['model', 'model_repair', 'server_compiler', 'server_renderer', 'emergency', 'none'] as const
const INTERVIEW_STATUSES = [
  'generated',
  'deferred',
  'skipped_by_gate',
  'failed_optional',
  'not_reached',
] as const
const OUTPUT_LENGTH_UNITS = ['cjk_characters', 'words'] as const

function safeDiagnosticCodes(value: unknown) {
  if (!Array.isArray(value)) return null
  if (value.length > 128 || value.some(item => (
    typeof item !== 'string' || !SAFE_DIAGNOSTIC_CODE.test(item)
  ))) return null
  return [...new Set(value)].sort()
}

function asEnum<const TValues extends readonly string[]>(value: unknown, values: TValues): TValues[number] | null {
  const text = asString(value)
  return text && (values as readonly string[]).includes(text) ? text as TValues[number] : null
}

function asNonNegativeInteger(value: unknown) {
  const number = asNumber(value)
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null
}

function asNullableNonNegativeInteger(value: unknown) {
  return value === null ? null : asNonNegativeInteger(value)
}

function safeIssueCounts(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const rawEntries = Object.entries(value as Record<string, unknown>)
  if (
    rawEntries.length > 128
    || rawEntries.some(([code, count]) => (
      !SAFE_DIAGNOSTIC_CODE.test(code) || asNonNegativeInteger(count) === null
    ))
  ) return null
  const entries = rawEntries
    .map(([code, count]) => [code, count as number] as const)
    .sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(entries)
}

function safeCoverage(value: unknown) {
  const coverage = asRecord(value)
  const numerator = asNonNegativeInteger(coverage.numerator)
  const denominator = asNonNegativeInteger(coverage.denominator)
  return numerator === null || denominator === null ? null : { numerator, denominator }
}

function sanitizeMetrics(value: unknown): NonNullable<V5DeliveryDiagnostics['metrics']> | null {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null

  const metrics = asRecord(value)
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
  const counts = Object.fromEntries(
    countKeys.map(key => [key, asNonNegativeInteger(metrics[key])])
  ) as Record<(typeof countKeys)[number], number | null>
  const plannedEvidenceCoverage = safeCoverage(metrics.plannedEvidenceCoverage)
  const stableCoreCoverage = safeCoverage(metrics.stableCoreCoverage)
  const primaryRequirementCoverage = safeCoverage(metrics.primaryRequirementCoverage)
  const outputLengthUnit = asEnum(metrics.outputLengthUnit, OUTPUT_LENGTH_UNITS)
  const outputLengthSoftMin = asNullableNonNegativeInteger(metrics.outputLengthSoftMin)
  const outputLengthHardMin = asNullableNonNegativeInteger(metrics.outputLengthHardMin)

  if (
    Object.values(counts).some(item => item === null)
    || !plannedEvidenceCoverage
    || !stableCoreCoverage
    || !primaryRequirementCoverage
    || !outputLengthUnit
    || (metrics.outputLengthSoftMin !== null && outputLengthSoftMin === null)
    || (metrics.outputLengthHardMin !== null && outputLengthHardMin === null)
  ) {
    return null
  }

  return {
    sourceBlockCount: counts.sourceBlockCount!,
    mappedSourceBlockCount: counts.mappedSourceBlockCount!,
    unmappedSourceBlockCount: counts.unmappedSourceBlockCount!,
    highImportanceUnmappedCount: counts.highImportanceUnmappedCount!,
    eligibleBusinessEvidenceCount: counts.eligibleBusinessEvidenceCount!,
    eligibleBusinessScopeCount: counts.eligibleBusinessScopeCount!,
    plannedContentEvidenceCount: counts.plannedContentEvidenceCount!,
    usedPlannedEvidenceCount: counts.usedPlannedEvidenceCount!,
    plannedEvidenceCoverage,
    stableCoreCoverage,
    primaryRequirementCoverage,
    renderedBusinessBulletCount: counts.renderedBusinessBulletCount!,
    renderedTotalListItemCount: counts.renderedTotalListItemCount!,
    renderedProjectCount: counts.renderedProjectCount!,
    targetBusinessBulletMin: counts.targetBusinessBulletMin!,
    targetBusinessBulletTarget: counts.targetBusinessBulletTarget!,
    targetBusinessBulletMax: counts.targetBusinessBulletMax!,
    outputLengthUnit,
    outputLengthValue: counts.outputLengthValue!,
    outputLengthSoftMin,
    outputLengthHardMin,
    outputLengthSoftMax: counts.outputLengthSoftMax!,
    outputLengthHardMax: counts.outputLengthHardMax!,
  }
}

/**
 * `harness_events` is an append-only audit stream, while this projection is
 * intended for aggregate product telemetry. Persist an explicit allowlist so a
 * future caller cannot accidentally copy resume or JD content into
 * `process_runs.diagnostics_json`.
 */
function sanitizeDeliveryDiagnostics(value: unknown): V5DeliveryDiagnostics | null {
  const diagnostics = asRecord(value)
  if (
    diagnostics.version !== 'v5-delivery-diagnostics-v2'
    || diagnostics.taxonomyVersion !== 'v5-delivery-taxonomy-v1'
  ) return null

  const outcome = asRecord(diagnostics.outcome)
  const tracks = asRecord(diagnostics.tracks)
  const factSafety = asRecord(tracks.factSafety)
  const productQuality = asRecord(tracks.productQuality)
  const provenance = asRecord(diagnostics.provenance)
  const execution = asEnum(outcome.execution, EXECUTION_STATUSES)
  const phaseReached = asEnum(outcome.phaseReached, RESUME_AGENT_STATES)
  const disposition = asEnum(outcome.disposition, DELIVERY_DISPOSITIONS)
  const decisionReasonCodes = safeDiagnosticCodes(outcome.decisionReasonCodes)
  const factSafetyStatus = asEnum(factSafety.status, FACT_SAFETY_STATUSES)
  const finalIssueCounts = safeIssueCounts(factSafety.finalIssueCounts)
  const rejectedCandidateIssueCounts = safeIssueCounts(factSafety.rejectedCandidateIssueCounts)
  const unclassifiedIssueCount = asNonNegativeInteger(factSafety.unclassifiedIssueCount)
  const productQualityStatus = asEnum(productQuality.status, PRODUCT_QUALITY_STATUSES)
  const productIssueCounts = safeIssueCounts(productQuality.issueCounts)
  const planOrigin = asEnum(provenance.planOrigin, PLAN_ORIGINS)
  const artifactOrigin = asEnum(provenance.artifactOrigin, ARTIFACT_ORIGINS)
  const usedSafeFallback = asBoolean(provenance.usedSafeFallback)
  const usedAnyFallback = asBoolean(provenance.usedAnyFallback)
  const interview = asEnum(provenance.interview, INTERVIEW_STATUSES)
  const metrics = sanitizeMetrics(diagnostics.metrics)

  if (
    !execution
    || !phaseReached
    || !disposition
    || !decisionReasonCodes
    || !factSafetyStatus
    || !finalIssueCounts
    || !rejectedCandidateIssueCounts
    || unclassifiedIssueCount === null
    || !productQualityStatus
    || !productIssueCounts
    || !planOrigin
    || !artifactOrigin
    || usedSafeFallback === null
    || usedAnyFallback === null
    || !interview
    || (diagnostics.metrics !== null && !metrics)
  ) {
    return null
  }

  const sanitized: V5DeliveryDiagnostics = {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: { execution, phaseReached, disposition, decisionReasonCodes },
    tracks: {
      factSafety: {
        status: factSafetyStatus,
        finalIssueCounts,
        rejectedCandidateIssueCounts,
        unclassifiedIssueCount,
      },
      productQuality: { status: productQualityStatus, issueCounts: productIssueCounts },
    },
    provenance: { planOrigin, artifactOrigin, usedSafeFallback, usedAnyFallback, interview },
    metrics,
  }
  return isV5DeliveryDiagnosticsSemanticallyValid(sanitized) ? sanitized : null
}

function terminalDiagnosticsProjection(payload: Record<string, unknown>) {
  const diagnostics = sanitizeDeliveryDiagnostics(payload.deliveryDiagnostics)
  if (!diagnostics) {
    return {
      deliveryDecision: null,
      safetyStatus: null,
      productQualityStatus: null,
      diagnosticsVersion: null,
      diagnosticsJson: null,
    }
  }

  const deliveryDecision = diagnostics.outcome.disposition === 'deliverable'
    ? 'deliver'
    : diagnostics.outcome.disposition === 'internal_only' ? 'internal_only' : 'block'

  return {
    deliveryDecision,
    safetyStatus: diagnostics.tracks.factSafety.status,
    productQualityStatus: diagnostics.tracks.productQuality.status,
    diagnosticsVersion: diagnostics.version,
    diagnosticsJson: JSON.stringify(diagnostics),
  }
}

const TERMINAL_WORKFLOW_EVENT_TYPES = new Set<HarnessEvent['type']>([
  'workflow.succeeded',
  'workflow.failed',
  'workflow.partial',
])

function terminalEventPayloadProjection(value: unknown): Record<string, unknown> {
  const payload = asRecord(value)
  const projected: Record<string, unknown> = {}
  const stringKeys = [
    'workflowName',
    'workflowVersion',
    'finishedAt',
    'errorCode',
    'errorMessage',
    'agentState',
    'executionMode',
    'deliveryDecision',
  ] as const
  const numberKeys = ['durationMs', 'stepCount'] as const

  for (const key of stringKeys) {
    const item = asString(payload[key])
    if (item !== null) projected[key] = item
  }
  for (const key of numberKeys) {
    const item = asNonNegativeInteger(payload[key])
    if (item !== null) projected[key] = item
  }
  if (typeof payload.usedSafeFallback === 'boolean') {
    projected.usedSafeFallback = payload.usedSafeFallback
  }

  const gates = asRecord(payload.qualityGates)
  const factSafety = asEnum(gates.factSafety, FACT_SAFETY_STATUSES)
  const contentCompleteness = asEnum(gates.contentCompleteness, ['pass', 'fail', 'not_run'] as const)
  const deliverability = asEnum(gates.deliverability, ['pass', 'fail', 'review_required', 'not_run'] as const)
  if (factSafety && contentCompleteness && deliverability) {
    projected.qualityGates = { factSafety, contentCompleteness, deliverability }
  }

  const issueCodes = safeDiagnosticCodes(payload.issueCodes)
  if (issueCodes) projected.issueCodes = issueCodes

  const deliveryDiagnostics = sanitizeDeliveryDiagnostics(payload.deliveryDiagnostics)
  if (deliveryDiagnostics) projected.deliveryDiagnostics = deliveryDiagnostics

  return projected
}

export class PersistenceSubscriber {
  private db: ReturnType<typeof initializeHarnessDatabase> | null = null

  constructor(
    private readonly databaseFactory: () => ReturnType<typeof initializeHarnessDatabase> = initializeHarnessDatabase
  ) {}

  handle = (event: HarnessEvent) => {
    if (env.DATABASE_PROVIDER === 'supabase') {
      return enqueueHarnessWrite(async () => {
        try {
          await supabaseHarnessRepository.persistEvent(event)
        } catch (error) {
          console.error('[PersistenceSubscriber] Supabase Harness persist failed', {
            eventType: event.type,
            runId: event.runId,
            stepRunId: event.stepRunId,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      })
    }
    try {
      const db = this.getDb()
      db.transaction(() => {
        this.persistEvent(event)
        this.persistState(event)
      })()
    } catch (error) {
      console.error('[PersistenceSubscriber] persist failed', {
        eventType: event.type,
        runId: event.runId,
        stepRunId: event.stepRunId,
        message: error instanceof Error ? error.message : String(error),
      })

      resetHarnessDatabaseConnection()
      this.db = null
    }
  }

  private getDb() {
    if (!this.db) {
      this.db = this.databaseFactory()
    }

    return this.db
  }

  private persistEvent(event: HarnessEvent) {
    const persistedPayload = event.type === 'extraction.validation.observed'
      ? sanitizeP01ValidationObservation(event.payload)
      : TERMINAL_WORKFLOW_EVENT_TYPES.has(event.type)
        ? terminalEventPayloadProjection(event.payload)
        : event.payload
    // Invalid diagnostic events are ignored instead of falling back to their
    // untrusted payload. Their observability must never widen the privacy surface.
    if (!persistedPayload) return
    this.getDb()
      .query(
        `
          INSERT OR IGNORE INTO harness_events (
            id,
            type,
            version,
            run_id,
            request_id,
            step_run_id,
            attempt_id,
            occurred_at,
            payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        event.id,
        event.type,
        event.version,
        event.runId,
        event.requestId,
        event.stepRunId ?? null,
        event.attemptId ?? null,
        event.occurredAt,
        JSON.stringify(persistedPayload)
      )
  }

  private persistState(event: HarnessEvent) {
    const payload = asRecord(event.payload)
    const db = this.getDb()

    switch (event.type) {
      case 'workflow.started':
        db
          .query(
            `
              INSERT OR REPLACE INTO process_runs (
                id,
                request_id,
                workflow_name,
                workflow_version,
                status,
                input_digest,
                started_at,
                release_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            event.runId,
            event.requestId,
            asString(payload.workflowName) ?? 'resume_optimization',
            asString(payload.workflowVersion) ?? 'v1',
            'running',
            asString(payload.inputDigest),
            event.occurredAt,
            asString(payload.releaseStatus)
          )
        return
      case 'workflow.state.changed':
        db.query('UPDATE process_runs SET agent_state = ? WHERE id = ?')
          .run(asString(payload.state), event.runId)
        return
      case 'workflow.succeeded':
      case 'workflow.failed':
      case 'workflow.partial': {
        const diagnostics = terminalDiagnosticsProjection(payload)
        db
          .query(
            `
              UPDATE process_runs
              SET status = ?, finished_at = ?, error_code = ?, error_message = ?,
                  agent_state = COALESCE(?, agent_state),
                  used_safe_fallback = COALESCE(?, used_safe_fallback),
                  delivery_decision = ?, safety_status = ?, product_quality_status = ?,
                  diagnostics_version = ?, diagnostics_json = ?
              WHERE id = ?
            `
          )
          .run(
            event.type.replace('workflow.', ''),
            asString(payload.finishedAt) ?? event.occurredAt,
            asString(payload.errorCode),
            asString(payload.errorMessage),
            asString(payload.agentState),
            typeof payload.usedSafeFallback === 'boolean' ? (payload.usedSafeFallback ? 1 : 0) : null,
            diagnostics.deliveryDecision,
            diagnostics.safetyStatus,
            diagnostics.productQualityStatus,
            diagnostics.diagnosticsVersion,
            diagnostics.diagnosticsJson,
            event.runId
          )
        return
      }
      case 'step.started':
        db
          .query(
            `
              INSERT OR REPLACE INTO step_runs (
                id,
                run_id,
                step_name,
                status,
                started_at
              ) VALUES (?, ?, ?, ?, ?)
            `
          )
          .run(
            event.stepRunId ?? null,
            event.runId,
            asString(payload.stepName) ?? 'unknown_step',
            'running',
            asString(payload.startedAt) ?? event.occurredAt
          )
        return
      case 'step.succeeded':
      case 'step.failed':
      case 'step.partial':
        db
          .query(
            `
              UPDATE step_runs
              SET status = ?, finished_at = ?, error_code = ?, error_message = ?
              WHERE id = ?
            `
          )
          .run(
            event.type.replace('step.', ''),
            asString(payload.finishedAt) ?? event.occurredAt,
            asString(payload.errorCode),
            asString(payload.errorMessage),
            event.stepRunId ?? null
          )
        return
      case 'attempt.started':
        db
          .query(
            `
              INSERT OR REPLACE INTO step_attempts (
                id,
                step_run_id,
                attempt_number,
                status,
                started_at
              ) VALUES (?, ?, ?, ?, ?)
            `
          )
          .run(event.attemptId ?? null, event.stepRunId ?? null, asNumber(payload.attemptNumber) ?? 1, 'running', event.occurredAt)
        return
      case 'provider.requested':
        {
          const manifest = asRecord(payload.promptManifest)
        db
          .query(
            `
              UPDATE step_attempts
              SET provider = ?, model = ?, prompt_version = ?, raw_output_digest = COALESCE(raw_output_digest, ?),
                  temperature = ?, max_output_tokens = ?, is_repair_attempt = ?,
                  compiled_prompt_sha256 = ?, schema_version = ?, validator_version = ?,
                  adaptive_policy_version = ?, score_formula_version = ?,
                  component_prompt_id = ?, component_prompt_version = ?
              WHERE id = ?
            `
          )
          .run(
            asString(payload.provider),
            asString(payload.model),
            asString(payload.promptVersion),
            asString(payload.inputDigest),
            asNumber(payload.temperature),
            asNumber(payload.maxOutputTokens),
            (asNumber(manifest.repairAttempt) ?? 0) > 0 ? 1 : 0,
            asString(manifest.compiledPromptSha256),
            asString(manifest.schemaVersion),
            asString(manifest.validatorVersion),
            asString(manifest.adaptivePolicyVersion),
            asString(manifest.scoreFormulaVersion),
            asString(manifest.componentPromptId),
            asString(manifest.componentPromptVersion),
            event.attemptId ?? null
          )
        return
        }
      case 'provider.responded':
        db
          .query(
            `
              UPDATE step_attempts
              SET
                provider = ?,
                model = ?,
                provider_request_id = ?,
                finish_reason = ?,
                input_tokens = ?,
                output_tokens = ?,
                latency_ms = ?,
                raw_output_digest = ?
              WHERE id = ?
            `
          )
          .run(
            asString(payload.provider),
            asString(payload.model),
            asString(payload.providerRequestId),
            asString(payload.finishReason),
            asNumber(payload.inputTokens),
            asNumber(payload.outputTokens),
            asNumber(payload.latencyMs),
            asString(payload.outputDigest),
            event.attemptId ?? null
          )
        return
      case 'output.parsed':
        this.persistArtifact(event)
        return
      case 'output.validated':
        db
          .query('UPDATE step_attempts SET parsed_output_digest = ? WHERE id = ?')
          .run(asString(payload.outputDigest), event.attemptId ?? null)
        return
      case 'attempt.succeeded':
      case 'attempt.failed':
        db
          .query(
            `
              UPDATE step_attempts
              SET status = ?, finished_at = ?, error_code = ?, error_message = ?, retry_reason = ?
              WHERE id = ?
            `
          )
          .run(
            event.type.replace('attempt.', ''),
            asString(payload.finishedAt) ?? event.occurredAt,
            asString(payload.errorCode),
            asString(payload.errorMessage),
            asString(payload.retryReason),
            event.attemptId ?? null
          )
        return
      case 'evaluation.completed':
        this.persistEvaluation(event)
        return
      default:
        return
    }
  }

  private persistArtifact(event: HarnessEvent) {
    const payload = asRecord(event.payload)
    const artifactId = randomUUID()
    const db = this.getDb()

    db
      .query(
        `
          INSERT INTO artifacts (
            id,
            run_id,
            step_run_id,
            type,
            content_type,
            content_digest,
            summary,
            storage_ref,
            redaction_policy,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        artifactId,
        event.runId,
        event.stepRunId ?? null,
        asString(payload.outputName) ?? 'parsed_output',
        'application/json',
        asString(payload.outputDigest) ?? '',
        asString(payload.summary),
        null,
        'pii_redacted',
        event.occurredAt
      )

    if (event.stepRunId) {
      db.query('UPDATE step_runs SET output_artifact_id = ? WHERE id = ?').run(artifactId, event.stepRunId)
    }
  }

  private persistEvaluation(event: HarnessEvent) {
    const payload = asRecord(event.payload)
    const db = this.getDb()

    db
      .query(
        `
          INSERT INTO evaluations (
            id,
            step_run_id,
            evaluator_name,
            evaluator_version,
            passed,
            score,
            issues_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        randomUUID(),
        event.stepRunId ?? null,
        asString(payload.evaluatorName) ?? 'unknown_evaluator',
        asString(payload.evaluatorVersion) ?? 'v1',
        payload.passed === true ? 1 : 0,
        asNumber(payload.score),
        JSON.stringify(payload.issues ?? []),
        event.occurredAt
      )
  }
}
