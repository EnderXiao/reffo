import { describe, expect, test } from 'bun:test'
import {
  assessV5DeliveryGate,
  buildV5DeliveryDiagnostics,
  buildV5FailureDiagnostics,
  isV5DeliveryDiagnosticsSemanticallyValid,
  isV5ProductDeliverable,
  validateV5DeliveryEnvelopeConsistency,
} from '@/v5/delivery-gate'
import {
  createHistoricalV5ResultWithInterviewPreparation,
  createV5ResultFixture,
} from '@/v5/tests/fixtures'

describe('V5 deterministic delivery gate', () => {
  test('Writer warnings remain non-blocking without releasing hard failures or fallback', () => {
    const input = { validationPassed: true, usedSafeFallback: false, hasAdvisoryQualityIssues: true, advisoryIssueCodes: ['OUTPUT_CONTENT_UNDERSIZED'], advisoryPolicy: 'warnings_only' as const }
    expect(assessV5DeliveryGate(input).deliveryDecision).toBe('deliver')
    expect(assessV5DeliveryGate({ ...input, validationPassed: false }).deliveryDecision).toBe('block')
    expect(assessV5DeliveryGate({ ...input, usedSafeFallback: true }).deliveryDecision).toBe('internal_only')
  })
  test('delivers only a clean validated model artifact', () => {
    expect(assessV5DeliveryGate({
      validationPassed: true,
      usedSafeFallback: false,
      hasAdvisoryQualityIssues: false,
    })).toEqual({
      qualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'pass',
        deliverability: 'pass',
      },
      deliveryDecision: 'deliver',
      reasonCodes: [],
    })
  })

  test('keeps safe renderings internal and blocks advisory omissions', () => {
    expect(assessV5DeliveryGate({
      validationPassed: true,
      usedSafeFallback: true,
      hasAdvisoryQualityIssues: false,
    })).toMatchObject({
      deliveryDecision: 'internal_only',
      qualityGates: { contentCompleteness: 'fail', deliverability: 'fail' },
    })
    expect(assessV5DeliveryGate({
      validationPassed: true,
      usedSafeFallback: false,
      hasAdvisoryQualityIssues: true,
    })).toMatchObject({
      deliveryDecision: 'block',
      qualityGates: { contentCompleteness: 'fail', deliverability: 'review_required' },
    })
  })

  test('blocks artifacts that did not pass deterministic validation', () => {
    expect(assessV5DeliveryGate({
      validationPassed: false,
      usedSafeFallback: false,
      hasAdvisoryQualityIssues: false,
    })).toEqual({
      qualityGates: {
        factSafety: 'fail',
        contentCompleteness: 'fail',
        deliverability: 'fail',
      },
      deliveryDecision: 'block',
      reasonCodes: ['DETERMINISTIC_VALIDATION_FAILED'],
    })
  })

  test('keeps sorted concrete advisory reasons and exposes only aggregate diagnostics', () => {
    const fixture = createV5ResultFixture()
    const assessment = assessV5DeliveryGate({
      validationPassed: true,
      usedSafeFallback: false,
      hasAdvisoryQualityIssues: true,
      advisoryIssueCodes: ['Z_WARNING', 'A_WARNING', 'Z_WARNING'],
    })
    const diagnostics = buildV5DeliveryDiagnostics({
      assessment,
      resume: fixture.resumeEvidenceBundle,
      match: fixture.matchAnalysis,
      plan: fixture.resumePlan,
      policy: fixture.generationPolicy,
      artifact: fixture.artifact,
      state: 'blocked_quality_validation',
      planOrigin: 'model_primary',
      artifactOrigin: 'model',
      usedSafeFallback: false,
      usedAnyFallback: false,
      interview: 'skipped_by_gate',
      finalValidationIssues: [{
        issueId: 'issue_quality_warning',
        code: 'A_WARNING',
        severity: 'warning',
        message: 'must not be copied into diagnostics',
        outputPath: '$.artifact',
        claimId: null,
        evidenceIds: [],
        requirementIds: [],
        expectedConstraint: 'fixture constraint',
        replacementText: null,
      }],
      rejectedCandidateIssues: [],
    })

    expect(assessment.reasonCodes).toEqual(['A_WARNING', 'Z_WARNING'])
    expect(diagnostics.tracks.productQuality.issueCounts).toEqual({ A_WARNING: 1, Z_WARNING: 1 })
    expect(diagnostics.tracks.factSafety.finalIssueCounts).toEqual({})
    expect(diagnostics.metrics?.plannedEvidenceCoverage.denominator).toBeGreaterThan(0)
    expect(JSON.stringify(diagnostics)).not.toContain('must not be copied')
  })

  test('rejects a contradictory safety pass instead of emitting misleading telemetry', () => {
    const fixture = createV5ResultFixture()
    expect(() => buildV5DeliveryDiagnostics({
      assessment: assessV5DeliveryGate({
        validationPassed: true,
        usedSafeFallback: false,
        hasAdvisoryQualityIssues: false,
      }),
      resume: fixture.resumeEvidenceBundle,
      match: fixture.matchAnalysis,
      plan: fixture.resumePlan,
      policy: fixture.generationPolicy,
      artifact: fixture.artifact,
      state: 'succeeded',
      planOrigin: 'model_primary',
      artifactOrigin: 'model',
      usedSafeFallback: false,
      usedAnyFallback: false,
      interview: 'not_reached',
      finalValidationIssues: [{
        issueId: 'issue_fact_error',
        code: 'FACT_ERROR',
        severity: 'error',
        message: 'private content',
        outputPath: '$.artifact',
        claimId: null,
        evidenceIds: [],
        requirementIds: [],
        expectedConstraint: 'fixture constraint',
        replacementText: null,
      }],
      rejectedCandidateIssues: [],
    })).toThrow('passed fact safety contains final errors')
  })

  test('fails closed for incomplete historical result shapes', () => {
    expect(isV5ProductDeliverable({
      state: 'succeeded',
      executionStatus: 'completed',
      deliveryDecision: 'deliver',
      usedSafeFallback: false,
      qualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'pass',
        deliverability: 'pass',
      },
    })).toBe(false)
    expect(isV5ProductDeliverable({
      state: 'succeeded_with_safe_fallback',
      executionStatus: 'completed',
      deliveryDecision: 'deliver',
      usedSafeFallback: false,
      qualityGates: {
        factSafety: 'pass',
        contentCompleteness: 'pass',
        deliverability: 'pass',
      },
      generationProvenance: { artifactOrigin: 'emergency' },
    })).toBe(false)
    expect(isV5ProductDeliverable({})).toBe(false)
  })

  test('accepts one internally consistent delivery envelope', () => {
    const result = createV5ResultFixture()
    expect(result.deliveryDiagnostics.provenance.interview).toBe('deferred')
    expect(result.interviewPreparation).toBeUndefined()
    expect(validateV5DeliveryEnvelopeConsistency(result)).toEqual({ passed: true, issueCodes: [] })
    expect(isV5ProductDeliverable(result)).toBe(true)
  })

  test('rejects issue telemetry on a deliverable while allowing rejected-candidate counts', () => {
    const mutations = [
      (result: ReturnType<typeof createV5ResultFixture>) => {
        result.deliveryDiagnostics.tracks.factSafety.finalIssueCounts = { FACT_ERROR: 1 }
      },
      (result: ReturnType<typeof createV5ResultFixture>) => {
        result.deliveryDiagnostics.tracks.factSafety.unclassifiedIssueCount = 1
      },
      (result: ReturnType<typeof createV5ResultFixture>) => {
        result.deliveryDiagnostics.tracks.productQuality.issueCounts = { QUALITY_WARNING: 1 }
      },
      (result: ReturnType<typeof createV5ResultFixture>) => {
        result.deliveryDiagnostics.outcome.decisionReasonCodes = ['QUALITY_WARNING']
      },
    ]

    for (const mutate of mutations) {
      const result = structuredClone(createV5ResultFixture())
      mutate(result)
      expect(isV5DeliveryDiagnosticsSemanticallyValid(result.deliveryDiagnostics)).toBe(false)
      expect(validateV5DeliveryEnvelopeConsistency(result)).toMatchObject({
        passed: false,
        issueCodes: expect.arrayContaining(['DELIVERY_DIAGNOSTICS_INVALID']),
      })
      expect(isV5ProductDeliverable(result)).toBe(false)
    }

    const withRejectedCandidate = structuredClone(createV5ResultFixture())
    withRejectedCandidate.deliveryDiagnostics.tracks.factSafety.rejectedCandidateIssueCounts = {
      REJECTED_CANDIDATE_WARNING: 2,
    }
    expect(isV5DeliveryDiagnosticsSemanticallyValid(withRejectedCandidate.deliveryDiagnostics)).toBe(true)
    expect(validateV5DeliveryEnvelopeConsistency(withRejectedCandidate)).toEqual({
      passed: true,
      issueCodes: [],
    })
    expect(isV5ProductDeliverable(withRejectedCandidate)).toBe(true)
  })

  test('requires preparation for generated, forbids it for deferred and reads failed_optional history', () => {
    const historicalGenerated = createHistoricalV5ResultWithInterviewPreparation()
    expect(validateV5DeliveryEnvelopeConsistency(historicalGenerated)).toEqual({ passed: true, issueCodes: [] })

    const generatedWithoutPreparation = structuredClone(historicalGenerated)
    delete generatedWithoutPreparation.interviewPreparation
    expect(validateV5DeliveryEnvelopeConsistency(generatedWithoutPreparation)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['INTERVIEW_STATUS_MISMATCH']),
    })

    const deferredWithPreparation = structuredClone(historicalGenerated)
    deferredWithPreparation.deliveryDiagnostics.provenance.interview = 'deferred'
    expect(validateV5DeliveryEnvelopeConsistency(deferredWithPreparation)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['INTERVIEW_STATUS_MISMATCH']),
    })

    const historicalFailedOptional = createV5ResultFixture()
    historicalFailedOptional.deliveryDiagnostics.provenance.interview = 'failed_optional'
    expect(validateV5DeliveryEnvelopeConsistency(historicalFailedOptional)).toEqual({ passed: true, issueCodes: [] })
    expect(isV5ProductDeliverable(historicalFailedOptional)).toBe(true)
  })

  test('fails closed for contradictions in either direction', () => {
    const legacySaysBlock = structuredClone(createV5ResultFixture())
    legacySaysBlock.deliveryDecision = 'block'
    legacySaysBlock.state = 'blocked_quality_validation'
    legacySaysBlock.qualityGates = {
      factSafety: 'pass',
      contentCompleteness: 'fail',
      deliverability: 'review_required',
    }
    expect(validateV5DeliveryEnvelopeConsistency(legacySaysBlock)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['DISPOSITION_MISMATCH', 'PRODUCT_QUALITY_MISMATCH']),
    })
    expect(isV5ProductDeliverable(legacySaysBlock)).toBe(false)

    const diagnosticsSayBlock = structuredClone(createV5ResultFixture())
    diagnosticsSayBlock.deliveryDiagnostics.outcome.disposition = 'review_required'
    diagnosticsSayBlock.deliveryDiagnostics.tracks.productQuality.status = 'review_required'
    expect(validateV5DeliveryEnvelopeConsistency(diagnosticsSayBlock)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['DISPOSITION_MISMATCH', 'PRODUCT_QUALITY_MISMATCH']),
    })
    expect(isV5ProductDeliverable(diagnosticsSayBlock)).toBe(false)
  })

  test('rejects missing, invalid and provenance-drifted diagnostics', () => {
    const missing = structuredClone(createV5ResultFixture()) as Partial<ReturnType<typeof createV5ResultFixture>>
    delete missing.deliveryDiagnostics
    expect(validateV5DeliveryEnvelopeConsistency(missing)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['DELIVERY_DIAGNOSTICS_INVALID']),
    })

    const invalid = structuredClone(createV5ResultFixture())
    ;(invalid.deliveryDiagnostics as { version: string }).version = 'v5-delivery-diagnostics-v1'
    expect(isV5ProductDeliverable(invalid)).toBe(false)

    const drifted = structuredClone(createV5ResultFixture())
    drifted.deliveryDiagnostics.provenance.artifactOrigin = 'model_repair'
    expect(validateV5DeliveryEnvelopeConsistency(drifted)).toMatchObject({
      passed: false,
      issueCodes: expect.arrayContaining(['ARTIFACT_ORIGIN_MISMATCH']),
    })
  })

  test('keeps failed and extract-only shapes non-deliverable without confusing failure diagnostics', () => {
    const failed = {
      state: 'provider_failure' as const,
      executionStatus: 'failed' as const,
      deliveryDecision: 'block' as const,
      usedSafeFallback: false,
      usedAnyFallback: false,
      qualityGates: {
        factSafety: 'not_run' as const,
        contentCompleteness: 'not_run' as const,
        deliverability: 'not_run' as const,
      },
      generationProvenance: { planOrigin: 'none' as const, artifactOrigin: 'none' as const },
      deliveryDiagnostics: buildV5FailureDiagnostics({
        state: 'provider_failure',
        code: 'V5_PROVIDER_REQUEST_FAILED',
        retryable: false,
        issues: [],
      }),
    }
    expect(validateV5DeliveryEnvelopeConsistency(failed)).toEqual({ passed: true, issueCodes: [] })
    expect(isV5ProductDeliverable(failed)).toBe(false)

    const extractOnly = { state: 'resume_extracted' as const }
    expect(validateV5DeliveryEnvelopeConsistency(extractOnly).passed).toBe(false)
    expect(isV5ProductDeliverable(extractOnly)).toBe(false)
  })

  test('keeps failure builder and semantic validation aligned for every terminal failure phase', () => {
    const cases = [
      {
        state: 'blocked_input_validation',
        factSafety: 'fail',
        productQuality: 'not_run',
        qualityGates: { factSafety: 'fail', contentCompleteness: 'not_run', deliverability: 'not_run' },
      },
      {
        state: 'blocked_fact_validation',
        factSafety: 'fail',
        productQuality: 'not_run',
        qualityGates: { factSafety: 'fail', contentCompleteness: 'not_run', deliverability: 'not_run' },
      },
      {
        state: 'blocked_structure_validation',
        factSafety: 'fail',
        productQuality: 'not_run',
        qualityGates: { factSafety: 'fail', contentCompleteness: 'not_run', deliverability: 'not_run' },
      },
      {
        state: 'blocked_quality_validation',
        factSafety: 'pass',
        productQuality: 'fail',
        qualityGates: { factSafety: 'pass', contentCompleteness: 'fail', deliverability: 'fail' },
      },
      {
        state: 'provider_failure',
        factSafety: 'not_run',
        productQuality: 'not_run',
        qualityGates: { factSafety: 'not_run', contentCompleteness: 'not_run', deliverability: 'not_run' },
      },
      {
        state: 'workflow_failure',
        factSafety: 'not_run',
        productQuality: 'not_run',
        qualityGates: { factSafety: 'not_run', contentCompleteness: 'not_run', deliverability: 'not_run' },
      },
    ] as const

    for (const { state, factSafety, productQuality, qualityGates } of cases) {
      const diagnostics = buildV5FailureDiagnostics({
        state,
        code: 'TEST_FAILURE',
        retryable: false,
        issues: [],
      })
      expect(diagnostics.tracks.factSafety.status).toBe(factSafety)
      expect(diagnostics.tracks.productQuality.status).toBe(productQuality)
      expect(isV5DeliveryDiagnosticsSemanticallyValid(diagnostics)).toBe(true)

      const envelope = {
        state,
        executionStatus: 'failed' as const,
        deliveryDecision: 'block' as const,
        usedSafeFallback: false,
        usedAnyFallback: false,
        qualityGates: { ...qualityGates },
        generationProvenance: { planOrigin: 'none' as const, artifactOrigin: 'none' as const },
        deliveryDiagnostics: diagnostics,
      }
      expect(validateV5DeliveryEnvelopeConsistency(envelope)).toEqual({ passed: true, issueCodes: [] })

      const wrongFactSafety = structuredClone(envelope)
      wrongFactSafety.qualityGates.factSafety = factSafety === 'fail' ? 'pass' : 'fail'
      expect(validateV5DeliveryEnvelopeConsistency(wrongFactSafety)).toMatchObject({
        passed: false,
        issueCodes: expect.arrayContaining(['LEGACY_ENVELOPE_INVALID']),
      })

      const wrongCompleteness = structuredClone(envelope)
      wrongCompleteness.qualityGates.contentCompleteness = qualityGates.contentCompleteness === 'fail'
        ? 'not_run'
        : 'fail'
      expect(validateV5DeliveryEnvelopeConsistency(wrongCompleteness)).toMatchObject({
        passed: false,
        issueCodes: expect.arrayContaining(['LEGACY_ENVELOPE_INVALID']),
      })

      const wrongDeliverability = structuredClone(envelope)
      wrongDeliverability.qualityGates.deliverability = qualityGates.deliverability === 'fail'
        ? 'not_run'
        : 'fail'
      expect(validateV5DeliveryEnvelopeConsistency(wrongDeliverability)).toMatchObject({
        passed: false,
        issueCodes: expect.arrayContaining(['LEGACY_ENVELOPE_INVALID']),
      })
    }

    const contradictory = buildV5FailureDiagnostics({
      state: 'blocked_input_validation',
      code: 'TEST_FAILURE',
      retryable: false,
      issues: [],
    })
    contradictory.tracks.factSafety.status = 'not_run'
    expect(isV5DeliveryDiagnosticsSemanticallyValid(contradictory)).toBe(false)

    expect(() => buildV5FailureDiagnostics({
      state: 'drafting',
      code: 'TEST_FAILURE',
      retryable: false,
      issues: [],
    })).toThrow('terminal failure phase')
  })
})
