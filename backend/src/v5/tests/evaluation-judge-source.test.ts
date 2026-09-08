import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { EVALUATION_BUDGET_JOURNAL_VERSION } from '@/v5/evaluation-budget'
import { loadValidatedJudgeSourceRun } from '@/v5/evaluation-judge-source'
import {
  V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
  V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
  V5_EVALUATION_USAGE_VERSION,
  digestJson,
  writeCheckpoint,
  type EvaluationCheckpointFingerprints,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import type { V5WorkflowResult } from '@/v5/types'
import { validateGeneratedResumeArtifact } from '@/v5/validators'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory() {
  const path = await mkdtemp(resolve(tmpdir(), 'reffo-v5-judge-source-'))
  temporaryDirectories.push(path)
  return path
}

const historyDigest = '1'.repeat(64)
const caseInputDigest = '2'.repeat(64)
const sourceFingerprints: EvaluationCheckpointFingerprints = {
  inputDigest: historyDigest,
  implementationDigest: '3'.repeat(64),
  configDigest: '4'.repeat(64),
}

async function createSourceRun(input: {
  stage?: 'generation-only' | 'full'
  p12Usage?: EvaluationUsageEntry[]
  p12Reservations?: Array<{ reservationId: string }>
  mutateResult?: (result: V5WorkflowResult) => void
} = {}) {
  const root = await temporaryDirectory()
  const sourceRun = resolve(root, 'source')
  const outputRoot = resolve(root, 'judge-output')
  const prefix = 'case-03-target'
  const result = createV5ResultFixture()
  input.mutateResult?.(result)
  await mkdir(resolve(sourceRun, 'cases'), { recursive: true })
  await writeCheckpoint({
    path: resolve(sourceRun, 'run-manifest.json'),
    kind: 'run_manifest',
    caseId: 'run',
    fingerprints: sourceFingerprints,
    payload: {
      runId: 'source-run-id',
      runnerProtocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
      selectedCases: [3],
      stage: input.stage ?? 'generation-only',
      sourceRun: null,
      provider: {
        endpoint: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        maxProviderAttempts: 1,
        fallbackEnabled: false,
      },
      executionPolicy: {
        releaseGateMode: 'deterministic_product_delivery_v2',
        agentFactJudgeEnabled: false,
        agentQualityJudgeEnabled: false,
        artifactGenerationMode: 'dsl_v1',
        artifactRepairMax: 0,
        interviewMode: 'deferred',
        componentQuotaPolicy: V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
      },
    },
  })
  await writeCheckpoint({
    path: resolve(sourceRun, 'cases', `${prefix}-v5-result.json`),
    kind: 'v5_result',
    caseId: 'case-03',
    fingerprints: { ...sourceFingerprints, inputDigest: caseInputDigest },
    payload: result,
  })
  await writeFile(resolve(sourceRun, 'cases', `${prefix}-v5.md`), result.artifact.markdown)

  const p12Usage = input.p12Usage ?? []
  const usageRows: EvaluationUsageEntry[] = [{
    usageVersion: V5_EVALUATION_USAGE_VERSION,
    at: new Date(0).toISOString(),
    reservationId: 'generation-call',
    caseId: 'case-03',
    outcome: 'success',
    promptVersion: '5.0.0-p06-test',
    model: 'deepseek-chat',
    inputTokens: 10,
    outputTokens: 10,
    finishReason: 'stop',
    requestedMaxOutputTokens: 100,
    providerRequestId: null,
    latencyMs: 1,
  }, ...p12Usage]
  await writeFile(
    resolve(sourceRun, 'usage.jsonl'),
    `${usageRows.map(row => JSON.stringify(row)).join('\n')}\n`
  )
  const initialized = {
    journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
    sequence: 1,
    runId: 'source-run-id',
    atMs: 0,
    type: 'budget_initialized',
    config: {},
  }
  const reservations = (input.p12Reservations ?? []).map(({ reservationId }, index) => ({
    journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
    sequence: index + 2,
    runId: 'source-run-id',
    atMs: index + 1,
    type: 'call_reserved',
    reservationId,
    caseId: 'case-03',
    estimatedInputTokens: 100,
    maxOutputTokens: 100,
    label: '5.0.0-p12-test',
  }))
  const settlements = p12Usage.map((row, index) => ({
    journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
    sequence: reservations.length + index + 2,
    runId: 'source-run-id',
    atMs: reservations.length + index + 1,
    type: 'call_settled',
    reservationId: row.reservationId,
    caseId: row.caseId,
    outcome: row.outcome,
    inputTokens: row.inputTokens ?? 100,
    outputTokens: row.outputTokens ?? 100,
    inputAccounting: row.inputTokens === null ? 'estimated' : 'actual',
    outputAccounting: row.outputTokens === null ? 'reserved_max' : 'actual',
  }))
  await writeFile(
    resolve(sourceRun, 'budget-journal.jsonl'),
    `${[initialized, ...reservations, ...settlements].map(row => JSON.stringify(row)).join('\n')}\n`
  )
  return { sourceRun, outputRoot, prefix, result }
}

function sourceRequest(source: Awaited<ReturnType<typeof createSourceRun>>) {
  return {
    sourceRun: source.sourceRun,
    outputRoot: source.outputRoot,
    historyDigest,
    selectedCases: [3],
    cases: [{
      caseNumber: 3,
      caseId: 'case-03',
      prefix: source.prefix,
      inputDigest: caseInputDigest,
      resumeDigest: source.result.resumeEvidenceBundle.sourceDocument.sha256,
    }],
  }
}

describe('judge-only source-run validation', () => {
  test('loads a content-addressed generation result without assigning current fingerprints to it', async () => {
    const source = await createSourceRun()
    const loaded = await loadValidatedJudgeSourceRun(sourceRequest(source))

    expect(loaded.cases).toHaveLength(1)
    expect(loaded.cases[0].v5Result.runId).toBe(source.result.runId)
    expect(loaded.cases[0].sourceCheckpoint.fingerprints).toEqual({
      ...sourceFingerprints,
      inputDigest: caseInputDigest,
    })
    expect(loaded.provenance.sourceStage).toBe('generation-only')
    expect(loaded.provenance.contentDigest).toBe(digestJson({
      sourceRunId: loaded.provenance.sourceRunId,
      sourceRunnerProtocolVersion: loaded.provenance.sourceRunnerProtocolVersion,
      sourceStage: loaded.provenance.sourceStage,
      historyDigest: loaded.provenance.historyDigest,
      sourceManifestPayloadSha256: loaded.provenance.sourceManifestPayloadSha256,
      sourceManifestFingerprints: loaded.provenance.sourceManifestFingerprints,
      cases: loaded.provenance.cases,
    }))
  })

  test('rejects historical results that fail any current product delivery invariant', async () => {
    const cases: Array<(result: V5WorkflowResult) => void> = [
      result => { result.usedSafeFallback = true },
      result => { result.generationProvenance.artifactOrigin = 'server_renderer' },
      result => { result.generationProvenance.artifactOrigin = 'emergency' },
      result => { result.qualityGates.deliverability = 'review_required' },
      result => { result.state = 'succeeded_with_safe_fallback' },
      result => { delete (result as Partial<V5WorkflowResult>).generationProvenance },
    ]

    for (const mutateResult of cases) {
      const source = await createSourceRun({ mutateResult })
      await expect(loadValidatedJudgeSourceRun(sourceRequest(source)))
        .rejects.toMatchObject({ code: 'JUDGE_SOURCE_DELIVERY_GATE_FAILED' })
    }
  })

  test('rejects bidirectional legacy/diagnostics drift and invalid diagnostics', async () => {
    const mutations: Array<(result: V5WorkflowResult) => void> = [
      result => {
        result.deliveryDecision = 'block'
        result.state = 'blocked_quality_validation'
        result.qualityGates = {
          factSafety: 'pass',
          contentCompleteness: 'fail',
          deliverability: 'review_required',
        }
      },
      result => {
        result.deliveryDiagnostics.outcome.disposition = 'review_required'
        result.deliveryDiagnostics.tracks.productQuality.status = 'review_required'
      },
      result => {
        ;(result.deliveryDiagnostics as { version: string }).version = 'v5-delivery-diagnostics-v1'
      },
    ]

    for (const mutateResult of mutations) {
      const source = await createSourceRun({ mutateResult })
      await expect(loadValidatedJudgeSourceRun(sourceRequest(source)))
        .rejects.toMatchObject({ code: 'JUDGE_SOURCE_DELIVERY_GATE_FAILED' })
    }

    const missing = await createSourceRun({
      mutateResult: result => { delete (result as Partial<V5WorkflowResult>).deliveryDiagnostics },
    })
    await expect(loadValidatedJudgeSourceRun(sourceRequest(missing)))
      .rejects.toMatchObject({ code: 'JUDGE_SOURCE_RESULT_INVALID' })
  })

  test('recomputes current product-quality warnings instead of trusting stored pass flags', async () => {
    const source = await createSourceRun({
      mutateResult: result => {
        const skillClaim = result.artifact.claims.find(claim => claim.outputPath.startsWith('skills'))
        if (!skillClaim) throw new Error('fixture needs a skill claim')
        result.artifact.markdown = result.artifact.markdown.replace(skillClaim.outputText, '')
        result.artifact.claims = result.artifact.claims.filter(claim => claim.claimId !== skillClaim.claimId)
        const validation = validateGeneratedResumeArtifact({
          artifact: result.artifact,
          resume: result.resumeEvidenceBundle,
          plan: result.resumePlan,
          policy: result.generationPolicy,
          gateMode: 'relaxed_release',
        })
        if (!validation.passed || !validation.value) throw new Error('fixture mutation must remain structurally valid')
        result.artifact = validation.value
        result.state = 'succeeded'
        result.usedSafeFallback = false
        result.deliveryDecision = 'deliver'
        result.qualityGates = {
          factSafety: 'pass',
          contentCompleteness: 'pass',
          deliverability: 'pass',
        }
        result.generationProvenance.artifactOrigin = 'model'
      },
    })

    await expect(loadValidatedJudgeSourceRun(sourceRequest(source)))
      .rejects.toMatchObject({ code: 'JUDGE_SOURCE_CURRENT_QUALITY_GATE_FAILED' })
  })

  test('rejects an artifact whose case input fingerprint is not the frozen history input', async () => {
    const source = await createSourceRun()
    await expect(loadValidatedJudgeSourceRun({
      ...sourceRequest(source),
      cases: [{ ...sourceRequest(source).cases[0], inputDigest: '9'.repeat(64) }],
    })).rejects.toMatchObject({ code: 'JUDGE_SOURCE_RESULT_FINGERPRINT_MISMATCH' })
  })

  test('rejects a source with a completed or billable P12 request', async () => {
    const reservationId = 'p12-call'
    const source = await createSourceRun({
      stage: 'full',
      p12Reservations: [{ reservationId }],
      p12Usage: [{
        usageVersion: V5_EVALUATION_USAGE_VERSION,
        at: new Date(0).toISOString(),
        reservationId,
        caseId: 'case-03',
        outcome: 'success',
        promptVersion: '5.0.0-p12-test',
        model: 'deepseek-chat',
        inputTokens: 100,
        outputTokens: 10,
        finishReason: 'stop',
        requestedMaxOutputTokens: 100,
        providerRequestId: null,
        latencyMs: 1,
      }],
    })
    await expect(loadValidatedJudgeSourceRun(sourceRequest(source)))
      .rejects.toMatchObject({ code: 'JUDGE_SOURCE_P12_ALREADY_CONSUMED' })
  })

  test('allows only settled zero-token P12 failures and rejects unknown reservations', async () => {
    const failedReservationId = 'p12-aborted'
    const safeSource = await createSourceRun({
      stage: 'full',
      p12Reservations: [{ reservationId: failedReservationId }],
      p12Usage: [{
        usageVersion: V5_EVALUATION_USAGE_VERSION,
        at: new Date(0).toISOString(),
        reservationId: failedReservationId,
        caseId: 'case-03',
        outcome: 'failure',
        promptVersion: '5.0.0-p12-test',
        model: 'deepseek-chat',
        inputTokens: null,
        outputTokens: null,
        finishReason: null,
        requestedMaxOutputTokens: 100,
        providerRequestId: null,
        latencyMs: null,
      }],
    })
    await expect(loadValidatedJudgeSourceRun(sourceRequest(safeSource))).resolves.toBeDefined()

    const unknownSource = await createSourceRun({
      stage: 'full',
      p12Reservations: [{ reservationId: 'p12-unknown' }],
    })
    await expect(loadValidatedJudgeSourceRun(sourceRequest(unknownSource)))
      .rejects.toMatchObject({ code: 'JUDGE_SOURCE_P12_UNKNOWN' })
  })

  test('rejects source/output overlap before any provider-bearing code can run', async () => {
    const source = await createSourceRun()
    await expect(loadValidatedJudgeSourceRun({
      ...sourceRequest(source),
      outputRoot: resolve(source.sourceRun, 'judge-output'),
    })).rejects.toMatchObject({ code: 'JUDGE_SOURCE_OUTPUT_OVERLAP' })
  })
})
