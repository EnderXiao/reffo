// Offline forensic replay only. No Provider, cache mutation, repair, or production artifact.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { createDigest } from '@/harness/run-context'
import { createImplementationDigest, digestJson } from '@/v5/evaluation-runner-support'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { splitResumeDocument } from '@/v5/chunked-resume-extraction'
import { buildResumeEvidenceBundle, buildJobRequirementBundle } from '@/v5/evidence'
import { resumeExtractionCandidateSchema, resumeEvidenceBundleSchema } from '@/v5/schemas'
import { targetedJobExtractionSchema, jobFitMapSchema } from '@/v5/targeting/contracts'
import { buildJobTargets, validateTargetedJobExtraction } from '@/v5/targeting/profile'
import { coreTaskEvidence, projectLegacyMatch, targetingEvidenceScores, validateJobFitMap } from '@/v5/targeting/fit'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan, validateV5ResumePlan } from '@/v5/validators'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileWritingArtifact, SupportedWritingError } from '@/v5/writing/compiler'
import { p06CompositionOutputSchema } from '@/v5/composition/contract'
import { writingNumbers } from '@/v5/writing/facts'
import type { ValidationIssue } from '@/v5/types'
import { V5_PROMPT_VERSIONS } from '@/v5/prompts'

const args = process.argv.slice(2)
const previewRevisedPlan = args[3] === '--preview-revised-plan'
if (args.length !== (previewRevisedPlan ? 4 : 3)) throw new Error('Usage: inspect-v5-targeted-writer-run.ts <source-run> <its-p01-cache> <separate-new-directory> [--preview-revised-plan]')
const [source, cachePath, output] = args.slice(0, 3).map(path => resolve(path))
if (source === output || output.startsWith(`${source}/`)) throw new Error('Forensic output must not alter the source run')
function readCheckpoint(path: string) {
  const text = readFileSync(path, 'utf8'), record = JSON.parse(text)
  if (record.payloadSha256 !== digestJson(record.payload)) throw new Error('Checkpoint content digest mismatch')
  return { record, sha256: createDigest(text) }
}
const manifest = readCheckpoint(resolve(source, 'run-manifest.json'))
if (manifest.record.payload.selectedCases.length !== 1 || manifest.record.payload.executionPolicy.jobTargetingPolicy !== 'job-targeted-v1') throw new Error('Requires a single targeted run')
const histories = JSON.parse(readFileSync(manifest.record.payload.historyPath, 'utf8'))
const history = histories[manifest.record.payload.selectedCases[0] - 1]
const resumeDocument = canonicalizeSourceDocument(history.resume_content, 'resume:forensic').canonicalDocument
const snapshot = readCheckpoint(cachePath)
if (snapshot.record.fingerprints.inputDigest !== resumeDocument.sha256) throw new Error('Cached input differs from selected case')
const cached = resumeExtractionCandidateSchema.parse(snapshot.record.payload.candidate)
if (createDigest(cached) !== snapshot.record.payload.candidateDigest) throw new Error('Cached candidate digest mismatch')
const resume = resumeEvidenceBundleSchema.parse(buildResumeEvidenceBundle(resumeDocument, cached, { trustedShardCount: splitResumeDocument(resumeDocument).length }))
if (createDigest({ ...resume, sourceDocument: { ...resume.sourceDocument, documentId: null } }) !== snapshot.record.payload.evidenceBundleDigest) throw new Error('Source evidence digest mismatch')
const recordSchema = z.object({ promptVersion: z.string(), messages: z.array(z.object({ role: z.string(), content: z.string() })),
  response: z.object({ content: z.string(), finishReason: z.literal('stop') }) })
