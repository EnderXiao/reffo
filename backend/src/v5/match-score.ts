import type { JobRequirementBundle, MatchScoreBreakdown, ResumeEvidenceBundle, V5MatchAnalysis } from '@/v5/types'

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
  if (input.match.judgmentBundle) return calculateRulesScore(input)
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
    formulaVersion: 'match-score-v1',
    score,
    label: 'based_on_current_material',
    confidence,
    components,
  }
}


/** Evidence coverage under a frozen rule, not a probability of hiring or empirical calibration. */
function calculateRulesScore(input: Parameters<typeof calculateV5MatchScore>[0]): MatchScoreBreakdown {
  const judgments = new Map(input.match.judgmentBundle!.items.map(item => [item.requirementId, item]))
  const groups = new Map<string, typeof input.job.requirementAtoms>()
  for (const requirement of input.job.requirementAtoms) {
    const key = requirement.logicGroupId && ['or', 'one_of'].includes(requirement.logicOperator ?? '')
      ? `alternative:${requirement.logicGroupId}` : requirement.semantics?.scoringGroupId ?? requirement.requirementId
    groups.set(key, [...groups.get(key) ?? [], requirement])
  }
  const priority = {must_have: 0, core_outcome: 1, differentiator: 2, nice_to_have: 3}
  const samples = [...groups.entries()].map(([key, requirements]) => {
    const importance = [...requirements].sort((a, b) => priority[a.importance] - priority[b.importance])[0]!.importance
    // An OR can be satisfied by any alternative; duplicate projections keep the strictest gate.
    const relevant = key.startsWith('alternative:') ? requirements : requirements.filter(item => item.importance === importance)
    const values = relevant.map(item => {
      const judgment = judgments.get(item.requirementId)
      return {judgment, weight: !judgment || judgment.conflict || judgment.status === 'unproven' ? null
        : judgment.status === 'direct' ? 1 : judgment.status === 'transferable_or_partial' ? 0.6 : 0}
    })
    const known = values.flatMap(item => item.weight === null ? [] : [item.weight])
    const alternative = key.startsWith('alternative:')
    const value = alternative ? known.length ? Math.max(...known) : null
      : values.some(item => item.weight === null) ? null : Math.min(...known)
    const uncertain = value === null || alternative && value < 1 && values.some(item => item.weight === null)
    return {importance, value, uncertain, conflict: values.some(item => Boolean(item.judgment?.conflict))}
  })
  const hasMust = samples.some(sample => sample.importance === 'must_have')
  const weights = hasMust ? {must: 35, core: 30, differentiator: 10} : {must: 0, core: 50, differentiator: 10}
  const dimensions = [
    {component: 'must_have' as const, weight: weights.must, selected: samples.filter(item => item.importance === 'must_have')},
    {component: 'core_outcome' as const, weight: weights.core, selected: samples.filter(item => item.importance === 'core_outcome')},
    {component: 'differentiator' as const, weight: weights.differentiator, selected: samples.filter(item => ['differentiator', 'nice_to_have'].includes(item.importance))},
  ].filter(item => item.selected.length > 0)
  const totalWeight = dimensions.reduce((sum, item) => sum + item.weight, 0)
  // Empty dimensions are absent; evidence quantity and writing quality never add match points.
  const components: MatchScoreBreakdown['components'] = dimensions.map(item => {
    const possible = totalWeight ? item.weight / totalWeight * 100 : 0
    const ratio = item.selected.reduce((sum, sample) => sum + (sample.value ?? 0), 0) / item.selected.length
    return {component: item.component, possible, earned: ratio * possible, applicableCount: item.selected.length}
  })
  const evaluatedGroupCount = samples.filter(item => item.value !== null).length
  const unprovenGroupCount = samples.filter(item => item.uncertain).length
  const conflictingGroupCount = samples.filter(item => item.conflict).length
  const usable = input.resume.evidenceAtoms.filter(atom => atom.status !== 'excluded')
  const score = evaluatedGroupCount && usable.length && totalWeight
    ? Math.max(0, Math.min(100, Math.round(components.reduce((sum, item) => sum + item.earned, 0)))) : null
  const uncertainSource = input.resume.extractionCoverage.highImportanceUnmappedCount > 0
    || input.job.extractionCoverage.highImportanceUnmappedCount > 0 || Boolean(input.resume.sourceStructure?.issues.length)
  const confidence = score === null || uncertainSource || conflictingGroupCount || unprovenGroupCount ? 'low' as const
    : samples.length < 3 || usable.some(atom => atom.status === 'source_qualified' || atom.riskFlags.length) ? 'medium' as const : 'high' as const
  return {formulaVersion: 'match-score-v3', score, label: 'based_on_current_material', confidence, components,
    metadata: {calibrationStatus: 'rules_based', scoreBasis: 'current_material_requirement_coverage',
      evaluatedGroupCount, unprovenGroupCount, conflictingGroupCount,
      deduplicatedRequirementCount: input.job.requirementAtoms.length - groups.size}}
}
