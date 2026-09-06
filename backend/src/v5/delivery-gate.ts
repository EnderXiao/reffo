import type {
  GeneratedResumeArtifact,
  GenerationPolicy,
  ResumeAgentState,
  ResumeEvidenceBundle,
  ValidationIssue,
  V5DeliveryDiagnostics,
  V5MatchAnalysis,
  V5ResumePlan,
  V5WorkflowResult,
} from '@/v5/types'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'

const SAFE_DIAGNOSTIC_CODE = /^[A-Z][A-Z0-9_]{0,63}$/
const UNCLASSIFIED_DIAGNOSTIC_CODE = 'V5_UNCLASSIFIED_DIAGNOSTIC_CODE'
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
] as const satisfies readonly ResumeAgentState[]
const FAILURE_AGENT_STATES = [
  'blocked_input_validation',
  'blocked_fact_validation',
  'blocked_structure_validation',
  'blocked_quality_validation',
  'provider_failure',
  'workflow_failure',
] as const satisfies readonly ResumeAgentState[]
const DIAGNOSTIC_COUNT_KEYS = [
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

type PlanOrigin = V5DeliveryDiagnostics['provenance']['planOrigin']
type ArtifactOrigin = V5DeliveryDiagnostics['provenance']['artifactOrigin']

function safeCode(value: string) {
  return SAFE_DIAGNOSTIC_CODE.test(value) ? value : null
}

function safeCodes(values: string[]) {
  const sanitized = values.map(safeCode)
  const valid = sanitized.filter((value): value is string => Boolean(value))
  if (sanitized.some(value => value === null)) valid.push(UNCLASSIFIED_DIAGNOSTIC_CODE)
  return [...new Set(valid)].sort()
}

function issueCounts(issues: ValidationIssue[], severities: ValidationIssue['severity'][] = ['error']) {
  const counts = new Map<string, number>()
  let unclassifiedIssueCount = 0
  for (const issue of issues) {
    if (!severities.includes(issue.severity)) continue
    const code = safeCode(issue.code)
    if (!code) {
      unclassifiedIssueCount += 1
      continue
    }
    counts.set(code, (counts.get(code) ?? 0) + 1)
  }
  return {
    counts: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
    unclassifiedIssueCount,
  }
}

export interface V5DeliveryGateAssessmentInput {
  validationPassed: boolean
  usedSafeFallback: boolean
  hasAdvisoryQualityIssues: boolean
  advisoryIssueCodes?: string[]
  /** Versioned rollout: ordinary quality warnings do not veto the Writer path. */
  advisoryPolicy?: 'legacy_block' | 'warnings_only'
}

export interface V5DeliveryGateAssessment {
  qualityGates: V5WorkflowResult['qualityGates']
  deliveryDecision: V5WorkflowResult['deliveryDecision']
  reasonCodes: string[]
}

export interface V5DeliverableResultShape {
  state?: ResumeAgentState | string
  executionStatus?: V5WorkflowResult['executionStatus'] | string
  deliveryDecision?: V5WorkflowResult['deliveryDecision'] | string
  usedSafeFallback?: boolean
  usedAnyFallback?: boolean
  qualityGates?: Partial<V5WorkflowResult['qualityGates']>
  deliveryDiagnostics?: unknown
  interviewPreparation?: unknown
  generationProvenance?: {
    planOrigin?: V5DeliveryDiagnostics['provenance']['planOrigin'] | string
    artifactOrigin?: V5DeliveryDiagnostics['provenance']['artifactOrigin'] | string
  }
}

export type V5DeliveryEnvelopeConsistencyIssue =
  | 'LEGACY_ENVELOPE_INVALID'
  | 'DELIVERY_DIAGNOSTICS_INVALID'
  | 'EXECUTION_STATUS_MISMATCH'
  | 'PHASE_REACHED_MISMATCH'
  | 'DISPOSITION_MISMATCH'
  | 'FACT_SAFETY_MISMATCH'
  | 'PRODUCT_QUALITY_MISMATCH'
  | 'PLAN_ORIGIN_MISMATCH'
  | 'ARTIFACT_ORIGIN_MISMATCH'
  | 'SAFE_FALLBACK_MISMATCH'
  | 'ANY_FALLBACK_MISMATCH'
  | 'INTERVIEW_STATUS_MISMATCH'

export interface V5DeliveryEnvelopeConsistencyResult {
  passed: boolean
  issueCodes: V5DeliveryEnvelopeConsistencyIssue[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index])
}

