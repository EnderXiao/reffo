import { createHash, randomUUID } from 'node:crypto'
import { appendFile, link, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, relative, resolve } from 'node:path'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { resumeExtractionMaxRepairBudget } from '@/v5/chunked-resume-extraction'
import {
  isV5DeliveryDiagnosticsSemanticallyValid,
  isV5ProductDeliverable,
  type V5DeliverableResultShape,
} from '@/v5/delivery-gate'
import { estimateV5PromptInputTokens, V5_PROMPT_MAX_OUTPUT_TOKENS } from '@/v5/prompt-compiler'
import type { V5DeliveryDiagnostics } from '@/v5/types'
import {
  EvaluationBudgetController,
  EvaluationBudgetJournalError,
  type EvaluationBudgetJournalEntry,
  type EvaluationBudgetLimits,
} from '@/v5/evaluation-budget'

export const V5_EVALUATION_RUNNER_PROTOCOL_VERSION = 'reffo-v5-nonprod-blind-eval-runner-v10' as const
export const V5_EVALUATION_CHECKPOINT_VERSION = 'reffo-v5-evaluation-checkpoint-v1' as const
export const V5_EVALUATION_USAGE_VERSION = 'reffo-v5-evaluation-usage-v2' as const
export const V5_EVALUATION_INPUT_TOKEN_SAFETY_MULTIPLIER = 1.3
export const V5_EVALUATION_INPUT_TOKEN_FRAMING_ALLOWANCE = 256
export const V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION = 'ordered-shard-repair-v2' as const
export const V5_EXTRACTION_IMPLEMENTATION_DIGEST_VERSION = 'reffo-v5-extraction-implementation-digest-v1' as const
export const V5_EXTRACTION_IMPLEMENTATION_SOURCE_FILES = [
  'src/config/env.ts',
  'src/config/deepseek-thinking.ts',
  'src/harness/run-context.ts',
  'src/providers/deepseek-provider.ts',
  'src/providers/llm-provider.ts',
  'src/v5/canonical-source.ts',
  'src/v5/chunked-resume-extraction.ts',
  'src/v5/composition/source-continuation.ts',
  'src/v5/composition/source-continuation-proof.ts',
  'src/v5/evidence.ts',
  'src/v5/temporal-risk.ts',
  'src/v5/p01-validation-diagnostics.ts',
  'src/v5/prompt-compiler.ts',
  'src/v5/targeting/contracts.ts',
  'src/v5/prompts.ts',
  'src/v5/resume-extraction-cache.ts',
  'src/v5/resume-extraction-transport.ts',
  'src/v5/schemas.ts',
  'src/v5/stage-runner.ts',
  'src/v5/types.ts',
] as const
export const V5_EXTRACTION_IMPLEMENTATION_SOURCE_FRAGMENTS = [{
  path: 'src/v5/main/workflow.ts',
  start: '  private envelope<T>(',
  end: '  private async runArtifactStage(',
}] as const
export const V5_EXTRACTION_PROMPT_COMPONENTS = ['P01', 'P01R'] as const
export const V5_EXTRACTION_SHARED_PROMPT_FILES = ['core-extraction.md', 'output.md'] as const
export const V5_EXTRACTION_RUNTIME_DEPENDENCIES = ['openai', 'zod'] as const
export const EXPECTED_NONPROD_HISTORY_SHA256 = '070466694c2761a9af674ff31cb6bef00b38c995836885e44d0b5e7078e4646a'
export const V5_NON_EXTRACTION_CALL_UPPER_BOUND = 8
export const V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND = 6
export const V5_JUDGE_CALL_UPPER_BOUND = 2
export const V5_P01_PRIMARY_OUTPUT_TOKEN_ENVELOPE_PER_CHUNK = V5_PROMPT_MAX_OUTPUT_TOKENS.P01
export const V5_P01_REPAIR_OUTPUT_TOKEN_ENVELOPE_PER_CALL = V5_PROMPT_MAX_OUTPUT_TOKENS.P01R
const V5_GENERATION_NON_EXTRACTION_COMPONENT_CALLS = [
  ['P02', 2],
  ['P03', 2],
  ['P04', 1],
  ['P06D', 1],
] as const
const V5_JUDGE_COMPONENT_CALLS = [['P12', 2]] as const

function outputTokenEnvelopeForComponentCalls(
  calls: ReadonlyArray<readonly [keyof typeof V5_PROMPT_MAX_OUTPUT_TOKENS, number]>
) {
  return calls.reduce(
    (total, [component, count]) => total + V5_PROMPT_MAX_OUTPUT_TOKENS[component] * count,
    0
  )
}

export const V5_GENERATION_NON_EXTRACTION_OUTPUT_TOKEN_ENVELOPE = outputTokenEnvelopeForComponentCalls(
  V5_GENERATION_NON_EXTRACTION_COMPONENT_CALLS
)
export const V5_JUDGE_OUTPUT_TOKEN_ENVELOPE = outputTokenEnvelopeForComponentCalls(
  V5_JUDGE_COMPONENT_CALLS
)

export type V5EvaluationComponent = keyof typeof V5_PROMPT_MAX_OUTPUT_TOKENS
export type V5EvaluationComponentQuotas = Readonly<Partial<Record<V5EvaluationComponent, number>>>

export interface V5ExtractionBudgetShape {
  artifactGenerationMode?: 'dsl_v1' | 'writer_v1'
  /** Output caps derived by the prompt compiler from each original source shard. */
  shardOutputTokenCaps?: readonly number[]
  /** Server-validated cache indexes only; never caller/model supplied. */
  validatedShardIndexes?: readonly number[]
}

function extractionBudgetShape(resumeChunks: number, shape: V5ExtractionBudgetShape = {}) {
  if (!Number.isSafeInteger(resumeChunks) || resumeChunks < 1) {
    throw new EvaluationRunnerSafetyError('INVALID_RESUME_CHUNK_COUNT', 'resumeChunks 必须是正安全整数')
  }
  const caps = shape.shardOutputTokenCaps ?? Array<number>(resumeChunks).fill(
    V5_P01_PRIMARY_OUTPUT_TOKEN_ENVELOPE_PER_CHUNK
  )
  const validated = shape.validatedShardIndexes ?? []
  if (caps.length !== resumeChunks || caps.some(cap => (
    !Number.isSafeInteger(cap) || cap < 1 || cap > V5_P01_PRIMARY_OUTPUT_TOKEN_ENVELOPE_PER_CHUNK
  )) || new Set(validated).size !== validated.length || validated.some(index => (
    !Number.isSafeInteger(index) || index < 0 || index >= resumeChunks
  ))) {
    throw new EvaluationRunnerSafetyError('INVALID_EXTRACTION_BUDGET_SHAPE', 'P01 预算分片或缓存索引无效')
  }
  const validatedIndexes = new Set(validated)
  const pendingCaps = caps.filter((_, index) => !validatedIndexes.has(index))
  const repairCalls = Math.min(pendingCaps.length, resumeExtractionMaxRepairBudget(resumeChunks))
  return { pendingCaps, repairCalls }
}

