// Local diagnostic only: no Provider, no trusted cache writes, no live claim.
import { resolve } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildResumeExtractionScopePlan, normalizeResumeExtractionChunkCandidate, splitResumeDocument } from '@/v5/chunked-resume-extraction'
import { buildResumeEvidenceBundle, validateResumeExtractionCandidate } from '@/v5/evidence'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan, validateV5ResumePlan, validateGeneratedResumeArtifact } from '@/v5/validators'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { materializeDslComposition } from '@/v5/composition/dsl'
import { compileCompositionArtifact } from '@/v5/composition/compiler'
import { atomicWriteJson } from '@/v5/evaluation-runner-support'
import type { V5WorkflowResult } from '@/v5/types'

const [sourceArg, cacheArg, outputArg] = process.argv.slice(2)
if (!sourceArg || !cacheArg || !outputArg) throw new Error('Usage: <generation-run> <recorded-extraction-cache> <new-output-directory>')
const source = resolve(sourceArg), output = resolve(outputArg)
if (source === output || output.startsWith(`${source}/`)) throw new Error('Preview output must be separate')
await mkdir(output, { mode: 0o700 })
const manifest = (await Bun.file(resolve(source, 'run-manifest.json')).json()).payload
if (manifest.selectedCases.length !== 1) throw new Error('One case required')
const histories = await Bun.file(manifest.historyPath).json()
const history = histories[manifest.selectedCases[0] - 1]
const { readdir } = await import('node:fs/promises')
const resultFile = (await readdir(resolve(source, 'cases'))).find(file => file.endsWith('-v5-result.json'))!
const previous: V5WorkflowResult = (await Bun.file(resolve(source, 'cases', resultFile)).json()).payload
const document = canonicalizeSourceDocument(history.resume_content).canonicalDocument
if (document.sha256 !== previous.resumeEvidenceBundle.sourceDocument.sha256) throw new Error('Source mismatch')
const stored = (await Bun.file(resolve(cacheArg)).json()).payload.candidate
const scopes = buildResumeExtractionScopePlan(document)
const candidate = normalizeResumeExtractionChunkCandidate({
  ...document,
  extractionScopeAssignments: scopes.scopes.map(scope => ({
    serverScopeLocalId: scope.serverScopeLocalId, sourceBlockIds: scope.memberBlockIds,
    scopeMemberBlockIds: scope.memberBlockIds, timelineAnchorBlockIds: scope.timelineAnchorBlockIds,
  })),
}, stored)
const validation = validateResumeExtractionCandidate(document, candidate, { shardCount: splitResumeDocument(document).length })
if (!validation.passed) {
  await atomicWriteJson(resolve(output, 'diagnostics.json'), { externalCallsMade: 0, phase: 'extraction', issues: validation.issues })
  console.log(JSON.stringify({ externalCallsMade: 0, phase: 'extraction', codes: validation.issues.filter(i => i.severity === 'error').map(i => i.code) }))
  process.exit(1)
}
const resume = buildResumeEvidenceBundle(document, candidate, { shardCount: splitResumeDocument(document).length })
const oldEvidence = new Map(previous.resumeEvidenceBundle.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
const remap = (id: string) => {
  const old = oldEvidence.get(id)
  return resume.evidenceAtoms.find(atom => old && atom.sourceBlockId === old.sourceBlockId && atom.verbatimText === old.verbatimText)?.evidenceId
}
const match = structuredClone(previous.matchAnalysis)
match.requirementMatches = match.requirementMatches.map(item => ({ ...item, evidenceIds: item.evidenceIds.map(remap).filter((id): id is string => Boolean(id)) }))
match.positioning.primaryEvidenceIds = match.positioning.primaryEvidenceIds.map(remap).filter((id): id is string => Boolean(id))
const job = previous.jobRequirementBundle
const { profile, policy } = buildAdaptiveStrategy({ resume, job, match })
const plan = buildDeterministicV5ResumePlan({ resume, job, match, profile, policy })
const planValidation = validateV5ResumePlan({ resume, job, match, plan, profile, policy, gateMode: 'relaxed_release' })
const blueprint = buildCompositionBlueprint({ resume, plan, policy, job })
const used = new Set<string>()
const dsl = { contractVersion: 'p06-dsl-v1', blocks: blueprint.slots.map(slot => {
  const id = slot.allowedEvidenceIds.find(id => slot.kind === 'summary' || !used.has(id))!
  if (slot.kind !== 'summary') used.add(id)
  return { slotId: slot.slotId, operations: [{ op: 'emit_atom', evidenceId: id }], joiner: 'none' }
}) }
const composition = materializeDslComposition({ dsl, blueprint, resume, plan })
if (!composition.passed) {
  await atomicWriteJson(resolve(output, 'diagnostics.json'), { externalCallsMade: 0, phase: 'composition', issues: composition.issues, resume, plan })
  console.log(JSON.stringify({ externalCallsMade: 0, phase: 'composition', codes: composition.issues.map(i => i.code) }))
  process.exit(1)
}
const { artifact } = compileCompositionArtifact({ composition: composition.value, blueprint, resume, plan, policy })
const artifactValidation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy, gateMode: 'relaxed_release' })
await writeFile(resolve(output, 'preview.md'), artifact.markdown, { mode: 0o600, flag: 'wx' })
await atomicWriteJson(resolve(output, 'diagnostics.json'), {
  externalCallsMade: 0, priorMatchRemappedForDiagnosticOnly: true,
  resume, plan, profile, policy, artifact,
  planIssues: planValidation.issues, artifactIssues: artifactValidation.issues,
})
console.log(JSON.stringify({ externalCallsMade: 0, planPassed: planValidation.passed, artifactPassed: artifactValidation.passed,
  businessBullets: artifact.renderStats, codes: artifactValidation.issues.map(i => i.code), output }))
