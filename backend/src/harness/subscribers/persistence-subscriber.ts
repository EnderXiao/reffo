import { randomUUID } from 'node:crypto'
import { initializeHarnessDatabase, resetHarnessDatabaseConnection } from '@/repositories/database'
import type { HarnessEvent } from '@/harness/events'
import { enqueueHarnessWrite } from '@/harness/subscribers/write-queue'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export class PersistenceSubscriber {
  private db: ReturnType<typeof initializeHarnessDatabase> | null = null

  handle = (event: HarnessEvent) => enqueueHarnessWrite(async () => {
    try {
      this.persistAtomically(event)
    } catch (error) {
      // Reopen once after an I/O/connection failure. Harness telemetry must not
      // block the business workflow, but later events should get a fresh handle.
      this.resetLocalConnection()
      try {
        this.persistAtomically(event)
      } catch (retryError) {
        console.error('[PersistenceSubscriber] persist failed', {
          eventType: event.type,
          runId: event.runId,
          stepRunId: event.stepRunId,
          message: retryError instanceof Error ? retryError.message : String(retryError),
        })
        this.resetLocalConnection()
      }
    }
  })

  private persistAtomically(event: HarnessEvent) {
    const db = this.getDb()
    db.transaction(() => {
      this.persistEvent(event, db)
      this.persistState(event, db)
    })()
  }

  private resetLocalConnection() {
    resetHarnessDatabaseConnection()
    this.db = null
  }

  private getDb() {
    if (!this.db) {
      this.db = initializeHarnessDatabase()
    }

    return this.db
  }

  private persistEvent(event: HarnessEvent, db: ReturnType<typeof initializeHarnessDatabase>) {
    db
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
        JSON.stringify(event.payload)
      )
  }

  private persistState(event: HarnessEvent, db: ReturnType<typeof initializeHarnessDatabase>) {
    const payload = asRecord(event.payload)

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
      case 'workflow.partial':
        db
          .query(
            `
              UPDATE process_runs
              SET status = ?, finished_at = ?, error_code = ?, error_message = ?,
                  agent_state = COALESCE(?, agent_state),
                  used_safe_fallback = COALESCE(?, used_safe_fallback)
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
            event.runId
          )
        return
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
        this.persistArtifact(event, db)
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
        this.persistEvaluation(event, db)
        return
      default:
        return
    }
  }

  private persistArtifact(event: HarnessEvent, db: ReturnType<typeof initializeHarnessDatabase>) {
    const payload = asRecord(event.payload)
    const artifactId = randomUUID()

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

  private persistEvaluation(event: HarnessEvent, db: ReturnType<typeof initializeHarnessDatabase>) {
    const payload = asRecord(event.payload)

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
