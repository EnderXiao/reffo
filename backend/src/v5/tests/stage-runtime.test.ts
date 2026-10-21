import { expect, test } from 'bun:test'
import { V5StageRuntime } from '@/v5/stage-runtime'
import { V5_WORKFLOW_VERSION } from '@/v5/types'

test('V5StageRuntime provides one shared context and enforces plugin dependencies', async () => {
  const runtime = new V5StageRuntime({timeoutMs: 1000})
  const order: string[] = []
  const extract = {
    id: 'extract', version: 'test', stage: 'extract' as const,
    run: async (context: typeof runtime.context) => {
      order.push('extract')
      context.shared.value = 'resume'
      return 'resume'
    },
  }
  const match = {
    id: 'match', version: 'test', stage: 'match' as const, dependencies: ['extract'],
    run: async (context: typeof runtime.context) => {
      order.push('match')
      return context.shared.value
    },
  }

  expect(await runtime.execute({plugin: extract, input: {}})).toBe('resume')
  expect(await runtime.execute({plugin: match, input: {}})).toBe('resume')
  expect(order).toEqual(['extract', 'match'])
  expect(runtime.runContext.workflowVersion).toBe(V5_WORKFLOW_VERSION)
  expect(runtime.context.completedPluginIds).toEqual(new Set(['extract', 'match']))
})


test('a missing prerequisite blocks execution and does not mark completion', async () => {
  const runtime = new V5StageRuntime()
  let calls = 0
  await expect(runtime.execute({plugin: {
    id: 'match', version: 'test', stage: 'match', dependencies: ['extract'],
    run: () => { calls++; return 'invalid' },
  }, input: {}})).rejects.toMatchObject({code: 'PLUGIN_DEPENDENCY_MISSING'})
  expect(calls).toBe(0)
  expect(runtime.context.completedPluginIds.size).toBe(0)
})

test('replacement and disabled plugins preserve the registry execution semantics', async () => {
  let calls = 0
  const runtime = new V5StageRuntime({pluginOverrides: {extract: {
    id: 'extract', version: 'override', stage: 'extract', run: () => 'replacement',
  }}})
  expect(await runtime.execute({plugin: {id: 'extract', version: 'test', stage: 'extract',
    run: () => { calls++; return 'original' }}, input: {}})).toBe('replacement')
  expect(calls).toBe(0)
  expect(runtime.manifest.plugins[0].pluginVersion).toBe('override')
  await runtime.execute({plugin: {id: 'optional', version: 'test', stage: 'quality_judge', optional: true,
    run: () => { calls++; return 'never' }}, input: {}, enabled: false})
  expect(calls).toBe(0)
  expect(runtime.manifest.plugins[1].status).toBe('skipped')
  expect(runtime.context.completedPluginIds.has('optional')).toBe(false)
})

test('required plugin failure retains its API mapping and contexts stay isolated', async () => {
  const runtime = new V5StageRuntime()
  await expect(runtime.execute({plugin: {id: 'extract', version: 'test', stage: 'extract',
    failureMapping: {apiCode: 'V5_RESUME_EXTRACTION_FAILED', agentState: 'blocked_input_validation'},
    run: () => { throw new Error('test failure') }}, input: {}})).rejects.toMatchObject({apiCode: 'V5_RESUME_EXTRACTION_FAILED'})
  expect(runtime.manifest.plugins[0].status).toBe('failed')
  const next = new V5StageRuntime()
  expect(next.runContext.runId).not.toBe(runtime.runContext.runId)
  expect(next.manifest.plugins).toEqual([])
  expect(next.context.completedPluginIds.size).toBe(0)
})
