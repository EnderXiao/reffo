import type { CanonicalSourceDocument } from '@/v5/types'
import type { TargetedJobExtraction, JobSuccessProfile } from '@/v5/targeting/contracts'
import { normalizeRequirementAnalysis, type RequirementAnalysis, type RequirementAnalysisItem } from '@/job-analysis/requirements'

/** A JD-only projection; candidate evidence and fit scores are deliberately absent. */
export function buildRequirementAnalysis(candidate: TargetedJobExtraction, document: CanonicalSourceDocument): RequirementAnalysis | undefined {
  const profile = candidate.jobSuccessProfile
  const blocks = new Map(document.blocks.map(block => [block.sourceBlockId, block.text]))
  type Node = JobSuccessProfile['tasks'][number] | JobSuccessProfile['attributes'][number] | JobSuccessProfile['context'][number]
  const node = (entry: Pick<Node, 'id' | 'text' | 'provenance'>): RequirementAnalysisItem => ({
    id: entry.id, text: entry.text, basis: entry.provenance.basis, strength: 'unspecified',
    sourceQuotes: entry.provenance.sourceBlockIds.flatMap(id => blocks.get(id) ?? []).slice(0, 6),
    rationale: entry.provenance.reason,
  })
  const externalRequirements = profile.requirements.flatMap(condition => {
    const source = candidate.requirementCandidates.find(item => item.requirementLocalId === condition.requirementLocalId)
    if (!source) return []
    return [{ id: `external:${condition.requirementLocalId}`, text: condition.sourceQuote,
      basis: 'explicit' as const, strength: condition.condition === 'unclear' ? 'unspecified' as const : condition.condition,
      sourceQuotes: [condition.sourceQuote], rationale: '' }]
  })
  return normalizeRequirementAnalysis({
    version: 'job-requirement-analysis-v1',
    portrait: profile.candidatePortrait ? node(profile.candidatePortrait) : null,
    tasks: profile.tasks.map(node), outcomes: profile.outcomes.map(node), successConditions: profile.successConditions.map(node),
    attributes: profile.attributes.map(attribute => ({ ...node(attribute), dimension: attribute.dimension, evidenceExpectation: attribute.evidenceExpectation })),
    externalRequirements, unknowns: profile.unknowns,
    conflicts: profile.conflicts.map((conflict, index) => ({ id: `conflict:${index}`, text: conflict.description,
      basis: 'explicit', strength: 'unspecified', sourceQuotes: conflict.sourceBlockIds.flatMap(id => blocks.get(id) ?? []).slice(0, 6), rationale: '' })),
  }, document.blocks.map(block => block.text).join('\n'))
}
