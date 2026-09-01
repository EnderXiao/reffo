import type { JobRequirementBundle, MatchScoreBreakdown, ResumeEvidenceBundle, V5MatchAnalysis } from '@/v5/types'
import { V5_SCORE_FORMULA_VERSION } from '@/v5/types'

const STATUS_WEIGHT = {
  direct_match: 1,
  transferable_match: 0.6,
  currently_unproven: 0,
  conflicting_evidence: 0,
} as const

function coverageScore(
  matches: V5MatchAnalysis['requirementMatches'],
  possible: number
) {
  if (matches.length === 0 || possible === 0) return 0
  const earnedRatio = matches.reduce((sum, match) => {
    if (match.status === 'not_applicable') return sum
    return sum + STATUS_WEIGHT[match.status]
  }, 0) / matches.length
  return Math.round(earnedRatio * possible * 10) / 10
}

export function calculateV5MatchScore(input: {
  resume: ResumeEvidenceBundle
  job: JobRequirementBundle
  match: V5MatchAnalysis
}): MatchScoreBreakdown {
  const requirements = new Map(input.job.requirementAtoms.map(atom => [atom.requirementId, atom]))
  const applicable = input.match.requirementMatches.filter(match => match.status !== 'not_applicable')
  const byImportance = (importance: string) => applicable.filter(match => requirements.get(match.requirementId)?.importance === importance)
  const must = byImportance('must_have')
  const core = byImportance('core_outcome')
  const differentiators = applicable.filter(match => {
    const importance = requirements.get(match.requirementId)?.importance
    return importance === 'differentiator' || importance === 'nice_to_have'
  })
  const hasMust = must.length > 0
  const weights = hasMust
    ? { must: 35, core: 30, depth: 15, differentiator: 10, clarity: 10 }
    : { must: 0, core: 50, depth: 30, differentiator: 10, clarity: 10 }
  const evidenceById = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const matchedEvidence = applicable
    .filter(match => match.status === 'direct_match' || match.status === 'transferable_match')
    .flatMap(match => match.evidenceIds)
    .map(id => evidenceById.get(id))
    .filter((atom): atom is NonNullable<typeof atom> => Boolean(atom && atom.status !== 'excluded'))
  const distinctScopes = new Set(matchedEvidence.map(atom => atom.sourceScopeId)).size
  const evidenceDepth = Math.min(1, distinctScopes / 3)
  const clarity = input.resume.evidenceAtoms.length === 0
    ? 0
    : input.resume.evidenceAtoms.filter(atom => atom.status === 'source_supported').length / input.resume.evidenceAtoms.length

  const components: MatchScoreBreakdown['components'] = [
    {
      component: 'must_have',
      earned: coverageScore(must, weights.must),
      possible: weights.must,
      applicableCount: must.length,
    },
    {
      component: 'core_outcome',
      earned: coverageScore(core, weights.core),
      possible: weights.core,
      applicableCount: core.length,
    },
    {
      component: 'evidence_depth',
      earned: Math.round(evidenceDepth * weights.depth * 10) / 10,
      possible: weights.depth,
      applicableCount: distinctScopes,
    },
    {
      component: 'differentiator',
      earned: coverageScore(differentiators, weights.differentiator),
      possible: weights.differentiator,
      applicableCount: differentiators.length,
    },
    {
      component: 'evidence_clarity',
      earned: Math.round(clarity * weights.clarity * 10) / 10,
      possible: weights.clarity,
      applicableCount: input.resume.evidenceAtoms.length,
    },
  ]
  const score = Math.max(0, Math.min(100, Math.round(components.reduce((sum, component) => sum + component.earned, 0))))
  const confidence: MatchScoreBreakdown['confidence'] = input.resume.extractionCoverage.highImportanceUnmappedCount > 0
    ? 'low'
    : applicable.length >= 3 ? 'high' : 'medium'

  return {
    formulaVersion: V5_SCORE_FORMULA_VERSION,
    score,
    label: 'based_on_current_material',
    confidence,
    components,
  }
}
