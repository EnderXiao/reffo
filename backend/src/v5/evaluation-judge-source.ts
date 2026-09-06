import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import {
  EVALUATION_BUDGET_JOURNAL_VERSION,
  type EvaluationBudgetJournalEntry,
} from '@/v5/evaluation-budget'
import {
  EvaluationRunnerSafetyError,
  V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
  V5_EVALUATION_RUNNER_PROTOCOL_VERSION,
  V5_EVALUATION_USAGE_VERSION,
  digestJson,
  isV5CodeGateDeliverable,
  readCheckpointUnbound,
  readJsonlStrict,
  type EvaluationCheckpointEnvelope,
  type EvaluationCheckpointFingerprints,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'
import { validateV5DeliveryEnvelopeConsistency } from '@/v5/delivery-gate'
import {
  generatedResumeArtifactSchema,
  generationPolicySchema,
  jobRequirementBundleSchema,
  resumeEvidenceBundleSchema,
  v5MatchAnalysisSchema,
  v5ResumePlanSchema,
} from '@/v5/schemas'
import type { V5WorkflowResult } from '@/v5/types'
import {
  RELAXED_PLAN_ADVISORY_CODES,
  RELAXED_RELEASE_ADVISORY_CODES,
  validateGeneratedResumeArtifact,
  validateV5ResumePlan,
} from '@/v5/validators'

interface SourceRunManifestPayload {
  runId: string
  runnerProtocolVersion: string
  selectedCases: number[]
  stage: string
  sourceRun: string | null
  provider: {
    endpoint: string
    model: string
    maxProviderAttempts: number
    fallbackEnabled: boolean
  }
  executionPolicy: {
    releaseGateMode: 'deterministic_product_delivery_v2'
    agentFactJudgeEnabled: false
    agentQualityJudgeEnabled: false
    artifactGenerationMode: 'dsl_v1' | 'writer_v1'
    artifactRepairMax: 0
    interviewMode: 'deferred'
    componentQuotaPolicy: typeof V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION
  }
}

export interface JudgeSourceCaseExpectation {
  caseNumber: number
  caseId: string
  prefix: string
  inputDigest: string
  resumeDigest: string
}

export interface JudgeSourceCaseProvenance {
  caseNumber: number
  caseId: string
  inputDigest: string
  sourceV5PayloadSha256: string
  sourceV5Fingerprints: EvaluationCheckpointFingerprints
}

export interface JudgeSourceProvenance {
  sourceRunId: string
  sourceRunnerProtocolVersion: string
  sourceStage: 'generation-only' | 'full'
  historyDigest: string
  sourceManifestPayloadSha256: string
  sourceManifestFingerprints: EvaluationCheckpointFingerprints
  cases: JudgeSourceCaseProvenance[]
  contentDigest: string
}

export interface ValidatedJudgeSourceCase {
  caseNumber: number
  caseId: string
  v5Result: V5WorkflowResult
  sourceCheckpoint: EvaluationCheckpointEnvelope<V5WorkflowResult>
}

export interface ValidatedJudgeSourceRun {
  sourceRun: string
  provenance: JudgeSourceProvenance
  cases: ValidatedJudgeSourceCase[]
}

function fail(code: string, message: string): never {
  throw new EvaluationRunnerSafetyError(code, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function assertFingerprints(value: unknown, label: string): asserts value is EvaluationCheckpointFingerprints {
  if (
    !isRecord(value)
    || !hasSha256(value.inputDigest)
    || !hasSha256(value.implementationDigest)
    || !hasSha256(value.configDigest)
  ) fail('JUDGE_SOURCE_FINGERPRINT_INVALID', `${label} 的三项指纹无效`)
}

function parseSourceManifest(value: unknown): SourceRunManifestPayload {
  if (!isRecord(value) || !isRecord(value.provider) || !isRecord(value.executionPolicy)) {
    return fail('JUDGE_SOURCE_MANIFEST_INVALID', 'source-run manifest 结构无效')
  }
  const selectedCases = value.selectedCases
  const provider = value.provider
  const executionPolicy = value.executionPolicy
  if (
    typeof value.runId !== 'string'
    || !value.runId
    || typeof value.runnerProtocolVersion !== 'string'
    || !Array.isArray(selectedCases)
    || selectedCases.some(item => !Number.isSafeInteger(item))
    || typeof value.stage !== 'string'
    || !(value.sourceRun === null || typeof value.sourceRun === 'string')
    || typeof provider.endpoint !== 'string'
    || typeof provider.model !== 'string'
    || typeof provider.maxProviderAttempts !== 'number'
    || typeof provider.fallbackEnabled !== 'boolean'
    || executionPolicy.releaseGateMode !== 'deterministic_product_delivery_v2'
    || executionPolicy.agentFactJudgeEnabled !== false
    || executionPolicy.agentQualityJudgeEnabled !== false
    || !['dsl_v1', 'writer_v1'].includes(String(executionPolicy.artifactGenerationMode))
    || executionPolicy.artifactRepairMax !== 0
    || executionPolicy.interviewMode !== 'deferred'
    || executionPolicy.componentQuotaPolicy !== V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION
  ) return fail('JUDGE_SOURCE_MANIFEST_INVALID', 'source-run manifest 缺少必要字段')

  return {
    runId: value.runId,
    runnerProtocolVersion: value.runnerProtocolVersion,
    selectedCases: [...selectedCases] as number[],
    stage: value.stage,
    sourceRun: value.sourceRun as string | null,
    provider: {
      endpoint: provider.endpoint,
      model: provider.model,
      maxProviderAttempts: provider.maxProviderAttempts,
      fallbackEnabled: provider.fallbackEnabled,
    },
    executionPolicy: {
      releaseGateMode: 'deterministic_product_delivery_v2',
      agentFactJudgeEnabled: false,
      agentQualityJudgeEnabled: false,
      artifactGenerationMode: executionPolicy.artifactGenerationMode as 'dsl_v1' | 'writer_v1',
      artifactRepairMax: 0,
      interviewMode: 'deferred',
      componentQuotaPolicy: V5_EVALUATION_COMPONENT_QUOTA_POLICY_VERSION,
    },
  }
}

async function canonicalPath(path: string) {
  let cursor = resolve(path)
  const missingSegments: string[] = []
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missingSegments)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      missingSegments.unshift(basename(cursor))
      cursor = parent
    }
  }
}

