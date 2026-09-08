// Read-only source replay. Produces a private writing plan, never a live-generation claim.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { buildWritingPlan, writingPayload } from '@/v5/writing/plan'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { buildAdaptiveStrategy } from '@/v5/adaptive-policy'
import { buildDeterministicV5ResumePlan } from '@/v5/validators'
import type { V5WorkflowResult } from '@/v5/types'

const root = resolve(import.meta.dir, '../..')
const baseline = JSON.parse(readFileSync(resolve(root, '.artifacts/v5-writer-baseline-20260906/baseline.json'), 'utf8'))
const casesDir = resolve(root, baseline.case3.priorRun, 'cases')
const resultFile = readdirSync(casesDir).find(name => name.endsWith('-v5-result.json'))!
const bytes = readFileSync(resolve(casesDir, resultFile))
if (createHash('sha256').update(bytes).digest('hex') !== baseline.case3.priorResultFileSha256) throw new Error('Frozen source result changed')
const previous: V5WorkflowResult = JSON.parse(bytes.toString()).payload
const resume = previous.resumeEvidenceBundle, match = previous.matchAnalysis, job = previous.jobRequirementBundle
const { profile, policy } = buildAdaptiveStrategy({ resume, match, job })
const plan = buildDeterministicV5ResumePlan({ resume, match, job, profile, policy })
const writingPlan = buildWritingPlan({ resume, match, job, plan, policy })
const compiled = compileV5Prompt({ component: 'P06C', envelope: { payload: writingPayload(writingPlan) } })
const report = {
  externalCallsMade: 0,
  priorMatchingReusedForLocalPreflightOnly: true,
  slotCount: writingPlan.blueprint.slots.length,
  writableFactCount: writingPlan.facts.length,
  coreReferenceCount: writingPlan.blueprint.requiredBodyEvidenceIds.length,
  estimatedWriterInputTokens: compiled.estimatedInputTokens,
  writerOutputTokenCap: compiled.maxOutputTokens,
  slots: writingPlan.blueprint.slots.map(slot => ({
    kind: slot.kind, factCount: slot.allowedEvidenceIds.length,
    sourceCharacters: writingPlan.facts.filter(fact => slot.allowedEvidenceIds.includes(fact.evidenceId)).reduce((sum, fact) => sum + fact.text.length, 0),
  })),
}
const output = resolve(root, '.artifacts/v5-writer-preflight-20260906')
mkdirSync(output, { recursive: true, mode: 0o700 })
writeFileSync(resolve(output, 'writing-plan.json'), JSON.stringify(writingPlan, null, 2), { flag: 'wx', mode: 0o600 })
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
