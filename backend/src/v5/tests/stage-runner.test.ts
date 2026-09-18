import { describe, expect, test } from 'bun:test'
import { createHarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
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
    let calls = 0
    const provider: LlmProvider = {
      complete: async () => {
        calls += 1
        return ({
        provider: 'fake',
        model: 'fixture',
        content: '{"schemaVersion":',
        finishReason: 'stop',
        latencyMs: 1,
        })
      },
    }

    await expect(runV5StructuredStage({
      component: 'P01',
      envelope: { payload: {} },
      options: { provider },
    })).rejects.toMatchObject({
      code: 'V5_JSON_PARSE_FAILED',
      component: 'P01',
    })
    expect(calls).toBe(2)
  })

  test('repairs malformed JSON once at the transport boundary and records recovery events', async () => {
    const content: BlindABEvaluation = {
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
          candidateId: 'B',
          absoluteGate: 'pass',
          dimensions: {
            factualFidelity: 24,
            jobSpecificity: 17,
            evidenceSelection: 13,
            highValueEvidenceRecall: 8,
            careerCoherence: 9,
            concisenessReadability: 9,
            deliverability: 9,
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
      pairwise: { winner: 'A', confidence: 'high', reason: 'transport repair' },
    }
    const requests: Array<Parameters<LlmProvider['complete']>[0]> = []
    const eventBus = createHarnessEventBus()
    const events: HarnessEvent[] = []
    eventBus.subscribe('*', event => { events.push(event) })
    const provider: LlmProvider = {
      complete: async request => {
        requests.push(request)
        return {
          provider: 'fake',
          model: 'fixture',
          content: requests.length === 1 ? '{"schemaVersion":' : JSON.stringify(content),
          finishReason: 'stop',
          latencyMs: 1,
          inputTokens: 10,
          outputTokens: requests.length === 1 ? 2 : 20,
        }
      },
    }

    const result = await runV5StructuredStage<BlindABEvaluation>({
      component: 'P12',
      envelope: { payload: {} },
      options: {
        provider,
        eventBus,
        stepContext: createStepExecutionContext(createRunContext(), 'v5_transport_json_repair'),
      },
    })

    expect(result.value).toEqual(content)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({
      callMetadata: {
        callReason: 'json_repair',
        contextMode: 'full',
        repairScope: ['json_output'],
        retryIndex: 1,
      },
      promptManifest: expect.objectContaining({ componentPromptId: 'P12', transportRepairAttempt: 1 }),
    })
    expect(requests[1].messages.at(-1)?.content).toContain('重新生成一个完整 JSON 对象')
    expect(events.filter(event => event.type.startsWith('recovery.'))).toHaveLength(3)
    expect(events.find(event => event.type === 'recovery.planned')?.payload).toMatchObject({
      action: 'repair_json',
      outputName: 'P12',
      triggerErrorCode: 'V5_JSON_PARSE_FAILED',
      maxAttempts: 1,
    })
    expect(events.find(event => event.type === 'recovery.succeeded')?.payload).toMatchObject({
      action: 'repair_json',
      outputName: 'P12',
      finishReason: 'stop',
    })
  })

  test('keeps JSON repair provider failures on the provider recovery boundary', async () => {
    let calls = 0
    const provider: LlmProvider = {
      complete: async () => {
        calls += 1
        if (calls === 1) {
          return {
            provider: 'fake',
            model: 'fixture',
            content: '{"schemaVersion":',
            finishReason: 'stop',
            latencyMs: 1,
          }
        }
        throw Object.assign(new Error('rate limited'), { status: 429 })
      },
    }

    try {
      await runV5StructuredStage({
        component: 'P01',
        envelope: { payload: {} },
        options: { provider },
      })
      throw new Error('expected JSON repair provider call to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(V5ProviderCallError)
      expect(error).toMatchObject({
        code: 'V5_PROVIDER_CALL_FAILED',
        component: 'P01',
        retryable: true,
        status: 429,
      })
    }
    expect(calls).toBe(2)
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