export function v5EvaluationComponentQuotas(
  resumeChunks: number,
  stage: EvaluationRunStage = 'full',
  shape: V5ExtractionBudgetShape = {}
): V5EvaluationComponentQuotas {
  if (!Number.isSafeInteger(resumeChunks) || resumeChunks < 1) {
    throw new EvaluationRunnerSafetyError('INVALID_RESUME_CHUNK_COUNT', 'resumeChunks 必须是正安全整数')
  }
  if (stage === 'judge-only') return Object.freeze({ P12: V5_JUDGE_CALL_UPPER_BOUND })

  const { pendingCaps, repairCalls } = extractionBudgetShape(resumeChunks, shape)
  const extraction: Partial<Record<V5EvaluationComponent, number>> = {
    ...(pendingCaps.length > 0 ? { P01: pendingCaps.length } : {}),
    ...(repairCalls > 0 ? { P01R: repairCalls } : {}),
  }
  if (stage === 'extract-only') return Object.freeze(extraction)

  return Object.freeze({
    ...extraction,
    P02: 1,
    P02R: 1,
    P03: 1,
    P03R: 1,
    P04: 1,
    ...(shape.artifactGenerationMode === 'writer_v1' ? { P06C: 1 } : { P06D: 1 }),
    ...(stage === 'full' ? { P12: V5_JUDGE_CALL_UPPER_BOUND } : {}),
  })
}

export function isV5CodeGateDeliverable(result: V5DeliverableResultShape) {
  return isV5ProductDeliverable(result)
}

export type EvaluationRunStage = 'extract-only' | 'generation-only' | 'judge-only' | 'full'

export const CASE_2_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 14,
  maxInputTokens: 350_000,
  maxOutputTokens: 150_000,
  maxWallTimeMs: 10 * 60_000,
}

export const EXTRACT_ONLY_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 6,
  maxInputTokens: 120_000,
  maxOutputTokens: 100_000,
  maxWallTimeMs: 5 * 60_000,
}

export const JUDGE_ONLY_CANARY_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 2,
  maxInputTokens: 150_000,
  maxOutputTokens: 20_000,
  maxWallTimeMs: 5 * 60_000,
}

export const FULL_RUN_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 110,
  maxInputTokens: 2_500_000,
  maxOutputTokens: 1_000_000,
  maxWallTimeMs: 60 * 60_000,
}

export const FULL_CASE_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 28,
  maxInputTokens: 450_000,
  maxOutputTokens: 350_000,
  maxWallTimeMs: 10 * 60_000,
}

export const DETAILED_RESUME_SINGLE_CASE_LIMITS: EvaluationBudgetLimits = {
  maxPhysicalCalls: 28,
  maxInputTokens: 450_000,
  maxOutputTokens: 350_000,
  maxWallTimeMs: 15 * 60_000,
}
export const DETAILED_RESUME_CHUNK_THRESHOLD = 10

export interface EvaluationBudgetRequirements {
  requiredPhysicalCalls?: number
  resumeChunks?: number
  estimatedOutputTokens?: number
}

export interface V5CaseOutputTokenEnvelope {
  resumeChunks: number
  primaryExtractionTokens: number
  repairCalls: number
  repairExtractionTokens: number
  generationNonExtractionTokens: number
  judgeTokens: number
  nonExtractionTokens: number
  totalTokens: number
}

export interface EvaluationRunnerCliOptions {
  historyPath: string
  outputRoot: string
  selectedCases: number[]
  dryRun: boolean
  live: boolean
  resume: boolean
  failFast: true
  outputWasExplicit: boolean
  help: boolean
  stage: EvaluationRunStage
  sourceRun: string | null
  artifactGenerationMode: 'dsl_v1' | 'writer_v1'
  jobTargetingPolicy?: 'job-targeted-v1'
  entryWritingPolicy?: 'entry-writing-v1'
}

export interface EvaluationCheckpointFingerprints {
  inputDigest: string
  implementationDigest: string
  configDigest: string
}

export type EvaluationCheckpointKind =
  | 'run_manifest'
  | 'resume_extraction'
  | 'v5_result'
  | 'generation_diagnostics'
  | 'job_targeting_analysis'
  | 'p01_validation_diagnostics'
  | 'resume_extraction_partial'
  | 'blind_eval_input'
  | 'generation_summary'
  | 'blind_ab'
  | 'case_summary'

export interface EvaluationCheckpointEnvelope<T> {
  checkpointVersion: typeof V5_EVALUATION_CHECKPOINT_VERSION
  kind: EvaluationCheckpointKind
  caseId: string
  createdAt: string
  fingerprints: EvaluationCheckpointFingerprints
  payloadSha256: string
  payload: T
}

export interface EvaluationUsageEntry {
  usageVersion: typeof V5_EVALUATION_USAGE_VERSION
  at: string
  reservationId: string
  caseId: string
  outcome: 'success' | 'failure'
  promptVersion: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  reasoningTokens?: number | null
  inputCacheHitTokens?: number | null
  inputCacheMissTokens?: number | null
  requestedModel?: string
  finishReason: string | null
  requestedMaxOutputTokens: number
  providerRequestId: string | null
  latencyMs: number | null
  error?: { name: string; message: string; code?: string }
}

export class EvaluationRunnerSafetyError extends Error {
  constructor(readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EvaluationRunnerSafetyError'
  }
}

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    )
  }
  return value
}

export function digestJson(value: unknown) {
  return sha256(JSON.stringify(canonicalize(value)))
}

const V5_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const V5_DIAGNOSTIC_PHASES = [
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

function diagnosticsInvalid(path: string): never {
  throw new EvaluationRunnerSafetyError(
    'GENERATION_DIAGNOSTICS_INVALID',
    `生成诊断结构无效：${path}`
  )
}

function diagnosticRecord(value: unknown, path: string) {
  if (!isRecord(value)) diagnosticsInvalid(path)
  return value
}

function diagnosticEnum<const TValues extends readonly string[]>(
  value: unknown,
  values: TValues,
  path: string
): TValues[number] {
  if (typeof value !== 'string' || !values.includes(value)) diagnosticsInvalid(path)
  return value as TValues[number]
}

function diagnosticBoolean(value: unknown, path: string) {
  if (typeof value !== 'boolean') diagnosticsInvalid(path)
  return value
}

function diagnosticCount(value: unknown, path: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) diagnosticsInvalid(path)
  return value as number
}

function diagnosticNullableCount(value: unknown, path: string) {
  return value === null ? null : diagnosticCount(value, path)
}

function diagnosticCodes(value: unknown, path: string) {
  if (
    !Array.isArray(value)
    || value.length > 100
    || value.some(item => typeof item !== 'string' || !V5_DIAGNOSTIC_CODE.test(item))
  ) diagnosticsInvalid(path)
  return [...new Set(value as string[])].sort()
}

