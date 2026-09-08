import { describe, expect, test } from 'bun:test'
import { normalizeV44PromptABJudge } from '@/prompts/v44-one-job-one-resume-evaluation-support'

function evaluation(candidateId: 'A' | 'B', overrides: Record<string, unknown> = {}) {
  return {
    candidate_id: candidateId,
    total_score: 75,
    factual_fidelity: 16,
    job_specificity: 15,
    evidence_selection: 11,
    result_density: 8,
    career_coherence: 8,
    conciseness_readability: 10,
    deliverability: 7,
    absolute_gate: 'pass',
    unsupported_claims: [],
    attribution_errors: [],
    empty_work_entries: [],
    empty_project_entries: [],
    internal_audit_leaks: [],
    ...overrides,
  }
}

describe('v4.4 prompt A/B judge normalization', () => {
  test('maps anonymous candidates back to baseline and candidate', () => {
    const result = normalizeV44PromptABJudge({
      evaluations: [evaluation('A'), evaluation('B', { total_score: 76, job_specificity: 16 })],
      winner: 'B',
    }, 'A')

    expect(result).toEqual({ baselineScore: 75, candidateScore: 76, winner: 'candidate' })
  })

  test('rejects unsupported claims that incorrectly pass the absolute gate', () => {
    const result = normalizeV44PromptABJudge({
      evaluations: [
        evaluation('A', {
          total_score: 58,
          factual_fidelity: 8,
          job_specificity: 12,
          evidence_selection: 9,
          result_density: 6,
          career_coherence: 7,
          conciseness_readability: 10,
          deliverability: 6,
          unsupported_claims: ['新增事实'],
          absolute_gate: 'pass',
        }),
        evaluation('B'),
      ],
      winner: 'B',
    }, 'A')

    expect(result).toEqual({ baselineScore: null, candidateScore: 75, winner: 'unknown' })
  })

  test('rejects inconsistent totals and duplicate candidate rows', () => {
    expect(normalizeV44PromptABJudge({
      evaluations: [evaluation('A', { total_score: 59 }), evaluation('B')],
      winner: 'B',
    }, 'A').winner).toBe('unknown')

    expect(normalizeV44PromptABJudge({
      evaluations: [evaluation('A'), evaluation('A')],
      winner: 'A',
    }, 'A')).toEqual({ baselineScore: null, candidateScore: null, winner: 'unknown' })
  })
})
