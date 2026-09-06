// Offline plan comparison only: never initializes a provider or compiles an old response.
import {readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import {writingNumbers} from '@/v5/writing/facts'

const [beforeArg, afterArg, outputArg] = process.argv.slice(2)
if (!beforeArg || !afterArg || !outputArg || process.argv.length !== 5) throw new Error('Usage: compare-v5-writing-previews.ts <before-writing-input.json> <after-writing-input.json> <new-report.json>')
const schema = z.object({
  blueprint: z.object({slots: z.array(z.object({slotId: z.string(), kind: z.string(), coreEvidenceIds: z.array(z.string()), allowedEvidenceIds: z.array(z.string()),
    editorial: z.object({emphasis: z.array(z.object({evidenceId: z.string(), text: z.string(), kind: z.string()})).optional(), lengthHint: z.object({target: z.number(), max: z.number()}), avoidRepeatingSlotIds: z.array(z.string()).optional()}).optional(),
  }))}),
  facts: z.array(z.object({evidenceId: z.string(), scopeId: z.string(), text: z.string(), protectedNumbers: z.array(z.string()), requiredNumbers: z.array(z.string()).optional()}).passthrough()),
})
const load = (path: string) => {
  const raw = readFileSync(resolve(path), 'utf8'), value = JSON.parse(raw)
  return {value: schema.parse(value), characters: JSON.stringify(value).length, sha256: createHash('sha256').update(raw).digest('hex')}
}
const before = load(beforeArg), after = load(afterArg)
const oldFacts = new Map(before.value.facts.map(fact => [fact.evidenceId, fact]))
const newFacts = new Map(after.value.facts.map(fact => [fact.evidenceId, fact]))
const highlights = after.value.blueprint.slots.flatMap(slot => (slot.editorial?.emphasis ?? []).map(item => ({
  slotId: slot.slotId, evidenceId: item.evidenceId, kind: item.kind, numbers: writingNumbers(item.text),
  verbatimInSelectedFact: newFacts.get(item.evidenceId)?.text.includes(item.text) === true,
})))
const slotsUnchanged = before.value.blueprint.slots.length === after.value.blueprint.slots.length
  && before.value.blueprint.slots.every((slot, index) => slot.slotId === after.value.blueprint.slots[index].slotId)
const factsUnchanged = after.value.facts.every(fact => JSON.stringify(oldFacts.get(fact.evidenceId)) === JSON.stringify(fact))
if (!slotsUnchanged || !factsUnchanged || highlights.some(item => !item.verbatimInSelectedFact)) throw new Error('OFFLINE_PLAN_INVARIANT_FAILED')
const report = {
  mode: 'offline_plan_comparison', externalCallsMade: 0, freshGenerationPassed: false, humanQualityAccepted: false,
  beforeSha256: before.sha256, afterSha256: after.sha256,
  promptVersionsCompared: false, note: '比较代码对同一历史分析的选材计划；不是新 Prompt 实测、Token 账单或简历评分。',
  invariantChecks: {slotsUnchanged, retainedFactsUnchanged: factsUnchanged, highlightsVerbatim: highlights.every(item => item.verbatimInSelectedFact)},
  payloadCharacters: {before: before.characters, after: after.characters, delta: after.characters - before.characters},
  factCounts: {before: before.value.facts.length, after: after.value.facts.length},
  bodySlots: after.value.blueprint.slots.filter(slot => slot.kind === 'business_bullet').length,
  changedCoreSlots: after.value.blueprint.slots.flatMap(slot => {
    const old = before.value.blueprint.slots.find(item => item.slotId === slot.slotId)!
    return JSON.stringify(old.coreEvidenceIds) === JSON.stringify(slot.coreEvidenceIds) ? []
      : [{slotId: slot.slotId, before: old.coreEvidenceIds, after: slot.coreEvidenceIds}]
  }),
  omittedOptionalContextIds: before.value.facts.filter(fact => !newFacts.has(fact.evidenceId)).map(fact => fact.evidenceId),
  highlights,
  lengthHints: after.value.blueprint.slots.filter(slot => slot.editorial).map(slot => ({slotId: slot.slotId, ...slot.editorial!.lengthHint})),
}
writeFileSync(resolve(outputArg), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600})
console.log(JSON.stringify({report: resolve(outputArg), invariantChecks: report.invariantChecks, payloadCharacters: report.payloadCharacters, factCounts: report.factCounts, bodySlots: report.bodySlots}))
