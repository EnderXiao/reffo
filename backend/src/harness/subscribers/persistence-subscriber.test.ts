import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHarnessEvent } from '@/harness/events'
import { PersistenceSubscriber } from '@/harness/subscribers/persistence-subscriber'
import { initializeHarnessDatabase } from '@/repositories/database'
import { HarnessRunRepository } from '@/repositories/harness-run-repository'

function deliveryDiagnostics(input: {
  productPassed: boolean
  decisionReasons?: string[]
  usedSafeFallback?: boolean
}) {
  const disposition = input.productPassed
    ? 'deliverable'
    : input.usedSafeFallback ? 'internal_only' : 'review_required'
  return {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: 'completed',
      phaseReached: input.productPassed ? 'succeeded' : 'blocked_quality_validation',
      disposition,
      decisionReasonCodes: input.decisionReasons ?? [],
    },
    tracks: {
      factSafety: {
        status: 'pass',
        finalIssueCounts: {},
        rejectedCandidateIssueCounts: {},
        unclassifiedIssueCount: 0,
      },
      productQuality: {
        status: input.productPassed ? 'pass' : input.usedSafeFallback ? 'fail' : 'review_required',
        issueCounts: input.productPassed ? {} : { OUTPUT_CONTENT_UNDERSIZED: 1 },
      },
    },
    provenance: {
      planOrigin: 'model_primary',
      artifactOrigin: input.usedSafeFallback ? 'server_renderer' : 'model',
      usedSafeFallback: input.usedSafeFallback ?? false,
      usedAnyFallback: input.usedSafeFallback ?? false,
      interview: input.productPassed ? 'deferred' : 'skipped_by_gate',
    },
    metrics: {
      sourceBlockCount: 12,
      mappedSourceBlockCount: 12,
      unmappedSourceBlockCount: 0,
      highImportanceUnmappedCount: 0,
      eligibleBusinessEvidenceCount: 8,
      eligibleBusinessScopeCount: 3,
      plannedContentEvidenceCount: 6,
      usedPlannedEvidenceCount: 6,
      plannedEvidenceCoverage: { numerator: 6, denominator: 6 },
      stableCoreCoverage: { numerator: 3, denominator: 3 },
      primaryRequirementCoverage: { numerator: 4, denominator: 5 },
      renderedBusinessBulletCount: 6,
      renderedTotalListItemCount: 10,
      renderedProjectCount: 2,
      targetBusinessBulletMin: 5,
      targetBusinessBulletTarget: 6,
      targetBusinessBulletMax: 8,
      outputLengthUnit: 'cjk_characters',
      outputLengthValue: 880,
      outputLengthSoftMin: 700,
      outputLengthHardMin: 500,
      outputLengthSoftMax: 1400,
      outputLengthHardMax: 1800,
    },
  }
}

function failedDeliveryDiagnostics() {
  return {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: 'failed',
      phaseReached: 'provider_failure',
      disposition: 'blocked_retryable',
      decisionReasonCodes: ['V5_PROVIDER_UNAVAILABLE'],
    },
    tracks: {
      factSafety: {
        status: 'not_run',
        finalIssueCounts: {},
        rejectedCandidateIssueCounts: {},
        unclassifiedIssueCount: 0,
      },
      productQuality: { status: 'not_run', issueCounts: {} },
    },
    provenance: {
      planOrigin: 'none',
      artifactOrigin: 'none',
      usedSafeFallback: false,
      usedAnyFallback: false,
      interview: 'not_reached',
    },
    metrics: null,
  }
}

function createTestHarness() {
  const db = initializeHarnessDatabase(new Database(':memory:'))
  const subscriber = new PersistenceSubscriber(() => db)
  const repository = new HarnessRunRepository(db)
  return { db, subscriber, repository }
}

