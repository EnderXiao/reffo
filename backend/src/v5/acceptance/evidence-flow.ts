import { z } from 'zod'
import type { CanonicalSourceDocument, GeneratedResumeArtifact, ResumeEvidenceBundle, V5MatchAnalysis, V5ResumePlan } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { WritingPlan } from '@/v5/writing/plan'
import { buildEvidencePlanningCatalog } from '@/v5/evidence-routing'
import { deriveEvidenceAssemblies } from '@/v5/composition/evidence-assembly'
import { businessSourceContinuationGroups } from '@/v5/composition/source-continuation'

const id = z.string().regex(/^[a-zA-Z0-9:_-]{1,120}$/)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const coordinate = z.number().int().nonnegative().safe()
const sourceUnit = z.object({
  sourceBlockId: z.string().regex(/^B\d+$/),
  start: coordinate,
  end: coordinate,
}).strict().refine(unit => unit.end > unit.start)

/** Alternatives are OR; all source units within an alternative are AND. */
export const evidenceFlowAnnotationSchema = z.object({
  version: z.literal('v5-evidence-flow-annotation-v1'),
  resumeSha256: digest,
  jdSha256: digest,
  judgments: z.array(z.object({
    judgmentId: id,
    alternatives: z.array(z.object({
      alternativeId: id,
      units: z.array(sourceUnit).min(1).max(32),
    }).strict()).min(1).max(16),
  }).strict()).max(64),
}).strict()
export type EvidenceFlowAnnotation = z.infer<typeof evidenceFlowAnnotationSchema>

type FlowInput = {
  resume: ResumeEvidenceBundle
  jdSha256: string | null
  source?: CanonicalSourceDocument
  match?: V5MatchAnalysis
  fit?: JobFitMap
  plan?: V5ResumePlan
  writingPlan?: WritingPlan
  artifact?: GeneratedResumeArtifact
  annotation?: unknown
}
type Unit = z.infer<typeof sourceUnit>
type StageSets = Record<'extracted' | 'routable' | 'matched' | 'planned' | 'writerAvailable' | 'bodyCited', Set<string> | null>
const sorted = (values: Iterable<string>) => [...new Set(values)].sort()

function annotationFor(input: FlowInput): EvidenceFlowAnnotation | undefined {
  if (input.annotation === undefined) return undefined
  const parsed = evidenceFlowAnnotationSchema.safeParse(input.annotation)
  if (!parsed.success) throw new Error('EVIDENCE_FLOW_INVALID_ANNOTATION')
  const annotation = parsed.data
  if (annotation.resumeSha256 !== input.resume.sourceDocument.sha256 || annotation.jdSha256 !== input.jdSha256) {
    throw new Error('EVIDENCE_FLOW_ANNOTATION_INPUT_MISMATCH')
  }
  if (!input.source) throw new Error('EVIDENCE_FLOW_ANNOTATION_SOURCE_REQUIRED')
  const blocks = new Map(input.source.blocks.map(block => [block.sourceBlockId, block]))
  if (new Set(annotation.judgments.map(item => item.judgmentId)).size !== annotation.judgments.length) {
    throw new Error('EVIDENCE_FLOW_DUPLICATE_JUDGMENT')
  }
  for (const judgment of annotation.judgments) {
    if (new Set(judgment.alternatives.map(item => item.alternativeId)).size !== judgment.alternatives.length) {
      throw new Error('EVIDENCE_FLOW_DUPLICATE_ALTERNATIVE')
    }
    for (const alternative of judgment.alternatives) {
      for (const unit of alternative.units) {
        const block = blocks.get(unit.sourceBlockId)
        if (!block || unit.start < block.canonicalStart || unit.end > block.canonicalEnd) {
          throw new Error('EVIDENCE_FLOW_ANNOTATION_SPAN_INVALID')
        }
      }
    }
  }
  return annotation
}

