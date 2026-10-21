import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { V5_ACCEPTANCE_CRITERIA } from '../src/v5/acceptance/criteria'

const root = resolve(import.meta.dir, '../..')
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const historyPath = resolve(root, '.artifacts/supabase/nonprod-20260829-162532/database/resume_histories.json')
const rows: Array<Record<string, unknown>> = JSON.parse(readFileSync(historyPath, 'utf8'))
const sourceRun = '.artifacts/v5-case3-quality-live-20260905-q4'
const resultName = readdirSync(resolve(root, sourceRun, 'cases')).find(name => name.endsWith('-v5-result.json'))
if (!resultName) throw new Error('Frozen Case3 result is missing')
const resultFile = readFileSync(resolve(root, sourceRun, 'cases', resultName))
const result = JSON.parse(resultFile.toString())
const case3 = rows[2]
if (!case3 || typeof case3.resume_content !== 'string' || typeof case3.jd_content !== 'string') {
  throw new Error('Case3 source pair is incomplete')
}

const dataset = '/Users/haishuanglong/Desktop/reffo/真实简历+目标岗位 JD'
const inventory = readdirSync(dataset, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && /^S\d{2}_/.test(entry.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(entry => {
    const files = readdirSync(resolve(dataset, entry.name)).filter(name => !name.startsWith('.'))
    const textResumes = files.filter(name => name.includes('_源简历_') && name.endsWith('.txt'))
    const jobs = files.filter(name => /_JD-[ABC]_/.test(name) && name.endsWith('.txt'))
    return {
      subjectId: entry.name.slice(0, 3),
      textResumeCount: textResumes.length,
      textJobCount: jobs.length,
      readyTextPairCount: textResumes.length === 1 ? jobs.length : 0,
      pdfCount: files.filter(name => /\.pdf$/i.test(name)).length,
      imageCount: files.filter(name => /\.(?:png|jpe?g)$/i.test(name)).length,
      // No source text, personal filename, or contact data in the inventory.
      fileDigests: files.map(name => hash(readFileSync(resolve(dataset, entry.name, name)))).sort(),
      provenance: 'user_supplied_pending_release_authorization',
    }
  })
const promptFiles = ['core.md', 'output.md', 'P01.md', 'P01R.md', 'P03.md', 'P03R.md', 'P06D.md', 'P12.md', 'manifest.json']
const report = {
  version: 'v5-writer-frozen-baseline-v1',
  criteria: V5_ACCEPTANCE_CRITERIA,
  createdAt: new Date().toISOString(),
  releaseDecision: 'not_accepted',
  missingRequirements: ['100_real_cases', '30_adversarial_cases', 'independent_human_reviews', 'live_writer_comparison'],
  case3: {
    historyFileSha256: hash(readFileSync(historyPath)),
    resumeSha256: hash(case3.resume_content),
    jdSha256: hash(case3.jd_content),
    historicalMarkdownSha256: hash(String(case3.optimized_content)),
    priorRun: sourceRun,
    priorResultFileSha256: hash(resultFile),
    priorPayloadSha256: result.payloadSha256,
    priorFingerprints: result.fingerprints,
  },
  promptDigests: Object.fromEntries(promptFiles.map(name => [name, hash(readFileSync(resolve(root, 'backend/src/v5/prompts', name)))])),
  datasetInventory: inventory,
  humanReviewCount: 0,
  externalCallsMade: 0,
}
const output = resolve(root, '.artifacts/v5-writer-baseline-20260906')
mkdirSync(output, { recursive: true, mode: 0o700 })
writeFileSync(resolve(output, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({
  output,
  subjectCount: inventory.length,
  readyTextPairs: inventory.reduce((sum, row) => sum + row.readyTextPairCount, 0),
  humanReviewCount: 0,
  externalCallsMade: 0,
}))
