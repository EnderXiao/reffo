// Offline only: no provider, cache mutation, gold signoff or release decision.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { auditEvidenceFlow } from '@/v5/acceptance/evidence-flow'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { generatedResumeArtifactSchema, jobRequirementBundleSchema, resumeEvidenceBundleSchema, v5MatchAnalysisSchema, v5ResumePlanSchema } from '@/v5/schemas'

const usage = 'bun run scripts/audit-v5-evidence-flow.ts --result <recorded-result.json> --out <new-report.json> [--resume-source <exact-source.txt>] [--jd-source <exact-jd.txt>] [--annotation <annotation.json>]'
const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(usage)
} else {
  const options = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1]
    if (!['--result', '--out', '--resume-source', '--jd-source', '--annotation'].includes(key) || !value || value.startsWith('--') || options.has(key)) {
      throw new Error(usage)
    }
    options.set(key, value)
  }
  if (!options.has('--result') || !options.has('--out')) throw new Error(usage)
  const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(path), 'utf8'))
  const envelope = readJson(options.get('--result')!)
  const value = envelope && typeof envelope === 'object' && 'payload' in envelope ? envelope.payload : envelope
  const parsed = z.object({
    resumeEvidenceBundle: resumeEvidenceBundleSchema,
    jobRequirementBundle: jobRequirementBundleSchema,
    matchAnalysis: v5MatchAnalysisSchema.optional(),
    resumePlan: v5ResumePlanSchema.optional(),
    artifact: generatedResumeArtifactSchema.optional(),
  }).safeParse(value)
  if (!parsed.success) throw new Error('EVIDENCE_FLOW_INVALID_RECORDED_RESULT')
  const result = parsed.data
  const sourcePath = options.get('--resume-source')
  const annotationPath = options.get('--annotation')
  const jdPath = options.get('--jd-source')
  const jdSource = jdPath ? canonicalizeSourceDocument(readFileSync(resolve(jdPath), 'utf8')).canonicalDocument : undefined
  if (annotationPath && !jdSource) throw new Error('EVIDENCE_FLOW_ANNOTATION_JD_REQUIRED')
  // Historical JobRequirementBundle has no whole-JD digest. Check supplied quotes;
  // this is not proof that an unreferenced portion matches the original frozen JD.
  if (jdSource && result.jobRequirementBundle.requirementAtoms.some(atom => {
    const block = jdSource.blocks.find(item => item.sourceBlockId === atom.sourceBlockId)
    return !block || atom.sourceSpan.start < block.canonicalStart || atom.sourceSpan.end > block.canonicalEnd
      || block.text.slice(atom.sourceSpan.start - block.canonicalStart, atom.sourceSpan.end - block.canonicalStart) !== atom.verbatimText
  })) throw new Error('EVIDENCE_FLOW_JD_QUOTE_MISMATCH')
  const report = auditEvidenceFlow({
    resume: result.resumeEvidenceBundle,
    jdSha256: jdSource?.sha256 ?? null,
    match: result.matchAnalysis,
    plan: result.resumePlan,
    artifact: result.artifact,
    ...(sourcePath ? { source: canonicalizeSourceDocument(readFileSync(resolve(sourcePath), 'utf8')).canonicalDocument } : {}),
    ...(annotationPath ? { annotation: readJson(annotationPath) } : {}),
  })
  const output = resolve(options.get('--out')!)
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
  writeFileSync(output, `${JSON.stringify({ ...report, jdOriginalInputDigestVerified: false }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ output, externalCallsMade: 0, semanticQualityAssessed: false,
    annotatedJudgments: report.judgments.length, sourceInventoryAvailable: report.sourceInventoryAvailable,
    counts: report.counts, invalidReferences: report.invalidReferences }))
}
