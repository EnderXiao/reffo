// Offline only. Intake records must reference genuine, independently verified review/source files.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createDigest } from '@/harness/run-context'
import { evaluateV5Acceptance } from '@/v5/acceptance/evaluate'
import { evaluateV5TargetedAcceptance } from '@/v5/acceptance/targeted-evaluate'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('bun run scripts/assess-v5-release.ts <base-records.json> <targeted-records.json> <new-report.json>\nOffline only; no API calls. Exit 2 means not accepted. Files are never overwritten.')
} else if (args.length !== 3) {
  console.error('Expected base records, targeted records, and a new report path. Use --help.')
  process.exitCode = 1
} else {
  try {
    const [baseText, targetedText] = args.slice(0, 2).map(path => readFileSync(resolve(path), 'utf8'))
    const base = JSON.parse(baseText), targeted = JSON.parse(targetedText)
    const result = evaluateV5TargetedAcceptance(base, targeted)
    const report = { externalCallsMade: 0, inputRecordSha256: { base: createDigest(baseText), targeted: createDigest(targetedText) },
      assessment: result, base: evaluateV5Acceptance(base),
      provenanceNotice: 'Record hashes and intake attestations do not prove human identity. The release owner must verify original source/review records; this report does not deploy or enable production.' }
    const output = resolve(args[2])
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
    writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ output, accepted: result.accepted, reasons: result.reasons, externalCallsMade: 0 }))
    if (!result.accepted) process.exitCode = 2
  } catch {
    console.error('Cannot read/parse records or create the new report. Existing files were not overwritten.')
    process.exitCode = 1
  }
}