function isEnum<TValue extends string>(value: unknown, values: readonly TValue[]): value is TValue {
  return typeof value === 'string' && values.includes(value as TValue)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

function isDiagnosticCodes(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length <= 100
    && value.every(item => typeof item === 'string' && SAFE_DIAGNOSTIC_CODE.test(item))
}

function isDiagnosticCounts(value: unknown): value is Record<string, number> {
  return isRecord(value)
    && Object.keys(value).length <= 200
    && Object.entries(value).every(([code, count]) => (
      SAFE_DIAGNOSTIC_CODE.test(code) && isNonNegativeSafeInteger(count)
    ))
}

function hasNoDiagnosticCounts(value: Record<string, number>) {
  return Object.keys(value).length === 0
}

function isDiagnosticCoverage(value: unknown) {
  if (!isRecord(value)) return false
  return isNonNegativeSafeInteger(value.numerator)
    && isNonNegativeSafeInteger(value.denominator)
    && value.numerator <= value.denominator
}

function isDeliveryMetrics(value: unknown) {
  if (!isRecord(value)) return false
  if (!hasExactKeys(value, [
    ...DIAGNOSTIC_COUNT_KEYS,
    'plannedEvidenceCoverage',
    'stableCoreCoverage',
    'primaryRequirementCoverage',
    'outputLengthUnit',
    'outputLengthSoftMin',
    'outputLengthHardMin',
  ])) return false
  if (DIAGNOSTIC_COUNT_KEYS.some(key => !isNonNegativeSafeInteger(value[key]))) return false
  if (
    !isDiagnosticCoverage(value.plannedEvidenceCoverage)
    || !isDiagnosticCoverage(value.stableCoreCoverage)
    || !isDiagnosticCoverage(value.primaryRequirementCoverage)
    || !isEnum(value.outputLengthUnit, ['cjk_characters', 'words'] as const)
  ) return false
  if (
    !(value.outputLengthSoftMin === null || isNonNegativeSafeInteger(value.outputLengthSoftMin))
    || !(value.outputLengthHardMin === null || isNonNegativeSafeInteger(value.outputLengthHardMin))
  ) return false

  const metrics = value as unknown as Exclude<V5DeliveryDiagnostics['metrics'], null>
  const plannedCoverage = metrics.plannedEvidenceCoverage
  const softMin = metrics.outputLengthSoftMin
  const hardMin = metrics.outputLengthHardMin
  return metrics.mappedSourceBlockCount + metrics.unmappedSourceBlockCount === metrics.sourceBlockCount
    && metrics.highImportanceUnmappedCount <= metrics.unmappedSourceBlockCount
    && plannedCoverage.denominator === metrics.plannedContentEvidenceCount
    && plannedCoverage.numerator === metrics.usedPlannedEvidenceCount
    && metrics.usedPlannedEvidenceCount <= metrics.plannedContentEvidenceCount
    && metrics.targetBusinessBulletMin <= metrics.targetBusinessBulletTarget
    && metrics.targetBusinessBulletTarget <= metrics.targetBusinessBulletMax
    && metrics.outputLengthSoftMax <= metrics.outputLengthHardMax
    && ((softMin === null && hardMin === null)
      || (softMin !== null && hardMin !== null && hardMin <= softMin && softMin <= metrics.outputLengthSoftMax))
}

interface FailurePhaseSemantics {
  factSafety: V5DeliveryDiagnostics['tracks']['factSafety']['status']
  productQuality: V5DeliveryDiagnostics['tracks']['productQuality']['status']
  legacyQualityGates: V5WorkflowResult['qualityGates']
}

function failurePhaseSemantics(state: ResumeAgentState): FailurePhaseSemantics | null {
  if (!isEnum(state, FAILURE_AGENT_STATES)) return null
  if ([
    'blocked_input_validation',
    'blocked_fact_validation',
    'blocked_structure_validation',
  ].includes(state)) {
    return {
      factSafety: 'fail',
      productQuality: 'not_run',
      legacyQualityGates: {
        factSafety: 'fail',
        contentCompleteness: 'not_run',
        deliverability: 'not_run',
      },
    }
  }
  if (state === 'blocked_quality_validation') {
    return {
      factSafety: 'pass',
      productQuality: 'fail',
      legacyQualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'fail',
        deliverability: 'fail',
      },
    }
  }
  if (state === 'provider_failure' || state === 'workflow_failure') {
    return {
      factSafety: 'not_run',
      productQuality: 'not_run',
      legacyQualityGates: {
        factSafety: 'not_run',
        contentCompleteness: 'not_run',
        deliverability: 'not_run',
      },
    }
  }
  return null
}

