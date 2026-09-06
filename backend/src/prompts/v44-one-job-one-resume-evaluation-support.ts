type JsonObject = Record<string, unknown>

export interface V44NormalizedJudgeResult {
  baselineScore: number | null
  candidateScore: number | null
  winner: 'baseline' | 'candidate' | 'tie' | 'unknown'
}

const componentLimits = {
  factual_fidelity: 20,
  job_specificity: 20,
  evidence_selection: 15,
  result_density: 10,
  career_coherence: 10,
  conciseness_readability: 15,
  deliverability: 10,
} as const

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizedEvaluationScore(evaluation: JsonObject) {
  const components = Object.entries(componentLimits).map(([key, limit]) => {
    const value = numberValue(evaluation[key])
    return value !== null && value >= 0 && value <= limit ? value : null
  })
  if (!components.every((value): value is number => value !== null)) return null
  if (evaluation.absolute_gate !== 'pass' && evaluation.absolute_gate !== 'fail') return null

  const requiredArrays = [
    'unsupported_claims',
    'attribution_errors',
    'empty_work_entries',
    'empty_project_entries',
    'internal_audit_leaks',
  ]
  if (!requiredArrays.every(key => Array.isArray(evaluation[key]))) return null

  const total = components.reduce((sum, value) => sum + value, 0)
  const reportedTotal = numberValue(evaluation.total_score)
  if (reportedTotal === null || reportedTotal !== total || total < 0 || total > 100) return null

  const hasUnsupportedClaims = (evaluation.unsupported_claims as unknown[]).length > 0
  const hasAttributionErrors = (evaluation.attribution_errors as unknown[]).length > 0
  const hasEmptyEntries = (evaluation.empty_work_entries as unknown[]).length > 0
    || (evaluation.empty_project_entries as unknown[]).length > 0
  const hasAuditLeaks = (evaluation.internal_audit_leaks as unknown[]).length > 0
  if (hasUnsupportedClaims && (
    Number(evaluation.factual_fidelity) > 8
    || total > 59
    || evaluation.absolute_gate !== 'fail'
  )) return null
  if (hasAttributionErrors && (Number(evaluation.factual_fidelity) > 12 || total > 69)) return null
  if (hasEmptyEntries && (Number(evaluation.deliverability) > 3 || evaluation.absolute_gate !== 'fail')) return null
  if (hasAuditLeaks && (Number(evaluation.deliverability) > 2 || evaluation.absolute_gate !== 'fail')) return null
  return total
}

export function normalizeV44PromptABJudge(
  judge: JsonObject,
  baselineCandidateId: 'A' | 'B'
): V44NormalizedJudgeResult {
  const evaluations = Array.isArray(judge.evaluations) ? judge.evaluations : []
  const objects = evaluations.filter(item => item && typeof item === 'object') as JsonObject[]
  const candidateCandidateId = baselineCandidateId === 'A' ? 'B' : 'A'
  const baselineRows = objects.filter(item => item.candidate_id === baselineCandidateId)
  const candidateRows = objects.filter(item => item.candidate_id === candidateCandidateId)
  if (evaluations.length !== 2 || baselineRows.length !== 1 || candidateRows.length !== 1 || objects.length !== 2) {
    return { baselineScore: null, candidateScore: null, winner: 'unknown' }
  }

  const baseline = baselineRows[0]
  const candidate = candidateRows[0]
  const baselineScore = normalizedEvaluationScore(baseline)
  const candidateScore = normalizedEvaluationScore(candidate)
  if (baselineScore === null || candidateScore === null) {
    return { baselineScore, candidateScore, winner: 'unknown' }
  }

  const baselineGate = baseline.absolute_gate
  const candidateGate = candidate.absolute_gate
  const gateWinner = baselineGate === 'pass' && candidateGate === 'fail'
    ? 'baseline' as const
    : candidateGate === 'pass' && baselineGate === 'fail'
      ? 'candidate' as const
      : null
  const winnerValue = judge.winner
  return {
    baselineScore,
    candidateScore,
    winner: gateWinner || (winnerValue === baselineCandidateId
      ? 'baseline'
      : winnerValue === candidateCandidateId
        ? 'candidate'
        : winnerValue === 'tie'
          ? 'tie'
          : 'unknown'),
  }
}
