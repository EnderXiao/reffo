import { createHash } from 'node:crypto'
import type { GeneratedResumeArtifact, ResumeEvidenceBundle } from '@/v5/types'
import type { WritingPlan } from '@/v5/writing/plan'

export const ABSTRACTION_REVIEW_CATEGORIES = ['fully_supported', 'source_present_citation_missing', 'unsupported', 'uncertain'] as const

/** Private offline review material. Citation membership is NOT semantic support. */
export function buildAbstractionReview(input: {
  resume: ResumeEvidenceBundle
  artifact: GeneratedResumeArtifact
  writingPlan?: WritingPlan
}) {
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const source = (id: string) => {
    const atom = atoms.get(id)
    if (!atom || atom.riskFlags.includes('sensitive_pii')) return { evidenceId: id, unavailable: true as const }
    return { evidenceId: id, scopeId: atom.sourceScopeId, sourceBlockId: atom.sourceBlockId,
      sourceSpan: atom.sourceSpan, status: atom.status, riskFlags: atom.riskFlags, text: atom.verbatimText }
  }
  return {
    version: 'v5-abstraction-review-v1', privateMaterial: true, externalCallsMade: 0,
    resumeSha256: input.resume.sourceDocument.sha256,
    artifactSha256: createHash('sha256').update(JSON.stringify(input.artifact)).digest('hex'),
    semanticQualityAssessed: false, releaseAcceptanceAssessed: false,
    categories: ABSTRACTION_REVIEW_CATEGORIES,
    instructions: '逐条核对实际表达；原文存在但未正确引用与原文不支持分别标注。引文存在不等于语义成立；拿不准用 uncertain。不得自动补引文或启动重写。',
    rows: input.artifact.claims.filter(claim => /^(?:summary|skills)(?:$|\.|\[)/u.test(claim.outputPath)).map(claim => {
      const slot = input.writingPlan?.blueprint.slots.find(slot => slot.outputPath === claim.outputPath)
      return { outputPath: claim.outputPath, text: claim.outputText,
        citedSources: claim.evidenceIds.map(source),
        offeredSources: slot?.allowedEvidenceIds.map(source) ?? null,
        writerViews: slot ? input.writingPlan!.facts.filter(fact => slot.allowedEvidenceIds.includes(fact.evidenceId)) : null,
        theme: slot?.kind === 'summary' ? input.writingPlan?.summaryThemes : slot ? input.writingPlan?.skillThemes?.[slot.slotId] : undefined,
        review: { category: null, rationale: null, reviewer: null },
      }
    }),
  }
}