function isIntrinsicDeliveryDiagnosticsConsistent(diagnostics: V5DeliveryDiagnostics) {
  const { outcome, tracks, provenance, metrics } = diagnostics
  if (provenance.usedSafeFallback && !provenance.usedAnyFallback) return false

  if (outcome.execution === 'failed') {
    const expectedPhase = failurePhaseSemantics(outcome.phaseReached)
    return expectedPhase !== null
      && metrics === null
      && outcome.disposition !== 'deliverable'
      && outcome.disposition !== 'review_required'
      && outcome.disposition !== 'internal_only'
      && !['succeeded', 'succeeded_with_safe_fallback'].includes(outcome.phaseReached)
      && tracks.factSafety.status === expectedPhase.factSafety
      && tracks.productQuality.status === expectedPhase.productQuality
      && provenance.planOrigin === 'none'
      && provenance.artifactOrigin === 'none'
      && provenance.usedSafeFallback === false
      && provenance.usedAnyFallback === false
      && provenance.interview === 'not_reached'
  }

  if (metrics === null) return false
  if (outcome.disposition === 'deliverable') {
    return outcome.phaseReached === 'succeeded'
      && outcome.decisionReasonCodes.length === 0
      && tracks.factSafety.status === 'pass'
      && hasNoDiagnosticCounts(tracks.factSafety.finalIssueCounts)
      && tracks.factSafety.unclassifiedIssueCount === 0
      && tracks.productQuality.status === 'pass'
      && hasNoDiagnosticCounts(tracks.productQuality.issueCounts)
      && provenance.usedSafeFallback === false
      && (
        provenance.artifactOrigin === 'model'
        || provenance.artifactOrigin === 'model_repair'
        || provenance.artifactOrigin === 'server_compiler'
      )
      && (
        provenance.interview === 'generated'
        || provenance.interview === 'deferred'
        || provenance.interview === 'failed_optional'
      )
  }
  if (outcome.disposition === 'review_required') {
    return outcome.phaseReached === 'blocked_quality_validation'
      && tracks.factSafety.status === 'pass'
      && tracks.productQuality.status === 'review_required'
      && provenance.usedSafeFallback === false
      && provenance.interview === 'skipped_by_gate'
  }
  if (outcome.disposition === 'internal_only') {
    return outcome.phaseReached === 'blocked_quality_validation'
      && tracks.factSafety.status === 'pass'
      && tracks.productQuality.status === 'fail'
      && provenance.usedSafeFallback === true
      && provenance.usedAnyFallback === true
      && (provenance.artifactOrigin === 'server_renderer' || provenance.artifactOrigin === 'emergency')
      && provenance.interview === 'skipped_by_gate'
  }
  return outcome.disposition === 'blocked_terminal'
    && tracks.factSafety.status === 'fail'
    && tracks.productQuality.status === 'fail'
    && provenance.interview === 'skipped_by_gate'
}

