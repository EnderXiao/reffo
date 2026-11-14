import {createDigest} from '@/harness/run-context'
import {collectGaps, dependentClaimExportable, isCompletionV4, prepareResumeExport, renderCompletionSegment, validateCompletionDocument} from '@/shared/resume-completion'
import type {ResumeHistoryRecord} from '@/types'
import type {EvidenceAtom, V5WorkflowResult, InterviewGenerationBasis} from '@/v5/types'
import {routeSourceInformation} from '@/v5/writing/information-routing'

const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
/** A saved edit is a distinct user source; original matching remains immutable. */
export function currentInterviewSnapshot<T extends InterviewGenerationBasis>(generated: T, history: ResumeHistoryRecord): T {
  const optimized = record(record(history.process_result).optimized)
  const checked = validateCompletionDocument(optimized.completion_document, history.optimized_content)
  if (!checked.ok) throw new Error('INTERVIEW_DOCUMENT_INVALID')
  const document = checked.document, exported = prepareResumeExport(document)
  if (!exported.ok) throw new Error('INTERVIEW_EXPORT_INVALID')
  const next = structuredClone(generated)
  next.completionDocument = document
  next.deliveryMarkdown = exported.markdown
  next.artifact.markdown = exported.markdown
  next.artifact.claims = []
  const allAtoms = new Map(next.resumeEvidenceBundle.evidenceAtoms.map(a => [a.evidenceId, a]))
  const userAtoms: EvidenceAtom[] = []
  const exportedClaimIds = new Set(document.blocks.flatMap(b => b.segments.flatMap(s => s.kind === 'dependent_claim'
    && dependentClaimExportable(s, document.schemaVersion) ? s.sourceEvidenceIds : [])))
  const uncertainIds = new Set(next.resumeEvidenceBundle.evidenceAtoms.filter(a => a.riskFlags.some(f => ['uncertain', 'conflicting'].includes(f))
    || /待补证|待核实|未验证/u.test(a.verbatimText)).map(a => a.evidenceId))
  const rejectedSourceIds = new Set([...document.blocks.flatMap(block => block.segments.filter((segment): segment is import('@/shared/resume-completion').ResumeDependentClaim =>
    segment.kind === 'dependent_claim' && segment.resolution?.state === 'rejected').flatMap(claim => claim.sourceEvidenceIds)),
    ...(document.claimLineage ?? []).filter(item => item.resolution?.state === 'rejected' || item.originalClaim.resolution?.state === 'rejected').flatMap(item => item.originalClaim.sourceEvidenceIds)])
  const routed = isCompletionV4(document) ? routeSourceInformation({atoms: next.resumeEvidenceBundle.evidenceAtoms}) : undefined
  const safelyProjected = new Set<string>()
  next.resumeEvidenceBundle.evidenceAtoms = next.resumeEvidenceBundle.evidenceAtoms.map(atom => {
    if (!uncertainIds.has(atom.evidenceId) && !rejectedSourceIds.has(atom.evidenceId)) return atom
    if (!isCompletionV4(document)) return exportedClaimIds.has(atom.evidenceId) ? atom : {...atom, status: 'excluded'}
    const currentBlocks = document.blocks.filter(block => generated.artifact.claims.some(claim => claim.outputPath === block.outputPath && claim.evidenceIds.includes(atom.evidenceId)))
    const currentText = currentBlocks.flatMap(block => block.segments.filter(segment =>
      segment.kind !== 'dependent_claim' || dependentClaimExportable(segment, document.schemaVersion))
      .filter(segment => segment.kind !== 'text' || !segment.replacedClaimIds?.some(id => document.claimLineage?.find(item => item.claimId === id)?.resolution?.state === 'rejected'))
      .map(segment => renderCompletionSegment(segment, 'export'))).join('\n')
    const assertions = routed?.assertions.filter(assertion => assertion.evidenceId === atom.evidenceId) ?? []
    const fragments = assertions.length ? assertions.map(assertion => assertion.resumeText).filter(Boolean)
      : rejectedSourceIds.has(atom.evidenceId) ? atom.verbatimText.split(/[，；;。]|(?<!\d),(?!\d{3}(?:\D|$))/u).map(text => text.trim()).filter(Boolean) : []
    const normalize = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '')
    const text = fragments.filter(fragment => {
      const numbers = fragment.match(/\d+(?:[,.]\d+)*(?:%|％)?/gu) ?? []
      // A topic or an exported sibling claim never admits an omitted numeric assertion.
      return (!numbers.length || numbers.every(number => currentText.includes(number)))
        && (!rejectedSourceIds.has(atom.evidenceId) || normalize(currentText).includes(normalize(fragment)))
    }).join('；')
    if (!text) return {...atom, status: 'excluded'}
    safelyProjected.add(atom.evidenceId)
    // Only admitted source fragments enter P10. The full, uncertain atom stays in the durable basis.
    return {...atom, verbatimText: text, normalizedClaim: text, status: 'source_qualified',
      qualifiers: atom.qualifiers.filter(value => text.includes(value)),
      numericAtoms: atom.numericAtoms.filter(value => text.includes(value.raw)),
      riskFlags: atom.riskFlags.filter(value => value !== 'uncertain' && value !== 'conflicting')}
  })
  for (const block of document.blocks) {
    if (block.kind === 'heading1') continue
    const original = generated.artifact.claims.find(c => c.outputPath === block.outputPath)
    const originalIds = original?.evidenceIds.filter(id => allAtoms.has(id)
      && ((!uncertainIds.has(id) && !rejectedSourceIds.has(id)) || exportedClaimIds.has(id) || safelyProjected.has(id))) ?? []
    const scope = originalIds.map(id => allAtoms.get(id)?.sourceScopeId).find(Boolean)
      ?? generated.resolvedActionPlan?.actions.find(action => action.sourceScopeIds.length === 1
        && document.blocks.find(candidate => candidate.blockId === block.blockId)?.actionIds?.includes(action.actionId))?.sourceScopeIds[0]
    const userEvidenceIds: string[] = []
    const text = block.segments.map(segment => {
      if (segment.kind === 'identity_gap') return ''
      if (segment.kind === 'dependent_claim' && !dependentClaimExportable(segment, document.schemaVersion)) return ''
      if (segment.kind === 'text' && segment.replacedClaimIds?.some(id => (isCompletionV4(document) ? document.claimLineage?.find(c => c.claimId === id)?.resolution?.state === 'rejected' : document.claimLineage?.find(c => c.claimId === id)?.resolution?.state !== 'confirmed'))) return ''
      const text = renderCompletionSegment(segment, 'export')
      const user = segment.kind === 'text' ? segment.origin === 'user' : segment.kind === 'optional_gap_clause' && segment.fill.state === 'filled'
      if (user && text.trim() && scope) {
        const evidenceId = `user:${createDigest([document.documentId, document.revision, block.blockId, text]).slice(0, 20)}`
        userAtoms.push({evidenceId, sourceDocumentHash: createDigest([document.documentId, document.revision]), sourceBlockId: block.blockId,
          sourceScopeId: scope, sourceSpan: {start: 0, end: text.length}, verbatimText: text, normalizedClaim: text, claimType: 'other',
          status: 'source_qualified', attributionLevel: 'unspecified', sourceActionVerb: null, qualifiers: ['用户本次补充，未经外部核验'],
          numericAtoms: (text.match(/\d+(?:[,.]\d+)*(?:%|％)?/gu) ?? []).map(raw => ({raw, valueText: raw, unit: null, qualifier: '用户提供', period: null, ownerScope: scope})),
          riskFlags: [], provenance: {kind: 'user_edit', documentId: document.documentId, revision: document.revision}})
        userEvidenceIds.push(evidenceId)
      }
      return text
    }).join('')
    const ids = [...new Set([...originalIds, ...userEvidenceIds])]
    if (text.trim() && ids.length) next.artifact.claims.push({claimId: `current:${block.blockId}`, outputPath: block.outputPath ?? `current.${block.blockId}`,
      outputText: text, evidenceIds: ids, transformation: 'safe_paraphrase', attributionLevel: 'unspecified'})
  }
  next.resumeEvidenceBundle.evidenceAtoms.push(...userAtoms)
  next.artifact.usedEvidenceIds = [...new Set(next.artifact.claims.flatMap(c => c.evidenceIds))]
  next.interviewSnapshot = {documentId: document.documentId, revision: document.revision, safeTextDigest: createDigest(exported.markdown),
    pendingDetailIds: collectGaps(document).filter(g => g.fill.state !== 'filled').flatMap(g => g.detailId ?? []),
    preparationTopicsDigest: createDigest(next.preparationTopics ?? [])}
  return next
}

export function interviewGenerationBasis(result: InterviewGenerationBasis): InterviewGenerationBasis {
  const {runId, deliveryDecision, usedSafeFallback, artifact, resumeEvidenceBundle, jobRequirementBundle,
    matchAnalysis, completionDocument, resolvedActionPlan, preparationTopics} = result
  return structuredClone({runId, deliveryDecision, usedSafeFallback, artifact, resumeEvidenceBundle, jobRequirementBundle,
    matchAnalysis, completionDocument, resolvedActionPlan, preparationTopics})
}

/** Only use this field from an owned repository row, never an HTTP payload. */
export function savedInterviewGenerationBasis(history: ResumeHistoryRecord): InterviewGenerationBasis | undefined {
  const basis = record(record(history.process_result).server_interview_basis)
  if (basis.version !== 'interview-generation-basis-v1') return undefined
  const result = record(basis.result)
  if (typeof result.runId !== 'string' || !record(result.artifact).claims || !record(result.resumeEvidenceBundle).evidenceAtoms
    || !record(result.jobRequirementBundle).requirementAtoms || !record(result.matchAnalysis).requirementMatches) return undefined
  return result as unknown as InterviewGenerationBasis
}
