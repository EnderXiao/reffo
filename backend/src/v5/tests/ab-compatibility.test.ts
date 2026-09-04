import { describe, expect, test } from 'bun:test'
import type { ChatCompletionInput, LlmProvider } from '@/providers/llm-provider'
import { runDoubleOrderBlindAb } from '@/v5/ab-evaluator'
import { toLegacyMvpProcessResponse } from '@/v5/main/compatibility'
import { createV5ResultFixture } from '@/v5/tests/fixtures'
import { V5_SCHEMA_VERSION } from '@/v5/types'

function parseCandidates(input: ChatCompletionInput) {
  const content = input.messages.find(message => message.role === 'user')?.content ?? ''
  const match = content.match(/UNTRUSTED_INPUT_JSON:\n([\s\S]+?)\n\n只返回本阶段/)
  return JSON.parse(match![1]).payload.candidates as Array<{ candidateId: 'A' | 'B'; markdown: string }>
}

class AbProvider implements LlmProvider {
  async complete(input: ChatCompletionInput) {
    const candidates = parseCandidates(input)
    const leftId = candidates.find(item => item.markdown.startsWith('LEFT'))!.candidateId
    const dimensions = {
      factualFidelity: 25,
      jobSpecificity: 18,
      evidenceSelection: 14,
      highValueEvidenceRecall: 9,
      careerCoherence: 9,
      concisenessReadability: 9,
      deliverability: 10,
    }
    const evaluation = {
      schemaVersion: V5_SCHEMA_VERSION,
      evaluations: candidates.map(item => ({
        candidateId: item.candidateId,
        absoluteGate: 'pass',
        dimensions: item.candidateId === leftId ? dimensions : { ...dimensions, jobSpecificity: 10 },
        unsupportedClaims: [],
        attributionErrors: [],
        emptyScopes: [],
        missingHighValueEvidence: [],
        internalAuditLeaks: [],
        strengths: ['可投递'],
        weaknesses: [],
      })),
      pairwise: { winner: leftId, confidence: 'high', reason: '左侧候选更有岗位针对性' },
    }
    return { provider: 'fake', model: 'ab', content: JSON.stringify(evaluation), latencyMs: 1 }
  }
}

describe('v5 compatibility and offline A/B', () => {
  test('preserves the legacy MVP response contract', () => {
    const response = toLegacyMvpProcessResponse(createV5ResultFixture())
    expect(response.agent_version).toBe('6.0.0')
    expect(response.workflow_status).toBe('succeeded')
    expect(response.step1_analysis.structured_resume.personal_info.name).toBe('张三')
    expect(response.step2_matching.match_score).toBeGreaterThan(0)
    expect(response.step3_optimized_resume).toContain('甲公司')
  })

  test('normalizes forward/reverse labels and detects order-consistent winner', async () => {
    const fixture = createV5ResultFixture()
    const left = { ...fixture.artifact, markdown: `LEFT\n${fixture.artifact.markdown}` }
    const right = { ...fixture.artifact, markdown: `RIGHT\n${fixture.artifact.markdown}` }
    const result = await runDoubleOrderBlindAb({
      runId: 'ab-fixture',
      resumeEvidenceBundle: fixture.resumeEvidenceBundle,
      jobRequirementBundle: fixture.jobRequirementBundle,
      candidateLeft: left,
      candidateRight: right,
    }, { provider: new AbProvider() })
    expect(result.normalizedForwardWinner).toBe('left')
    expect(result.normalizedReverseWinner).toBe('left')
    expect(result.absoluteGateConsistent).toBe(true)
    expect(result.orderConsistent).toBe(true)
  })
})
