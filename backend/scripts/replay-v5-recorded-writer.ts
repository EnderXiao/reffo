// Offline only: validate an unchanged recorded Writer response under current local checks.
// This is not a new model run or acceptance of the current prompt/selection strategy.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { buildCompositionBlueprint } from '@/v5/composition/blueprint'
import { p06CompositionOutputSchema } from '@/v5/composition/contract'
import { buildJobRequirementBundle, validateJobExtractionCandidate } from '@/v5/evidence'
import { jobExtractionCandidateSchema, v5MatchAnalysisSchema } from '@/v5/schemas'
import { buildDeterministicV5ResumePlan, validateGeneratedResumeArtifact, validateV5MatchAnalysis, validateV5ResumePlan } from '@/v5/validators'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import type { V5WorkflowResult } from '@/v5/types'

const root = resolve(import.meta.dir, '../..')
const source = resolve(process.argv[2] ?? '')
const output = resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3] || output === source || output.startsWith(`${source}/`)) {
  throw new Error('Usage: replay-v5-recorded-writer.ts <recorded-run> <separate-output-directory>')
}
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const baseline = JSON.parse(readFileSync(resolve(root, '.artifacts/v5-writer-baseline-20260906/baseline.json'), 'utf8'))
const cases = resolve(root, baseline.case3.priorRun, 'cases')
const resultFile = readdirSync(cases).find(name => name.endsWith('-v5-result.json'))!
const bytes = readFileSync(resolve(cases, resultFile))
if (hash(bytes) !== baseline.case3.priorResultFileSha256) throw new Error('Frozen source result changed')
const previous: V5WorkflowResult = JSON.parse(bytes.toString()).payload
const recordSchema = z.object({
  promptVersion: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
  response: z.object({ content: z.string(), finishReason: z.literal('stop') }),
})
const records = [1, 2, 3].map(index => {
  const bytes = readFileSync(resolve(source, 'private-calls', `case-03-${String(index).padStart(3, '0')}.json`))
  return { record: recordSchema.parse(JSON.parse(bytes.toString())), sha256: hash(bytes) }
})
function envelope(record: z.infer<typeof recordSchema>) {
  const message = record.messages.find(message => message.role === 'user')?.content
  if (!message?.includes('UNTRUSTED_INPUT_JSON:\n')) throw new Error('Recorded envelope is missing')
  return JSON.parse(message.split('UNTRUSTED_INPUT_JSON:\n')[1].split('\n\n只返回')[0]).payload
}
const originalJob = envelope(records[0].record).canonicalJobDocument
const historyBytes = readFileSync(resolve(root, '.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json'))
if (hash(historyBytes) !== baseline.case3.historyFileSha256) throw new Error('Frozen input changed')
const history = JSON.parse(historyBytes.toString())[2]
const jobDocument = canonicalizeSourceDocument(history.jd_content, originalJob.documentId).canonicalDocument
if (JSON.stringify(originalJob) !== JSON.stringify(jobDocument)) throw new Error('Recorded job is not frozen Case3')
const jobCandidate = jobExtractionCandidateSchema.parse(JSON.parse(records[0].record.response.content))
if (!validateJobExtractionCandidate(jobDocument, jobCandidate).passed) throw new Error('Recorded job fails local validation')
const resume = previous.resumeEvidenceBundle
const job = buildJobRequirementBundle(jobDocument, jobCandidate)
const checkedMatch = validateV5MatchAnalysis({ resume, job, match: v5MatchAnalysisSchema.parse(JSON.parse(records[1].record.response.content)) })
if (!checkedMatch.passed || !checkedMatch.value) throw new Error('Recorded matching fails local validation')
const match = checkedMatch.value
const { profile, policy, requiresResolution } = buildAdaptiveStrategy({ resume, match, job })
if (requiresResolution) throw new Error('Replay needs a recorded strategy decision; will not make a provider call')
const checkedPlan = validateV5ResumePlan({ resume, match, job, profile, policy,
  plan: buildDeterministicV5ResumePlan({ resume, match, job, profile, policy }), gateMode: 'relaxed_release' })
