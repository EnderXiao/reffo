import { describe, expect, test } from 'bun:test'
import { aggregateHarnessMetrics, evaluateV6ReleaseGate } from '@/repositories/harness-metrics'

describe('harness metrics aggregation', () => {
  test('按阶段汇总调用、门禁、物理 attempt、token、延迟和成本', () => {
    const metrics = aggregateHarnessMetrics({
      runs: [{ id: 'run-1', status: 'succeeded' }],
      steps: [
        { id: 'step-p08', run_id: 'run-1', step_name: 'v5_p08_repair_1', started_at: '2026-01-01T00:00:00.000Z', finished_at: '2026-01-01T00:00:01.000Z' },
        { id: 'step-p09', run_id: 'run-1', step_name: 'v5_p09_fact_judge', started_at: '2026-01-01T00:00:01.000Z', finished_at: '2026-01-01T00:00:03.000Z' },
      ],
      attempts: [
        { id: 'attempt-p08', step_run_id: 'step-p08', provider: 'deepseek', model: 'deepseek-chat', input_tokens: 1000, output_tokens: 500, latency_ms: 900, is_repair_attempt: 1 },
        { id: 'attempt-p09', step_run_id: 'step-p09', provider: 'deepseek', model: 'deepseek-chat', input_tokens: 2000, output_tokens: 300, latency_ms: 1800, is_repair_attempt: 0 },
      ],
      events: [
        { attempt_id: 'attempt-p08', type: 'provider.requested', payload_json: JSON.stringify({
          callReason: 'validation_repair',
          promptManifest: {
            componentPromptId: 'P08',
            inputSummary: { envelopeBytes: 800, estimatedInputTokens: 700, messageCharacterCounts: [100, 200] },
          },
        }) },
        { attempt_id: 'attempt-p08', type: 'provider.responded', payload_json: JSON.stringify({ physicalAttempts: 1 }) },
        { attempt_id: 'attempt-p09', type: 'provider.requested', payload_json: JSON.stringify({
          callReason: 'semantic_gate',
          promptManifest: {
            componentPromptId: 'P09',
            inputSummary: { envelopeBytes: 1200, estimatedInputTokens: 1100, messageCharacterCounts: [100, 300] },
          },
        }) },
        { attempt_id: 'attempt-p09', type: 'provider.responded', payload_json: JSON.stringify({ physicalAttempts: 2 }) },
        { type: 'evaluation.completed', payload_json: JSON.stringify({ evaluatorName: 'markdown-resume-rules' }) },
        { type: 'evaluation.completed', payload_json: JSON.stringify({ evaluatorName: 'v5_resume_quality_judge' }) },
      ],
    })

    expect(metrics).toMatchObject({
      runCount: 1,
      llmCalls: 2,
      repairCalls: 1,
      semanticGateCalls: 1,
      deterministicGateEvaluations: 1,
      physicalAttempts: 3,
      inputTokens: 3000,
      outputTokens: 800,
      totalTokens: 3800,
      avgLatencyMs: 1350,
      p95LatencyMs: 1800,
      estimatedCostCny: 0.0124,
    })
    expect(metrics.stageMetrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ stepName: 'v5_p08_repair_1', llmCalls: 1, repairCalls: 1, totalTokens: 1500, p95LatencyMs: 1000 }),
      expect.objectContaining({ stepName: 'v5_p09_fact_judge', llmCalls: 1, repairCalls: 0, totalTokens: 2300, p95LatencyMs: 2000 }),
    ]))
    expect(metrics.promptInputSummary).toMatchObject({
      observedCalls: 2,
      envelopeBytes: 2000,
      estimatedInputTokens: 1800,
      messageCharacters: 700,
    })
    expect(metrics.promptInputSummary.byComponent).toEqual([
      expect.objectContaining({ component: 'P08', calls: 1, estimatedInputTokens: 700 }),
      expect.objectContaining({ component: 'P09', calls: 1, estimatedInputTokens: 1100 }),
    ])
  })

  test('发布门禁拒绝超预算和安全事故', () => {
    const base = aggregateHarnessMetrics({
      runs: [],
      steps: [],
      attempts: Array.from({ length: 9 }, (_, index) => ({ id: `a-${index}`, provider: 'deepseek', input_tokens: 20_000, output_tokens: 0 })),
      events: [{ type: 'workflow.failed', payload_json: JSON.stringify({ errorCode: 'FACT_SAFETY_BLOCKED' }) }],
    })
    const gate = evaluateV6ReleaseGate(base)

    expect(gate.passed).toBe(false)
    expect(gate.failures).toEqual(expect.arrayContaining(['logicalCalls', 'totalTokens', 'factSafety']))
  })
})