function pathContains(parent: string, child: string) {
  const nested = relative(parent, child)
  return nested === '' || (!nested.startsWith('..') && !isAbsolute(nested))
}

function validateSourceResult(input: {
  payload: unknown
  expectedResumeDigest: string
  caseNumber: number
}) {
  if (!isRecord(input.payload)) {
    return fail('JUDGE_SOURCE_RESULT_INVALID', `案例 ${input.caseNumber} 的 v5 result 不是对象`)
  }
  const resume = resumeEvidenceBundleSchema.safeParse(input.payload.resumeEvidenceBundle)
  const job = jobRequirementBundleSchema.safeParse(input.payload.jobRequirementBundle)
  const match = v5MatchAnalysisSchema.safeParse(input.payload.matchAnalysis)
  const plan = v5ResumePlanSchema.safeParse(input.payload.resumePlan)
  const policy = generationPolicySchema.safeParse(input.payload.generationPolicy)
  const artifact = generatedResumeArtifactSchema.safeParse(input.payload.artifact)
  if (!resume.success || !job.success || !match.success || !plan.success || !policy.success || !artifact.success) {
    return fail(
      'JUDGE_SOURCE_RESULT_SCHEMA_INVALID',
      `案例 ${input.caseNumber} 的 P12 必需输入未通过当前 v5 Schema`
    )
  }
  if (resume.data.sourceDocument.sha256 !== input.expectedResumeDigest) {
    return fail(
      'JUDGE_SOURCE_RESUME_DIGEST_MISMATCH',
      `案例 ${input.caseNumber} 的来源简历摘要与当前冻结输入不一致`
    )
  }
  if (
    typeof input.payload.runId !== 'string'
    || !input.payload.runId
    || typeof input.payload.state !== 'string'
    || typeof input.payload.usedSafeFallback !== 'boolean'
    || typeof input.payload.usedAnyFallback !== 'boolean'
    || !isRecord(input.payload.matchScore)
    || typeof input.payload.matchScore.score !== 'number'
    || !isRecord(input.payload.qualityGates)
    || !isRecord(input.payload.deliveryDiagnostics)
    || typeof input.payload.executionStatus !== 'string'
    || typeof input.payload.deliveryDecision !== 'string'
  ) {
    return fail('JUDGE_SOURCE_RESULT_INVALID', `案例 ${input.caseNumber} 的 v5 result 缺少完成态字段`)
  }

  const result = input.payload as unknown as V5WorkflowResult
  const envelopeConsistency = validateV5DeliveryEnvelopeConsistency(result)
  if (!envelopeConsistency.passed) {
    return fail(
      'JUDGE_SOURCE_DELIVERY_GATE_FAILED',
      `案例 ${input.caseNumber} 的来源结果交付字段不一致：${envelopeConsistency.issueCodes.join(',')}`
    )
  }
  if (!isV5CodeGateDeliverable(result)) {
    return fail(
      'JUDGE_SOURCE_DELIVERY_GATE_FAILED',
      `案例 ${input.caseNumber} 的来源结果未满足当前可交付状态门禁`
    )
  }
  const planValidation = validateV5ResumePlan({
    resume: resume.data,
    job: job.data,
    match: match.data,
    plan: plan.data,
    policy: policy.data,
    profile: plan.data.strategyProfile,
    gateMode: 'relaxed_release',
  })
  if (!planValidation.passed || !planValidation.value) {
    return fail(
      'JUDGE_SOURCE_CURRENT_PLAN_GATE_FAILED',
      `案例 ${input.caseNumber} 的来源计划未通过当前确定性计划门禁`
    )
  }
  if (digestJson(planValidation.value) !== digestJson(plan.data)) {
    return fail(
      'JUDGE_SOURCE_PLAN_NOT_CANONICAL',
      `案例 ${input.caseNumber} 的来源计划需要当前代码改写，拒绝静默改变冻结盲评输入`
    )
  }
  const validation = validateGeneratedResumeArtifact({
    artifact: artifact.data,
    resume: resume.data,
    plan: plan.data,
    policy: policy.data,
    gateMode: 'relaxed_release',
  })
  if (!validation.passed || !validation.value) {
    return fail(
      'JUDGE_SOURCE_CURRENT_GATE_FAILED',
      `案例 ${input.caseNumber} 的来源成品未通过当前确定性成品门禁`
    )
  }
  const hasCurrentProductQualityWarning = planValidation.issues.some(item => (
    item.severity === 'warning' && RELAXED_PLAN_ADVISORY_CODES.has(item.code)
  )) || validation.issues.some(item => (
    item.severity === 'warning' && RELAXED_RELEASE_ADVISORY_CODES.has(item.code)
  ))
  if (hasCurrentProductQualityWarning) {
    return fail(
      'JUDGE_SOURCE_CURRENT_QUALITY_GATE_FAILED',
      `案例 ${input.caseNumber} 的来源结果未通过当前确定性产品质量门禁`
    )
  }
  if (digestJson(validation.value) !== digestJson(artifact.data)) {
    return fail(
      'JUDGE_SOURCE_NOT_CANONICAL',
      `案例 ${input.caseNumber} 的来源成品需要当前代码改写，拒绝静默改变冻结盲评输入`
    )
  }
  return result
}