function startRun(subscriber: PersistenceSubscriber, runId: string) {
  subscriber.handle(createHarnessEvent({
    type: 'workflow.started',
    runId,
    requestId: `request-${runId}`,
    payload: {
      workflowName: 'resume_optimization',
      workflowVersion: '5.0.0-test',
      inputDigest: `digest-${runId}`,
      releaseStatus: 'preproduction_candidate',
    },
  }))
}

describe('Phase 1 harness diagnostics persistence', () => {
  test('re-sanitizes P01 validation observations before persisting event payloads', () => {
    const { db, subscriber } = createTestHarness()
    try {
      const runId = 'run-p01-validation-observation'
      const piiCanary = 'PII_CANARY_resume_text@example.com_13800138000'
      startRun(subscriber, runId)
      subscriber.handle(createHarnessEvent({
        type: 'extraction.validation.observed',
        runId,
        requestId: `request-${runId}`,
        payload: {
          version: 'v5-p01-validation-observation-v1',
          shardIndex: 0,
          shardCount: 2,
          component: 'P01',
          attempt: 0,
          layer: 'domain',
          outcome: 'failed',
          issueBuckets: [{
            code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
            severity: 'error',
            pathCategory: 'fact',
            count: 2,
            message: piiCanary,
            rawPath: `factCandidates[0].${piiCanary}`,
          }, {
            code: `UNKNOWN_${piiCanary}`,
            severity: 'warning',
            pathCategory: 'other',
            count: 1,
          }],
          resumeContent: piiCanary,
          jobDescription: piiCanary,
          currentOutput: piiCanary,
        },
      }))

      const row = db.query(`
        SELECT payload_json
        FROM harness_events
        WHERE run_id = ? AND type = 'extraction.validation.observed'
      `).get(runId) as { payload_json: string }
      expect(row.payload_json).not.toContain(piiCanary)
      expect(JSON.parse(row.payload_json)).toEqual({
        version: 'v5-p01-validation-observation-v1',
        shardIndex: 0,
        shardCount: 2,
        component: 'P01',
        attempt: 0,
        layer: 'domain',
        outcome: 'failed',
        issueBuckets: [{
          code: 'BUSINESS_FACT_WITHOUT_TIMELINE',
          severity: 'error',
          pathCategory: 'fact',
          count: 2,
        }, {
          code: 'UNCLASSIFIED_VALIDATION_ISSUE',
          severity: 'warning',
          pathCategory: 'other',
          count: 1,
        }],
      })

      subscriber.handle(createHarnessEvent({
        type: 'extraction.validation.observed',
        runId,
        requestId: `request-${runId}`,
        payload: {
          version: 'v5-p01-validation-observation-v1',
          shardIndex: 3,
          shardCount: 2,
          component: 'P01',
          attempt: 0,
          layer: 'domain',
          outcome: 'failed',
          issueBuckets: [],
          resumeContent: piiCanary,
        },
      }))
      expect(db.query(`
        SELECT COUNT(*) AS count
        FROM harness_events
        WHERE run_id = ? AND type = 'extraction.validation.observed'
      `).get(runId)).toEqual({ count: 1 })
    } finally {
      db.close()
    }
  })

  test('migrates an existing harness process_runs table without replacing data', () => {
    const db = new Database(':memory:')
    try {
      db.exec(`
        CREATE TABLE process_runs (
          id TEXT PRIMARY KEY,
          request_id TEXT NOT NULL,
          workflow_name TEXT NOT NULL,
          workflow_version TEXT NOT NULL,
          status TEXT NOT NULL,
          input_digest TEXT,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          error_code TEXT,
          error_message TEXT
        );
        INSERT INTO process_runs (
          id, request_id, workflow_name, workflow_version, status, started_at
        ) VALUES ('existing-run', 'existing-request', 'resume_optimization', 'v1', 'succeeded', '2099-01-01');
      `)

      initializeHarnessDatabase(db)

      const row = db.query(`
        SELECT id, delivery_decision, safety_status, product_quality_status,
               diagnostics_version, diagnostics_json
        FROM process_runs
        WHERE id = 'existing-run'
      `).get()
      expect(row).toEqual({
        id: 'existing-run',
        delivery_decision: null,
        safety_status: null,
        product_quality_status: null,
        diagnostics_version: null,
        diagnostics_json: null,
      })
    } finally {
      db.close()
    }
  })

  test('adds nullable diagnostics columns and stores only the allowlisted projection', () => {
    const { db, subscriber } = createTestHarness()
    try {
      const runId = 'run-deliverable'
      startRun(subscriber, runId)
      const diagnostics = deliveryDiagnostics({ productPassed: true })
      subscriber.handle(createHarnessEvent({
        type: 'workflow.succeeded',
        runId,
        requestId: `request-${runId}`,
        payload: {
          agentState: 'succeeded',
          usedSafeFallback: false,
          deliveryDecision: 'deliver',
          qualityGates: { factSafety: 'pass', deliverability: 'pass' },
          deliveryDiagnostics: {
            ...diagnostics,
            outcome: { ...diagnostics.outcome, candidateText: '不应进入聚合诊断' },
            metrics: { ...diagnostics.metrics, sourceText: '不应进入聚合诊断' },
            resumeMarkdown: '# 不应进入聚合诊断',
            jobDescription: '不应进入聚合诊断',
          },
        },
      }))

      const columns = db.query('PRAGMA table_info(process_runs)').all() as Array<{ name: string }>
      expect(columns.map(item => item.name)).toEqual(expect.arrayContaining([
        'delivery_decision',
        'safety_status',
        'product_quality_status',
        'diagnostics_version',
        'diagnostics_json',
      ]))
      expect(db.query("SELECT version FROM schema_versions WHERE name = 'harness'").get()).toEqual({ version: 3 })

      const row = db.query(`
        SELECT delivery_decision, safety_status, product_quality_status,
               diagnostics_version, diagnostics_json
        FROM process_runs
        WHERE id = ?
      `).get(runId) as Record<string, unknown>
      expect(row).toMatchObject({
        delivery_decision: 'deliver',
        safety_status: 'pass',
        product_quality_status: 'pass',
        diagnostics_version: 'v5-delivery-diagnostics-v2',
      })
      expect(row.diagnostics_json).toBeString()
      expect(String(row.diagnostics_json)).not.toContain('resumeMarkdown')
      expect(String(row.diagnostics_json)).not.toContain('jobDescription')
      expect(String(row.diagnostics_json)).not.toContain('candidateText')
      expect(String(row.diagnostics_json)).not.toContain('sourceText')
      expect(JSON.parse(String(row.diagnostics_json))).toEqual(diagnostics)
      expect(JSON.parse(String(row.diagnostics_json)).provenance.interview).toBe('deferred')

      const eventRow = db.query(`
        SELECT payload_json
        FROM harness_events
        WHERE run_id = ? AND type = 'workflow.succeeded'
      `).get(runId) as { payload_json: string }
      expect(eventRow.payload_json).not.toContain('resumeMarkdown')
      expect(eventRow.payload_json).not.toContain('jobDescription')
      expect(eventRow.payload_json).not.toContain('candidateText')
      expect(eventRow.payload_json).not.toContain('sourceText')
      expect(JSON.parse(eventRow.payload_json)).toMatchObject({
        agentState: 'succeeded',
        usedSafeFallback: false,
        deliveryDecision: 'deliver',
        deliveryDiagnostics: diagnostics,
      })
    } finally {
      db.close()
    }
  })

  test('keeps historical failed_optional interview diagnostics readable', () => {
    const { db, subscriber, repository } = createTestHarness()
    try {
      const runId = 'run-historical-failed-optional'
      startRun(subscriber, runId)
      const diagnostics = deliveryDiagnostics({ productPassed: true })
      diagnostics.provenance.interview = 'failed_optional'
      subscriber.handle(createHarnessEvent({
        type: 'workflow.succeeded',
        runId,
        requestId: `request-${runId}`,
        payload: {
          agentState: 'succeeded',
          usedSafeFallback: false,
          deliveryDiagnostics: diagnostics,
        },
      }))

      const row = db.query(`
        SELECT diagnostics_json
        FROM process_runs
        WHERE id = ?
      `).get(runId) as { diagnostics_json: string }
      expect(JSON.parse(row.diagnostics_json).provenance.interview).toBe('failed_optional')
      expect(repository.getDashboardMetrics().diagnosticsV2Counts).toEqual({
        validCount: 1,
        missingCount: 0,
        invalidCount: 0,
      })
    } finally {
      db.close()
    }
  })

  test('persists failed terminal diagnostics with null metrics', () => {
    const { db, subscriber } = createTestHarness()
    try {
      const runId = 'run-provider-failure'
      startRun(subscriber, runId)
      subscriber.handle(createHarnessEvent({
        type: 'workflow.failed',
        runId,
        requestId: `request-${runId}`,
        payload: {
          agentState: 'provider_failure',
          errorCode: 'V5_PROVIDER_UNAVAILABLE',
          deliveryDiagnostics: failedDeliveryDiagnostics(),
        },
      }))

      const row = db.query(`
        SELECT delivery_decision, safety_status, product_quality_status,
               diagnostics_version, diagnostics_json
        FROM process_runs
        WHERE id = ?
      `).get(runId) as Record<string, unknown>
      expect(row).toMatchObject({
        delivery_decision: 'block',
        safety_status: 'not_run',
        product_quality_status: 'not_run',
        diagnostics_version: 'v5-delivery-diagnostics-v2',
      })
      expect(JSON.parse(String(row.diagnostics_json))).toEqual(failedDeliveryDiagnostics())
    } finally {
      db.close()
    }
  })

  test('aggregates delivery tracks and average tokens per deliverable run', () => {
    const { db, subscriber, repository } = createTestHarness()
    try {
      startRun(subscriber, 'run-deliverable')
      subscriber.handle(createHarnessEvent({
        type: 'step.started',
        runId: 'run-deliverable',
        requestId: 'request-run-deliverable',
        stepRunId: 'step-deliverable',
        payload: { stepName: 'v5_p06_resume_generate' },
      }))
      subscriber.handle(createHarnessEvent({
        type: 'attempt.started',
        runId: 'run-deliverable',
        requestId: 'request-run-deliverable',
        stepRunId: 'step-deliverable',
        attemptId: 'attempt-deliverable',
        payload: { attemptNumber: 1 },
      }))
      subscriber.handle(createHarnessEvent({
        type: 'provider.responded',
        runId: 'run-deliverable',
        requestId: 'request-run-deliverable',
        stepRunId: 'step-deliverable',
        attemptId: 'attempt-deliverable',
        payload: { inputTokens: 120, outputTokens: 30, latencyMs: 800 },
      }))
      subscriber.handle(createHarnessEvent({
        type: 'workflow.succeeded',
        runId: 'run-deliverable',
        requestId: 'request-run-deliverable',
        payload: {
          agentState: 'succeeded',
          usedSafeFallback: false,
          deliveryDecision: 'deliver',
          qualityGates: { factSafety: 'pass', deliverability: 'pass' },
          deliveryDiagnostics: deliveryDiagnostics({ productPassed: true }),
        },
      }))

      startRun(subscriber, 'run-review-required')
      subscriber.handle(createHarnessEvent({
        type: 'workflow.partial',
        runId: 'run-review-required',
        requestId: 'request-run-review-required',
        payload: {
          agentState: 'blocked_quality_validation',
          usedSafeFallback: false,
          deliveryDecision: 'block',
          qualityGates: { factSafety: 'pass', deliverability: 'review_required' },
          deliveryDiagnostics: deliveryDiagnostics({
            productPassed: false,
            decisionReasons: ['OUTPUT_CONTENT_UNDERSIZED'],
          }),
        },
      }))

      const metrics = repository.getDashboardMetrics() as Record<string, unknown>
      expect(metrics.deliveryDecisionCounts).toEqual([
        { delivery_decision: 'block', count: 1 },
        { delivery_decision: 'deliver', count: 1 },
      ])
      expect(metrics.safetyStatusCounts).toEqual([{ safety_status: 'pass', count: 2 }])
      expect(metrics.productQualityStatusCounts).toEqual([
        { product_quality_status: 'pass', count: 1 },
        { product_quality_status: 'review_required', count: 1 },
      ])
      expect(metrics.deliverableRunTokenMetrics).toEqual({
        deliverable_run_count: 1,
        avg_input_tokens_per_run: 120,
        avg_output_tokens_per_run: 30,
        avg_total_tokens_per_run: 150,
      })
      expect(metrics.deliveryDispositionCounts).toEqual([
        { disposition: 'deliverable', count: 1 },
        { disposition: 'review_required', count: 1 },
      ])
      expect(metrics.fallbackMetrics).toEqual({
        eligibleDiagnosticsCount: 2,
        safeFallbackUseCount: 0,
        safeFallbackUseRate: 0,
        anyFallbackUseCount: 0,
        anyFallbackUseRate: 0,
      })
    } finally {
      db.close()
    }
  })

  test('aggregates only strict v2 diagnostics and treats 0/0 coverage as N/A', () => {
    const { db, subscriber, repository } = createTestHarness()
    try {
      startRun(subscriber, 'run-valid-metrics')
      subscriber.handle(createHarnessEvent({
        type: 'workflow.succeeded',
        runId: 'run-valid-metrics',
        requestId: 'request-run-valid-metrics',
        payload: {
          agentState: 'succeeded',
          usedSafeFallback: false,
          deliveryDiagnostics: deliveryDiagnostics({ productPassed: true }),
        },
      }))

      const notApplicable = deliveryDiagnostics({
        productPassed: false,
        usedSafeFallback: true,
        decisionReasons: ['OUTPUT_CONTENT_UNDERSIZED'],
      })
      notApplicable.metrics.plannedEvidenceCoverage = { numerator: 0, denominator: 0 }
      notApplicable.metrics.plannedContentEvidenceCount = 0
      notApplicable.metrics.usedPlannedEvidenceCount = 0
      notApplicable.metrics.stableCoreCoverage = { numerator: 0, denominator: 0 }
      notApplicable.metrics.primaryRequirementCoverage = { numerator: 0, denominator: 0 }
      notApplicable.metrics.renderedBusinessBulletCount = 0
      notApplicable.metrics.targetBusinessBulletMin = 0
      notApplicable.metrics.targetBusinessBulletTarget = 0
      notApplicable.metrics.targetBusinessBulletMax = 0
      notApplicable.metrics.outputLengthValue = 0
      notApplicable.metrics.outputLengthSoftMin = 0
      notApplicable.metrics.outputLengthHardMin = 0
      notApplicable.metrics.outputLengthSoftMax = 0
      notApplicable.metrics.outputLengthHardMax = 0
      startRun(subscriber, 'run-valid-na')
      subscriber.handle(createHarnessEvent({
        type: 'workflow.partial',
        runId: 'run-valid-na',
        requestId: 'request-run-valid-na',
        payload: {
          agentState: 'blocked_quality_validation',
          usedSafeFallback: true,
          deliveryDiagnostics: notApplicable,
        },
      }))

      startRun(subscriber, 'run-valid-no-metrics')
      subscriber.handle(createHarnessEvent({
        type: 'workflow.failed',
        runId: 'run-valid-no-metrics',
        requestId: 'request-run-valid-no-metrics',
        payload: {
          agentState: 'provider_failure',
          deliveryDiagnostics: failedDeliveryDiagnostics(),
        },
      }))

      startRun(subscriber, 'run-missing-diagnostics')
      subscriber.handle(createHarnessEvent({
        type: 'workflow.failed',
        runId: 'run-missing-diagnostics',
        requestId: 'request-run-missing-diagnostics',
        payload: { agentState: 'workflow_failure', errorCode: 'V5_TEST_FAILURE' },
      }))
      startRun(subscriber, 'run-legacy-without-v2-diagnostics')
      db.query(`
        UPDATE process_runs
        SET workflow_version = '4.0.0-test', status = 'failed'
        WHERE id = 'run-legacy-without-v2-diagnostics'
      `).run()
      startRun(subscriber, 'run-invalid-json')
      db.query(`
        UPDATE process_runs
        SET status = 'failed', diagnostics_version = 'v5-delivery-diagnostics-v2', diagnostics_json = '{invalid'
        WHERE id = 'run-invalid-json'
      `).run()

      startRun(subscriber, 'run-invalid-coverage')
      const invalidCoverage = structuredClone(deliveryDiagnostics({ productPassed: true }))
      invalidCoverage.metrics.primaryRequirementCoverage = { numerator: 6, denominator: 5 }
      db.query(`
        UPDATE process_runs
        SET status = 'failed', diagnostics_version = 'v5-delivery-diagnostics-v2', diagnostics_json = ?
        WHERE id = 'run-invalid-coverage'
      `).run(JSON.stringify(invalidCoverage))

      const metrics = repository.getDashboardMetrics()
      expect(metrics.diagnosticsV2Counts).toEqual({
        validCount: 3,
        missingCount: 1,
        invalidCount: 2,
      })
      expect(metrics.deliveryDispositionCounts).toEqual([
        { disposition: 'deliverable', count: 1 },
        { disposition: 'internal_only', count: 1 },
        { disposition: 'blocked_retryable', count: 1 },
      ])
      expect(metrics.fallbackMetrics).toMatchObject({
        eligibleDiagnosticsCount: 3,
        safeFallbackUseCount: 1,
        anyFallbackUseCount: 1,
      })
      expect(metrics.fallbackMetrics.safeFallbackUseRate).toBeCloseTo(1 / 3)
      expect(metrics.fallbackMetrics.anyFallbackUseRate).toBeCloseTo(1 / 3)
      expect(metrics.coverageMetrics).toEqual({
        plannedEvidenceCoverage: {
          numerator: 6,
          denominator: 6,
          ratio: 1,
          sampleCount: 1,
          notApplicableCount: 1,
          metricsUnavailableCount: 1,
        },
        stableCoreCoverage: {
          numerator: 3,
          denominator: 3,
          ratio: 1,
          sampleCount: 1,
          notApplicableCount: 1,
          metricsUnavailableCount: 1,
        },
        primaryRequirementCoverage: {
          numerator: 4,
          denominator: 5,
          ratio: 0.8,
          sampleCount: 1,
          notApplicableCount: 1,
          metricsUnavailableCount: 1,
        },
      })
      expect(metrics.businessBulletMetrics).toEqual({
        actual: { sampleCount: 2, total: 6, average: 3, minimum: 0, maximum: 6 },
        target: { sampleCount: 2, total: 6, average: 3, minimum: 0, maximum: 6 },
        minimum: { sampleCount: 2, total: 5, average: 2.5, minimum: 0, maximum: 5 },
        maximum: { sampleCount: 2, total: 8, average: 4, minimum: 0, maximum: 8 },
      })
      expect(metrics.outputLengthMetrics).toEqual([{
        unit: 'cjk_characters',
        actual: { sampleCount: 2, total: 880, average: 440, minimum: 0, maximum: 880 },
        softMinimum: { sampleCount: 2, total: 700, average: 350, minimum: 0, maximum: 700 },
        hardMinimum: { sampleCount: 2, total: 500, average: 250, minimum: 0, maximum: 500 },
        softMaximum: { sampleCount: 2, total: 1400, average: 700, minimum: 0, maximum: 1400 },
        hardMaximum: { sampleCount: 2, total: 1800, average: 900, minimum: 0, maximum: 1800 },
      }])
    } finally {
      db.close()
    }
  })
})