/** Strict structural runtime guard shared by delivery boundaries. */
export function isV5DeliveryDiagnosticsV2(value: unknown): value is V5DeliveryDiagnostics {
  if (!isRecord(value)) return false
  if (
    !hasExactKeys(value, ['version', 'taxonomyVersion', 'outcome', 'tracks', 'provenance', 'metrics'])
    ||
    value.version !== 'v5-delivery-diagnostics-v2'
    || value.taxonomyVersion !== 'v5-delivery-taxonomy-v1'
    || !isRecord(value.outcome)
    || !isRecord(value.tracks)
    || !isRecord(value.provenance)
  ) return false

  const outcome = value.outcome
  const tracks = value.tracks
  const provenance = value.provenance
  if (!isRecord(tracks.factSafety) || !isRecord(tracks.productQuality)) return false
  const factSafety = tracks.factSafety
  const productQuality = tracks.productQuality
  if (
    !hasExactKeys(outcome, ['execution', 'phaseReached', 'disposition', 'decisionReasonCodes'])
    || !hasExactKeys(tracks, ['factSafety', 'productQuality'])
    || !hasExactKeys(factSafety, [
      'status',
      'finalIssueCounts',
      'rejectedCandidateIssueCounts',
      'unclassifiedIssueCount',
    ])
    || !hasExactKeys(productQuality, ['status', 'issueCounts'])
    || !hasExactKeys(provenance, [
      'planOrigin',
      'artifactOrigin',
      'usedSafeFallback',
      'usedAnyFallback',
      'interview',
    ])
    ||
    !isEnum(outcome.execution, ['completed', 'failed'] as const)
    || !isEnum(outcome.phaseReached, RESUME_AGENT_STATES)
    || !isEnum(outcome.disposition, [
      'deliverable',
      'review_required',
      'internal_only',
      'blocked_retryable',
      'blocked_terminal',
    ] as const)
    || !isDiagnosticCodes(outcome.decisionReasonCodes)
    || !isEnum(factSafety.status, ['pass', 'fail', 'not_run'] as const)
    || !isDiagnosticCounts(factSafety.finalIssueCounts)
    || !isDiagnosticCounts(factSafety.rejectedCandidateIssueCounts)
    || !isNonNegativeSafeInteger(factSafety.unclassifiedIssueCount)
    || !isEnum(productQuality.status, ['pass', 'review_required', 'fail', 'not_run'] as const)
    || !isDiagnosticCounts(productQuality.issueCounts)
    || !isEnum(provenance.planOrigin, ['model_primary', 'model_repair', 'deterministic_quality', 'none'] as const)
    || !isEnum(provenance.artifactOrigin, ['model', 'model_repair', 'server_compiler', 'server_renderer', 'emergency', 'none'] as const)
    || typeof provenance.usedSafeFallback !== 'boolean'
    || typeof provenance.usedAnyFallback !== 'boolean'
    || !isEnum(provenance.interview, [
      'generated',
      'deferred',
      'skipped_by_gate',
      'failed_optional',
      'not_reached',
    ] as const)
  ) return false

  return outcome.execution === 'completed'
    ? isDeliveryMetrics(value.metrics)
    : value.metrics === null
}

export function isV5DeliveryDiagnosticsSemanticallyValid(
  value: unknown
): value is V5DeliveryDiagnostics {
  return isV5DeliveryDiagnosticsV2(value)
    && isIntrinsicDeliveryDiagnosticsConsistent(value)
}

function expectedDisposition(result: V5DeliverableResultShape) {
  if (result.executionStatus === 'failed') {
    return result.deliveryDecision === 'block'
      ? new Set<V5DeliveryDiagnostics['outcome']['disposition']>(['blocked_retryable', 'blocked_terminal'])
      : null
  }
  if (result.deliveryDecision === 'deliver') return new Set(['deliverable'] as const)
  if (result.deliveryDecision === 'internal_only') return new Set(['internal_only'] as const)
  if (result.deliveryDecision === 'block') {
    return new Set(result.qualityGates?.deliverability === 'review_required'
      ? ['review_required'] as const
      : ['blocked_terminal'] as const
    )
  }
  return null
}

function expectedProductQuality(result: V5DeliverableResultShape) {
  if (result.executionStatus === 'failed') return result.qualityGates?.deliverability === 'not_run' ? 'not_run' : 'fail'
  if (result.deliveryDecision === 'deliver') return 'pass'
  if (result.qualityGates?.deliverability === 'review_required') return 'review_required'
  return 'fail'
}