async function assertNoCompletedOrUnknownJudgeCalls(input: {
  sourceRun: string
  sourceRunId: string
  caseId: string
  sourceStage: string
}) {
  const usage = await readJsonlStrict<EvaluationUsageEntry>(resolve(input.sourceRun, 'usage.jsonl'))
  const budget = await readJsonlStrict<EvaluationBudgetJournalEntry>(
    resolve(input.sourceRun, 'budget-journal.jsonl')
  )
  if (!usage || !budget) {
    return fail('JUDGE_SOURCE_JOURNAL_MISSING', 'source-run 缺少调用或预算 journal')
  }
  const p12Usage = usage.filter(row => (
    row.caseId === input.caseId && /^5\.0\.0-p12/.test(row.promptVersion)
  ))
  const p12Reservations = budget.filter((row): row is Extract<
    EvaluationBudgetJournalEntry,
    { type: 'call_reserved' }
  > => (
    row.type === 'call_reserved'
    && row.caseId === input.caseId
    && /^5\.0\.0-p12/.test(row.label ?? '')
  ))
  const p12Settlements = budget.filter((row): row is Extract<
    EvaluationBudgetJournalEntry,
    { type: 'call_settled' }
  > => row.type === 'call_settled' && row.caseId === input.caseId)
  const usageByReservation = new Map(p12Usage.map(row => [row.reservationId, row]))
  const reservationsById = new Set(p12Reservations.map(row => row.reservationId))
  const settlementsByReservation = new Map(p12Settlements.map(row => [row.reservationId, row]))
  if (p12Usage.some(row => (
    row.usageVersion !== V5_EVALUATION_USAGE_VERSION
    || row.model !== 'deepseek-chat'
  ))) {
    return fail('JUDGE_SOURCE_USAGE_INVALID', 'source-run P12 usage 版本或模型身份无效')
  }
  if (p12Reservations.some(row => (
    row.journalVersion !== EVALUATION_BUDGET_JOURNAL_VERSION
    || row.runId !== input.sourceRunId
  ))) {
    return fail('JUDGE_SOURCE_JOURNAL_MISMATCH', 'source-run P12 预算预留未绑定 source runId')
  }
  if (p12Usage.some(row => !reservationsById.has(row.reservationId))) {
    return fail('JUDGE_SOURCE_JOURNAL_MISMATCH', 'source-run P12 usage 缺少对应预算预留')
  }
  if (p12Reservations.some(row => (
    !usageByReservation.has(row.reservationId)
    || !settlementsByReservation.has(row.reservationId)
  ))) {
    return fail('JUDGE_SOURCE_P12_UNKNOWN', 'source-run 存在状态未知的 P12 物理请求，拒绝重复调用')
  }
  if (p12Usage.some(row => (
    row.outcome === 'success'
    || (row.inputTokens ?? 0) > 0
    || (row.outputTokens ?? 0) > 0
  ))) {
    return fail('JUDGE_SOURCE_P12_ALREADY_CONSUMED', 'source-run 已有完成或产生 Token 的 P12 请求，拒绝重复调用')
  }
  if (p12Reservations.some(row => {
    const settlement = settlementsByReservation.get(row.reservationId)
    return !settlement
      || settlement.journalVersion !== EVALUATION_BUDGET_JOURNAL_VERSION
      || settlement.runId !== input.sourceRunId
      || settlement.outcome !== 'failure'
  })) {
    return fail('JUDGE_SOURCE_JOURNAL_MISMATCH', 'source-run P12 预算结算状态与零 Token 失败记录不一致')
  }
  if (input.sourceStage === 'generation-only' && (p12Usage.length > 0 || p12Reservations.length > 0)) {
    return fail('JUDGE_SOURCE_STAGE_CONTAMINATED', 'generation-only source-run 不得包含 P12 调用记录')
  }
}

