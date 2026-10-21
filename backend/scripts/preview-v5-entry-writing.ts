// Offline historical-material preflight only: no Provider, no API key access,
// no cache hydration and no claim of fresh upstream/model validation.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { resumeEvidenceBundleSchema, jobRequirementBundleSchema, v5MatchAnalysisSchema, v5ResumePlanSchema, generationPolicySchema } from '@/v5/schemas'
import { jobSuccessProfileSchema, jobFitMapSchema } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { buildWritingPlan } from '@/v5/writing/plan'
import { buildEntryWritingPlan, entryWritingPayload } from '@/v5/writing/entries'
import { compileV5Prompt } from '@/v5/prompt-compiler'

const resultPath = process.argv[2], targetingPath = process.argv[3]
if (!resultPath || !targetingPath) throw new Error('用法：bun run scripts/preview-v5-entry-writing.ts <历史 result.json> <历史 targeting.json>')
const read = (path: string) => {
  const bytes = readFileSync(resolve(path))
  return { digest: createHash('sha256').update(bytes).digest('hex'), value: JSON.parse(bytes.toString()) }
}
const recorded = read(resultPath), targeting = read(targetingPath)
const result = recorded.value.payload ?? recorded.value
const resume = resumeEvidenceBundleSchema.parse(result.resumeEvidenceBundle)
const job = jobRequirementBundleSchema.parse(result.jobRequirementBundle)
const match = v5MatchAnalysisSchema.parse(result.matchAnalysis)
const plan = v5ResumePlanSchema.parse(result.resumePlan)
const policy = generationPolicySchema.parse(result.generationPolicy)
const profile = jobSuccessProfileSchema.parse(targeting.value.profile)
const fit = jobFitMapSchema.parse(targeting.value.fit)
const targets: JobTarget[] = z.array(z.object({
  id: z.string(), kind: z.enum(['task', 'condition', 'attribute', 'requirement']),
  text: z.string(), priority: z.enum(['core', 'supporting', 'optional', 'unclear']),
  basis: z.enum(['explicit', 'inferred', 'unknown']), taskIds: z.array(z.string()),
  requirementIds: z.array(z.string()),
  dimension: z.enum(['knowledge', 'skill', 'experience', 'ability', 'behavior', 'motivation_fit']).optional(),
})).parse(targeting.value.targets)
const base = buildWritingPlan({ resume, job, match, plan, policy,
  targeting: { profile, targets, fit }, editorialPolicy: 'document-editorial-v1' })
const entries = buildEntryWritingPlan({ base, resume, plan, policy })
const payload = entryWritingPayload(entries)
const compiled = compileV5Prompt({ component: 'P06C', envelope: { payload } })
console.log(JSON.stringify({ externalCallsMade: 0, historicalUpstreamOnly: true,
  historicalResultDigest: recorded.digest, historicalTargetingDigest: targeting.digest,
  promptVersion: compiled.promptVersion, promptDigest: compiled.promptSha256,
  contextPreflightPassed: true, estimatedInputTokens: compiled.estimatedInputTokens, outputTokenCap: compiled.maxOutputTokens,
  oldSlots: base.blueprint.slots.length, entries: entries.entries.length,
  distinctFacts: new Set(entries.entries.flatMap(entry => entry.facts.map(fact => fact.evidenceId))).size,
  sectionMaterial: entries.entries.map(entry => ({ section: entry.section, facts: entry.facts.length,
    sourceCharacters: entry.facts.reduce((sum, fact) => sum + fact.text.length, 0),
    softTarget: entry.lengthHint.target })),
}, null, 2))
