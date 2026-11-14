import type {ResumeHistoryRecord} from '@/types'
import {savedInterviewGenerationBasis} from '@/v5/current-interview-snapshot'
import {calculateV5MatchScore} from '@/v5/match-score'
import {canonicalMatchAnalysisSchema, jobRequirementBundleSchema, resumeEvidenceBundleSchema} from '@/v5/schemas'

const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : undefined

/** Read owned repository rows before stripping their private basis; never persist this projection. */
export function projectResumeHistoryScore(history: ResumeHistoryRecord): ResumeHistoryRecord {
  if (history.match_score !== null) return history
  const result = record(history.process_result)
  const matching = record(result?.matching)
  if (matching?.score_formula_version !== 'match-score-v2') return history

  const basis = savedInterviewGenerationBasis(history)
  if (!basis?.matchAnalysis.judgmentBundle
    || !resumeEvidenceBundleSchema.safeParse(basis.resumeEvidenceBundle).success
    || !jobRequirementBundleSchema.safeParse(basis.jobRequirementBundle).success) return history

  // Durable server results can carry action plans alongside the canonical match.
  // Validate its complete canonical projection without changing the public schema.
  const {schemaVersion, judgmentBundle, requirementMatches, strengths, gaps, positioning, scoreInputs, contextUsed} = basis.matchAnalysis
  const match = canonicalMatchAnalysisSchema.safeParse({schemaVersion, judgmentBundle, requirementMatches, strengths, gaps, positioning, scoreInputs, contextUsed})
  if (!match.success) return history

  const score = calculateV5MatchScore({resume: basis.resumeEvidenceBundle, job: basis.jobRequirementBundle, match: match.data})
  return {...history, match_score: score.score, process_result: {...result, matching: {...matching,
    match_score: score.score,
    score_formula_version: score.formulaVersion,
    score_calibration_status: score.metadata?.calibrationStatus,
    score_basis: 'current_material_requirement_coverage',
    score_confidence: score.confidence,
  }}}
}