export async function loadValidatedJudgeSourceRun(input: {
  sourceRun: string
  outputRoot: string
  historyDigest: string
  selectedCases: readonly number[]
  cases: readonly JudgeSourceCaseExpectation[]
}): Promise<ValidatedJudgeSourceRun> {
  const sourceRun = await canonicalPath(input.sourceRun)
  const outputRoot = await canonicalPath(input.outputRoot)
  if (pathContains(sourceRun, outputRoot) || pathContains(outputRoot, sourceRun)) {
    return fail('JUDGE_SOURCE_OUTPUT_OVERLAP', 'source-run 与新输出目录不得相同或互相嵌套')
  }

  const manifestCheckpoint = await readCheckpointUnbound<unknown>({
    path: resolve(sourceRun, 'run-manifest.json'),
    kind: 'run_manifest',
    caseId: 'run',
  })
  if (!manifestCheckpoint) return fail('JUDGE_SOURCE_MANIFEST_MISSING', 'source-run 缺少版本化 run manifest')
  assertFingerprints(manifestCheckpoint.fingerprints, 'source-run manifest')
  const sourceManifest = parseSourceManifest(manifestCheckpoint.payload)
  if (sourceManifest.runnerProtocolVersion !== V5_EVALUATION_RUNNER_PROTOCOL_VERSION) {
    return fail('JUDGE_SOURCE_PROTOCOL_MISMATCH', 'source-run runner 协议版本不受当前续跑器支持')
  }
  if (sourceManifest.stage !== 'generation-only' && sourceManifest.stage !== 'full') {
    return fail('JUDGE_SOURCE_STAGE_INVALID', 'source-run 必须来自 generation-only 或 full')
  }
  if (sourceManifest.sourceRun !== null) {
    return fail('JUDGE_SOURCE_CHAIN_BLOCKED', '禁止从另一个 judge-only/source-run 结果继续链式取源')
  }
  if (
    sourceManifest.provider.endpoint !== 'https://api.deepseek.com'
    || sourceManifest.provider.model !== 'deepseek-chat'
    || sourceManifest.provider.maxProviderAttempts !== 1
    || sourceManifest.provider.fallbackEnabled
  ) {
    return fail('JUDGE_SOURCE_PROVIDER_INVALID', 'source-run 不是受限的单次直连 DeepSeek 配置')
  }
  if (manifestCheckpoint.fingerprints.inputDigest !== input.historyDigest) {
    return fail('JUDGE_SOURCE_HISTORY_MISMATCH', 'source-run 的历史数据摘要与当前冻结数据不一致')
  }
  if (
    sourceManifest.selectedCases.join(',') !== input.selectedCases.join(',')
    || input.cases.map(item => item.caseNumber).join(',') !== input.selectedCases.join(',')
  ) {
    return fail('JUDGE_SOURCE_CASE_SELECTION_MISMATCH', 'source-run 与 judge-only 的案例选择不一致')
  }

  const validatedCases: ValidatedJudgeSourceCase[] = []
  const caseProvenance: JudgeSourceCaseProvenance[] = []
  for (const expected of input.cases) {
    const sourceV5Path = resolve(sourceRun, 'cases', `${expected.prefix}-v5-result.json`)
    const checkpoint = await readCheckpointUnbound<unknown>({
      path: sourceV5Path,
      kind: 'v5_result',
      caseId: expected.caseId,
    })
    if (!checkpoint) {
      return fail('JUDGE_SOURCE_RESULT_MISSING', `案例 ${expected.caseNumber} 缺少 v5 result 检查点`)
    }
    assertFingerprints(checkpoint.fingerprints, `案例 ${expected.caseNumber} v5 result`)
    if (
      checkpoint.fingerprints.inputDigest !== expected.inputDigest
      || checkpoint.fingerprints.implementationDigest !== manifestCheckpoint.fingerprints.implementationDigest
      || checkpoint.fingerprints.configDigest !== manifestCheckpoint.fingerprints.configDigest
    ) {
      return fail(
        'JUDGE_SOURCE_RESULT_FINGERPRINT_MISMATCH',
        `案例 ${expected.caseNumber} 的 v5 result 未与 source-run manifest 和当前冻结输入绑定`
      )
    }
    const existingAb = await readCheckpointUnbound<unknown>({
      path: resolve(sourceRun, 'cases', `${expected.prefix}-ab.json`),
      kind: 'blind_ab',
      caseId: expected.caseId,
    })
    if (existingAb) {
      return fail('JUDGE_SOURCE_ALREADY_EVALUATED', `案例 ${expected.caseNumber} 已有完整盲评检查点`)
    }
    await assertNoCompletedOrUnknownJudgeCalls({
      sourceRun,
      sourceRunId: sourceManifest.runId,
      caseId: expected.caseId,
      sourceStage: sourceManifest.stage,
    })
    const v5Result = validateSourceResult({
      payload: checkpoint.payload,
      expectedResumeDigest: expected.resumeDigest,
      caseNumber: expected.caseNumber,
    })
    const markdown = await readFile(resolve(sourceRun, 'cases', `${expected.prefix}-v5.md`), 'utf8')
    if (markdown !== v5Result.artifact.markdown) {
      return fail('JUDGE_SOURCE_MARKDOWN_MISMATCH', `案例 ${expected.caseNumber} 的 v5 Markdown 与检查点不一致`)
    }
    const sourceCheckpoint = checkpoint as EvaluationCheckpointEnvelope<V5WorkflowResult>
    validatedCases.push({
      caseNumber: expected.caseNumber,
      caseId: expected.caseId,
      v5Result,
      sourceCheckpoint,
    })
    caseProvenance.push({
      caseNumber: expected.caseNumber,
      caseId: expected.caseId,
      inputDigest: expected.inputDigest,
      sourceV5PayloadSha256: checkpoint.payloadSha256,
      sourceV5Fingerprints: { ...checkpoint.fingerprints },
    })
  }

  const provenanceWithoutDigest = {
    sourceRunId: sourceManifest.runId,
    sourceRunnerProtocolVersion: sourceManifest.runnerProtocolVersion,
    sourceStage: sourceManifest.stage as 'generation-only' | 'full',
    historyDigest: input.historyDigest,
    sourceManifestPayloadSha256: manifestCheckpoint.payloadSha256,
    sourceManifestFingerprints: { ...manifestCheckpoint.fingerprints },
    cases: caseProvenance,
  }
  return {
    sourceRun,
    provenance: {
      ...provenanceWithoutDigest,
      contentDigest: digestJson(provenanceWithoutDigest),
    },
    cases: validatedCases,
  }
}