const records = readdirSync(resolve(source, 'private-calls')).filter(name => name.endsWith('.json')).sort().map(name => {
  const text = readFileSync(resolve(source, 'private-calls', name), 'utf8')
  return { name, sha256: createDigest(text), value: recordSchema.parse(JSON.parse(text)) }
})
const stage = (component: string) => records.findLast(item => item.value.promptVersion.includes(`-${component}-`))
const jobRecord = previewRevisedPlan ? stage('p02') : stage('p02r') ?? stage('p02')
const fitRecord = previewRevisedPlan ? stage('p03') : stage('p03r') ?? stage('p03'), writerRecord = stage('p06c')
if (!jobRecord || !fitRecord || (!previewRevisedPlan && !writerRecord)) throw new Error('Missing recorded targeted stages')
function payload(record: z.infer<typeof recordSchema>) {
  const content = record.messages.find(message => message.role === 'user')?.content
  if (!content?.includes('UNTRUSTED_INPUT_JSON:\n')) throw new Error('Recorded stage input is absent')
  return JSON.parse(content.split('UNTRUSTED_INPUT_JSON:\n')[1].split('\n\n只返回')[0]).payload
}
const jobInput = payload(jobRecord.value), originalJob = (jobInput.originalEnvelope?.payload ?? jobInput).canonicalJobDocument
const jobDocument = canonicalizeSourceDocument(history.jd_content, originalJob.documentId).canonicalDocument
if (createDigest(jobDocument) !== createDigest(originalJob)) throw new Error('Recorded JD differs from selected input')
const checkedJob = validateTargetedJobExtraction(jobDocument, targetedJobExtractionSchema.parse(JSON.parse(jobRecord.value.response.content)))
if (!checkedJob.passed || !checkedJob.value) throw new Error('Recorded job no longer passes local validation')
const candidate = checkedJob.value, job = buildJobRequirementBundle(jobDocument, candidate), targets = buildJobTargets(candidate, job)
const checkedFit = validateJobFitMap(jobFitMapSchema.parse(JSON.parse(fitRecord.value.response.content)), targets, resume)
if (!checkedFit.passed || !checkedFit.value) throw new Error('Recorded mapping no longer passes local validation')
const fit = checkedFit.value, targeting = { profile: candidate.jobSuccessProfile, targets, fit }
const match = projectLegacyMatch(fit, targets, resume, job)
const { profile, policy, requiresResolution } = buildAdaptiveStrategy({ resume, job, match })
if (requiresResolution) throw new Error('This inspection does not synthesize a missing P04 decision')
const checkedPlan = validateV5ResumePlan({ resume, job, match, profile, policy, gateMode: 'relaxed_release',
  plan: buildDeterministicV5ResumePlan({ resume, job, match, profile, policy, targetingScores: targetingEvidenceScores(fit, targets, resume),
    targetingTaskEvidence: coreTaskEvidence(fit, targets, resume) }) })