function diagnosticCounts(value: unknown, path: string) {
  const record = diagnosticRecord(value, path)
  const entries = Object.entries(record)
  if (
    entries.length > 200
    || entries.some(([code, count]) => (
      !V5_DIAGNOSTIC_CODE.test(code)
      || !Number.isSafeInteger(count)
      || (count as number) < 0
    ))
  ) diagnosticsInvalid(path)
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right))) as Record<string, number>
}

function diagnosticCoverage(value: unknown, path: string) {
  const record = diagnosticRecord(value, path)
  const numerator = diagnosticCount(record.numerator, `${path}.numerator`)
  const denominator = diagnosticCount(record.denominator, `${path}.denominator`)
  if (numerator > denominator) diagnosticsInvalid(path)
  return { numerator, denominator }
}

/**
 * Projects workflow diagnostics onto the versioned privacy-safe schema used by
 * the nonprod runner. Unknown fields are deliberately discarded so an Error
 * object can never smuggle messages, resume text, JD text or artifact content
 * into the generation diagnostics sidecar.
 */
export function sanitizeV5DeliveryDiagnostics(value: unknown): V5DeliveryDiagnostics {
  const root = diagnosticRecord(value, 'deliveryDiagnostics')
  if (
    root.version !== 'v5-delivery-diagnostics-v2'
    || root.taxonomyVersion !== 'v5-delivery-taxonomy-v1'
  ) diagnosticsInvalid('deliveryDiagnostics.version')

  const outcome = diagnosticRecord(root.outcome, 'deliveryDiagnostics.outcome')
  const factSafety = diagnosticRecord(
    diagnosticRecord(root.tracks, 'deliveryDiagnostics.tracks').factSafety,
    'deliveryDiagnostics.tracks.factSafety'
  )
  const productQuality = diagnosticRecord(
    diagnosticRecord(root.tracks, 'deliveryDiagnostics.tracks').productQuality,
    'deliveryDiagnostics.tracks.productQuality'
  )
  const provenance = diagnosticRecord(root.provenance, 'deliveryDiagnostics.provenance')
  const metrics = root.metrics === null
    ? null
    : diagnosticRecord(root.metrics, 'deliveryDiagnostics.metrics')

  const sanitizedMetrics: V5DeliveryDiagnostics['metrics'] = metrics === null
    ? null
    : {
        sourceBlockCount: diagnosticCount(metrics.sourceBlockCount, 'deliveryDiagnostics.metrics.sourceBlockCount'),
        mappedSourceBlockCount: diagnosticCount(metrics.mappedSourceBlockCount, 'deliveryDiagnostics.metrics.mappedSourceBlockCount'),
        unmappedSourceBlockCount: diagnosticCount(metrics.unmappedSourceBlockCount, 'deliveryDiagnostics.metrics.unmappedSourceBlockCount'),
        highImportanceUnmappedCount: diagnosticCount(metrics.highImportanceUnmappedCount, 'deliveryDiagnostics.metrics.highImportanceUnmappedCount'),
        eligibleBusinessEvidenceCount: diagnosticCount(metrics.eligibleBusinessEvidenceCount, 'deliveryDiagnostics.metrics.eligibleBusinessEvidenceCount'),
        eligibleBusinessScopeCount: diagnosticCount(metrics.eligibleBusinessScopeCount, 'deliveryDiagnostics.metrics.eligibleBusinessScopeCount'),
        plannedContentEvidenceCount: diagnosticCount(metrics.plannedContentEvidenceCount, 'deliveryDiagnostics.metrics.plannedContentEvidenceCount'),
        usedPlannedEvidenceCount: diagnosticCount(metrics.usedPlannedEvidenceCount, 'deliveryDiagnostics.metrics.usedPlannedEvidenceCount'),
        plannedEvidenceCoverage: diagnosticCoverage(metrics.plannedEvidenceCoverage, 'deliveryDiagnostics.metrics.plannedEvidenceCoverage'),
        stableCoreCoverage: diagnosticCoverage(metrics.stableCoreCoverage, 'deliveryDiagnostics.metrics.stableCoreCoverage'),
        primaryRequirementCoverage: diagnosticCoverage(metrics.primaryRequirementCoverage, 'deliveryDiagnostics.metrics.primaryRequirementCoverage'),
        renderedBusinessBulletCount: diagnosticCount(metrics.renderedBusinessBulletCount, 'deliveryDiagnostics.metrics.renderedBusinessBulletCount'),
        renderedTotalListItemCount: diagnosticCount(metrics.renderedTotalListItemCount, 'deliveryDiagnostics.metrics.renderedTotalListItemCount'),
        renderedProjectCount: diagnosticCount(metrics.renderedProjectCount, 'deliveryDiagnostics.metrics.renderedProjectCount'),
        targetBusinessBulletMin: diagnosticCount(metrics.targetBusinessBulletMin, 'deliveryDiagnostics.metrics.targetBusinessBulletMin'),
        targetBusinessBulletTarget: diagnosticCount(metrics.targetBusinessBulletTarget, 'deliveryDiagnostics.metrics.targetBusinessBulletTarget'),
        targetBusinessBulletMax: diagnosticCount(metrics.targetBusinessBulletMax, 'deliveryDiagnostics.metrics.targetBusinessBulletMax'),
        outputLengthUnit: diagnosticEnum(
          metrics.outputLengthUnit,
          ['cjk_characters', 'words'] as const,
          'deliveryDiagnostics.metrics.outputLengthUnit'
        ),
        outputLengthValue: diagnosticCount(metrics.outputLengthValue, 'deliveryDiagnostics.metrics.outputLengthValue'),
        outputLengthSoftMin: diagnosticNullableCount(metrics.outputLengthSoftMin, 'deliveryDiagnostics.metrics.outputLengthSoftMin'),
        outputLengthHardMin: diagnosticNullableCount(metrics.outputLengthHardMin, 'deliveryDiagnostics.metrics.outputLengthHardMin'),
        outputLengthSoftMax: diagnosticCount(metrics.outputLengthSoftMax, 'deliveryDiagnostics.metrics.outputLengthSoftMax'),
        outputLengthHardMax: diagnosticCount(metrics.outputLengthHardMax, 'deliveryDiagnostics.metrics.outputLengthHardMax'),
      }

  const sanitized: V5DeliveryDiagnostics = {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: diagnosticEnum(
        outcome.execution,
        ['completed', 'failed'] as const,
        'deliveryDiagnostics.outcome.execution'
      ),
      phaseReached: diagnosticEnum(
        outcome.phaseReached,
        V5_DIAGNOSTIC_PHASES,
        'deliveryDiagnostics.outcome.phaseReached'
      ),
      disposition: diagnosticEnum(
        outcome.disposition,
        ['deliverable', 'review_required', 'internal_only', 'blocked_retryable', 'blocked_terminal'] as const,
        'deliveryDiagnostics.outcome.disposition'
      ),
      decisionReasonCodes: diagnosticCodes(
        outcome.decisionReasonCodes,
        'deliveryDiagnostics.outcome.decisionReasonCodes'
      ),
    },
    tracks: {
      factSafety: {
        status: diagnosticEnum(
          factSafety.status,
          ['pass', 'fail', 'not_run'] as const,
          'deliveryDiagnostics.tracks.factSafety.status'
        ),
        finalIssueCounts: diagnosticCounts(
          factSafety.finalIssueCounts,
          'deliveryDiagnostics.tracks.factSafety.finalIssueCounts'
        ),
        rejectedCandidateIssueCounts: diagnosticCounts(
          factSafety.rejectedCandidateIssueCounts,
          'deliveryDiagnostics.tracks.factSafety.rejectedCandidateIssueCounts'
        ),
        unclassifiedIssueCount: diagnosticCount(
          factSafety.unclassifiedIssueCount,
          'deliveryDiagnostics.tracks.factSafety.unclassifiedIssueCount'
        ),
      },
      productQuality: {
        status: diagnosticEnum(
          productQuality.status,
          ['pass', 'review_required', 'fail', 'not_run'] as const,
          'deliveryDiagnostics.tracks.productQuality.status'
        ),
        issueCounts: diagnosticCounts(
          productQuality.issueCounts,
          'deliveryDiagnostics.tracks.productQuality.issueCounts'
        ),
      },
    },
    provenance: {
      planOrigin: diagnosticEnum(
        provenance.planOrigin,
        ['model_primary', 'model_repair', 'deterministic_quality', 'none'] as const,
        'deliveryDiagnostics.provenance.planOrigin'
      ),
      artifactOrigin: diagnosticEnum(
        provenance.artifactOrigin,
        ['model', 'model_repair', 'server_compiler', 'server_renderer', 'emergency', 'none'] as const,
        'deliveryDiagnostics.provenance.artifactOrigin'
      ),
      usedSafeFallback: diagnosticBoolean(
        provenance.usedSafeFallback,
        'deliveryDiagnostics.provenance.usedSafeFallback'
      ),
      usedAnyFallback: diagnosticBoolean(
        provenance.usedAnyFallback,
        'deliveryDiagnostics.provenance.usedAnyFallback'
      ),
      interview: diagnosticEnum(
        provenance.interview,
        ['generated', 'deferred', 'skipped_by_gate', 'failed_optional', 'not_reached'] as const,
        'deliveryDiagnostics.provenance.interview'
      ),
    },
    metrics: sanitizedMetrics,
  }
  if (!isV5DeliveryDiagnosticsSemanticallyValid(sanitized)) {
    diagnosticsInvalid('deliveryDiagnostics.semanticConsistency')
  }
  return sanitized
}