function hasCanonicalLegacyEnvelope(result: V5DeliverableResultShape) {
  const provenance = result.generationProvenance
  const gates = result.qualityGates
  if (
    !isEnum(result.state, RESUME_AGENT_STATES)
    || !isEnum(result.executionStatus, ['completed', 'failed'] as const)
    || !isEnum(result.deliveryDecision, ['deliver', 'block', 'internal_only'] as const)
    || typeof result.usedSafeFallback !== 'boolean'
    || typeof result.usedAnyFallback !== 'boolean'
    || !gates
    || !isEnum(gates.factSafety, ['pass', 'fail', 'not_run'] as const)
    || !isEnum(gates.contentCompleteness, ['pass', 'fail', 'not_run'] as const)
    || !isEnum(gates.deliverability, ['pass', 'fail', 'review_required', 'not_run'] as const)
    || !provenance
    || !isEnum(provenance.planOrigin, ['model_primary', 'model_repair', 'deterministic_quality', 'none'] as const)
    || !isEnum(provenance.artifactOrigin, ['model', 'model_repair', 'server_compiler', 'server_renderer', 'emergency', 'none'] as const)
  ) return false

  if (result.executionStatus === 'failed') {
    const expectedPhase = failurePhaseSemantics(result.state)
    return result.deliveryDecision === 'block'
      && expectedPhase !== null
      && gates.factSafety === expectedPhase.legacyQualityGates.factSafety
      && gates.contentCompleteness === expectedPhase.legacyQualityGates.contentCompleteness
      && gates.deliverability === expectedPhase.legacyQualityGates.deliverability
  }
  if (result.deliveryDecision === 'deliver') {
    return result.state === 'succeeded'
      && result.usedSafeFallback === false
      && gates.factSafety === 'pass'
      && gates.contentCompleteness === 'pass'
      && gates.deliverability === 'pass'
      && (
        provenance.artifactOrigin === 'model'
        || provenance.artifactOrigin === 'model_repair'
        || provenance.artifactOrigin === 'server_compiler'
      )
  }
  if (result.deliveryDecision === 'internal_only') {
    return result.state === 'blocked_quality_validation'
      && result.usedSafeFallback === true
      && result.usedAnyFallback === true
      && gates.factSafety === 'pass'
      && gates.contentCompleteness === 'fail'
      && gates.deliverability === 'fail'
      && (provenance.artifactOrigin === 'server_renderer' || provenance.artifactOrigin === 'emergency')
  }
  if (gates.deliverability === 'review_required') {
    return result.state === 'blocked_quality_validation'
      && result.usedSafeFallback === false
      && gates.factSafety === 'pass'
      && gates.contentCompleteness === 'fail'
  }
  return result.state === 'blocked_quality_validation'
    && result.usedSafeFallback === false
    && gates.deliverability === 'fail'
    && gates.contentCompleteness === 'fail'
}

/**
 * Validates that the legacy delivery envelope and diagnostics describe exactly
 * the same terminal outcome. It never throws so public and historical
 * boundaries can fail closed.
 */
