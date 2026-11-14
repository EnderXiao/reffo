import {expect, test} from 'bun:test'
import {MatchingResourceBudget, MATCHING_MAX_PHYSICAL_CALLS, MATCHING_STEP_TIMEOUT_MS} from '@/v5/targeting/matching-budget'
import {FallbackLlmProvider} from '@/providers/fallback-provider'
import type {ChatCompletionInput, LlmProvider} from '@/providers/llm-provider'
import {runV5StructuredStage} from '@/v5/stage-runner'

const success = {provider: 'fake', model: 'fake', content: '{}', latencyMs: 1, finishReason: 'stop'}
const request = {messages: [{role: 'user' as const, content: 'test'}]}

test('matching caps elapsed time and total physical calls across all bound requests', async () => {
  let now = 100, calls = 0
  const budget = new MatchingResourceBudget({timeoutMs: 600_000, now: () => now})
  expect(budget.remainingMs()).toBe(MATCHING_STEP_TIMEOUT_MS)
  const provider = budget.bind({complete: async input => {
    calls++
    expect(input.maxProviderAttempts).toBe(1); expect(input.maxProviderModels).toBe(1)
    expect(input.callMetadata?.budgetRemaining).toBe(MATCHING_MAX_PHYSICAL_CALLS - calls)
    return success
  }})
  for (let i = 0; i < MATCHING_MAX_PHYSICAL_CALLS; i++) await provider.complete(request)
  await expect(provider.complete(request)).rejects.toMatchObject({code: 'P03_CALL_BUDGET_EXCEEDED'})
  expect(calls).toBe(MATCHING_MAX_PHYSICAL_CALLS)
  expect(budget.physicalCalls).toBe(calls)
  now += MATCHING_STEP_TIMEOUT_MS
  expect(budget.remainingMs()).toBe(0)
})

test('repair preflight rejects all batches before spending if call or remaining time is insufficient', async () => {
  let now = 0
  const budget = new MatchingResourceBudget({timeoutMs: 300_000, now: () => now})
  expect(() => budget.preflightRepairs(5)).toThrow(expect.objectContaining({code: 'P03_REPAIR_CALL_BUDGET_EXCEEDED'}))
  now = 260_001
  expect(() => budget.preflightRepairs(2)).toThrow(expect.objectContaining({code: 'P03_REPAIR_TIME_BUDGET_EXCEEDED'}))
  now = 0
  const provider = budget.bind({complete: async () => success})
  for (let i = 0; i < 7; i++) await provider.complete(request)
  expect(() => budget.preflightRepairs(2)).toThrow(expect.objectContaining({code: 'P03_REPAIR_CALL_BUDGET_EXCEEDED'}))
})

test('matching provider wrapper disables hidden fallback retries', async () => {
  let calls = 0
  const primary: LlmProvider = {complete: async () => {calls++; throw new Error('network timeout')}}
  const budget = new MatchingResourceBudget({timeoutMs: 300_000})
  await expect(budget.bind(new FallbackLlmProvider(primary)).complete(request)).rejects.toThrow('network timeout')
  expect(calls).toBe(1)
  expect(budget.physicalCalls).toBe(1)
})

test('continuation and JSON repair all consume the same matching physical call allowance', async () => {
  const budget = new MatchingResourceBudget({timeoutMs: 300_000})
  const calls: ChatCompletionInput[] = []
  const provider = budget.bind({complete: async input => {
    calls.push(input)
    if (calls.length === 1) return {...success, content: '{"contractVersion":', finishReason: 'length'}
    return {...success, content: 'malformed'}
  }})
  await expect(runV5StructuredStage({component: 'P03', envelope: {payload: {jobTargetingPolicy: 'job-targeted-v2', targets: []}},
    options: {provider}})).rejects.toMatchObject({code: 'V5_JSON_PARSE_FAILED'})
  expect(calls).toHaveLength(3)
  expect(budget.physicalCalls).toBe(3)
  expect(calls[2]!.callMetadata?.callReason).toBe('json_repair')
})

test('parent cancellation reaches active repair and prevents all later physical calls', async () => {
  const controller = new AbortController()
  const budget = new MatchingResourceBudget({timeoutMs: 300_000, signal: controller.signal})
  let calls = 0
  const provider = budget.bind({complete: async input => {
    calls++
    return await new Promise((_, reject) => {
      input.signal!.addEventListener('abort', () => reject(input.signal!.reason), {once: true})
      controller.abort(new Error('user cancelled'))
    })
  }})
  await expect(budget.runRepairBatch(1, signal => provider.complete({...request, signal}))).rejects.toThrow('user cancelled')
  await expect(provider.complete(request)).rejects.toThrow('user cancelled')
  expect(calls).toBe(1)
})

test('time exhaustion during one repair prevents the next batch', async () => {
  let now = 0, calls = 0
  const budget = new MatchingResourceBudget({timeoutMs: 300_000, now: () => now})
  await budget.runRepairBatch(2, async () => {calls++; now = 280_001; return success})
  await expect(budget.runRepairBatch(1, async () => {calls++; return success})).rejects.toMatchObject({code: 'P03_REPAIR_TIME_BUDGET_EXCEEDED'})
  expect(calls).toBe(1)
})