function parseCaseSelector(value: string) {
  if (!value.trim()) throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', '--cases 不能为空')
  const selected = new Set<number>()
  for (const part of value.split(',')) {
    const token = part.trim()
    const range = token.match(/^(\d+)-(\d+)$/)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start > end) throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', `案例范围无效：${token}`)
      for (let current = start; current <= end; current += 1) selected.add(current)
      continue
    }
    if (!/^\d+$/.test(token)) {
      throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', `无法识别案例编号：${token}`)
    }
    selected.add(Number(token))
  }
  const result = [...selected].sort((left, right) => left - right)
  if (result.some(value => value < 1 || value > 9)) {
    throw new EvaluationRunnerSafetyError('INVALID_CASE_SELECTION', '案例编号必须位于 1–9')
  }
  return result
}

function requireFlagValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new EvaluationRunnerSafetyError('MISSING_FLAG_VALUE', `${flag} 需要一个值`)
  }
  return value
}

export function parseEvaluationRunnerArgs(
  argv: string[],
  input: { backendRoot: string; now?: Date } 
): EvaluationRunnerCliOptions {
  const now = input.now ?? new Date()
  let historyPath = resolve(
    input.backendRoot,
    '../.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json'
  )
  let outputRoot = resolve(
    input.backendRoot,
    `../.artifacts/v5-nonprod-nine-safe-${now.toISOString().replace(/[:.]/g, '-')}`
  )
  let selectedCases = [2]
  let dryRun = true
  let live = false
  let dryRunWasExplicit = false
  let resume = false
  let outputWasExplicit = false
  let help = false
  let stage: EvaluationRunStage = 'full'
  let sourceRun: string | null = null
  let artifactGenerationMode: 'dsl_v1' | 'writer_v1' = 'dsl_v1'
  let jobTargetingPolicy: 'job-targeted-v1' | undefined
  let entryWritingPolicy: 'entry-writing-v1' | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--history') {
      historyPath = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--output') {
      outputRoot = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      outputWasExplicit = true
      index += 1
    } else if (arg === '--cases') {
      selectedCases = parseCaseSelector(requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--stage') {
      const value = requireFlagValue(argv, index, arg)
      if (!['extract-only', 'generation-only', 'judge-only', 'full'].includes(value)) {
        throw new EvaluationRunnerSafetyError('INVALID_STAGE', `无法识别运行阶段：${value}`)
      }
      stage = value as EvaluationRunStage
      index += 1
    } else if (arg === '--artifact-mode') {
      const value = requireFlagValue(argv, index, arg)
      if (value !== 'dsl_v1' && value !== 'writer_v1') throw new EvaluationRunnerSafetyError('INVALID_ARTIFACT_MODE', '仅支持 dsl_v1 或 writer_v1')
      artifactGenerationMode = value
      index += 1
    } else if (arg === '--job-targeted') {
      jobTargetingPolicy = 'job-targeted-v1'
    } else if (arg === '--entry-writer') {
      entryWritingPolicy = 'entry-writing-v1'
    } else if (arg === '--source-run') {
      sourceRun = resolve(process.cwd(), requireFlagValue(argv, index, arg))
      index += 1
    } else if (arg === '--dry-run') {
      dryRun = true
      dryRunWasExplicit = true
    } else if (arg === '--live') {
      live = true
      dryRun = false
    } else if (arg === '--resume') {
      resume = true
    } else if (arg === '--fail-fast') {
      // Fail-fast is mandatory for this production-data evaluator. The flag is
      // accepted so invocations can state that safety decision explicitly.
    } else if (arg === '--help' || arg === '-h') {
      help = true
    } else {
      throw new EvaluationRunnerSafetyError('UNKNOWN_ARGUMENT', `未知参数：${arg}`)
    }
  }

  if (resume && !outputWasExplicit) {
    throw new EvaluationRunnerSafetyError('RESUME_REQUIRES_OUTPUT', '--resume 必须同时提供明确的 --output 目录')
  }
  if (live && dryRunWasExplicit) {
    throw new EvaluationRunnerSafetyError('CONFLICTING_RUN_MODE', '--live 与 --dry-run 不能同时使用')
  }
  if (live && !outputWasExplicit) {
    throw new EvaluationRunnerSafetyError('LIVE_REQUIRES_OUTPUT', '--live 必须提供明确的全新或恢复 --output 目录')
  }
  if (stage === 'judge-only' && !sourceRun) {
    throw new EvaluationRunnerSafetyError('JUDGE_SOURCE_RUN_REQUIRED', 'judge-only 必须提供冻结的 --source-run 目录')
  }
  if (stage !== 'judge-only' && sourceRun) {
    throw new EvaluationRunnerSafetyError('SOURCE_RUN_STAGE_MISMATCH', '--source-run 只允许用于 judge-only')
  }
  if (live && stage === 'extract-only') {
    throw new EvaluationRunnerSafetyError(
      'LIVE_STAGE_NOT_IMPLEMENTED',
      `${stage} 尚未实现独立检查点路由；为避免误跑完整链路并消耗 API，当前只允许 dry-run`
    )
  }

  if (jobTargetingPolicy && artifactGenerationMode !== 'writer_v1') throw new EvaluationRunnerSafetyError('JOB_TARGETING_REQUIRES_WRITER', '--job-targeted 必须同时使用 --artifact-mode writer_v1')
  if (entryWritingPolicy && (!jobTargetingPolicy || artifactGenerationMode !== 'writer_v1')) throw new EvaluationRunnerSafetyError('ENTRY_WRITER_REQUIRES_TARGETING', '--entry-writer 必须同时使用 --artifact-mode writer_v1 --job-targeted')
  return {
    historyPath,
    outputRoot,
    selectedCases,
    dryRun,
    live,
    resume,
    failFast: true,
    outputWasExplicit,
    help,
    stage,
    sourceRun,
    artifactGenerationMode,
    ...(jobTargetingPolicy ? { jobTargetingPolicy } : {}),
    ...(entryWritingPolicy ? { entryWritingPolicy } : {}),
  }
}

