import { test, expect } from 'bun:test'
import type OpenAI from 'openai'
import { z } from 'zod'
import { DeepSeekProvider } from '@/providers/deepseek-provider'
import { parseDeepSeekThinking } from '@/config/deepseek-thinking'

function provider(frames: unknown[], observe?: (body: unknown, options: unknown) => void) {
  const client = { chat: { completions: { create: async (body: unknown, options: unknown) => {
    observe?.(body, options)
    return (async function* () { for (const frame of frames) yield frame })()
  } } } } as unknown as OpenAI
  return new DeepSeekProvider(client, parseDeepSeekThinking('disabled'))
}
const content = (text: string) => ({ id: 'r1', model: 'deepseek-v4-flash', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })
const stop = (reason = 'stop') => ({ id: 'r1', choices: [{ index: 0, delta: {}, finish_reason: reason }] })
const schema = { name: 'test', schema: z.object({ ok: z.boolean() }), strict: true as const }

test('streams only content, consumes the trailing usage frame, and never retries', async () => {
  const deltas: string[] = [], requests: unknown[] = []
  const p = provider([
    { choices: [{ index: 0, delta: { reasoning_content: 'PRIVATE_THINKING' } }] },
    content('{"ok":'), content('true}'), stop(),
    { choices: [], usage: { prompt_tokens: 12, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 20 } } },
  ], (body, options) => { requests.push(body); expect(options).toMatchObject({ maxRetries: 0 }) })
  const result = await p.complete({ messages: [], model: 'deepseek-v4-flash', structuredOutput: schema, onContentDelta: s => deltas.push(s) })
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
  expect(deltas.join('')).toBe('{"ok":true}')
  expect(result).toMatchObject({ content: '{"ok":true}', physicalAttempts: 1, inputTokens: 12, outputTokens: 30, reasoningTokens: 20 })
  expect(JSON.stringify(result)).not.toContain('PRIVATE_THINKING')
})

test('clean EOF without a terminal frame is not successful generation', async () => {
  await expect(provider([content('{"ok":true}')]).complete({ model: 'deepseek-v4-flash', messages: [], onContentDelta: () => {} })).rejects.toThrow('PROVIDER_STREAM_INCOMPLETE')
})
test('length termination retains usage for the stage-level truncation check', async () => {
  const result = await provider([content('{'), stop('length'), { choices: [], usage: { prompt_tokens: 2, completion_tokens: 40 } }])
    .complete({ model: 'deepseek-v4-flash', messages: [], structuredOutput: schema, onContentDelta: () => {} })
  expect(result).toMatchObject({ finishReason: 'length', content: '{', outputTokens: 40 })
})
test('stream abort stops consumption without a second request', async () => {
  const controller = new AbortController()
  let calls = 0
  const p = provider([content('a'), content('b'), stop()], () => calls++)
  await expect(p.complete({ model: 'deepseek-v4-flash', messages: [], signal: controller.signal, onContentDelta: () => controller.abort() })).rejects.toThrow()
  expect(calls).toBe(1)
})
test('missing provider usage stays unavailable, not a false zero', async () => {
  const result = await provider([content('{}'), stop()]).complete({ model: 'deepseek-v4-flash', messages: [], onContentDelta: () => {} })
  expect(result.outputTokens).toBeUndefined()
})