if (!checkedPlan.passed || !checkedPlan.value) throw new Error('Recorded planning fails local validation')
const plan = checkedPlan.value
const currentPlan = buildWritingPlan({ resume, match, job, plan, policy })
const original = z.object({
  writingPolicy: z.literal('supported-writing-v1'),
  blueprint: z.object({ slots: z.array(z.object({
    slotId: z.string(), kind: z.string(), required: z.boolean(),
    allowedEvidenceIds: z.array(z.string()).min(1), coreEvidenceIds: z.array(z.string()),
  })) }),
  facts: z.array(z.object({ evidenceId: z.string(), scopeId: z.string(), text: z.string(), claimType: z.string() })),
}).parse(envelope(records[2].record))
// Use recorded grouping for the old response, not the changed selection strategy.
// Validate every recorded reference/text against frozen authoritative evidence first.
const replayPlan = structuredClone(currentPlan)
const legalBlueprint = buildCompositionBlueprint({ resume, job, plan, policy })
const facts = new Map(currentPlan.facts.map(fact => [fact.evidenceId, fact]))
if (original.facts.length !== facts.size || new Set(original.facts.map(fact => fact.evidenceId)).size !== facts.size
  || original.facts.some(fact => {
    const authoritative = facts.get(fact.evidenceId)
    return !authoritative || fact.text !== authoritative.text || fact.scopeId !== authoritative.scopeId || fact.claimType !== authoritative.claimType
  })) throw new Error('Recorded writing facts differ from the authoritative source projection')
if (original.blueprint.slots.length !== replayPlan.blueprint.slots.length
  || new Set(original.blueprint.slots.map(slot => slot.slotId)).size !== replayPlan.blueprint.slots.length) throw new Error('Recorded slot set changed')
for (const slot of replayPlan.blueprint.slots) {
  const saved = original.blueprint.slots.find(item => item.slotId === slot.slotId)
  const legal = legalBlueprint.slots.find(item => item.slotId === slot.slotId)!
  if (!saved || saved.kind !== slot.kind || saved.required !== slot.required
    || saved.allowedEvidenceIds.some(id => !facts.has(id) || (slot.kind !== 'summary' && !legal.allowedEvidenceIds.includes(id)))
    || saved.coreEvidenceIds.some(id => !saved.allowedEvidenceIds.includes(id))) throw new Error('Recorded grouping has illegal references')
  slot.allowedEvidenceIds = saved.allowedEvidenceIds
  replayPlan.coreEvidenceIdsBySlot[slot.slotId] = saved.coreEvidenceIds
}
replayPlan.blueprint.requiredBodyEvidenceIds = Object.values(replayPlan.coreEvidenceIdsBySlot).flat()
const composition = p06CompositionOutputSchema.parse(JSON.parse(records[2].record.response.content))
mkdirSync(output, { recursive: true, mode: 0o700 })
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
save('current-writing-payload.json', writingPayload(currentPlan))
const provenance = {
  externalCallsMade: 0, sourceRun: source, sourceResponseDigests: records.map(item => item.sha256),
  recordedWriterVersion: records[2].record.promptVersion,
  mode: 'unchanged_recorded_response_current_local_checks',
  freshGenerationPassed: false, humanQualityAccepted: false,
}
try {
  const { artifact } = compileWritingArtifact({ composition, writingPlan: replayPlan, resume, plan, policy })
  const validation = validateGeneratedResumeArtifact({ artifact, resume, plan, policy, gateMode: 'relaxed_release', textPolicy: 'supported_writing_v1' })
  const businessSlotIds = new Set(replayPlan.blueprint.slots.filter(slot => slot.kind === 'business_bullet').map(slot => slot.slotId))
  const businessBlocks = composition.blocks.filter(block => businessSlotIds.has(block.slotId))
  save('artifact.json', artifact)
  writeFileSync(resolve(output, 'candidate.md'), artifact.markdown, { flag: 'wx', mode: 0o600 })
  const report = { ...provenance, localValidationPassed: validation.passed,
    issues: validation.issues, blockCount: composition.blocks.length,
    longestBusinessBlock: businessBlocks.length ? Math.max(...businessBlocks.map(block => block.text.length)) : null,
    businessBlocksOver130: businessBlocks.filter(block => block.text.length > 130).length,
    newPlanFactCounts: currentPlan.blueprint.slots.filter(slot => slot.kind === 'business_bullet').map(slot => slot.allowedEvidenceIds.length),
  }
  save('report.json', report)
  console.log(JSON.stringify({ ...report, issues: validation.issues.map(issue => ({ code: issue.code, severity: issue.severity, path: issue.outputPath })) }, null, 2))
  if (!validation.passed) process.exitCode = 1
} catch (error) {
  if (!(error instanceof SupportedWritingError)) throw error
  save('report.json', { ...provenance, localValidationPassed: false, issues: error.issues })
  console.log(JSON.stringify({ externalCallsMade: 0, localValidationPassed: false, issues: error.issues.map(issue => ({ code: issue.code, path: issue.outputPath })) }))
  process.exitCode = 1
}