export function budgetProfileForCases(
  selectedCases: readonly number[],
  stage: EvaluationRunStage = 'full',
  requirements: number | EvaluationBudgetRequirements = 0
) {
  const normalizedRequirements = typeof requirements === 'number'
    ? { requiredPhysicalCalls: requirements }
    : requirements
  const requiredPhysicalCalls = normalizedRequirements.requiredPhysicalCalls ?? 0
  const estimatedOutputTokens = normalizedRequirements.estimatedOutputTokens
    ?? (normalizedRequirements.resumeChunks === undefined
      ? 0
      : v5CaseOutputTokenEnvelope(normalizedRequirements.resumeChunks, stage).totalTokens)
  const isCase2Canary = selectedCases.length === 1 && selectedCases[0] === 2
  if (isCase2Canary && stage === 'extract-only') {
    return {
      name: 'case_2_extract_canary' as const,
      runLimits: { ...EXTRACT_ONLY_CANARY_LIMITS },
      caseLimits: { ...EXTRACT_ONLY_CANARY_LIMITS },
    }
  }
  if (selectedCases.length === 1 && stage === 'judge-only') {
    return {
      name: isCase2Canary ? 'case_2_judge_canary' as const : 'single_case_judge_only' as const,
      runLimits: { ...JUDGE_ONLY_CANARY_LIMITS },
      caseLimits: { ...JUDGE_ONLY_CANARY_LIMITS },
    }
  }
  if (
    selectedCases.length === 1
    && (
      requiredPhysicalCalls > FULL_CASE_LIMITS.maxPhysicalCalls
      || estimatedOutputTokens > FULL_CASE_LIMITS.maxOutputTokens
      || (normalizedRequirements.resumeChunks ?? 0) >= DETAILED_RESUME_CHUNK_THRESHOLD
    )
  ) {
    return {
      name: 'detailed_resume_single_case' as const,
      runLimits: { ...DETAILED_RESUME_SINGLE_CASE_LIMITS },
      caseLimits: { ...DETAILED_RESUME_SINGLE_CASE_LIMITS },
    }
  }
  return {
    name: isCase2Canary ? 'case_2_canary' as const : 'bounded_batch' as const,
    runLimits: { ...(isCase2Canary ? CASE_2_CANARY_LIMITS : FULL_RUN_LIMITS) },
    caseLimits: { ...(isCase2Canary ? CASE_2_CANARY_LIMITS : FULL_CASE_LIMITS) },
  }
}

export function v5CaseOutputTokenEnvelope(
  resumeChunks: number,
  stage: EvaluationRunStage = 'full',
  shape: V5ExtractionBudgetShape = {}
): V5CaseOutputTokenEnvelope {
  if (!Number.isSafeInteger(resumeChunks) || resumeChunks < 1) {
    throw new EvaluationRunnerSafetyError('INVALID_RESUME_CHUNK_COUNT', 'resumeChunks 必须是正安全整数')
  }
  const includesExtraction = stage !== 'judge-only'
  const extraction = extractionBudgetShape(resumeChunks, shape)
  const repairCalls = includesExtraction
    ? extraction.repairCalls
    : 0
  const primaryExtractionTokens = includesExtraction
    ? extraction.pendingCaps.reduce((sum, cap) => sum + cap, 0)
    : 0
  // Any pending shard may fail. Reserve the largest possible repair outputs,
  // using the same source-shaped caps as the primary and repair compiler.
  const repairExtractionTokens = [...extraction.pendingCaps]
    .sort((left, right) => right - left).slice(0, repairCalls)
    .reduce((sum, cap) => sum + Math.min(cap, V5_P01_REPAIR_OUTPUT_TOKEN_ENVELOPE_PER_CALL), 0)
  const generationNonExtractionTokens = stage === 'full' || stage === 'generation-only'
    ? V5_GENERATION_NON_EXTRACTION_OUTPUT_TOKEN_ENVELOPE
      + (shape.artifactGenerationMode === 'writer_v1'
        ? V5_PROMPT_MAX_OUTPUT_TOKENS.P06C - V5_PROMPT_MAX_OUTPUT_TOKENS.P06D : 0)
    : 0
  const judgeTokens = stage === 'full' || stage === 'judge-only'
    ? V5_JUDGE_OUTPUT_TOKEN_ENVELOPE
    : 0
  const nonExtractionTokens = generationNonExtractionTokens + judgeTokens
  return {
    resumeChunks,
    primaryExtractionTokens,
    repairCalls,
    repairExtractionTokens,
    generationNonExtractionTokens,
    judgeTokens,
    nonExtractionTokens,
    totalTokens: primaryExtractionTokens + repairExtractionTokens + nonExtractionTokens,
  }
}

export function v5CasePhysicalCallUpperBound(
  resumeChunks: number,
  stage: EvaluationRunStage = 'full',
  shape: V5ExtractionBudgetShape = {}
) {
  if (!Number.isSafeInteger(resumeChunks) || resumeChunks < 1) {
    throw new EvaluationRunnerSafetyError('INVALID_RESUME_CHUNK_COUNT', 'resumeChunks 必须是正安全整数')
  }
  const extraction = extractionBudgetShape(resumeChunks, shape)
  const extractionCalls = extraction.pendingCaps.length + extraction.repairCalls
  if (stage === 'extract-only') return extractionCalls
  if (stage === 'judge-only') return V5_JUDGE_CALL_UPPER_BOUND
  return extractionCalls + (stage === 'generation-only'
    ? V5_GENERATION_NON_EXTRACTION_CALL_UPPER_BOUND
    : V5_NON_EXTRACTION_CALL_UPPER_BOUND)
}