if (!checkedPlan.passed || !checkedPlan.value) throw new Error('Cannot reproduce recorded plan')
const plan = checkedPlan.value, writingPlan = buildWritingPlan({ resume, job, match, policy, plan, targeting })
if (previewRevisedPlan) {
  // Intentionally stop before compilation: the old Writer never received this new plan.
  const revisedPayload = writingPayload(writingPlan)
  const oldPayload = writerRecord ? payload(writerRecord.value) : null
  const report = { mode: 'revised_plan_preview_using_recorded_analysis', externalCallsMade: 0,
    freshGenerationPassed: false, humanQualityAccepted: false, writerResponseReplayed: false,
    sourceRun: source, sourceManifestSha256: manifest.sha256, sourceCacheSha256: snapshot.sha256,
    currentImplementationDigest: await createImplementationDigest(resolve(import.meta.dir, '..')),
    inspectionScriptSha256: createDigest(readFileSync(import.meta.path, 'utf8')),
    currentPromptVersions: V5_PROMPT_VERSIONS, inputPromptVersions: records.map(item => ({ file: item.name, sha256: item.sha256, version: item.value.promptVersion })),
    originalWriterPayloadDigest: oldPayload ? createDigest(oldPayload) : null, revisedWriterPayloadDigest: createDigest(revisedPayload),
    originalPayloadCharacters: oldPayload ? JSON.stringify(oldPayload).length : null, revisedPayloadCharacters: JSON.stringify(revisedPayload).length,
    profileIssues: checkedJob.issues.map(issue => ({ code: issue.code, severity: issue.severity })),
    fitIssues: checkedFit.issues.map(issue => ({ code: issue.code, severity: issue.severity })),
    planIssues: checkedPlan.issues.map(issue => ({ code: issue.code, severity: issue.severity })),
    scopeSelection: plan.scopePlans.map(scope => ({ scopeId: scope.scopeId, scopeType: scope.scopeType,
      bulletBudget: scope.bulletBudget, selectedEvidenceIds: scope.selectedEvidenceIds })),
    note: '新代码对旧 P02/P03 响应的离线选材预览；不是新提示词效果评估，不编译旧 Writer、不改变原运行失败状态。',
  }
  mkdirSync(output, { recursive: true, mode: 0o700 })
  for (const [name, value] of Object.entries({ 'report.json': report, 'writing-input.json': revisedPayload, 'selection.json': { plan, targeting } })) {
    writeFileSync(resolve(output, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
  }
  console.log(JSON.stringify({ output, mode: report.mode, externalCallsMade: 0,
    profileIssues: report.profileIssues, fitIssues: report.fitIssues, planIssues: report.planIssues,
    originalPayloadCharacters: report.originalPayloadCharacters, revisedPayloadCharacters: report.revisedPayloadCharacters }))
  process.exit(0)
}
if (!writerRecord) throw new Error('Missing recorded Writer')
if (createDigest(writingPayload(writingPlan)) !== createDigest(payload(writerRecord.value))) throw new Error('Rebuilt Writer input differs from recorded request; not a faithful replay')
const composition = p06CompositionOutputSchema.parse(JSON.parse(writerRecord.value.response.content))
let issues: ValidationIssue[] = [], localCompilationPassed = false
try { compileWritingArtifact({ composition, writingPlan, resume, plan, policy }); localCompilationPassed = true }
catch (error) { if (!(error instanceof SupportedWritingError)) throw error; issues = error.issues }
const bySlot = new Map(writingPlan.blueprint.slots.map(slot => [slot.slotId, slot]))
const selected = new Set(writingPlan.facts.map(fact => fact.evidenceId))
const blocks = composition.blocks.map(block => {
  const slot = bySlot.get(block.slotId)!
  const numbers = new Set(writingNumbers(block.text)), core = writingPlan.coreEvidenceIdsBySlot[block.slotId]
  const coreFacts = writingPlan.facts.filter(fact => core.includes(fact.evidenceId))
  return { ...block, kind: slot.kind, sectionKey: slot.sectionKey, scopeId: slot.scopeId,
    coreEvidenceIds: core, characters: block.text.length,
    missingProtectedResultNumbers: slot.kind === 'summary' ? [] : coreFacts.filter(fact => ['result', 'deliverable'].includes(fact.claimType)).flatMap(fact => fact.protectedNumbers.filter(value => !numbers.has(value))),
    sources: writingPlan.facts.filter(fact => block.evidenceIds.includes(fact.evidenceId)) }
})
const body = blocks.filter(block => block.kind === 'business_bullet')
const usage = readFileSync(resolve(source, 'usage.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
const report = { mode: 'unchanged_response_forensic_replay', externalCallsMade: 0, freshGenerationPassed: false,
  humanQualityAccepted: false, localCompilationPassed, writerPayloadExactlyReproduced: true,
  sourceRun: source, sourceManifestSha256: manifest.sha256, sourceCacheSha256: snapshot.sha256,
  recordedStages: records.map(item => ({ file: item.name, sha256: item.sha256, version: item.value.promptVersion })),
  issueCodes: issues.map(issue => issue.code), blockCount: blocks.length, businessBulletCount: body.length,
  writerTextCharacters: blocks.reduce((sum, block) => sum + block.characters, 0),
  longestBusinessBullet: Math.max(...body.map(block => block.characters)), selectedFactCount: selected.size,
  sourceScopeSelection: plan.scopePlans.map(scope => ({ scopeId: scope.scopeId, scopeType: scope.scopeType, treatment: scope.treatment,
    bulletBudget: scope.bulletBudget, selectedEvidenceCount: scope.selectedEvidenceIds.length })),
  taskLinks: fit.links.filter(link => targets.find(target => target.id === link.targetId)?.kind === 'task').map(link => ({ ...link,
    selectedEvidenceIds: link.evidenceIds.filter(id => selected.has(id)) })),
  actualRunUsage: { calls: usage.length, input: usage.reduce((sum, row) => sum + row.inputTokens, 0), output: usage.reduce((sum, row) => sum + row.outputTokens, 0) },
}
mkdirSync(output, { recursive: true, mode: 0o700 })
const save = (name: string, value: unknown) => writeFileSync(resolve(output, name), JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
save('report.json', report)
save('writer-evidence-review.json', { notice: 'Unreleased model draft and source references for owner review only; not a product artifact or completed human review.', blocks, issues })
save('selection-review.json', { timeline: resume.timeline, atoms: resume.evidenceAtoms.filter(atom => selected.has(atom.evidenceId) || fit.links.some(link => link.evidenceIds.includes(atom.evidenceId))), plan })
const draft = ['# Case3 未交付草稿（仅供审阅）', '', '以下正文直接来自本轮 Writer 响应，未通过本地编译。不作为正式简历或上线验收通过结果；未补写或修复模型正文。', '']
for (const slot of [...writingPlan.blueprint.slots].sort((a, b) => a.order - b.order)) {
  const block = composition.blocks.find(block => block.slotId === slot.slotId)
  if (!block) continue
  const timeline = resume.timeline.find(item => item.scopeId === slot.scopeId)
  draft.push(`## ${slot.kind === 'summary' ? '摘要' : [slot.sectionKey, timeline?.title].filter(Boolean).join(' / ')}`, '', block.text, '')
}
writeFileSync(resolve(output, 'draft-for-review.md'), draft.join('\n'), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output, externalCallsMade: 0, localCompilationPassed, writerPayloadExactlyReproduced: true,
  issueCodes: report.issueCodes, blockCount: blocks.length, businessBulletCount: body.length, writerTextCharacters: report.writerTextCharacters }))
