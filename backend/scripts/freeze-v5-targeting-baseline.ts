import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileV5Prompt } from '@/v5/prompt-compiler'
import { V5_ACCEPTANCE_CRITERIA } from '@/v5/acceptance/criteria'
const root = resolve(import.meta.dir, '../..')
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const prior = JSON.parse(readFileSync(resolve(root, '.artifacts/v5-writer-baseline-20260906/baseline.json'), 'utf8'))
const files = ['backend/docs/v5-prompt-optimization-final-plan.md', 'backend/src/v5/main/workflow.ts',
  'backend/src/v5/prompt-compiler.ts', 'backend/src/v5/validators.ts', 'backend/src/v5/prompts/manifest.json']
const report = { version: 'v5-targeting-baseline-v1', createdAt: new Date().toISOString(),
  releaseAccepted: false, externalCallsMade: 0, case3: prior.case3,
  datasetInventory: prior.datasetInventory, humanReviewCount: 0,
  baseCriteria: V5_ACCEPTANCE_CRITERIA,
  targetingProposedCriteria: { version: 'job-targeted-acceptance-v1', humanRubricSignoff: false,
    minimumTaskPrecision: .9, minimumTaskRecall: .9, minimumFitPrecision: .9,
    minimumEligibleCoreTaskCoverage: .9, minimumMultiJobSubjects: 20, minimumJobsPerSubject: 2, minimumBlindJobAttribution: .8,
    maximumMajorProfileErrors: 0, maximumCrossJobFactChanges: 0 },
  fileDigests: Object.fromEntries(files.map(path => [path, hash(readFileSync(resolve(root, path)))])),
  prompts: (['P02', 'P03', 'P06C'] as const).map(component => {
    const prompt = compileV5Prompt({ component, envelope: { payload: {} } })
    return { component, version: prompt.promptVersion, sha256: prompt.promptSha256, outputCap: prompt.maxOutputTokens }
  }),
  baselineValidation: { unitTests: 486, failures: 0, typecheckPassed: true, log: '/tmp/reffo-r2-baseline-tests.log' },
}
const output = resolve(root, '.artifacts/v5-targeting-baseline-20260906')
mkdirSync(output, { recursive: true, mode: 0o700 })
writeFileSync(resolve(output, 'baseline.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output, externalCallsMade: 0, releaseAccepted: false }))