export function assertResumeExtractionReplaySafe(input: {
  resume: boolean
  hasV5Checkpoint: boolean
  hasTrustedExtractionCheckpoint?: boolean
  resumeDigest: string
  completedResumeDigests: ReadonlySet<string>
}) {
  if (
    input.resume
    && !input.hasV5Checkpoint
    && !input.hasTrustedExtractionCheckpoint
    && input.completedResumeDigests.has(input.resumeDigest)
  ) {
    throw new EvaluationRunnerSafetyError(
      'CROSS_PROCESS_EXTRACTION_CACHE_REPLAY_BLOCKED',
      '恢复运行缺少同源简历的 v5 或受信 P01 检查点；已拒绝重复外呼。'
    )
  }
}

export function assertStrictDeepSeekEndpoint(value: string | undefined) {
  const configured = value?.trim() || 'https://api.deepseek.com'
  let parsed: URL
  try {
    parsed = new URL(configured)
  } catch (cause) {
    throw new EvaluationRunnerSafetyError('INVALID_PROVIDER_ENDPOINT', 'OPENAI_BASE_URL 不是合法 URL', {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.hostname !== 'api.deepseek.com'
    || parsed.port !== ''
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.pathname !== '/'
    || parsed.search !== ''
    || parsed.hash !== ''
  ) {
    throw new EvaluationRunnerSafetyError(
      'UNSAFE_PROVIDER_ENDPOINT',
      `评测只允许 https://api.deepseek.com 根地址，当前为 ${parsed.toString()}`
    )
  }
  return 'https://api.deepseek.com'
}

export async function assertOutputDirectoryPolicy(path: string, resume: boolean) {
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      if (resume) {
        throw new EvaluationRunnerSafetyError('RESUME_OUTPUT_MISSING', `恢复目录不存在：${path}`)
      }
      return
    }
    throw error
  }
  if (resume) {
    if (entries.length === 0) {
      throw new EvaluationRunnerSafetyError('RESUME_OUTPUT_EMPTY', `恢复目录为空：${path}`)
    }
    return
  }
  if (entries.length > 0) {
    throw new EvaluationRunnerSafetyError(
      'OUTPUT_DIRECTORY_NOT_EMPTY',
      `输出目录非空，拒绝混用历史结果：${path}`
    )
  }
}

export interface EvaluationRunLock {
  path: string
  release(): Promise<void>
}

export async function acquireEvaluationRunLock(input: {
  outputRoot: string
  resume: boolean
}): Promise<EvaluationRunLock> {
  await mkdir(input.outputRoot, { recursive: true, mode: 0o700 })
  const lockPath = resolve(input.outputRoot, '.reffo-v5-evaluation.lock')
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(lockPath, 'wx', 0o600)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvaluationRunnerSafetyError(
        'RUN_LOCK_HELD',
        `输出目录已有运行锁：${lockPath}。请先人工核验原进程已停止，再处理残留锁。`
      )
    }
    throw cause
  }

  let released = false
  const release = async () => {
    if (released) return
    released = true
    try {
      await unlink(lockPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      protocolVersion: V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
      pid: process.pid,
      hostname: hostname(),
      acquiredAt: new Date().toISOString(),
      resume: input.resume,
    })}\n`)
    await handle.sync()
  } catch (cause) {
    await handle.close().catch(() => undefined)
    await release()
    throw cause
  }
  await handle.close()

  if (!input.resume) {
    const unexpected = (await readdir(input.outputRoot)).filter(name => name !== basename(lockPath))
    if (unexpected.length > 0) {
      await release()
      throw new EvaluationRunnerSafetyError(
        'OUTPUT_DIRECTORY_RACE_DETECTED',
        `获取运行锁时输出目录出现其他内容，拒绝继续：${unexpected.join(', ')}`
      )
    }
  }

  return { path: lockPath, release }
}

async function implementationFiles(root: string) {
  const files: string[] = []
  const promptRoot = resolve(root, 'src', 'v5', 'prompts')
  const visit = async (path: string) => {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name)
      if (entry.isDirectory()) await visit(child)
      else if (
        entry.isFile()
        && (
          entry.name.endsWith('.ts')
          || (
            child.startsWith(`${promptRoot}/`)
            && (entry.name.endsWith('.md') || entry.name === 'manifest.json')
          )
        )
      ) files.push(child)
    }
  }
  await visit(resolve(root, 'src'))
  files.push(resolve(root, 'scripts/run-v5-nonprod-nine-case-blind-eval.ts'))
  files.push(resolve(root, 'package.json'))
  files.push(resolve(root, 'bun.lock'))
  files.push(resolve(root, 'tsconfig.json'))
  return files.sort()
}

export async function createImplementationDigest(backendRoot: string) {
  const rows = []
  for (const path of await implementationFiles(backendRoot)) {
    rows.push({ path: relative(backendRoot, path), sha256: sha256(await readFile(path)) })
  }
  return digestJson(rows)
}

function requireStringRecord(value: unknown, label: string) {
  if (!isRecord(value)) throw new EvaluationRunnerSafetyError('EXTRACTION_DIGEST_INPUT_INVALID', `${label} 不是对象`)
  return value
}

export async function createExtractionImplementationDigest(backendRoot: string) {
  const sources = []
  for (const relativePath of V5_EXTRACTION_IMPLEMENTATION_SOURCE_FILES) {
    const path = resolve(backendRoot, relativePath)
    sources.push({ path: relativePath, sha256: sha256(await readFile(path)) })
  }
  const fragments = []
  for (const selector of V5_EXTRACTION_IMPLEMENTATION_SOURCE_FRAGMENTS) {
    const source = await readFile(resolve(backendRoot, selector.path), 'utf8')
    const start = source.indexOf(selector.start)
    const end = source.indexOf(selector.end, start + selector.start.length)
    if (start < 0 || end <= start) {
      throw new EvaluationRunnerSafetyError(
        'EXTRACTION_DIGEST_INPUT_INVALID',
        `无法定位 P01 实现片段：${selector.path}`
      )
    }
    fragments.push({
      path: selector.path,
      start: selector.start,
      end: selector.end,
      sha256: sha256(source.slice(start, end)),
    })
  }

  const promptManifestPath = resolve(backendRoot, 'src/v5/prompts/manifest.json')
  const promptManifest = requireStringRecord(
    JSON.parse(await readFile(promptManifestPath, 'utf8')),
    'P01 Prompt manifest'
  )
  const promptVersions = requireStringRecord(promptManifest.components, 'P01 Prompt manifest components')
  const prompts = []
  for (const component of V5_EXTRACTION_PROMPT_COMPONENTS) {
    const version = promptVersions[component]
    if (typeof version !== 'string' || version.length === 0) {
      throw new EvaluationRunnerSafetyError(
        'EXTRACTION_DIGEST_INPUT_INVALID',
        `P01 Prompt manifest 缺少 ${component} 版本`
      )
    }
    const relativePath = `src/v5/prompts/${component}.md`
    prompts.push({
      component,
      version,
      path: relativePath,
      sha256: sha256(await readFile(resolve(backendRoot, relativePath))),
    })
  }
  for (const fileName of V5_EXTRACTION_SHARED_PROMPT_FILES) {
    const relativePath = `src/v5/prompts/${fileName}`
    prompts.push({
      component: fileName,
      version: 'shared',
      path: relativePath,
      sha256: sha256(await readFile(resolve(backendRoot, relativePath))),
    })
  }

  const lockText = await readFile(resolve(backendRoot, 'bun.lock'), 'utf8')
  const dependencies = V5_EXTRACTION_RUNTIME_DEPENDENCIES.map(name => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = lockText.match(new RegExp(`"${escapedName}": \\["(${escapedName}@[^"]+)"`))
    if (!match) {
      throw new EvaluationRunnerSafetyError(
        'EXTRACTION_DIGEST_INPUT_INVALID',
        `bun.lock 缺少 P01 运行依赖 ${name}`
      )
    }
    return { name, resolved: match[1] }
  })

  return digestJson({
    version: V5_EXTRACTION_IMPLEMENTATION_DIGEST_VERSION,
    sources,
    fragments,
    prompts,
    dependencies,
  })
}