export function validateV5DeliveryEnvelopeConsistency(
  result: V5DeliverableResultShape
): V5DeliveryEnvelopeConsistencyResult {
  const issues = new Set<V5DeliveryEnvelopeConsistencyIssue>()
  if (!hasCanonicalLegacyEnvelope(result)) issues.add('LEGACY_ENVELOPE_INVALID')
  if (!isV5DeliveryDiagnosticsV2(result.deliveryDiagnostics)) {
    issues.add('DELIVERY_DIAGNOSTICS_INVALID')
    return { passed: false, issueCodes: [...issues].sort() }
  }

  const diagnostics = result.deliveryDiagnostics
  if (!isV5DeliveryDiagnosticsSemanticallyValid(diagnostics)) {
    issues.add('DELIVERY_DIAGNOSTICS_INVALID')
  }
  if (diagnostics.outcome.execution !== result.executionStatus) issues.add('EXECUTION_STATUS_MISMATCH')
  if (diagnostics.outcome.phaseReached !== result.state) issues.add('PHASE_REACHED_MISMATCH')
  const disposition = expectedDisposition(result)
  if (!disposition || !disposition.has(diagnostics.outcome.disposition)) issues.add('DISPOSITION_MISMATCH')
  if (diagnostics.tracks.factSafety.status !== result.qualityGates?.factSafety) issues.add('FACT_SAFETY_MISMATCH')
  if (diagnostics.tracks.productQuality.status !== expectedProductQuality(result)) {
    issues.add('PRODUCT_QUALITY_MISMATCH')
  }
  if (diagnostics.provenance.planOrigin !== result.generationProvenance?.planOrigin) {
    issues.add('PLAN_ORIGIN_MISMATCH')
  }
  if (diagnostics.provenance.artifactOrigin !== result.generationProvenance?.artifactOrigin) {
    issues.add('ARTIFACT_ORIGIN_MISMATCH')
  }
  if (diagnostics.provenance.usedSafeFallback !== result.usedSafeFallback) {
    issues.add('SAFE_FALLBACK_MISMATCH')
  }
  if (diagnostics.provenance.usedAnyFallback !== result.usedAnyFallback) {
    issues.add('ANY_FALLBACK_MISMATCH')
  }
  const hasInterviewPreparation = result.interviewPreparation !== undefined
    && result.interviewPreparation !== null
  const interviewStatus = diagnostics.provenance.interview
  const interviewConsistent = result.executionStatus === 'failed'
    ? interviewStatus === 'not_reached' && !hasInterviewPreparation
    : result.deliveryDecision !== 'deliver'
      ? interviewStatus === 'skipped_by_gate' && !hasInterviewPreparation
      : interviewStatus === 'generated'
        ? hasInterviewPreparation
        : (interviewStatus === 'deferred' || interviewStatus === 'failed_optional')
          && !hasInterviewPreparation
  if (!interviewConsistent) issues.add('INTERVIEW_STATUS_MISMATCH')

  return { passed: issues.size === 0, issueCodes: [...issues].sort() }
}

/**
 * Converts deterministic validation signals into a product delivery decision.
 * A server-rendered fallback remains available for diagnostics, but is never
 * treated as a user-deliverable resume.
 */
export function assessV5DeliveryGate(
  input: V5DeliveryGateAssessmentInput
): V5DeliveryGateAssessment {
  if (!input.validationPassed) {
    return {
      qualityGates: {
        factSafety: 'fail',
        contentCompleteness: 'fail',
        deliverability: 'fail',
      },
      deliveryDecision: 'block',
      reasonCodes: ['DETERMINISTIC_VALIDATION_FAILED'],
    }
  }

  if (input.usedSafeFallback) {
    return {
      qualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'fail',
        deliverability: 'fail',
      },
      deliveryDecision: 'internal_only',
      reasonCodes: ['SAFE_FALLBACK_INTERNAL_ONLY'],
    }
  }

  if (input.hasAdvisoryQualityIssues && input.advisoryPolicy !== 'warnings_only') {
    return {
      qualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'fail',
        deliverability: 'review_required',
      },
      deliveryDecision: 'block',
      reasonCodes: [...new Set(
        safeCodes(input.advisoryIssueCodes?.length
          ? input.advisoryIssueCodes
          : ['PRODUCT_QUALITY_ADVISORY']
        )
      )].sort(),
    }
  }

  return {
    qualityGates: {
      factSafety: 'pass',
      contentCompleteness: 'pass',
      deliverability: 'pass',
    },
    deliveryDecision: 'deliver',
    reasonCodes: [],
  }
}

