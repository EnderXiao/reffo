import { expect, test } from 'bun:test'
import { env } from '@/config/env'
import { planJobFitRepair, repairJobFitMap } from '@/v5/targeting/fit-repair'
import { compactTargetingResume, validateJobFitMap } from '@/v5/targeting/fit'
import { jobFitMapSchema, type JobFitMap } from '@/v5/targeting/contracts'
import { createTargetingFixture } from './targeting-fixtures'
import { writingIssue } from '@/v5/writing/facts'
import { compileV5Prompt, V5PromptBudgetError } from '@/v5/prompt-compiler'
import {MatchingResourceBudget} from '@/v5/targeting/matching-budget'

function fixture(count = 45) {
  const f = createTargetingFixture()
  const targets = Array.from({length: count}, (_, index) => ({...f.targets[0]!, id: `job:task:t${index}`}))
  const fit: JobFitMap = {contractVersion: 'job-fit-map-v2', links: targets.map(target => ({
    targetId: target.id, status: 'transferable', evidenceIds: [f.business.evidenceId], similarity: '已有相邻产品实践。',
    difference: '具体业务场景不同。', expressionAngle: '展开已有交付。', supportedAspects: [{text: '参与产品迭代', evidenceIds: [f.business.evidenceId]}],
    unprovenAspects: [], roleBoundary: '团队参与。', supportRelation: 'domain_transfer',
  })), narratives: [], questions: []}
  const payload = {jobTargetingPolicy: 'job-targeted-v2', targets, jobSuccessProfile: f.candidate.jobSuccessProfile,
    resumeContext: compactTargetingResume(f.resume)}
  return {...f, targets, fit, payload}
}
const envelope = (payload: unknown) => ({payload})
const scopeError = writingIssue('V5_SCHEMA_VALIDATION_FAILED', 'links.30.supportedAspects.0.evidenceIds', [], 'Expected array')
function payloadOf(value: unknown) {
  return (value as {payload: {originalEnvelope: {payload: ReturnType<typeof fixture>['payload'] & {repairScope: {targetIds: string[]}}}; currentOutput: unknown}}).payload
}

test('nested schema errors repair their owning link without resending the full 45-target draft', async () => {
  const f = fixture(), current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  current.links[30]!.supportedAspects = [{text: '参与产品迭代', evidenceIds: null}]
  const requests: unknown[] = []
  const repaired = await repairJobFitMap({current, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
    execute: async request => {
      requests.push(request)
      const p = payloadOf(request)
      expect(p.originalEnvelope.payload.targets.map(target => target.id)).toEqual([f.targets[30]!.id])
      expect(p.originalEnvelope.payload.resumeContext).toEqual(f.payload.resumeContext)
      expect(JSON.stringify(p.currentOutput)).not.toContain(f.targets[0]!.id)
      const compiled = compileV5Prompt({component: 'P03R', envelope: request})
      expect(compiled.maxOutputTokens).toBe(9600)
      return {...f.fit, links: [f.fit.links[30]!], narratives: [], questions: []}
    }})
  expect(requests).toHaveLength(1)
  expect(repaired).toEqual(f.fit)
  expect(validateJobFitMap(repaired, f.targets, f.resume).passed).toBe(true)
})

test('all schema errors are scoped even when the stored error summary only includes the first one', () => {
  const f = fixture(), current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  for (let index = 5; index < 35; index++) current.links[index]!.supportedAspects = [{text: '参与', evidenceIds: null}]
  const plan = planJobFitRepair({current, schemaValidated: false, issues: [scopeError], targets: f.targets, resume: f.resume})
  expect(plan.rebuild).toBe(false)
  expect(plan.targets.map(target => target.id)).toEqual(f.targets.slice(5, 35).map(target => target.id))
})

