import { describe, expect, test } from 'bun:test'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'
import { createRunContext } from '@/harness/run-context'
import type { V5WorkflowPlugin, V5WorkflowPluginContext } from '@/v5/plugins/contract'
import {
  V5PluginExecutionError,
  V5PluginRegistryError,
  V5WorkflowPluginRegistry,
} from '@/v5/plugins/registry'

interface SharedState {
  calls: string[]
}

function context(remainingMs = 1000): V5WorkflowPluginContext<SharedState> {
  return {
    runContext: createRunContext('plugin-test'),
    eventBus: new FakeHarnessEventBus(),
    remainingMs: () => remainingMs,
    shared: { calls: [] },
    config: {},
    manifest: { plugins: [] },
    completedPluginIds: new Set(),
    providers: {},
  }
}

function plugin(input: Partial<V5WorkflowPlugin<string, string, SharedState>> & Pick<V5WorkflowPlugin<string, string, SharedState>, 'id'>) {
  return {
    version: '1.0.0',
    stage: 'extract' as const,
    run: async (pluginContext: V5WorkflowPluginContext<SharedState>, value: string) => {
      pluginContext.shared.calls.push(input.id)
      return `${input.id}:${value}`
    },
    ...input,
  } satisfies V5WorkflowPlugin<string, string, SharedState>
}

describe('V5WorkflowPluginRegistry', () => {
  test('runs lifecycle hooks and records a completed plugin', async () => {
    const calls: string[] = []
    const registry = new V5WorkflowPluginRegistry<SharedState>()
      .register(plugin({
        id: 'resume-extraction',
        beforeRun: () => { calls.push('before') },
        run: async (_context, value) => {
          calls.push('run')
          return value.toUpperCase()
        },
        validate: (_context, _input, output) => { calls.push(`validate:${output}`) },
        afterRun: () => { calls.push('after') },
      }))
    const pluginContext = context()

    const result = await registry.execute<string, string>('resume-extraction', pluginContext, 'resume')

    expect(result).toMatchObject({ status: 'succeeded', output: 'RESUME' })
    expect(calls).toEqual(['before', 'run', 'validate:RESUME', 'after'])
    expect(pluginContext.completedPluginIds.has('resume-extraction')).toBe(true)
    expect(pluginContext.manifest.plugins).toMatchObject([{
      pluginId: 'resume-extraction',
      pluginVersion: '1.0.0',
      status: 'succeeded',
    }])
  })

  test('rejects duplicate ids and supports explicit replacement', async () => {
    const registry = new V5WorkflowPluginRegistry<SharedState>().register(plugin({ id: 'matching' }))
    expect(() => registry.register(plugin({ id: 'matching' }))).toThrow(V5PluginRegistryError)

    registry.replace(plugin({ id: 'matching', version: '2.0.0', run: async () => 'replacement' }))
    const result = await registry.execute<string, string>('matching', context(), 'input')

    expect(result.pluginVersion).toBe('2.0.0')
    expect(result.output).toBe('replacement')
  })

  test('validates missing and cyclic dependencies before execution', () => {
    const missing = new V5WorkflowPluginRegistry<SharedState>().register(plugin({
      id: 'planning',
      dependencies: ['matching'],
    }))
    expect(() => missing.assertReady()).toThrowError(expect.objectContaining({ code: 'PLUGIN_DEPENDENCY_MISSING' }))

    const cyclic = new V5WorkflowPluginRegistry<SharedState>()
      .register(plugin({ id: 'a', dependencies: ['b'] }))
      .register(plugin({ id: 'b', dependencies: ['a'] }))
    expect(() => cyclic.assertReady()).toThrowError(expect.objectContaining({ code: 'PLUGIN_DEPENDENCY_CYCLE' }))
  })

  test('requires dependencies to complete in the current workflow context', async () => {
    const registry = new V5WorkflowPluginRegistry<SharedState>()
      .register(plugin({ id: 'extract' }))
      .register(plugin({ id: 'match', dependencies: ['extract'] }))
      .assertReady()
    const pluginContext = context()

    await expect(registry.execute('match', pluginContext, 'input')).rejects.toMatchObject({
      code: 'PLUGIN_DEPENDENCY_NOT_COMPLETED',
    })
    await registry.execute('extract', pluginContext, 'input')
    const result = await registry.execute('match', pluginContext, 'input')

    expect(result.status).toBe('succeeded')
  })

  test('only allows optional plugins to be disabled', async () => {
    const registry = new V5WorkflowPluginRegistry<SharedState>()
      .register(plugin({ id: 'required' }))
      .register(plugin({ id: 'quality', optional: true, stage: 'quality_judge' }))

    expect(() => registry.disable('required')).toThrowError(expect.objectContaining({
      code: 'PLUGIN_REQUIRED_DISABLE_FORBIDDEN',
    }))
    registry.disable('quality')
    const result = await registry.execute('quality', context(), 'input')

    expect(result.status).toBe('skipped')
  })

  test('returns partial for optional failures and calls onError', async () => {
    let captured: unknown
    const failure = new Error('quality unavailable')
    const registry = new V5WorkflowPluginRegistry<SharedState>().register(plugin({
      id: 'quality',
      optional: true,
      stage: 'quality_judge',
      run: async () => { throw failure },
      onError: (_context, _input, error) => { captured = error },
    }))

    const result = await registry.execute('quality', context(), 'input')

    expect(result.status).toBe('partial')
    expect(result.error).toBeInstanceOf(V5PluginExecutionError)
    expect(captured).toBe(failure)
  })

  test('throws a typed error for required failures', async () => {
    const registry = new V5WorkflowPluginRegistry<SharedState>().register(plugin({
      id: 'fact-judge',
      stage: 'fact_judge',
      failureMapping: {
        apiCode: 'V5_FACT_JUDGE_BLOCKED',
        agentState: 'blocked_fact_validation',
      },
      run: async () => { throw new Error('judge unavailable') },
    }))

    await expect(registry.execute('fact-judge', context(), 'input')).rejects.toMatchObject({
      code: 'PLUGIN_EXECUTION_FAILED',
      pluginId: 'fact-judge',
      stage: 'fact_judge',
      apiCode: 'V5_FACT_JUDGE_BLOCKED',
      agentState: 'blocked_fact_validation',
    })
  })

  test('enforces the smaller plugin or workflow timeout', async () => {
    const registry = new V5WorkflowPluginRegistry<SharedState>().register(plugin({
      id: 'slow',
      timeoutMs: 50,
      run: async pluginContext => new Promise((_resolve, reject) => {
        pluginContext.signal?.addEventListener('abort', () => reject(pluginContext.signal?.reason), { once: true })
      }),
    }))

    await expect(registry.execute('slow', context(5), 'input')).rejects.toMatchObject({
      code: 'PLUGIN_TIMEOUT',
      pluginId: 'slow',
    })
  })

  test('propagates parent cancellation even when a plugin ignores the signal', async () => {
    const controller = new AbortController()
    const pluginContext = { ...context(), signal: controller.signal }
    const registry = new V5WorkflowPluginRegistry<SharedState>().register(plugin({
      id: 'cancelled',
      run: async () => new Promise<string>(() => {}),
    }))

    const execution = registry.execute('cancelled', pluginContext, 'input')
    controller.abort(new Error('workflow cancelled'))

    await expect(execution).rejects.toMatchObject({
      code: 'PLUGIN_CANCELLED',
      pluginId: 'cancelled',
    })
  })
})