export function buildV5DeliveryDiagnostics(input: {
  assessment: V5DeliveryGateAssessment
  resume: ResumeEvidenceBundle
  match: V5MatchAnalysis
  plan: V5ResumePlan
  policy: GenerationPolicy
  artifact: GeneratedResumeArtifact
  state: ResumeAgentState
  planOrigin: PlanOrigin
  artifactOrigin: ArtifactOrigin
  usedSafeFallback: boolean
  usedAnyFallback: boolean
  interview: V5DeliveryDiagnostics['provenance']['interview']
  finalValidationIssues: ValidationIssue[]
  rejectedCandidateIssues: ValidationIssue[]
}): V5DeliveryDiagnostics {
  const evidenceById = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const eligibleEvidence = input.resume.evidenceAtoms.filter(atom => (
    atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii')
  ))
  const plannedContentIds = [...new Set([
    ...input.plan.stableCoreEvidenceIds,
    ...input.plan.customizedEvidenceIds,
    ...input.plan.featuredSkillEvidenceIds,
    ...input.plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds),
  ])].filter(id => {
    const atom = evidenceById.get(id)
    return Boolean(atom && atom.status !== 'excluded' && !atom.riskFlags.includes('sensitive_pii'))
  })
  const usedIds = new Set(input.artifact.usedEvidenceIds)
  const usedPlannedEvidenceCount = plannedContentIds.filter(id => usedIds.has(id)).length
  const stableCoreIds = [...new Set(input.plan.stableCoreEvidenceIds)]
  const coveredStableCoreCount = stableCoreIds.filter(id => usedIds.has(id)).length
  const primaryRequirementIds = [...new Set(input.plan.primaryRequirementIds)]
  const requirementMatches = new Map(input.match.requirementMatches.map(item => [item.requirementId, item]))
  const coveredPrimaryRequirementCount = primaryRequirementIds.filter(requirementId => {
    const match = requirementMatches.get(requirementId)
    return Boolean(match && match.evidenceIds.some(id => usedIds.has(id)))
  }).length
  const finalIssues = issueCounts(input.finalValidationIssues)
  const rejectedIssues = issueCounts(input.rejectedCandidateIssues, ['error', 'warning'])
  const factSafetyStatus = input.assessment.qualityGates.factSafety === 'pass' ? 'pass' : 'fail'
  if (factSafetyStatus === 'pass' && (
    Object.keys(finalIssues.counts).length > 0 || finalIssues.unclassifiedIssueCount > 0
  )) {
    throw new Error('V5 delivery diagnostics invariant failed: passed fact safety contains final errors')
  }
  const outputLengthValue = input.policy.outputLength.unit === 'cjk_characters'
    ? input.artifact.renderStats.cjkCharacterCount
    : input.artifact.renderStats.wordCount
  const productQualityStatus = input.assessment.deliveryDecision === 'deliver'
    ? 'pass' as const
    : input.assessment.qualityGates.deliverability === 'review_required'
      ? 'review_required' as const
      : 'fail' as const
  const disposition = input.assessment.deliveryDecision === 'deliver'
    ? 'deliverable' as const
    : input.assessment.deliveryDecision === 'internal_only'
      ? 'internal_only' as const
      : input.assessment.qualityGates.deliverability === 'review_required'
        ? 'review_required' as const
        : 'blocked_terminal' as const
  const productIssueCounts = Object.fromEntries(
    safeCodes(input.assessment.reasonCodes).map(code => [code, 1])
  )
  const catalog = buildEvidencePlanningCatalog(input.resume)
  const eligibleBusinessAtoms = eligibleEvidence.filter(atom => catalog.businessAnchorEvidenceIds.includes(atom.evidenceId))

  return {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: 'completed',
      phaseReached: input.state,
      disposition,
      decisionReasonCodes: safeCodes(input.assessment.reasonCodes),
    },
    tracks: {
      factSafety: {
        status: factSafetyStatus,
        finalIssueCounts: finalIssues.counts,
        rejectedCandidateIssueCounts: rejectedIssues.counts,
        unclassifiedIssueCount: finalIssues.unclassifiedIssueCount + rejectedIssues.unclassifiedIssueCount,
      },
      productQuality: {
        status: productQualityStatus,
        issueCounts: productIssueCounts,
      },
    },
    provenance: {
      planOrigin: input.planOrigin,
      artifactOrigin: input.artifactOrigin,
      usedSafeFallback: input.usedSafeFallback,
      usedAnyFallback: input.usedAnyFallback,
      interview: input.interview,
    },
    metrics: {
      sourceBlockCount: input.resume.extractionCoverage.sourceBlockCount,
      mappedSourceBlockCount: input.resume.extractionCoverage.mappedBlockCount,
      unmappedSourceBlockCount: input.resume.extractionCoverage.unmappedBlockCount,
      highImportanceUnmappedCount: input.resume.extractionCoverage.highImportanceUnmappedCount,
      eligibleBusinessEvidenceCount: eligibleBusinessAtoms.length,
      eligibleBusinessScopeCount: new Set(eligibleBusinessAtoms.map(atom => atom.sourceScopeId)).size,
      plannedContentEvidenceCount: plannedContentIds.length,
      usedPlannedEvidenceCount,
      plannedEvidenceCoverage: { numerator: usedPlannedEvidenceCount, denominator: plannedContentIds.length },
      stableCoreCoverage: { numerator: coveredStableCoreCount, denominator: stableCoreIds.length },
      primaryRequirementCoverage: { numerator: coveredPrimaryRequirementCount, denominator: primaryRequirementIds.length },
      renderedBusinessBulletCount: input.artifact.renderStats.businessBulletCount,
      renderedTotalListItemCount: input.artifact.renderStats.totalListItemCount,
      renderedProjectCount: input.artifact.renderStats.projectCount,
      targetBusinessBulletMin: input.policy.targetBusinessBulletMin,
      targetBusinessBulletTarget: input.policy.targetBusinessBulletTarget,
      targetBusinessBulletMax: input.policy.targetBusinessBulletMax,
      outputLengthUnit: input.policy.outputLength.unit,
      outputLengthValue,
      outputLengthSoftMin: input.policy.outputLength.softMin,
      outputLengthHardMin: input.policy.outputLength.hardMin,
      outputLengthSoftMax: input.policy.outputLength.softMax,
      outputLengthHardMax: input.policy.outputLength.hardMax,
    },
  }
}

