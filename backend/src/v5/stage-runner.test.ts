import { describe, expect, test } from 'bun:test'
import type { LlmProvider } from '@/providers/llm-provider'
import { runV5StructuredStage, V5StructuredOutputError } from '@/v5/stage-runner'

describe('v5 structured stage transport completion', () => {
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
    })).rejects.toMatchObject<V5StructuredOutputError>({
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
    })).rejects.toMatchObject<V5StructuredOutputError>({
      code: 'V5_JSON_PARSE_FAILED',
      component: 'P01',
    })
  })
})