/** Local provenance trace, not a semantic judge, quality score or delivery gate. */
export function auditEvidenceFlow(input: FlowInput) {
  if (input.source && input.source.sha256 !== input.resume.sourceDocument.sha256) {
    throw new Error('EVIDENCE_FLOW_SOURCE_MISMATCH')
  }
  const atoms = input.resume.evidenceAtoms
  if (new Set(atoms.map(atom => atom.evidenceId)).size !== atoms.length) throw new Error('EVIDENCE_FLOW_DUPLICATE_EVIDENCE')
  const known = new Set(atoms.map(atom => atom.evidenceId))
  const invalidReferences: Record<string, number> = {}
  const knownIds = (stage: string, ids: Iterable<string>) => {
    const all = sorted(ids)
    invalidReferences[stage] = all.filter(value => !known.has(value)).length
    return new Set(all.filter(value => known.has(value)))
  }
  const annotation = annotationFor(input)
  const catalog = buildEvidencePlanningCatalog(input.resume)
  const routable = new Set([...catalog.assessments.values()]
    .filter(item => item.allowedUses.some(use => use !== 'same_scope_support'))
    .map(item => item.evidenceId))
  // A physical continuation is available through its head, not a second independent achievement.
  for (const group of businessSourceContinuationGroups(atoms)) {
    if (routable.has(group[0].evidenceId)) group.forEach(atom => routable.add(atom.evidenceId))
  }
  const matched = input.fit ? input.fit.links.filter(link => ['direct', 'transferable', 'weak_signal'].includes(link.status)).flatMap(link => link.evidenceIds)
    : input.match?.requirementMatches.filter(link => ['direct_match', 'transferable_match'].includes(link.status)).flatMap(link => link.evidenceIds)
  const planned = input.plan ? knownIds('planned', [
    ...input.plan.scopePlans.filter(scope => scope.treatment !== 'omit').flatMap(scope => scope.selectedEvidenceIds),
    ...input.plan.featuredSkillEvidenceIds,
  ]) : null
  if (input.plan && planned) {
    for (const assembly of deriveEvidenceAssemblies(input.resume, input.plan)) {
      if (planned.has(assembly.anchorEvidenceId)) assembly.memberEvidenceIds.forEach(value => planned.add(value))
    }
  }
  const writerHeads = input.writingPlan ? input.writingPlan.blueprint.slots
    .filter(slot => slot.kind !== 'summary').flatMap(slot => slot.allowedEvidenceIds
      .filter(id => slot.kind !== 'skill' || atoms.find(atom => atom.evidenceId === id)?.claimType === 'skill'))
    .filter(value => input.writingPlan!.facts.some(fact => fact.evidenceId === value)) : null
  const writerSpans = new Map<string, Array<{ start: number; end: number }>>()
  for (const head of writerHeads ?? []) {
    const fact = input.writingPlan!.facts.find(item => item.evidenceId === head)!
    for (const evidenceId of [head, ...(input.writingPlan!.expandedEvidenceIds[head] ?? [])]) {
      const excerpts = fact.sourceExcerpts?.filter(excerpt => excerpt.evidenceId === evidenceId)
      const span = atoms.find(atom => atom.evidenceId === evidenceId)?.sourceSpan
      const ranges = excerpts?.length ? excerpts.map(excerpt => excerpt.sourceSpan) : span ? [span] : []
      writerSpans.set(evidenceId, [...(writerSpans.get(evidenceId) ?? []), ...ranges])
    }
  }
  const writerAvailable = writerHeads ? knownIds('writerAvailable', writerSpans.keys()) : null
  const stages: StageSets = {
    extracted: known,
    routable,
    matched: matched ? knownIds('matched', matched) : null,
    planned,
    writerAvailable,
    bodyCited: input.artifact ? knownIds('bodyCited', input.artifact.claims
      .filter(claim => !/(?:^|\.)summary(?:$|\.|\[)/u.test(claim.outputPath))
      .flatMap(claim => claim.evidenceIds.filter(id => !/^skills(?:$|\.|\[)/u.test(claim.outputPath)
        || atoms.find(atom => atom.evidenceId === id)?.claimType === 'skill'))) : null,
  }
  const covered = (unit: Unit, ids: Set<string>, stage: string) => {
    const spans = atoms.filter(atom => ids.has(atom.evidenceId)
      && atom.sourceDocumentHash === input.resume.sourceDocument.sha256
      && atom.sourceBlockId === unit.sourceBlockId
      && atom.sourceSpan.end > unit.start && atom.sourceSpan.start < unit.end)
      .flatMap(atom => stage === 'writerAvailable' ? writerSpans.get(atom.evidenceId) ?? [] : [atom.sourceSpan])
      .sort((a, b) => a.start - b.start || a.end - b.end)
    let end = unit.start
    for (const span of spans) {
      if (span.start > end) break
      end = Math.max(end, span.end)
    }
    return end >= unit.end
  }
  const judgments = annotation?.judgments.map(judgment => {
    const alternatives = judgment.alternatives.map(alternative => ({
      alternativeId: alternative.alternativeId,
      stages: Object.fromEntries(Object.entries(stages).map(([stage, ids]) => [stage,
        ids === null ? null : alternative.units.every(unit => covered(unit, ids, stage))])) as Record<keyof StageSets, boolean | null>,
    }))
    const satisfied = (stage: keyof StageSets) => stages[stage] === null ? null : alternatives.some(item => item.stages[stage])
    const stageCoverage = Object.fromEntries(Object.keys(stages).map(stage => [stage, satisfied(stage as keyof StageSets)]))
    // Matching and routing are different observations, not universal prerequisites for ancillary content.
    const firstUncoveredStage = (['extracted', 'routable', 'planned', 'writerAvailable', 'bodyCited'] as const)
      .find(stage => satisfied(stage) === false) ?? null
    return { judgmentId: judgment.judgmentId, alternatives, stageCoverage, firstUncoveredStage, semanticExpression: 'not_assessed' as const }
  }) ?? []
  const rows = [...atoms].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start || a.evidenceId.localeCompare(b.evidenceId)).map(atom => ({
    evidenceId: atom.evidenceId,
    sourceBlockId: atom.sourceBlockId,
    sourceSpan: atom.sourceSpan,
    sourceScopeId: atom.sourceScopeId,
    claimType: atom.claimType,
    status: atom.status,
    routing: catalog.assessments.get(atom.evidenceId)?.reasonCodes ?? [],
    selectionObservation: planned === null ? 'plan_unavailable'
      : !planned.has(atom.evidenceId) ? 'not_planned'
      : writerAvailable === null ? 'writer_unavailable'
      : !writerAvailable.has(atom.evidenceId) ? 'not_offered_to_body'
      : stages.bodyCited === null ? 'artifact_unavailable'
      : !stages.bodyCited.has(atom.evidenceId) ? 'not_cited_in_body' : 'cited_semantics_unassessed',
    stages: Object.fromEntries(Object.entries(stages).map(([stage, ids]) => [stage, ids === null ? null : ids.has(atom.evidenceId)])),
  }))
  return {
    version: 'v5-evidence-flow-audit-v1' as const,
    externalCallsMade: 0,
    semanticQualityAssessed: false,
    releaseAcceptanceAssessed: false,
    resumeSha256: input.resume.sourceDocument.sha256,
    jdSha256: input.jdSha256,
    sourceInventoryAvailable: Boolean(input.source),
    unextractedSourceBlockIds: input.source ? input.source.blocks
      .filter(block => !atoms.some(atom => atom.sourceBlockId === block.sourceBlockId))
      .map(block => block.sourceBlockId) : null,
    counts: Object.fromEntries(Object.entries(stages).map(([stage, ids]) => [stage, ids?.size ?? null])),
    invalidReferences,
    judgments,
    rows,
  }
}