export function buildV5FailureDiagnostics(input: {
  state: ResumeAgentState
  code: string
  retryable: boolean
  issues: ValidationIssue[]
}): V5DeliveryDiagnostics {
  const phaseSemantics = failurePhaseSemantics(input.state)
  if (!phaseSemantics) {
    throw new Error(`V5 failure diagnostics require a terminal failure phase: ${input.state}`)
  }
  const isSafetyFailure = phaseSemantics.factSafety === 'fail'
  const isQualityFailure = phaseSemantics.productQuality === 'fail'
  const summarized = issueCounts(input.issues, ['error', 'warning'])
  const decisionReasonCodes = safeCodes([input.code])
  return {
    version: 'v5-delivery-diagnostics-v2',
    taxonomyVersion: 'v5-delivery-taxonomy-v1',
    outcome: {
      execution: 'failed',
      phaseReached: input.state,
      disposition: input.retryable ? 'blocked_retryable' : 'blocked_terminal',
      decisionReasonCodes,
    },
    tracks: {
      factSafety: {
        status: phaseSemantics.factSafety,
        finalIssueCounts: isSafetyFailure ? summarized.counts : {},
        rejectedCandidateIssueCounts: {},
        unclassifiedIssueCount: isSafetyFailure ? summarized.unclassifiedIssueCount : 0,
      },
      productQuality: {
        status: phaseSemantics.productQuality,
        issueCounts: isQualityFailure
          ? Object.fromEntries(decisionReasonCodes.map(code => [code, 1]))
          : {},
      },
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

/**
 * Single source of truth for every boundary that can expose or evaluate a V5
 * artifact. Historical or malformed checkpoints fail closed without throwing.
 */
export function isV5ProductDeliverable(result: V5DeliverableResultShape) {
  if (!validateV5DeliveryEnvelopeConsistency(result).passed) return false
  const artifactOrigin = result.generationProvenance?.artifactOrigin
  return result.state === 'succeeded'
    && result.executionStatus === 'completed'
    && result.deliveryDecision === 'deliver'
    && result.usedSafeFallback === false
    && result.qualityGates?.factSafety === 'pass'
    && result.qualityGates?.contentCompleteness === 'pass'
    && result.qualityGates?.deliverability === 'pass'
    && (
      artifactOrigin === 'model'
      || artifactOrigin === 'model_repair'
      || artifactOrigin === 'server_compiler'
    )
}
