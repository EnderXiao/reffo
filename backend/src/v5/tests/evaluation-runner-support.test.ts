import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { resumeExtractionFactCandidateLimit, splitResumeDocument } from '@/v5/chunked-resume-extraction'
import {
  finalizeEvaluationResources,
  finalizeFailedEvaluationCase,
  finalizeFailedEvaluationCaseAndRethrow,
  persistGenerationDiagnosticsBeforeResumeCache,
  persistPartialExtractionCheckpoint,
  providerComponentQuotasForRun,
  serializedError,
} from '../../../scripts/run-v5-nonprod-nine-case-blind-eval'
import { estimateV5PromptInputTokens, resumeExtractionOutputTokenCapForBlocks, V5_PROMPT_MAX_OUTPUT_TOKENS } from '@/v5/prompt-compiler'
import { EvaluationBudgetController } from '@/v5/evaluation-budget'
import { createResumeFixture, createV5ResultFixture } from '@/v5/tests/fixtures'
import { createTrustedResumeExtractionCache, type TrustedResumeExtractionPartialSnapshot } from '@/v5/resume-extraction-cache'
import {
  BudgetedEvaluationProvider,
  CASE_2_CANARY_LIMITS,
  DETAILED_RESUME_SINGLE_CASE_LIMITS,
  FULL_CASE_LIMITS,
  FULL_RUN_LIMITS,
  V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
  V5_EVALUATION_INPUT_TOKEN_FRAMING_ALLOWANCE,
  V5_EVALUATION_INPUT_TOKEN_SAFETY_MULTIPLIER,
  V5_EXTRACTION_IMPLEMENTATION_SOURCE_FILES,
  V5_EXTRACTION_IMPLEMENTATION_SOURCE_FRAGMENTS,
  EvaluationRunnerSafetyError,
  assertResumeExtractionReplaySafe,
  acquireEvaluationRunLock,
  assertOutputDirectoryPolicy,
  assertStrictDeepSeekEndpoint,
  budgetProfileForCases,
  createExtractionImplementationDigest,
  createImplementationDigest,
  estimateProviderInputTokens,
  isV5CodeGateDeliverable,
  parseEvaluationRunnerArgs,
  readCheckpoint,
  sanitizeV5DeliveryDiagnostics,
  v5CasePhysicalCallUpperBound,
  v5CaseOutputTokenEnvelope,
  v5EvaluationComponentQuotas,
  writeCheckpoint,
  type EvaluationCheckpointFingerprints,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'
import type { V5DeliveryDiagnostics } from '@/v5/types'

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const path = await mkdtemp(resolve(tmpdir(), 'reffo-v5-runner-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function fingerprints(overrides: Partial<EvaluationCheckpointFingerprints> = {}): EvaluationCheckpointFingerprints {
  return {
    inputDigest: 'a'.repeat(64),
    implementationDigest: 'b'.repeat(64),
    configDigest: 'c'.repeat(64),
    ...overrides,
  }
}

function request(overrides: Partial<ChatCompletionInput> = {}): ChatCompletionInput {
  const promptVersion = overrides.promptVersion ?? '5.0.0-p01-test'
  const componentMatch = promptVersion.match(/-p(\d{2})([a-z]?)-/iu)
  const componentPromptId = componentMatch
    ? `P${componentMatch[1]}${componentMatch[2].toUpperCase()}`
    : 'P01'
  return {
    messages: [{ role: 'user', content: 'test' }],
    maxOutputTokens: 100,
    promptVersion,
    promptManifest: {
      workflowVersion: '5.0.0',
      componentPromptId,
      componentPromptVersion: promptVersion,
      compiledPromptSha256: 'a'.repeat(64),
      schemaVersion: '5.0.0',
      validatorVersion: '5.0.0',
      adaptivePolicyVersion: '5.0.0',
      scoreFormulaVersion: '5.0.0',
      temperature: 0,
      inputDocumentIds: [],
      repairAttempt: 0,
    },
    ...overrides,
  }
}

function testComponentQuotas() {
  return v5EvaluationComponentQuotas(2, 'full')
}

function deliveryDiagnostics(): V5DeliveryDiagnostics {
  return {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: 'completed',
      phaseReached: 'succeeded',
      disposition: 'deliverable',
      decisionReasonCodes: [],
    },
    tracks: {
      factSafety: {
        status: 'pass',
        finalIssueCounts: {},
        rejectedCandidateIssueCounts: { NUMBER_MISMATCH: 1 },
        unclassifiedIssueCount: 0,
      },
      productQuality: { status: 'pass', issueCounts: {} },
    },
    provenance: {
      planOrigin: 'model_primary',
      artifactOrigin: 'model',
      usedSafeFallback: false,
      usedAnyFallback: false,
      interview: 'deferred',
    },
    metrics: {
      sourceBlockCount: 12,
      mappedSourceBlockCount: 11,
      unmappedSourceBlockCount: 1,
      highImportanceUnmappedCount: 0,
      eligibleBusinessEvidenceCount: 10,
      eligibleBusinessScopeCount: 3,
      plannedContentEvidenceCount: 8,
      usedPlannedEvidenceCount: 7,
      plannedEvidenceCoverage: { numerator: 7, denominator: 8 },
      stableCoreCoverage: { numerator: 3, denominator: 3 },
      primaryRequirementCoverage: { numerator: 4, denominator: 5 },
      renderedBusinessBulletCount: 7,
      renderedTotalListItemCount: 10,
      renderedProjectCount: 2,
      targetBusinessBulletMin: 6,
      targetBusinessBulletTarget: 8,
      targetBusinessBulletMax: 10,
      outputLengthUnit: 'cjk_characters',
      outputLengthValue: 1320,
      outputLengthSoftMin: 1200,
      outputLengthHardMin: 900,
      outputLengthSoftMax: 1800,
      outputLengthHardMax: 2200,
    },
  }
}

describe('evaluation runner CLI and immutable safety configuration', () => {
  test('uses protocol v10 for ordered repair and partial-shard checkpoint semantics', () => {
    expect(V5_EVALUATION_RUNNER_PROTOCOL_VERSION).toBe('reffo-v5-nonprod-blind-eval-runner-v10')
  })

  test('keeps provider/workflow initialization behind the dry-run return and avoids SQLite persistence', async () => {
    const runnerSource = await readFile(
      resolve(import.meta.dir, '../../../scripts/run-v5-nonprod-nine-case-blind-eval.ts'),
      'utf8'
    )
    expect(runnerSource).not.toMatch(/^import\s+.*@\/providers\/deepseek-provider/m)
    expect(runnerSource).not.toMatch(/^import\s+.*@\/v5\/main\/workflow/m)
    expect(runnerSource).toContain("import('@/providers/deepseek-provider')")
    expect(runnerSource.indexOf('if (args.dryRun) return')).toBeLessThan(
      runnerSource.indexOf("import('@/providers/deepseek-provider')")
    )
    expect(runnerSource).not.toContain('PersistenceSubscriber')
    expect(runnerSource).toContain("resolve(args.outputRoot, 'harness.sqlite')")
    expect(runnerSource).not.toContain("resolve(backendRoot, 'data', 'harness.sqlite')")
    expect(runnerSource).toContain('assertV5EvaluationCandidateDeliverable(v5Result, caseNumber)')
    expect(runnerSource).toContain('assertV5EvaluationCandidateDeliverable(restoredV5Result, caseNumber)')
    expect(runnerSource).toContain('assertV5EvaluationCandidateDeliverable(v5Checkpoint.payload, caseNumber)')
    expect(runnerSource.indexOf('assertV5EvaluationCandidateDeliverable(v5Result, caseNumber)')).toBeLessThan(
      runnerSource.indexOf('runDoubleOrderBlindAb({')
    )
    expect(runnerSource).not.toContain('V5_ABSOLUTE_GATE_FAIL_FAST')
    expect(runnerSource).not.toContain("component: 'P09'")
    expect(runnerSource).not.toContain("component: 'P11'")
    expect(runnerSource).not.toContain("persistence: 'single_process_only'")
    expect(runnerSource).toContain("persistence: 'validated_local_checkpoint_v1'")
    expect(runnerSource).toContain('providerConfigFingerprint: extractionConfigDigest')
    expect(runnerSource).toContain('implementationFingerprint: extractionImplementationDigest')
    expect(runnerSource).toContain('implementationDigest: extractionImplementationDigest')
    expect(runnerSource).toContain("artifactGenerationMode: 'dsl_v1'")
    expect(runnerSource).toContain("interviewMode: 'deferred'")
    expect(runnerSource).not.toContain('V5_RESUME_EXTRACTION_CACHE_LEGACY_VERSION')
    expect(runnerSource).not.toContain('promotable_v1')
    expect(runnerSource).toContain('cacheStatus: extractionCache.status')
    expect(runnerSource).toContain('withinCaseOutputBudget')
    expect(runnerSource).toContain('outputTokenEnvelopeWithTrustedResumeExtractionCache')
    expect(runnerSource).toContain("kind: 'generation_diagnostics'")
    expect(runnerSource).toContain('generationDiagnosticsPath')
    expect(runnerSource).toContain('deliveryDiagnosticsFromError(error)')
    expect(runnerSource).toContain('deliveryDiagnostics,')
    expect(runnerSource).toContain('计划覆盖 n/d')
    expect(runnerSource).toContain('稳定核心 n/d')
    expect(runnerSource).toContain('JD 主要求 n/d')
    expect(runnerSource).toContain('业务 bullet/target')
    expect(runnerSource).toContain('输出长度/边界')
  })

  test('persists generation diagnostics before attempting the P01 cache snapshot', async () => {
    const calls: string[] = []

    const diagnostics = await persistGenerationDiagnosticsBeforeResumeCache({
      persistGenerationDiagnostics: async () => {
        calls.push('generation_diagnostics')
        return { disposition: 'deliverable' }
      },
      persistResumeExtraction: async () => {
        calls.push('resume_extraction_cache')
      },
    })

    expect(calls).toEqual(['generation_diagnostics', 'resume_extraction_cache'])
    expect(diagnostics).toEqual({ disposition: 'deliverable' })
  })

  test('continues fail-fast, drain, cache and failed status when sidecar or cache persistence throws', async () => {
    const calls: string[] = []
    const diagnosticsError = new Error('diagnostics unavailable')
    const cacheError = new Error('cache snapshot unavailable')

    const errors = await finalizeFailedEvaluationCase({
      persistFailureDiagnostics: async () => {
        calls.push('generation_diagnostics')
        throw diagnosticsError
      },
      triggerFailFast: async () => {
        calls.push('fail_fast')
      },
      drainProvider: async () => {
        calls.push('provider_drain')
      },
      persistResumeExtraction: async () => {
        calls.push('resume_extraction_cache')
        throw cacheError
      },
      writeFailedStatus: async () => {
        calls.push('failed_status')
      },
    })

    expect(calls).toEqual([
      'generation_diagnostics',
      'fail_fast',
      'provider_drain',
      'resume_extraction_cache',
      'failed_status',
    ])
    expect(errors.generation_diagnostics).toBe(diagnosticsError)
    expect(errors.resume_extraction_cache).toBe(cacheError)
    expect(errors.failed_status).toBeUndefined()
  })

  test('never lets cleanup or cleanup telemetry replace the primary case failure', async () => {
    const calls: string[] = []
    const primaryError = new Error('primary P01 failure')
    let caught: unknown

    try {
      await finalizeFailedEvaluationCaseAndRethrow({
        primaryError,
        persistFailureDiagnostics: async () => {
          calls.push('generation_diagnostics')
          throw new Error('diagnostics failure')
        },
        triggerFailFast: async () => {
          calls.push('fail_fast')
          throw new Error('fail-fast failure')
        },
        drainProvider: async () => {
          calls.push('provider_drain')
          throw new Error('drain failure')
        },
        persistResumeExtraction: async () => {
          calls.push('resume_extraction_cache')
          throw new Error('cache failure')
        },
        writeFailedStatus: async () => {
          calls.push('failed_status')
          throw new Error('status failure')
        },
        onStageError: async () => {
          await Promise.resolve()
          throw new Error('cleanup telemetry failure')
        },
      })
    } catch (error) {
      caught = error
    }

    expect(calls).toEqual([
      'generation_diagnostics',
      'fail_fast',
      'provider_drain',
      'resume_extraction_cache',
      'failed_status',
    ])
    expect(caught).toBe(primaryError)
  })

  test('suppresses resource cleanup errors only while a primary failure is already propagating', async () => {
    const calls: string[] = []
    const cleanupError = new Error('lock release failure')
    await expect(finalizeEvaluationResources({
      hadPrimaryFailure: true,
      stages: [
        {
          stage: 'run_lock_release',
          action: async () => {
            calls.push('lock')
            throw cleanupError
          },
        },
        {
          stage: 'budget_dispose',
          action: () => { calls.push('budget') },
        },
      ],
      onStageError: async () => {
        await Promise.resolve()
        throw new Error('telemetry failure')
      },
    })).resolves.toBeUndefined()
    expect(calls).toEqual(['lock', 'budget'])

    await expect(finalizeEvaluationResources({
      hadPrimaryFailure: false,
      stages: [{ stage: 'run_lock_release', action: async () => { throw cleanupError } }],
    })).rejects.toBe(cleanupError)
  })

  test('bounds local cleanup and telemetry without skipping later stages', async () => {
    const calls: string[] = []
    const errors = await finalizeFailedEvaluationCase({
      cleanupTimeoutMs: 5,
      persistFailureDiagnostics: () => new Promise(() => {}),
      triggerFailFast: async () => { calls.push('fail_fast') },
      drainProvider: async () => { calls.push('provider_drain') },
      persistResumeExtraction: async () => { calls.push('resume_extraction_cache') },
      writeFailedStatus: async () => { calls.push('failed_status') },
      onStageError: () => new Promise(() => {}),
    })

    expect(calls).toEqual([
      'fail_fast',
      'provider_drain',
      'resume_extraction_cache',
      'failed_status',
    ])
    expect(errors.generation_diagnostics).toMatchObject({
      code: 'EVALUATION_CLEANUP_TIMEOUT',
      stage: 'generation_diagnostics',
    })

    const resourceCalls: string[] = []
    await expect(finalizeEvaluationResources({
      hadPrimaryFailure: true,
      cleanupTimeoutMs: 5,
      stages: [
        { stage: 'resume_extraction_cache_clear', action: () => new Promise(() => {}) },
        { stage: 'budget_dispose', action: () => { resourceCalls.push('budget') } },
      ],
    })).resolves.toBeUndefined()
    expect(resourceCalls).toEqual(['budget'])
  })

  test('serializes failure status without resume text, validation messages or evidence IDs', () => {
    const secret = '真实候选人私密经历与手机号13800138000'
    const error = Object.assign(new Error(secret), {
      code: 'P01_VALIDATION_FAILED',
      issues: [{
        code: 'SOURCE_QUOTE_NOT_FOUND',
        severity: 'error',
        outputPath: 'factCandidates[0]',
        claimId: secret,
        evidenceIds: [secret],
        message: secret,
      }],
      validationIssues: [{ path: 'factCandidates.0', code: 'custom', message: secret }],
      outputAudit: {
        rawOutputDigest: 'a'.repeat(64),
        validatedOutputDigest: 'b'.repeat(64),
        normalizationApplied: true,
        normalizationChanges: [secret],
      },
    })

    const serialized = serializedError(error)
    expect(JSON.stringify(serialized)).not.toContain(secret)
    expect(serialized).toMatchObject({
      code: 'P01_VALIDATION_FAILED',
      issues: [{ code: 'SOURCE_QUOTE_NOT_FOUND', pathCategory: 'fact', severity: 'error', count: 1 }],
      validationIssues: [{ pathCategory: 'fact', code: 'SCHEMA_CUSTOM', severity: 'error', count: 1 }],
      outputAudit: { normalizationChangeCount: 1 },
    })
  })

  test('includes prompt file content in the implementation fingerprint', async () => {
    const root = await temporaryDirectory()
    await mkdir(resolve(root, 'src/v5/prompts'), { recursive: true })
    await mkdir(resolve(root, 'scripts'), { recursive: true })
    await Promise.all([
      writeFile(resolve(root, 'src/index.ts'), 'export {}\n'),
      writeFile(resolve(root, 'src/v5/prompts/P01.md'), 'prompt-a\n'),
      writeFile(resolve(root, 'src/v5/prompts/manifest.json'), '{"P01":"v1"}\n'),
      writeFile(resolve(root, 'scripts/run-v5-nonprod-nine-case-blind-eval.ts'), 'export {}\n'),
      writeFile(resolve(root, 'package.json'), '{}\n'),
      writeFile(resolve(root, 'bun.lock'), ''),
      writeFile(resolve(root, 'tsconfig.json'), '{}\n'),
    ])

    const before = await createImplementationDigest(root)
    await writeFile(resolve(root, 'src/v5/prompts/P01.md'), 'prompt-b\n')
    const after = await createImplementationDigest(root)

    expect(after).not.toBe(before)
  })

  test('isolates the extraction digest from planner/renderer/final-validator changes', async () => {
    const root = await temporaryDirectory()
    for (const relativePath of V5_EXTRACTION_IMPLEMENTATION_SOURCE_FILES) {
      const path = resolve(root, relativePath)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${relativePath}:v1\n`)
    }
    for (const selector of V5_EXTRACTION_IMPLEMENTATION_SOURCE_FRAGMENTS) {
      const path = resolve(root, selector.path)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `downstream-before\n${selector.start}p01-v1\n${selector.end}downstream-after\n`)
    }
    await mkdir(resolve(root, 'src/v5/prompts'), { recursive: true })
    await writeFile(resolve(root, 'src/v5/prompts/P01.md'), 'p01-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/P01R.md'), 'p01r-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/core.md'), 'core-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/core-extraction.md'), 'core-extraction-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/output.md'), 'output-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/manifest.json'), JSON.stringify({
      components: {
        P01: 'p01-v1',
        P01R: 'p01r-v1',
        P06: 'p06-v1',
      },
    }))
    await writeFile(resolve(root, 'bun.lock'), [
      '"openai": ["openai@4.104.0", ""]',
      '"zod": ["zod@3.25.76", ""]',
    ].join('\n'))

    const baseline = await createExtractionImplementationDigest(root)
    await writeFile(resolve(root, 'src/v5/prompts/core-extraction.md'), 'core-extraction-v2\n')
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/prompts/core-extraction.md'), 'core-extraction-v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/core.md'), 'downstream-core-v2\n')
    expect(await createExtractionImplementationDigest(root)).toBe(baseline)
    await mkdir(resolve(root, 'src/v5'), { recursive: true })
    await writeFile(resolve(root, 'src/v5/adaptive-policy.ts'), 'planner-v2\n')
    await writeFile(resolve(root, 'src/v5/safe-renderer.ts'), 'renderer-v2\n')
    await writeFile(resolve(root, 'src/v5/validators.ts'), 'final-validator-v2\n')
    expect(await createExtractionImplementationDigest(root)).toBe(baseline)

    const workflowSelector = V5_EXTRACTION_IMPLEMENTATION_SOURCE_FRAGMENTS[0]
    const workflowPath = resolve(root, workflowSelector.path)
    await writeFile(
      workflowPath,
      `changed-downstream-before\n${workflowSelector.start}p01-v1\n${workflowSelector.end}changed-downstream-after\n`
    )
    expect(await createExtractionImplementationDigest(root)).toBe(baseline)
    await writeFile(
      workflowPath,
      `changed-downstream-before\n${workflowSelector.start}p01-v2\n${workflowSelector.end}changed-downstream-after\n`
    )
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(
      workflowPath,
      `changed-downstream-before\n${workflowSelector.start}p01-v1\n${workflowSelector.end}changed-downstream-after\n`
    )

    await writeFile(resolve(root, 'src/v5/prompts/manifest.json'), JSON.stringify({
      components: {
        P01: 'p01-v1',
        P01R: 'p01r-v1',
        P06: 'p06-v2',
      },
    }))
    expect(await createExtractionImplementationDigest(root)).toBe(baseline)

    for (const relativePath of ['src/v5/composition/source-continuation.ts', 'src/v5/composition/source-continuation-proof.ts']) {
      expect(V5_EXTRACTION_IMPLEMENTATION_SOURCE_FILES as readonly string[]).toContain(relativePath)
      await writeFile(resolve(root, relativePath), 'source-boundary-proof-v2\n')
      expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
      await writeFile(resolve(root, relativePath), `${relativePath}:v1\n`)
      expect(await createExtractionImplementationDigest(root)).toBe(baseline)
    }

    await writeFile(resolve(root, 'src/v5/chunked-resume-extraction.ts'), 'chunk-plan-v2\n')
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/chunked-resume-extraction.ts'), 'src/v5/chunked-resume-extraction.ts:v1\n')
    await writeFile(resolve(root, 'src/v5/prompts/P01.md'), 'p01-v2\n')
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/prompts/P01.md'), 'p01-v1\n')
    await writeFile(resolve(root, 'src/v5/evidence.ts'), 'extraction-validator-v2\n')
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/evidence.ts'), 'src/v5/evidence.ts:v1\n')
    await writeFile(resolve(root, 'src/v5/schemas.ts'), 'extraction-schema-v2\n')
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/schemas.ts'), 'src/v5/schemas.ts:v1\n')
    await writeFile(resolve(root, 'src/v5/types.ts'), "export const V5_WORKFLOW_VERSION = 'changed'\n")
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
    await writeFile(resolve(root, 'src/v5/types.ts'), 'src/v5/types.ts:v1\n')
    await writeFile(
      workflowPath,
      `changed-downstream-before\n${workflowSelector.start}envelope-v2\n${workflowSelector.end}changed-downstream-after\n`
    )
    expect(await createExtractionImplementationDigest(root)).not.toBe(baseline)
  })

  test('defaults to a case-2 dry-run-safe canary selection', () => {
    const parsed = parseEvaluationRunnerArgs([], {
      backendRoot: '/repo/backend',
      now: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(parsed.selectedCases).toEqual([2])
    expect(parsed.dryRun).toBe(true)
    expect(parsed.live).toBe(false)
    expect(parsed.failFast).toBe(true)
    expect(parsed.resume).toBe(false)
    expect(parsed.outputRoot).toContain('v5-nonprod-nine-safe-2026-09-01T00-00-00-000Z')
  })

  test('parses sorted unique case lists and ranges', () => {
    const parsed = parseEvaluationRunnerArgs(['--cases', '3,1-2,2,9', '--dry-run', '--fail-fast'], {
      backendRoot: '/repo/backend',
    })
    expect(parsed.selectedCases).toEqual([1, 2, 3, 9])
    expect(parsed.dryRun).toBe(true)
  })

  test('rejects invalid cases, unknown flags and implicit resume directories', () => {
    expect(() => parseEvaluationRunnerArgs(['--cases', '0'], { backendRoot: '/repo/backend' }))
      .toThrow(EvaluationRunnerSafetyError)
    expect(() => parseEvaluationRunnerArgs(['--unknown'], { backendRoot: '/repo/backend' }))
      .toThrow('未知参数')
    expect(() => parseEvaluationRunnerArgs(['--resume'], { backendRoot: '/repo/backend' }))
      .toThrow('--resume 必须同时提供明确的 --output')
    expect(() => parseEvaluationRunnerArgs(['--live'], { backendRoot: '/repo/backend' }))
      .toThrow('--live 必须提供明确的全新或恢复 --output')
    expect(() => parseEvaluationRunnerArgs(['--live', '--dry-run', '--output', '/tmp/run'], { backendRoot: '/repo/backend' }))
      .toThrow('--live 与 --dry-run 不能同时使用')
  })

  test('requires an explicit output directory before enabling live mode', () => {
    const parsed = parseEvaluationRunnerArgs(['--live', '--output', '/tmp/reffo-explicit-run'], {
      backendRoot: '/repo/backend',
    })
    expect(parsed.live).toBe(true)
    expect(parsed.dryRun).toBe(false)
    expect(parsed.outputWasExplicit).toBe(true)
  })

  test('fails closed for extract-only live but allows source-bound judge-only live', () => {
    expect(() => parseEvaluationRunnerArgs([
      '--stage', 'extract-only', '--live', '--output', '/tmp/reffo-extract-run',
    ], { backendRoot: '/repo/backend' })).toThrow('extract-only 尚未实现独立检查点路由')
    const judgeLive = parseEvaluationRunnerArgs([
      '--stage', 'judge-only', '--source-run', '/tmp/reffo-generation-run',
      '--live', '--output', '/tmp/reffo-judge-run',
    ], { backendRoot: '/repo/backend' })
    expect(judgeLive.live).toBe(true)
    expect(judgeLive.stage).toBe('judge-only')
    expect(judgeLive.sourceRun).toBe('/tmp/reffo-generation-run')

    const extractionDryRun = parseEvaluationRunnerArgs([
      '--stage', 'extract-only', '--dry-run',
    ], { backendRoot: '/repo/backend' })
    expect(extractionDryRun.dryRun).toBe(true)
    expect(extractionDryRun.stage).toBe('extract-only')

    const judgeDryRun = parseEvaluationRunnerArgs([
      '--stage', 'judge-only', '--source-run', '/tmp/reffo-generation-run', '--dry-run',
    ], { backendRoot: '/repo/backend' })
    expect(judgeDryRun.dryRun).toBe(true)
    expect(judgeDryRun.stage).toBe('judge-only')
  })

  test('uses exact mandatory canary, full-run and per-case limits', () => {
    expect(budgetProfileForCases([2])).toEqual({
      name: 'case_2_canary',
      runLimits: CASE_2_CANARY_LIMITS,
      caseLimits: CASE_2_CANARY_LIMITS,
    })
    expect(budgetProfileForCases([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({
      name: 'bounded_batch',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    })
    expect(budgetProfileForCases([3], 'full', {
      requiredPhysicalCalls: 25,
      resumeChunks: 14,
      estimatedOutputTokens: 315_560,
    })).toEqual({
      name: 'detailed_resume_single_case',
      runLimits: DETAILED_RESUME_SINGLE_CASE_LIMITS,
      caseLimits: DETAILED_RESUME_SINGLE_CASE_LIMITS,
    })
    expect(DETAILED_RESUME_SINGLE_CASE_LIMITS).toEqual({
      maxPhysicalCalls: 28,
      maxInputTokens: 450_000,
      maxOutputTokens: 350_000,
      maxWallTimeMs: 15 * 60_000,
    })
    expect(budgetProfileForCases([3], 'full', { resumeChunks: 14 }).name)
      .toBe('detailed_resume_single_case')
    expect(v5CaseOutputTokenEnvelope(17).totalTokens)
      .toBeGreaterThan(DETAILED_RESUME_SINGLE_CASE_LIMITS.maxOutputTokens)
    expect(budgetProfileForCases([3], 'judge-only', { resumeChunks: 14 })).toEqual({
      name: 'single_case_judge_only',
      runLimits: {
        maxPhysicalCalls: 2,
        maxInputTokens: 150_000,
        maxOutputTokens: 20_000,
        maxWallTimeMs: 5 * 60_000,
      },
      caseLimits: {
        maxPhysicalCalls: 2,
        maxInputTokens: 150_000,
        maxOutputTokens: 20_000,
        maxWallTimeMs: 5 * 60_000,
      },
    })
  })

  test('keeps the default three-chunk case-2 dry-run within canary budgets', () => {
    const fullEnvelope = v5CaseOutputTokenEnvelope(3, 'full')
    const fullProfile = budgetProfileForCases([2], 'full', {
      requiredPhysicalCalls: v5CasePhysicalCallUpperBound(3, 'full'),
      resumeChunks: 3,
      estimatedOutputTokens: fullEnvelope.totalTokens,
    })
    expect(fullProfile.name).toBe('case_2_canary')
    expect(fullEnvelope.totalTokens).toBe(121_060)
    expect(fullEnvelope.totalTokens).toBeLessThanOrEqual(fullProfile.caseLimits.maxOutputTokens)

    const extractEnvelope = v5CaseOutputTokenEnvelope(3, 'extract-only')
    const extractProfile = budgetProfileForCases([2], 'extract-only', {
      requiredPhysicalCalls: v5CasePhysicalCallUpperBound(3, 'extract-only'),
      resumeChunks: 3,
      estimatedOutputTokens: extractEnvelope.totalTokens,
    })
    expect(extractProfile.name).toBe('case_2_extract_canary')
    expect(extractEnvelope.totalTokens).toBe(77_500)
    expect(extractEnvelope.totalTokens).toBeLessThanOrEqual(extractProfile.caseLimits.maxOutputTokens)
  })

  test('budgets primary shards plus the source-sized half-shard repair ceiling', () => {
    expect(v5CasePhysicalCallUpperBound(2)).toBe(11)
    expect(v5CasePhysicalCallUpperBound(2, 'generation-only')).toBe(9)
    expect(v5CasePhysicalCallUpperBound(9)).toBe(22)
    expect(v5CasePhysicalCallUpperBound(9, 'generation-only')).toBe(20)
    expect(v5CasePhysicalCallUpperBound(14)).toBe(29)
    expect(v5CasePhysicalCallUpperBound(14, 'generation-only')).toBe(27)
    expect(v5CasePhysicalCallUpperBound(3, 'extract-only')).toBe(5)
    expect(v5CasePhysicalCallUpperBound(3, 'judge-only')).toBe(2)
    expect(() => v5CasePhysicalCallUpperBound(0)).toThrow('resumeChunks 必须是正安全整数')
  })

  test('derives stage-specific component quotas from the same bounded topology', () => {
    expect(v5EvaluationComponentQuotas(14, 'generation-only')).toEqual({
      P01: 14,
      P01R: 7,
      P02: 1,
      P02R: 1,
      P03: 1,
      P03R: 1,
      P04: 1,
      P06D: 1,
    })
    expect(v5EvaluationComponentQuotas(14, 'full')).toEqual({
      P01: 14,
      P01R: 7,
      P02: 1,
      P02R: 1,
      P03: 1,
      P03R: 1,
      P04: 1,
      P06D: 1,
      P12: 2,
    })
    expect(v5EvaluationComponentQuotas(14, 'judge-only')).toEqual({ P12: 2 })
    expect(v5EvaluationComponentQuotas(2, 'extract-only')).toEqual({ P01: 2, P01R: 1 })
  })

  test('estimates detailed-resume output before provider initialization', () => {
    expect(v5CaseOutputTokenEnvelope(14)).toEqual({
      resumeChunks: 14,
      primaryExtractionTokens: 217_000,
      repairCalls: 7,
      repairExtractionTokens: 108_500,
      generationNonExtractionTokens: 31_560,
      judgeTokens: 12_000,
      nonExtractionTokens: 43_560,
      totalTokens: 369_060,
    })
    expect(v5CaseOutputTokenEnvelope(14, 'generation-only').totalTokens).toBe(357_060)
    expect(v5CaseOutputTokenEnvelope(14, 'extract-only').totalTokens).toBe(325_500)
    expect(v5CaseOutputTokenEnvelope(14, 'judge-only').totalTokens).toBe(12_000)
    expect(v5CaseOutputTokenEnvelope(17).totalTokens).toBe(446_560)
    expect(v5CaseOutputTokenEnvelope(2).repairCalls).toBe(1)
    expect(() => v5CaseOutputTokenEnvelope(0)).toThrow('resumeChunks 必须是正安全整数')
  })

  test('keeps a privacy-safe case3-density extraction plan inside the detailed-run budget', () => {
    const sourceLines = [
      ...Array.from({ length: 211 }, (_, index) => `短事实 ${index}`),
      ...Array.from({ length: 43 }, (_, index) => `事实 ${index}；独立补充 ${index}`),
      ...Array.from({ length: 16 }, (_, index) => `事实 ${index}；独立补充 ${index}；独立结果 ${index}`),
    ]
    const document = canonicalizeSourceDocument(
      sourceLines.join('\n'),
      'synthetic-case3-density'
    ).canonicalDocument
    const chunks = splitResumeDocument(document)
    const generationEnvelope = v5CaseOutputTokenEnvelope(chunks.length, 'generation-only', {
      shardOutputTokenCaps: chunks.map(chunk => resumeExtractionOutputTokenCapForBlocks(chunk.blocks)),
    })

    expect(document.blocks).toHaveLength(270)
    expect(resumeExtractionFactCandidateLimit(document.blocks)).toBe(345)
    expect(chunks.length).toBeLessThanOrEqual(15)
    expect(generationEnvelope.totalTokens).toBeLessThanOrEqual(FULL_CASE_LIMITS.maxOutputTokens)
    expect(v5CasePhysicalCallUpperBound(chunks.length, 'generation-only'))
      .toBeLessThanOrEqual(FULL_CASE_LIMITS.maxPhysicalCalls)
  })

  test('covers the frozen nine-case unique-resume envelope without increasing call caps', () => {
    const uniqueResumeExtraction = [2, 3, 14, 3]
      .map(chunks => v5CaseOutputTokenEnvelope(chunks, 'extract-only').totalTokens)
      .reduce((sum, tokens) => sum + tokens, 0)
    const perCaseDownstream = v5CaseOutputTokenEnvelope(1).nonExtractionTokens
    const frozenNineCaseEnvelope = uniqueResumeExtraction + perCaseDownstream * 9

    expect(perCaseDownstream).toBe(43_560)
    expect(frozenNineCaseEnvelope).toBe(919_040)
    expect(frozenNineCaseEnvelope).toBeLessThanOrEqual(FULL_RUN_LIMITS.maxOutputTokens)
    expect(v5CasePhysicalCallUpperBound(14, 'full')).toBeGreaterThan(FULL_CASE_LIMITS.maxPhysicalCalls)
    expect(v5CaseOutputTokenEnvelope(17).totalTokens).toBeGreaterThan(FULL_CASE_LIMITS.maxOutputTokens)
    expect(FULL_RUN_LIMITS.maxPhysicalCalls).toBe(110)
    expect(FULL_CASE_LIMITS.maxPhysicalCalls).toBe(28)
  })

  test('derives the P01 envelope from the prompt compiler hard caps', () => {
    const envelope = v5CaseOutputTokenEnvelope(1, 'extract-only')
    expect(envelope.primaryExtractionTokens).toBe(V5_PROMPT_MAX_OUTPUT_TOKENS.P01)
    expect(envelope.repairExtractionTokens).toBe(V5_PROMPT_MAX_OUTPUT_TOKENS.P01R)
  })

  test('reserves the largest possible repairs and skips only validated cached shard indexes', () => {
    const shape = { shardOutputTokenCaps: [14_400, 15_500, 14_700, 14_400] }
    const envelope = v5CaseOutputTokenEnvelope(4, 'extract-only', shape)
    expect(envelope.primaryExtractionTokens).toBe(59_000)
    expect(envelope.repairExtractionTokens).toBe(30_200)
    const partial = { ...shape, validatedShardIndexes: [1, 3] }
    expect(v5CaseOutputTokenEnvelope(4, 'extract-only', partial).totalTokens).toBe(58_200)
    expect(v5EvaluationComponentQuotas(4, 'extract-only', partial)).toEqual({ P01: 2, P01R: 2 })
    expect(v5CasePhysicalCallUpperBound(4, 'generation-only', partial)).toBe(10)
    expect(v5EvaluationComponentQuotas(4, 'extract-only', { validatedShardIndexes: [0, 1, 2, 3] })).toEqual({})
    expect(() => v5CaseOutputTokenEnvelope(4, 'full', { validatedShardIndexes: [0, 0] })).toThrow('P01 预算分片或缓存索引无效')
    expect(() => v5CaseOutputTokenEnvelope(4, 'full', { shardOutputTokenCaps: [14_400] })).toThrow('P01 预算分片或缓存索引无效')
    expect(() => v5CaseOutputTokenEnvelope(4, 'full', { validatedShardIndexes: [4] })).toThrow('P01 预算分片或缓存索引无效')
  })

  test('derives every downstream envelope from the prompt compiler hard caps', () => {
    const cachedFull = v5CaseOutputTokenEnvelope(1)
    expect(cachedFull.generationNonExtractionTokens).toBe(
      V5_PROMPT_MAX_OUTPUT_TOKENS.P02 * 2
      + V5_PROMPT_MAX_OUTPUT_TOKENS.P03 * 2
      + V5_PROMPT_MAX_OUTPUT_TOKENS.P04
      + V5_PROMPT_MAX_OUTPUT_TOKENS.P06D
    )
    expect(cachedFull.judgeTokens).toBe(V5_PROMPT_MAX_OUTPUT_TOKENS.P12 * 2)
  })

  test('admits only clean model artifacts through the evaluation code gate', () => {
    const base = createV5ResultFixture()
    expect(isV5CodeGateDeliverable(base)).toBe(true)
    const repaired = structuredClone(base)
    repaired.generationProvenance.artifactOrigin = 'model_repair'
    repaired.deliveryDiagnostics.provenance.artifactOrigin = 'model_repair'
    expect(isV5CodeGateDeliverable(repaired)).toBe(true)
    const compiled = structuredClone(base)
    compiled.generationProvenance.artifactOrigin = 'server_compiler'
    compiled.deliveryDiagnostics.provenance.artifactOrigin = 'server_compiler'
    expect(isV5CodeGateDeliverable(compiled)).toBe(true)
    expect(isV5CodeGateDeliverable({
      ...base,
      qualityGates: { ...base.qualityGates, factSafety: 'fail' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      qualityGates: { ...base.qualityGates, contentCompleteness: 'fail' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, deliveryDecision: 'block' })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, deliveryDecision: 'internal_only' })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, executionStatus: 'failed' })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, state: 'blocked_quality_validation' })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, usedSafeFallback: true })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      generationProvenance: { artifactOrigin: 'server_renderer' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      qualityGates: { ...base.qualityGates, deliverability: 'review_required' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      qualityGates: { ...base.qualityGates, deliverability: 'fail' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      qualityGates: { ...base.qualityGates, deliverability: 'not_run' },
    })).toBe(false)
    expect(isV5CodeGateDeliverable({ ...base, deliveryDiagnostics: undefined })).toBe(false)
    expect(isV5CodeGateDeliverable({
      ...base,
      deliveryDiagnostics: {
        ...base.deliveryDiagnostics,
        outcome: { ...base.deliveryDiagnostics.outcome, disposition: 'review_required' },
      },
    })).toBe(false)
  })

  test('accepts only the exact HTTPS DeepSeek host', () => {
    expect(assertStrictDeepSeekEndpoint(undefined)).toBe('https://api.deepseek.com')
    expect(assertStrictDeepSeekEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
    for (const unsafe of [
      'http://api.deepseek.com',
      'https://api.deepseek.com.evil.example',
      'https://user@api.deepseek.com',
      'https://api.deepseek.com:8443',
      'https://api.deepseek.com/v1',
      'https://api.deepseek.com/?proxy=true',
      'https://api.deepseek.com/#fragment',
    ]) {
      expect(() => assertStrictDeepSeekEndpoint(unsafe)).toThrow(EvaluationRunnerSafetyError)
    }
  })

  test('blocks cross-process replay when a completed case owned the same extraction', () => {
    const completedResumeDigests = new Set(['same-resume'])
    expect(() => assertResumeExtractionReplaySafe({
      resume: true,
      hasV5Checkpoint: false,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).toThrow(EvaluationRunnerSafetyError)
    expect(() => assertResumeExtractionReplaySafe({
      resume: true,
      hasV5Checkpoint: true,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).not.toThrow()
    expect(() => assertResumeExtractionReplaySafe({
      resume: true,
      hasV5Checkpoint: false,
      hasTrustedExtractionCheckpoint: true,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).not.toThrow()
    expect(() => assertResumeExtractionReplaySafe({
      resume: false,
      hasV5Checkpoint: false,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).not.toThrow()
  })
})

describe('evaluation runner output and checkpoint protection', () => {
  test('atomically merges validated partial progress and restores it with private file permissions', async () => {
    const root = await temporaryDirectory()
    const document = canonicalizeSourceDocument('技能：SQL\n技能：Python\n技能：Excel\n技能：Figma').canonicalDocument
    const cacheOptions = {
      implementationFingerprint: 'partial-implementation',
      providerConfigFingerprint: 'partial-provider',
      chunkMaxBlocks: 2,
    }
    const binding = fingerprints({ inputDigest: document.sha256 })
    const snapshots: TrustedResumeExtractionPartialSnapshot[] = []
    for (const index of [1, 0]) {
      const cache = createTrustedResumeExtractionCache(cacheOptions)
      await expect(cache.resolve(document, async context => {
        const chunk = context.chunks[index]
        const candidate = structuredClone(createResumeFixture().candidate)
        const baseFact = structuredClone(candidate.factCandidates[3])
        candidate.identityCandidates = []
        candidate.timelineCandidates = []
        candidate.sectionCandidates = []
        candidate.factCandidates = chunk.blocks.map((block, factIndex) => ({
          ...baseFact, factLocalId: `skill${factIndex}`, sourceBlockId: block.sourceBlockId,
          blockRelativeSpan: { start: 0, end: block.text.length },
          verbatimText: block.text, normalizedClaim: block.text,
        }))
        candidate.coverageClaim = { mappedSourceBlockIds: chunk.blocks.map(block => block.sourceBlockId), unmappedSourceBlockIds: [] }
        await context.storeValidatedShard!(index, candidate)
        throw new Error('synthetic interruption')
      })).rejects.toThrow('synthetic interruption')
      const snapshot = cache.partialSnapshot(document)!
      snapshots.push(snapshot)
      await persistPartialExtractionCheckpoint({ root, snapshot, document, cacheOptions, fingerprints: binding })
    }
    const path = resolve(root, `${snapshots[0].cacheKey}.partial.json`)
    const restored = await readCheckpoint<TrustedResumeExtractionPartialSnapshot>({
      path, kind: 'resume_extraction_partial', caseId: `resume-${document.sha256}`, fingerprints: binding,
    })
    const resumed = createTrustedResumeExtractionCache(cacheOptions)
    resumed.hydratePartial(document, restored!.payload)
    expect(resumed.progress(document)).toMatchObject({ validatedShardIndices: [0, 1], missingShardIndices: [], complete: false })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    // A stale callback cannot overwrite newer progress.
    await persistPartialExtractionCheckpoint({ root, snapshot: snapshots[0], document, cacheOptions, fingerprints: binding })
    const after = await readCheckpoint<TrustedResumeExtractionPartialSnapshot>({
      path, kind: 'resume_extraction_partial', caseId: `resume-${document.sha256}`, fingerprints: binding,
    })
    expect(after!.payload.shards.map(shard => shard.index)).toEqual([0, 1])
    await expect(readCheckpoint({ path, kind: 'resume_extraction_partial', caseId: `resume-${document.sha256}`, fingerprints: fingerprints() }))
      .rejects.toThrow()
  })
  test('projects diagnostics onto a message-free, source-free sidecar schema', () => {
    const expected = deliveryDiagnostics()
    const unsafe = {
      ...expected,
      message: '不应进入 sidecar 的错误消息',
      resumeMarkdown: '不应进入 sidecar 的源简历',
      outcome: {
        ...expected.outcome,
        message: '不应进入 sidecar 的门禁消息',
      },
      metrics: {
        ...expected.metrics!,
        sourceText: '不应进入 sidecar 的原文',
      },
    }

    const sanitized = sanitizeV5DeliveryDiagnostics(unsafe)
    expect(sanitized).toEqual(expected)
    const serialized = JSON.stringify(sanitized)
    expect(serialized).not.toContain('错误消息')
    expect(serialized).not.toContain('源简历')
    expect(serialized).not.toContain('门禁消息')
    expect(serialized).not.toContain('原文')
  })

  test('accepts deferred diagnostics and remains backward compatible with failed_optional', () => {
    const current = deliveryDiagnostics()
    expect(sanitizeV5DeliveryDiagnostics(current).provenance.interview).toBe('deferred')

    const historical = structuredClone(current)
    historical.provenance.interview = 'failed_optional'
    expect(sanitizeV5DeliveryDiagnostics(historical).provenance.interview).toBe('failed_optional')
  })

  test('rejects invalid diagnostic codes, ratios and versions', () => {
    const invalidCode = deliveryDiagnostics()
    invalidCode.outcome.decisionReasonCodes = ['source text must not be stored']
    expect(() => sanitizeV5DeliveryDiagnostics(invalidCode)).toThrow('生成诊断结构无效')

    const invalidRatio = deliveryDiagnostics()
    invalidRatio.metrics!.plannedEvidenceCoverage = { numerator: 9, denominator: 8 }
    expect(() => sanitizeV5DeliveryDiagnostics(invalidRatio)).toThrow('生成诊断结构无效')

    expect(() => sanitizeV5DeliveryDiagnostics({
      ...deliveryDiagnostics(),
      version: 'v5-delivery-diagnostics-v1',
    })).toThrow('生成诊断结构无效')
  })

  test('atomically locks one live writer and requires manual stale-lock handling', async () => {
    const path = resolve(await temporaryDirectory(), 'new-run')
    const first = await acquireEvaluationRunLock({ outputRoot: path, resume: false })
    await expect(acquireEvaluationRunLock({ outputRoot: path, resume: true })).rejects.toMatchObject({
      code: 'RUN_LOCK_HELD',
    })
    await first.release()
    const resumed = await acquireEvaluationRunLock({ outputRoot: path, resume: true })
    await resumed.release()
  })

  test('refuses a non-empty output directory unless resume is explicit', async () => {
    const path = await temporaryDirectory()
    await assertOutputDirectoryPolicy(path, false)
    await writeFile(resolve(path, 'existing.json'), '{}')
    await expect(assertOutputDirectoryPolicy(path, false)).rejects.toMatchObject({
      code: 'OUTPUT_DIRECTORY_NOT_EMPTY',
    })
    await expect(assertOutputDirectoryPolicy(path, true)).resolves.toBeUndefined()
  })

  test('round-trips a versioned atomic checkpoint and verifies every fingerprint', async () => {
    const path = resolve(await temporaryDirectory(), 'checkpoint.json')
    const expected = fingerprints()
    await writeCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { result: 'ok' },
    })
    const loaded = await readCheckpoint<{ result: string }>({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
    })
    expect(loaded?.payload).toEqual({ result: 'ok' })
    await expect(writeCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { result: 'replacement' },
    })).rejects.toMatchObject({ code: 'CHECKPOINT_ALREADY_EXISTS' })
    await expect(readCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: fingerprints({ implementationDigest: 'd'.repeat(64) }),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_FINGERPRINT_MISMATCH' })
  })

  test('round-trips a generation diagnostics checkpoint without resume or JD text', async () => {
    const path = resolve(await temporaryDirectory(), 'generation-diagnostics.json')
    const expectedFingerprints = fingerprints()
    const payload = sanitizeV5DeliveryDiagnostics(deliveryDiagnostics())
    await writeCheckpoint({
      path,
      kind: 'generation_diagnostics',
      caseId: 'case-03',
      fingerprints: expectedFingerprints,
      payload,
    })

    const loaded = await readCheckpoint<V5DeliveryDiagnostics>({
      path,
      kind: 'generation_diagnostics',
      caseId: 'case-03',
      fingerprints: expectedFingerprints,
    })
    expect(loaded?.payload).toEqual(payload)
    expect(await readFile(path, 'utf8')).not.toContain('resumeMarkdown')
    expect(await readFile(path, 'utf8')).not.toContain('jobDescription')
  })

  test('rejects legacy raw JSON, corrupt JSON and payload tampering', async () => {
    const directory = await temporaryDirectory()
    const expected = fingerprints()
    const read = (path: string) => readCheckpoint({
      path,
      kind: 'blind_ab',
      caseId: 'case-02',
      fingerprints: expected,
    })

    const legacyPath = resolve(directory, 'legacy.json')
    await writeFile(legacyPath, JSON.stringify({ forward: {}, reverse: {} }))
    await expect(read(legacyPath)).rejects.toMatchObject({ code: 'CHECKPOINT_LEGACY_OR_INVALID' })

    const corruptPath = resolve(directory, 'corrupt.json')
    await writeFile(corruptPath, '{broken')
    await expect(read(corruptPath)).rejects.toMatchObject({ code: 'CHECKPOINT_CORRUPT' })

    const tamperedPath = resolve(directory, 'tampered.json')
    await writeCheckpoint({
      path: tamperedPath,
      kind: 'blind_ab',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { ok: true },
    })
    const envelope = JSON.parse(await readFile(tamperedPath, 'utf8'))
    envelope.payload.ok = false
    await writeFile(tamperedPath, JSON.stringify(envelope))
    await expect(read(tamperedPath)).rejects.toMatchObject({ code: 'CHECKPOINT_PAYLOAD_DIGEST_MISMATCH' })
  })
})

describe('BudgetedEvaluationProvider', () => {
  test('accounts reasoning inside completion totals even when the response is truncated', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({ runId: 'thinking-total-test',
      runLimits: FULL_RUN_LIMITS, caseLimits: FULL_CASE_LIMITS }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({ budget, caseId: 'case-03', model: 'deepseek-v4-flash',
      componentQuotas: v5EvaluationComponentQuotas(1, 'generation-only'),
      usageSink: async entry => { usage.push(entry) },
      directProvider: { complete: async () => ({ provider: 'deepseek', model: 'deepseek-v4-flash-0731', content: '',
        latencyMs: 1, inputTokens: 30, outputTokens: 100, reasoningTokens: 100, finishReason: 'length' }) },
    })
    const response = await provider.complete(request())
    expect(response.finishReason).toBe('length')
    expect(budget.snapshot().run.usage).toMatchObject({ settledInputTokens: 30, settledOutputTokens: 100, pendingOutputTokens: 0 })
    expect(usage[0]).toMatchObject({ requestedModel: 'deepseek-v4-flash', model: 'deepseek-v4-flash-0731',
      outputTokens: 100, reasoningTokens: 100, finishReason: 'length' })
    budget.dispose()
  })

  test('adds a bounded safety margin to the compiler estimate instead of counting UTF-8 bytes', () => {
    const messages: ChatCompletionInput['messages'] = [
      { role: 'system', content: '只依据证据判断。'.repeat(2_000) },
      { role: 'user', content: JSON.stringify({ candidate: '产品经理'.repeat(4_000) }) },
    ]
    const providerEstimate = estimateProviderInputTokens({
      messages,
      structuredOutput: { name: 'test', schema: {} as never, strict: true },
    })

    const compilerEstimate = estimateV5PromptInputTokens(messages)
    expect(providerEstimate).toBe(
      Math.ceil(compilerEstimate * V5_EVALUATION_INPUT_TOKEN_SAFETY_MULTIPLIER)
      + V5_EVALUATION_INPUT_TOKEN_FRAMING_ALLOWANCE
    )
    expect(providerEstimate).toBeGreaterThan(compilerEstimate)
    expect(providerEstimate).toBeLessThan(Buffer.byteLength(JSON.stringify(messages), 'utf8'))
  })

  test('blocks components outside the current stage before reserving any budget', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-component-block-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let directCalls = 0
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async () => {
          directCalls += 1
          throw new Error('must not run')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: v5EvaluationComponentQuotas(2, 'generation-only'),
      usageSink: async () => {},
    })

    await expect(provider.complete(request({ promptVersion: '5.0.0-p08-test' }))).rejects.toMatchObject({
      code: 'COMPONENT_CALL_BLOCKED',
    })
    expect(directCalls).toBe(0)
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(0)
    budget.dispose()
  })

  test('restores component attempts from the journal and enforces the exact quota', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-component-restore-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let directCalls = 0
    const directProvider: LlmProvider = {
      complete: async () => {
        directCalls += 1
        return {
          provider: 'deepseek',
          model: 'deepseek-chat',
          content: '{}',
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
        }
      },
    }
    const input = {
      directProvider,
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: { P01: 1 } as const,
      usageSink: async (_entry: EvaluationUsageEntry) => {},
    }
    const firstProcessProvider = new BudgetedEvaluationProvider(input)
    await expect(firstProcessProvider.complete(request())).resolves.toMatchObject({ content: '{}' })

    const restoredProcessProvider = new BudgetedEvaluationProvider(input)
    await expect(restoredProcessProvider.complete(request())).rejects.toMatchObject({
      code: 'COMPONENT_CALL_QUOTA_EXCEEDED',
    })
    expect(directCalls).toBe(1)
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(1)
    budget.dispose()
  })

  test('restores historical P01 usage with a complete cache and only continues the pending judge', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'restore-after-generation', runLimits: FULL_RUN_LIMITS, caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const calls: string[] = []
    const shared = {
      directProvider: { complete: async (input: ChatCompletionInput) => {
        calls.push(input.promptVersion!)
        return { provider: 'deepseek', model: 'deepseek-chat', content: '{}', latencyMs: 1, inputTokens: 1, outputTokens: 1 }
      } },
      budget, caseId: 'case-02', model: 'deepseek-chat', usageSink: async () => {},
    }
    try {
      const original = new BudgetedEvaluationProvider({ ...shared,
        componentQuotas: providerComponentQuotasForRun({ resume: false, resumeChunks: 2, stage: 'full', validatedShardIndexes: [] }),
      })
      await original.complete(request())
      const resumed = new BudgetedEvaluationProvider({ ...shared,
        componentQuotas: providerComponentQuotasForRun({ resume: true, resumeChunks: 2, stage: 'full', validatedShardIndexes: [0, 1] }),
      })
      await resumed.complete(request({ promptVersion: '5.0.0-p12-test' }))
      expect(calls).toEqual(['5.0.0-p01-test', '5.0.0-p12-test'])
      const newRunQuotas = providerComponentQuotasForRun({ resume: false, resumeChunks: 2, stage: 'full', validatedShardIndexes: [0, 1] })
      expect(newRunQuotas.P01).toBeUndefined()
      expect(newRunQuotas.P01R).toBeUndefined()
    } finally { budget.dispose() }
  })

  test('reserves before the one direct attempt and propagates a shared abort signal', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let calls = 0
    const directProvider: LlmProvider = {
      complete: async input => {
        calls += 1
        expect(budget.snapshot().run.usage.physicalAttempts).toBe(1)
        expect(input.maxProviderAttempts).toBe(1)
        expect(input.model).toBe('deepseek-chat')
        expect(input.signal).toBeInstanceOf(AbortSignal)
        return {
          provider: 'deepseek',
          model: 'deepseek-chat',
          content: '{}',
          latencyMs: 12,
          inputTokens: 20,
          outputTokens: 5,
        }
      },
    }
    const provider = new BudgetedEvaluationProvider({
      directProvider,
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).resolves.toMatchObject({ content: '{}' })
    expect(calls).toBe(1)
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 1,
      settledInputTokens: 20,
      settledOutputTokens: 5,
    })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ outcome: 'success', caseId: 'case-02', finishReason: null })
    budget.dispose()
  })

  test('counts a failed physical attempt, aborts the run and never retries it', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-failure-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let calls = 0
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          calls += 1
          throw new Error('provider failed')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).rejects.toThrow('provider failed')
    expect(calls).toBe(1)
    expect(budget.aborted).toBe(true)
    expect(budget.snapshot().run.usage).toMatchObject({ physicalAttempts: 1, failedAttempts: 1 })
    expect(usage).toHaveLength(1)
    expect(usage[0].outcome).toBe('failure')
    budget.dispose()
  })

  test('settles an in-flight failure even when another fail-fast condition already aborted the budget', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-concurrent-abort-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          try {
            await budget.failFast(new Error('another branch failed'), 'case-02')
          } catch {
            // Simulates a shared abort arriving while this physical call is in flight.
          }
          throw new Error('in-flight request observed abort')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).rejects.toThrow('in-flight request observed abort')
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 1,
      failedAttempts: 1,
      pendingInputTokens: 0,
      pendingOutputTokens: 0,
    })
    expect(budget.snapshot().terminal?.kind).toBe('external_failure')
    expect(usage[0].outcome).toBe('failure')
    budget.dispose()
  })

  test('drains every concurrently aborted physical call before final accounting', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-drain-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let invocation = 0
    let releaseSecond!: () => void
    const secondMayFinish = new Promise<void>(resolve => { releaseSecond = resolve })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          invocation += 1
          if (invocation === 1) throw new Error('first branch failed')
          await secondMayFinish
          throw new Error('second branch observed shared abort')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async entry => { usage.push(entry) },
    })

    const first = provider.complete(request({ promptVersion: '5.0.0-p12-a' }))
    const second = provider.complete(request({ promptVersion: '5.0.0-p12-b' }))
    await expect(first).rejects.toThrow('first branch failed')
    expect(budget.snapshot().run.usage.pendingInputTokens).toBeGreaterThan(0)
    let drained = false
    const draining = provider.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    releaseSecond()
    await expect(second).rejects.toThrow('second branch observed shared abort')
    await draining
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 2,
      settledAttempts: 2,
      failedAttempts: 2,
      pendingInputTokens: 0,
      pendingOutputTokens: 0,
    })
    expect(usage).toHaveLength(2)
    budget.dispose()
  })

  test('blocks an unexpected model before reserving any call', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-model-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: { complete: async () => { throw new Error('must not run') } },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async () => {},
    })

    await expect(provider.complete(request({ model: 'fallback-model' }))).rejects.toMatchObject({
      code: 'MODEL_OVERRIDE_BLOCKED',
    })
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(0)
    budget.dispose()
  })

  test('rejects a response from anything other than the direct DeepSeek provider', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-provider-identity-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async () => ({
          provider: 'fallback',
          model: 'fallback-model',
          content: '{}',
          latencyMs: 1,
        }),
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      componentQuotas: testComponentQuotas(),
      usageSink: async () => {},
    })

    await expect(provider.complete(request())).rejects.toThrow('只接受 DeepSeek provider 响应')
    expect(budget.snapshot().run.usage).toMatchObject({ physicalAttempts: 1, failedAttempts: 1 })
    expect(budget.aborted).toBe(true)
    budget.dispose()
  })
})
