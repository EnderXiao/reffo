// Zero-provider size probe. Historical extraction is read for sizing, never promoted to a new cache entry.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { compileV5Prompt, estimateV5PromptInputTokens } from '@/v5/prompt-compiler'
import { buildCompactMatchingResumeContext, buildModelSafeResumeEvidenceBundle } from '@/v5/main/workflow'
import { JOB_TARGETING_POLICY } from '@/v5/targeting/contracts'
import { compactTargetingResume } from '@/v5/targeting/fit'
import type { V5WorkflowResult } from '@/v5/types'

const root = resolve(import.meta.dir, '../..')
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')
const baseline = JSON.parse(readFileSync(resolve(root, '.artifacts/v5-writer-baseline-20260906/baseline.json'), 'utf8'))
const historyBytes = readFileSync(resolve(root, '.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json'))
if (hash(historyBytes) !== baseline.case3.historyFileSha256) throw new Error('Frozen source history changed')
const history = JSON.parse(historyBytes.toString())[2]
const cases = resolve(root, baseline.case3.priorRun, 'cases')
const resultName = readdirSync(cases).find(name => name.endsWith('-v5-result.json'))
if (!resultName) throw new Error('Frozen extraction is missing')
const resultBytes = readFileSync(resolve(cases, resultName))
if (hash(resultBytes) !== baseline.case3.priorResultFileSha256) throw new Error('Frozen extraction changed')
const previous: V5WorkflowResult = JSON.parse(resultBytes.toString()).payload
const job = canonicalizeSourceDocument(history.jd_content, 'case3:job-sizing').canonicalDocument
const payload = { canonicalJobDocument: job, sourcedContext: [] }
const oldP02 = compileV5Prompt({ component: 'P02', envelope: { payload } })
const newP02 = compileV5Prompt({ component: 'P02', envelope: { payload: { ...payload, jobTargetingPolicy: JOB_TARGETING_POLICY } } })
const measure = (value: unknown) => ({ characters: JSON.stringify(value).length,
  estimatedTokens: estimateV5PromptInputTokens([{ role: 'user', content: JSON.stringify(value) }]) })
const oldResume = buildCompactMatchingResumeContext(previous.resumeEvidenceBundle)
const newResume = compactTargetingResume(buildModelSafeResumeEvidenceBundle(previous.resumeEvidenceBundle))
const report = { mode: 'local_size_probe_only', externalCallsMade: 0, freshGenerationPassed: false, humanQualityAccepted: false,
  sourceHistorySha256: hash(historyBytes), historicalExtractionSha256: hash(resultBytes),
  historicalExtractionUsedForSizingOnly: true, cacheWritten: false,
  p02: { blockCount: job.blocks.length, legacyContractInputEstimate: oldP02.estimatedInputTokens,
    targetedContractInputEstimate: newP02.estimatedInputTokens, inputEstimateDelta: newP02.estimatedInputTokens - oldP02.estimatedInputTokens,
    targetedOutputCap: newP02.maxOutputTokens, contextWindow: newP02.contextWindowTokens, promptSha256: newP02.promptSha256,
    note: 'Both estimates use current prompt text. Neither is an actual provider bill.' },
  p03ResumeContext: { legacy: measure(oldResume), targeted: measure(newResume), factCount: newResume.facts.length,
    note: 'Resume projection only; the new P02 profile and targets have not been generated. Full P03/Writer budgets are checked before each actual call.' },
}
const output = resolve(process.argv[2] ?? resolve(root, '.artifacts/v5-case3-targeting-size-20260906-r1'))
mkdirSync(output, { recursive: true, mode: 0o700 })
writeFileSync(resolve(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output, ...report }, null, 2))