export async function atomicWriteText(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  await rename(temporary, path)
}

export async function atomicWriteJson(path: string, value: unknown) {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function atomicWriteJsonExclusive(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = resolve(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  })
  try {
    await link(temporary, path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new EvaluationRunnerSafetyError(
        'CHECKPOINT_ALREADY_EXISTS',
        `拒绝覆盖已有检查点：${path}`
      )
    }
    throw cause
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
}

export async function writeCheckpoint<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
  fingerprints: EvaluationCheckpointFingerprints
  payload: T
}) {
  const envelope: EvaluationCheckpointEnvelope<T> = {
    checkpointVersion: V5_EVALUATION_CHECKPOINT_VERSION,
    kind: input.kind,
    caseId: input.caseId,
    createdAt: new Date().toISOString(),
    fingerprints: { ...input.fingerprints },
    payloadSha256: digestJson(input.payload),
    payload: input.payload,
  }
  await atomicWriteJsonExclusive(input.path, envelope)
  return envelope
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readCheckpointUnbound<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
}): Promise<EvaluationCheckpointEnvelope<T> | null> {
  let raw: string
  try {
    raw = await readFile(input.path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_CORRUPT', `检查点 JSON 损坏：${input.path}`, {
      cause: cause instanceof Error ? cause : undefined,
    })
  }
  if (!isRecord(parsed) || parsed.checkpointVersion !== V5_EVALUATION_CHECKPOINT_VERSION) {
    throw new EvaluationRunnerSafetyError(
      'CHECKPOINT_LEGACY_OR_INVALID',
      `拒绝复用旧版裸 JSON 或未知检查点：${input.path}`
    )
  }
  const envelope = parsed as unknown as EvaluationCheckpointEnvelope<T>
  if (envelope.kind !== input.kind || envelope.caseId !== input.caseId) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_IDENTITY_MISMATCH', `检查点身份不匹配：${input.path}`)
  }
  if (envelope.payloadSha256 !== digestJson(envelope.payload)) {
    throw new EvaluationRunnerSafetyError('CHECKPOINT_PAYLOAD_DIGEST_MISMATCH', `检查点内容摘要不匹配：${input.path}`)
  }
  return envelope
}

export async function readCheckpoint<T>(input: {
  path: string
  kind: EvaluationCheckpointKind
  caseId: string
  fingerprints: EvaluationCheckpointFingerprints
}): Promise<EvaluationCheckpointEnvelope<T> | null> {
  const envelope = await readCheckpointUnbound<T>(input)
  if (!envelope) return null
  for (const key of ['inputDigest', 'implementationDigest', 'configDigest'] as const) {
    if (envelope.fingerprints?.[key] !== input.fingerprints[key]) {
      throw new EvaluationRunnerSafetyError(
        'CHECKPOINT_FINGERPRINT_MISMATCH',
        `检查点 ${key} 不匹配，拒绝跨输入、实现或配置复用：${input.path}`
      )
    }
  }
  return envelope
}

export function createAppendOnlyJsonlSink<T>(path: string) {
  let tail = Promise.resolve()
  return async (entry: T) => {
    const line = `${JSON.stringify(entry)}\n`
    tail = tail.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      await appendFile(path, line, { encoding: 'utf8', mode: 0o600 })
    })
    await tail
  }
}

export async function readJsonlStrict<T>(path: string): Promise<T[] | null> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const lines = raw.split('\n').filter(line => line.length > 0)
  if (lines.length === 0) throw new EvaluationBudgetJournalError(`JSONL journal is empty: ${path}`)
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as T
    } catch (cause) {
      throw new EvaluationBudgetJournalError(`JSONL journal is corrupt at line ${index + 1}: ${path}`, {
        cause: cause instanceof Error ? cause : undefined,
      })
    }
  })
}

export function estimateProviderInputTokens(input: ChatCompletionInput) {
  // Start from the exact same base estimate used by the compiler, then keep a
  // runner-only margin for tokenizer variance and transport framing. UTF-8 byte
  // count is not a token estimate and inflates Chinese-heavy prompts by ~4x.
  const compilerEstimate = estimateV5PromptInputTokens(input.messages)
  return Math.ceil(compilerEstimate * V5_EVALUATION_INPUT_TOKEN_SAFETY_MULTIPLIER)
    + V5_EVALUATION_INPUT_TOKEN_FRAMING_ALLOWANCE
}

function serializedError(error: unknown) {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return {
      name: error.name || 'Error',
      message: error.message.slice(0, 500),
      ...(code ? { code } : {}),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 500) }
}

function combineSignals(signals: Array<AbortSignal | undefined>) {
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  return AbortSignal.any(active)
}

const VERSIONED_PROMPT_COMPONENT = /(?:^|-)p(\d{2})([a-z]?)(?:-|$)/iu

function componentFromPromptVersion(value: string | undefined): V5EvaluationComponent | null {
  const match = value?.match(VERSIONED_PROMPT_COMPONENT)
  if (!match) return null
  const component = `P${match[1]}${match[2].toUpperCase()}`
  return component in V5_PROMPT_MAX_OUTPUT_TOKENS
    ? component as V5EvaluationComponent
    : null
}

function requestEvaluationComponent(request: ChatCompletionInput): V5EvaluationComponent {
  const manifestComponent = request.promptManifest?.componentPromptId
  if (!manifestComponent || !(manifestComponent in V5_PROMPT_MAX_OUTPUT_TOKENS)) {
    throw new EvaluationRunnerSafetyError(
      'COMPONENT_MANIFEST_REQUIRED',
      '评测请求缺少受信的已知组件 manifest'
    )
  }
  const versionComponent = componentFromPromptVersion(request.promptVersion)
  if (versionComponent !== manifestComponent) {
    throw new EvaluationRunnerSafetyError(
      'COMPONENT_MANIFEST_MISMATCH',
      '评测请求的 Prompt 版本与组件 manifest 不一致'
    )
  }
  return manifestComponent as V5EvaluationComponent
}

