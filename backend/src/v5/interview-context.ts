import type { EvidenceAtom, V5WorkflowResult } from '@/v5/types'
import { deriveInterviewCaseGroups } from '@/v5/interview-source-structure'
import { findInterviewResultContinuations } from '@/v5/interview-results'

const STORY_TYPES = new Set(['responsibility', 'action', 'deliverable', 'result'])

/** Select complete evidence units; never truncate source text to fit a budget. */
export function buildInterviewContext(result: Pick<V5WorkflowResult,
  'artifact' | 'resumeEvidenceBundle' | 'jobRequirementBundle' | 'matchAnalysis'>) {
  const { artifact, resumeEvidenceBundle: resume, jobRequirementBundle: job, matchAnalysis: match } = result
  const eligible = resume.evidenceAtoms.filter(atom => atom.status !== 'excluded'
    && atom.claimType !== 'identity'
    && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag)))
  const byId = new Map(eligible.map(atom => [atom.evidenceId, atom]))
  const caseGroups = deriveInterviewCaseGroups(resume)
  const caseByEvidence = new Map(caseGroups.flatMap(group => group.evidenceIds.map(id => [id, group] as const)))
  const resultContinuations = new Map(findInterviewResultContinuations(resume.evidenceAtoms)
    .map(link => [link.previousEvidenceId, link.tailEvidenceId]))
  const resultPredecessors = new Map([...resultContinuations].map(([head, tail]) => [tail, head]))
  const selected = new Set<string>()
  const include = (ids: string[]) => ids.forEach(id => { if (byId.has(id)) selected.add(id) })
  const claims = artifact.claims.filter(claim => !/^identity(?:[.\[]|$)/iu.test(claim.outputPath))
  include(claims.flatMap(claim => claim.evidenceIds))
  include(match.requirementMatches.flatMap(item => item.evidenceIds))
  include(match.strengths.flatMap(item => item.evidenceIds))
  include(match.gaps.flatMap(item => item.evidenceIds))
  include(match.positioning.primaryEvidenceIds)

  // A resume paragraph may cite an action while its result stays elsewhere in
  // the source scope. Give the coach actual result/交付 evidence for its stories,
  // without expanding every selected scope back into the entire master resume.
  const storyScopes = new Set([...selected].map(id => byId.get(id)!)
    .filter(atom => STORY_TYPES.has(atom.claimType)).map(atom => atom.sourceScopeId))
  for (const scopeId of storyScopes) {
    const results = eligible.filter(atom => atom.sourceScopeId === scopeId
      && (atom.claimType === 'result' || atom.claimType === 'deliverable')
      && !atom.riskFlags.includes('future_or_planned'))
      .sort((left, right) => Number(selected.has(right.evidenceId)) - Number(selected.has(left.evidenceId))
        || Number(left.status !== 'source_supported') - Number(right.status !== 'source_supported')
        || left.sourceSpan.start - right.sourceSpan.start || left.evidenceId.localeCompare(right.evidenceId))
    include(results.slice(0, 2).map(atom => atom.evidenceId))
  }
  // Include source-linked continuation predecessors so a numeric fragment is
  // not detached from its object, while retaining all qualifiers on both units.
  const pending = [...selected]
  for (let index = 0; index < pending.length; index += 1) {
    const id = pending[index]!
    const additions = [byId.get(id)?.sourceContinuation?.previousEvidenceId,
      resultContinuations.get(id), resultPredecessors.get(id), caseByEvidence.get(id)?.titleEvidenceId,
      // A story plan needs its original problem and constraints as well as the
      // chosen action/result. Expand only the explicitly proven case, not its employer scope.
      ...(caseByEvidence.get(id)?.evidenceIds ?? [])]
    for (const addition of additions) if (addition && byId.has(addition) && !selected.has(addition)) {
      selected.add(addition)
      pending.push(addition)
    }
  }
  const evidenceIds = (ids: string[]) => ids.filter(id => selected.has(id))
  const selectedAtoms = eligible.filter(atom => selected.has(atom.evidenceId))
  const scopeIds = new Set(selectedAtoms.map(atom => atom.sourceScopeId))
  const compactAtom = (atom: EvidenceAtom) => ({
    evidenceId: atom.evidenceId,
    sourceScopeId: atom.sourceScopeId,
    verbatimText: atom.verbatimText,
    claimType: atom.claimType,
    status: atom.status,
    attributionLevel: atom.attributionLevel,
    sourceActionVerb: atom.sourceActionVerb,
    qualifiers: atom.qualifiers,
    numericAtoms: atom.numericAtoms,
    riskFlags: atom.riskFlags,
    ...(caseByEvidence.has(atom.evidenceId) ? { caseGroupId: caseByEvidence.get(atom.evidenceId)!.caseGroupId,
      caseTitle: caseByEvidence.get(atom.evidenceId)!.title } : {}),
    ...(resultPredecessors.has(atom.evidenceId) ? { resultContinuationOf: resultPredecessors.get(atom.evidenceId) } : {}),
    ...(atom.sourceContinuation && selected.has(atom.sourceContinuation.previousEvidenceId)
      ? { previousEvidenceId: atom.sourceContinuation.previousEvidenceId } : {}),
  })
  return {
    contextVersion: 'interview-evidence-v1' as const,
    artifact: {
      schemaVersion: artifact.schemaVersion,
      // claims contain the delivered text and evidence links. Sending Markdown
      // too would repeat the same body and reintroduce contact details.
      claims: claims.map(claim => ({ ...claim, evidenceIds: evidenceIds(claim.evidenceIds) }))
        .filter(claim => claim.evidenceIds.length > 0),
    },
    resumeEvidenceBundle: {
      sourceDocument: { primaryLanguage: resume.sourceDocument.primaryLanguage },
      timeline: resume.timeline.filter(item => scopeIds.has(item.scopeId))
        .map(item => ({ ...item, evidenceIds: evidenceIds(item.evidenceIds) })),
      evidenceAtoms: selectedAtoms.map(compactAtom),
      caseGroups: caseGroups.filter(group => group.evidenceIds.some(id => selected.has(id)))
        .map(group => ({ ...group, evidenceIds: evidenceIds(group.evidenceIds) })),
      conflicts: resume.conflicts.map(item => ({ ...item, evidenceIds: evidenceIds(item.evidenceIds) }))
        .filter(item => item.evidenceIds.length > 0),
    },
    jobRequirementBundle: {
      basicInfo: job.basicInfo,
      requirementAtoms: job.requirementAtoms.map(atom => ({
        requirementId: atom.requirementId,
        verbatimText: atom.verbatimText,
        ...(atom.normalizedRequirement !== atom.verbatimText ? { normalizedRequirement: atom.normalizedRequirement } : {}),
        category: atom.category,
        importance: atom.importance,
        logicGroupId: atom.logicGroupId,
        logicOperator: atom.logicOperator,
        explicitness: atom.explicitness,
      })),
      explicitCompanySignals: job.explicitCompanySignals,
      explicitLocationSignals: job.explicitLocationSignals,
      uncertainties: job.uncertainties,
      sourcedContext: job.sourcedContext,
    },
    matchAnalysis: {
      requirementMatches: match.requirementMatches.map(item => ({ ...item, evidenceIds: evidenceIds(item.evidenceIds) })),
      strengths: match.strengths.map(item => ({ ...item, evidenceIds: evidenceIds(item.evidenceIds) }))
        .filter(item => item.evidenceIds.length > 0),
      gaps: match.gaps.map(item => ({ ...item, evidenceIds: evidenceIds(item.evidenceIds) })),
      positioning: { ...match.positioning, primaryEvidenceIds: evidenceIds(match.positioning.primaryEvidenceIds) },
      contextUsed: match.contextUsed,
    },
  }
}