test.each(['null', 'string', 'missing_id', 'duplicate', 'unknown_id', 'top_level', 'out_of_range'] as const)(
  'unidentifiable drafts safely rebuild the authoritative target list: %s', async mutation => {
    const f = fixture(3)
    let current: unknown = structuredClone(f.fit)
    if (mutation === 'null') current = null
    else if (mutation === 'string') current = '{bad json'
    else if (mutation === 'missing_id') delete (current as {links: Array<{targetId?: string}>}).links[1]!.targetId
    else if (mutation === 'duplicate') (current as JobFitMap).links[1]!.targetId = f.fit.links[0]!.targetId
    else if (mutation === 'unknown_id') (current as JobFitMap).links[1]!.targetId = 'job:task:unknown'
    else if (mutation === 'top_level') (current as unknown as {questions: unknown}).questions = null
    const issues = mutation === 'out_of_range' ? [writingIssue('V5_SCHEMA_VALIDATION_FAILED', 'links.999.targetId', [], 'out of range')] : [scopeError]
    const result = await repairJobFitMap({current, schemaValidated: false, issues, payload: f.payload, resume: f.resume, envelope,
      execute: async request => {expect(payloadOf(request).originalEnvelope.payload.targets).toEqual(f.targets); return f.fit}})
    expect(result).toEqual(f.fit)
  })

test('schema repair also repairs business errors hidden by the primary schema failure', async () => {
  const f = fixture(3)
  const current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  current.links[1]!.supportedAspects = [{text: '参与', evidenceIds: null}]
  current.links[2]!.evidenceIds = ['not_real_evidence']
  const result = await repairJobFitMap({current, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
    execute: async request => {
      expect(payloadOf(request).originalEnvelope.payload.targets.map(target => target.id)).toEqual(f.targets.slice(1).map(target => target.id))
      return {...f.fit, links: f.fit.links.slice(1)}
    }})
  expect(result).toEqual(f.fit)
})

test('mixed schema and invented-gate errors keep the exact boundary of each requirement', async () => {
  const f = fixture(3)
  const targets = f.targets.map((target, index) => index === 2 ? {...target, kind: 'requirement' as const,
    text: '了解AI应用或具有AI产品设计经验。', sourceQuote: '了解AI应用或具有AI产品设计经验。'} : target)
  const current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  current.links[1]!.supportedAspects = [{text: '参与', evidenceIds: null}]
  current.links[2]!.difference = '未提供模型训练与模型评估经验。'
  const result = await repairJobFitMap({current, schemaValidated: false, issues: [scopeError], payload: {...f.payload, targets}, resume: f.resume, envelope,
    execute: async request => {
      const p = payloadOf(request), original = p.originalEnvelope.payload as typeof p.originalEnvelope.payload & {
        sourceBoundaries: Array<{targetId: string; sourceQuote: string; excludedCriteria: string[]}>
      }
      expect(original.targets.map(target => target.id)).toEqual(targets.slice(1).map(target => target.id))
      expect(original.sourceBoundaries).toHaveLength(1)
      expect(original.sourceBoundaries[0]!.sourceQuote).toBe(targets[2]!.sourceQuote!)
      expect(original.sourceBoundaries[0]!.excludedCriteria.join('')).toContain('模型')
      expect(original.resumeContext).toEqual(f.payload.resumeContext)
      return {...f.fit, links: f.fit.links.slice(1)}
    }})
  expect(result.links).toEqual(f.fit.links)
})

test('new-model missing v2 fields are scoped and repaired while missing targets cannot silently become unknown', async () => {
  const f = fixture(3), current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  delete current.links[1]!.roleBoundary
  current.links.pop()
  const result = await repairJobFitMap({current, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
    execute: async request => {
      expect(payloadOf(request).originalEnvelope.payload.targets.map(target => target.id)).toEqual(f.targets.slice(1).map(target => target.id))
      return {...f.fit, links: f.fit.links.slice(1)}
    }})
  expect(result).toEqual(f.fit)
})

test('a schema-valid repair with invented evidence still fails full business validation', async () => {
  const f = fixture(3), current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  current.links[1]!.supportedAspects = [{text: '参与', evidenceIds: null}]
  const result = await repairJobFitMap({current, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
    execute: async () => ({...f.fit, links: [{...f.fit.links[1]!, evidenceIds: ['invented']}]})})
  expect(jobFitMapSchema.safeParse(result).success).toBe(true)
  expect(validateJobFitMap(result, f.targets, f.resume).passed).toBe(false)
})