/**
 * The wrapped provider must be the direct DeepSeek provider. Reservation happens
 * immediately before every SDK invocation; no fallback/retry provider belongs
 * outside or inside this wrapper.
 */
export class BudgetedEvaluationProvider implements LlmProvider {
  private readonly activeCalls = new Set<Promise<ChatCompletionResult>>()
  private readonly componentAttempts = new Map<V5EvaluationComponent, number>()

  constructor(private readonly input: {
    directProvider: LlmProvider
    budget: EvaluationBudgetController
    caseId: string
    model: string
    componentQuotas: V5EvaluationComponentQuotas
    usageSink: (entry: EvaluationUsageEntry) => Promise<void>
  }) {
    for (const [component, quota] of Object.entries(input.componentQuotas)) {
      if (!Number.isSafeInteger(quota) || quota < 1) {
        throw new EvaluationRunnerSafetyError(
          'INVALID_COMPONENT_QUOTA',
          `评测组件 ${component} 的调用额度必须是正安全整数`
        )
      }
    }
    for (const entry of input.budget.journal()) {
      if (entry.type !== 'call_reserved' || entry.caseId !== input.caseId) continue
      const component = componentFromPromptVersion(entry.label)
      if (!component || input.componentQuotas[component] === undefined) {
        throw new EvaluationRunnerSafetyError(
          'COMPONENT_USAGE_RESTORE_FAILED',
          '历史预算记录包含当前运行拓扑不允许的组件'
        )
      }
      this.componentAttempts.set(component, (this.componentAttempts.get(component) ?? 0) + 1)
    }
  }

  complete(request: ChatCompletionInput): Promise<ChatCompletionResult> {
    const operation = this.performComplete(request)
    this.activeCalls.add(operation)
    void operation.then(
      () => this.activeCalls.delete(operation),
      () => this.activeCalls.delete(operation)
    )
    return operation
  }

  async drain() {
    while (this.activeCalls.size > 0) {
      await Promise.allSettled([...this.activeCalls])
    }
  }

  private async performComplete(request: ChatCompletionInput): Promise<ChatCompletionResult> {
    if (request.model && request.model !== this.input.model) {
      throw new EvaluationRunnerSafetyError(
        'MODEL_OVERRIDE_BLOCKED',
        `评测期间禁止切换模型：${request.model}`
      )
    }
    const component = requestEvaluationComponent(request)
    const quota = this.input.componentQuotas[component]
    if (quota === undefined) {
      throw new EvaluationRunnerSafetyError(
        'COMPONENT_CALL_BLOCKED',
        `当前评测阶段禁止调用 ${component}`
      )
    }
    const previousAttempts = this.componentAttempts.get(component) ?? 0
    if (previousAttempts >= quota) {
      throw new EvaluationRunnerSafetyError(
        'COMPONENT_CALL_QUOTA_EXCEEDED',
        `${component} 已达到当前评测阶段的调用上限 ${quota}`
      )
    }
    this.componentAttempts.set(component, previousAttempts + 1)

    let reservation
    try {
      reservation = await this.input.budget.reservePhysicalCall({
        caseId: this.input.caseId,
        label: request.promptVersion ?? 'unknown',
        estimatedInputTokens: estimateProviderInputTokens(request),
        maxOutputTokens: request.maxOutputTokens ?? 8_192,
      })
    } catch (error) {
      this.componentAttempts.set(component, previousAttempts)
      throw error
    }
    const startedAt = Date.now()
    try {
      const result = await this.input.directProvider.complete({
        ...request,
        model: this.input.model,
        maxProviderAttempts: 1,
        signal: combineSignals([reservation.signal, request.signal, request.stepContext?.signal]),
      })
      if (result.provider !== 'deepseek') {
        throw new EvaluationRunnerSafetyError(
          'NON_DEEPSEEK_PROVIDER_BLOCKED',
          `评测只接受 DeepSeek provider 响应，实际为 ${result.provider || 'unknown'}`
        )
      }
      await this.input.budget.settleSuccess(reservation, {
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
      await this.input.usageSink({
        usageVersion: V5_EVALUATION_USAGE_VERSION,
        at: new Date().toISOString(),
        reservationId: reservation.reservationId,
        caseId: this.input.caseId,
        outcome: 'success',
        promptVersion: request.promptVersion ?? 'unknown',
        model: result.model,
        inputTokens: result.inputTokens ?? null,
        outputTokens: result.outputTokens ?? null,
        reasoningTokens: result.reasoningTokens ?? null,
        inputCacheHitTokens: result.inputCacheHitTokens ?? null,
        inputCacheMissTokens: result.inputCacheMissTokens ?? null,
        requestedModel: this.input.model,
        finishReason: result.finishReason ?? null,
        requestedMaxOutputTokens: request.maxOutputTokens ?? 8_192,
        providerRequestId: result.providerRequestId ?? null,
        latencyMs: result.latencyMs,
      })
      return result
    } catch (error) {
      const alreadySettled = this.input.budget.journal().some(entry => (
        entry.type === 'call_settled' && entry.reservationId === reservation.reservationId
      ))
      if (!alreadySettled) {
        try {
          await this.input.budget.settleFailure(reservation, error)
        } catch (accountedFailure) {
          error = accountedFailure
        }
      }
      try {
        await this.input.usageSink({
          usageVersion: V5_EVALUATION_USAGE_VERSION,
          at: new Date().toISOString(),
          reservationId: reservation.reservationId,
          caseId: this.input.caseId,
          outcome: 'failure',
          promptVersion: request.promptVersion ?? 'unknown',
          model: request.model ?? this.input.model,
          inputTokens: null,
          outputTokens: null,
          finishReason: null,
          requestedMaxOutputTokens: request.maxOutputTokens ?? 8_192,
          providerRequestId: null,
          latencyMs: Date.now() - startedAt,
          error: serializedError(error),
        })
      } catch (journalError) {
        throw new EvaluationRunnerSafetyError('USAGE_JOURNAL_WRITE_FAILED', 'usage journal 写入失败', {
          cause: journalError instanceof Error ? journalError : undefined,
        })
      }
      throw error
    }
  }
}

export async function restoreEvaluationBudget(input: {
  journalPath: string
  journalSink: (entry: EvaluationBudgetJournalEntry) => Promise<void>
}) {
  const entries = await readJsonlStrict<EvaluationBudgetJournalEntry>(input.journalPath)
  if (!entries) return null
  const budget = await EvaluationBudgetController.restore(entries, { journalSink: input.journalSink })
  const snapshot = budget.snapshot()
  if (snapshot.aborted || snapshot.terminal) {
    budget.dispose()
    throw new EvaluationRunnerSafetyError('TERMINAL_RUN_CANNOT_RESUME', '已有运行已进入终止状态，禁止自动恢复或重试')
  }
  if (snapshot.pendingReservations.length > 0) {
    budget.dispose()
    throw new EvaluationRunnerSafetyError(
      'PENDING_CALL_CANNOT_RESUME',
      'usage journal 存在结果未知的在途调用，禁止将其自动重试'
    )
  }
  return budget
}

export async function pathExists(path: string) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
