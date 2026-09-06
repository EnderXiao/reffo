import { describe, expect, test } from 'bun:test'
import type { LlmProvider } from '@/providers/llm-provider'
import { runV5StructuredStage, V5ProviderCallError } from '@/v5/stage-runner'
import { V5_SCHEMA_VERSION, type BlindABEvaluation } from '@/v5/types'

describe('v5 structured stage transport completion', () => {
  test('classifies transient and non-transient provider failures before workflow recovery', async () => {
    for (const [status, retryable] of [[429, true], [400, false]] as const) {
      const provider: LlmProvider = {
        complete: async () => {
          throw Object.assign(new Error(`HTTP ${status}`), { status })
        },
      }

      try {
        await runV5StructuredStage({
          component: 'P06',
          envelope: { payload: {} },
          options: { provider },
        })
        throw new Error('expected provider call to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(V5ProviderCallError)
        expect(error).toMatchObject({
          code: 'V5_PROVIDER_CALL_FAILED',
          component: 'P06',
          status,
          retryable,
        })
      }
    }
  })

  test('classifies finish_reason=length as truncation before JSON parsing', async () => {
    const provider: LlmProvider = {
      complete: async () => ({
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":"5.0.0","factCandidates":[',
        finishReason: 'length',
        latencyMs: 1,
        inputTokens: 10,
        outputTokens: 16_000,
      }),
    }

    await expect(runV5StructuredStage({
      component: 'P01',
      envelope: { payload: {} },
      options: { provider },
    })).rejects.toMatchObject({
      code: 'V5_OUTPUT_TRUNCATED',
      component: 'P01',
    })
  })

  test('keeps malformed non-truncated JSON as a parse failure', async () => {
    const provider: LlmProvider = {
      complete: async () => ({
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":',
        finishReason: 'stop',
        latencyMs: 1,
      }),
    }

    await expect(runV5StructuredStage({
      component: 'P01',
      envelope: { payload: {} },
      options: { provider },
    })).rejects.toMatchObject({
      code: 'V5_JSON_PARSE_FAILED',
      component: 'P01',
    })
  })

  test('normalizes P12 semantic gate and winner before strict validation', async () => {
    const dimensions = {
      factualFidelity: 25,
      jobSpecificity: 18,
      evidenceSelection: 14,
      highValueEvidenceRecall: 9,
      careerCoherence: 9,
      concisenessReadability: 9,
      deliverability: 10,
    }
    const content = {
      schemaVersion: V5_SCHEMA_VERSION,
      evaluations: [
        {
          candidateId: 'A',
          absoluteGate: 'pass',
          dimensions,
          unsupportedClaims: ['服务端可见的硬门禁问题'],
          attributionErrors: [],
          emptyScopes: [],
          missingHighValueEvidence: [],
          internalAuditLeaks: [],
          strengths: [],
          weaknesses: ['存在硬门禁问题'],
        },
        {
          candidateId: 'B',
          absoluteGate: 'pass',
          dimensions: { ...dimensions, jobSpecificity: 1 },
          unsupportedClaims: [],
          attributionErrors: [],
          emptyScopes: [],
          missingHighValueEvidence: [],
          internalAuditLeaks: [],
          strengths: ['可投递'],
          weaknesses: [],
        },
      ],
      pairwise: { winner: 'A', confidence: 'high', reason: '保留模型解释' },
    }
    const provider: LlmProvider = {
      complete: async () => ({
        provider: 'fake',
        model: 'fixture',
        content: JSON.stringify(content),
        finishReason: 'stop',
        latencyMs: 1,
      }),
    }

    const result = await runV5StructuredStage<BlindABEvaluation>({
      component: 'P12',
      envelope: { payload: {} },
      options: { provider },
    })

    expect(result.value.evaluations.find(item => item.candidateId === 'A')?.absoluteGate).toBe('fail')
    expect(result.value.pairwise).toEqual({
      winner: 'B',
      confidence: 'low',
      reason: '服务端按绝对门禁优先规则确定胜者为 B。',
    })
    expect(result.outputAudit.normalizationApplied).toBe(true)
    expect(result.outputAudit.normalizationChanges).toEqual(expect.arrayContaining([
      'evaluations.A.absoluteGate:pass->fail',
      'pairwise.winner:A->B',
    ]))
    expect(result.outputAudit.rawOutputDigest).not.toBe(result.outputAudit.validatedOutputDigest)
  })

  test('keeps malformed P12 output blocked and exposes only safe validation audit metadata', async () => {
    const content = {
      schemaVersion: V5_SCHEMA_VERSION,
      evaluations: [
        {
          candidateId: 'A',
          absoluteGate: 'pass',
          dimensions: {
            factualFidelity: 25,
            jobSpecificity: 18,
            evidenceSelection: 14,
            highValueEvidenceRecall: 9,
            careerCoherence: 9,
            concisenessReadability: 9,
            deliverability: 10,
          },
          unsupportedClaims: [],
          attributionErrors: [],
          emptyScopes: [],
          missingHighValueEvidence: [],
          internalAuditLeaks: [],
          strengths: [],
          weaknesses: [],
        },
        {
          candidateId: 'A',
          absoluteGate: 'pass',
          dimensions: {
            factualFidelity: 25,
            jobSpecificity: 18,
            evidenceSelection: 14,
            highValueEvidenceRecall: 9,
            careerCoherence: 9,
            concisenessReadability: 9,
            deliverability: 10,
          },
          unsupportedClaims: [],
          attributionErrors: [],
          emptyScopes: [],
          missingHighValueEvidence: [],
          internalAuditLeaks: [],
          strengths: [],
          weaknesses: [],
        },
      ],
      pairwise: { winner: 'A', confidence: 'high', reason: '结构非法' },
    }
    const provider: LlmProvider = {
      complete: async () => ({
        provider: 'fake',
        model: 'fixture',
        content: JSON.stringify(content),
        finishReason: 'stop',
        latencyMs: 1,
      }),
    }

    try {
      await runV5StructuredStage({
        component: 'P12',
        envelope: { payload: {} },
        options: { provider },
      })
      throw new Error('expected P12 schema validation to fail')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'V5_SCHEMA_VALIDATION_FAILED',
        validationIssues: expect.arrayContaining([
          expect.objectContaining({ path: 'evaluations' }),
        ]),
        outputAudit: {
          normalizationApplied: false,
          normalizationChanges: [],
        },
      })
      const outputAudit = (error as { outputAudit: { rawOutputDigest: string; validatedOutputDigest: string } }).outputAudit
      expect(outputAudit.rawOutputDigest).toBe(outputAudit.validatedOutputDigest)
    }
  })
})