test('scoped repair cannot overwrite unaffected targets or omit the requested target', async () => {
  const f = fixture(3), current = structuredClone(f.fit) as unknown as {links: Array<Record<string, unknown>>}
  current.links[1]!.supportedAspects = [{text: '参与', evidenceIds: null}]
  for (const links of [f.fit.links, [], [f.fit.links[1]!, f.fit.links[1]!]]) await expect(repairJobFitMap({
    current, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
    execute: async () => ({...f.fit, links}),
  })).rejects.toMatchObject({code: 'P03_REPAIR_SCOPE_INVALID'})
})

test('oversized repair splits targets using preflight budgets and keeps every source fact', async () => {
  const f = fixture(45), previousWindow = env.V5_CONTEXT_WINDOW_TOKENS
  const seen: string[] = []
  try {
    env.V5_CONTEXT_WINDOW_TOKENS = 18000
    const repaired = await repairJobFitMap({current: null, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume, envelope,
      execute: async request => {
        const p = payloadOf(request), compiled = compileV5Prompt({component: 'P03R', envelope: request})
        expect(compiled.estimatedInputTokens + compiled.maxOutputTokens + 2048).toBeLessThanOrEqual(18000)
        expect(p.originalEnvelope.payload.resumeContext).toEqual(f.payload.resumeContext)
        const ids = new Set(p.originalEnvelope.payload.targets.map(target => target.id)); seen.push(...ids)
        return {...f.fit, links: f.fit.links.filter(link => ids.has(link.targetId))}
      }})
    expect(seen.length).toBe(45); expect(new Set(seen).size).toBe(45)
    expect(repaired).toEqual(f.fit)
  } finally {env.V5_CONTEXT_WINDOW_TOKENS = previousWindow}
})

test('one target whose source evidence cannot fit fails before any repair calls, and cancellation stops further calls', async () => {
  const f = fixture(3), previousWindow = env.V5_CONTEXT_WINDOW_TOKENS
  let calls = 0
  try {
    env.V5_CONTEXT_WINDOW_TOKENS = 10000
    await expect(repairJobFitMap({current: null, schemaValidated: false, issues: [], payload: f.payload, resume: f.resume, envelope,
      execute: async () => {calls++; return f.fit}})).rejects.toBeInstanceOf(V5PromptBudgetError)
    expect(calls).toBe(0)
  } finally {env.V5_CONTEXT_WINDOW_TOKENS = previousWindow}
  const controller = new AbortController(); controller.abort()
  await expect(repairJobFitMap({current: null, schemaValidated: false, issues: [], payload: f.payload, resume: f.resume,
    envelope, signal: controller.signal, execute: async () => {calls++; return f.fit}})).rejects.toBeDefined()
  expect(calls).toBe(0)
})

test('all context-fitting repair batches are preflighted against shared time and call budgets before any request', async () => {
  const f = fixture(45), previousWindow = env.V5_CONTEXT_WINDOW_TOKENS
  let calls = 0
  try {
    env.V5_CONTEXT_WINDOW_TOKENS = 18000
    const resourceBudget = new MatchingResourceBudget({timeoutMs: 300_000})
    const provider = resourceBudget.bind({complete: async () => ({provider: 'fake', model: 'fake', content: '{}', latencyMs: 1})})
    for (let i = 0; i < 7; i++) await provider.complete({messages: []})
    await expect(repairJobFitMap({current: null, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume,
      envelope, resourceBudget, execute: async () => {calls++; return f.fit}})).rejects.toMatchObject({code: 'P03_REPAIR_CALL_BUDGET_EXCEEDED'})
    expect(calls).toBe(0)
    await expect(repairJobFitMap({current: null, schemaValidated: false, issues: [scopeError], payload: f.payload, resume: f.resume,
      envelope, resourceBudget: new MatchingResourceBudget({timeoutMs: 30_000}),
      execute: async () => {calls++; return f.fit}})).rejects.toMatchObject({code: 'P03_REPAIR_TIME_BUDGET_EXCEEDED'})
    expect(calls).toBe(0)
  } finally {env.V5_CONTEXT_WINDOW_TOKENS = previousWindow}
})
