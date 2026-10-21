import { createHarnessEventBus, type HarnessEventBus } from '@/harness/event-bus'
import { createHarnessEvent } from '@/harness/events'
import { createRunContext } from '@/harness/run-context'
import type { LlmProvider } from '@/providers/llm-provider'
import { V5WorkflowPluginRegistry } from '@/v5/plugins/registry'
import type { V5WorkflowPlugin, V5WorkflowPluginContext, V5WorkflowPluginManifest } from '@/v5/plugins/contract'
import { V5_WORKFLOW_VERSION, type ResumeAgentState } from '@/v5/types'

export interface V5StageRuntimeOptions {
  eventBus?: HarnessEventBus
  timeoutMs?: number
  provider?: LlmProvider
  judgeProvider?: LlmProvider
  config?: Readonly<Record<string, unknown>>
  pluginOverrides?: Partial<Record<string, V5WorkflowPlugin<unknown, unknown>>>
}

/** 每次请求独立持有插件依赖、状态和预算；完整流程与单步共用。 */
export class V5StageRuntime {
  readonly runContext = createRunContext(V5_WORKFLOW_VERSION)
  readonly registry = new V5WorkflowPluginRegistry()
  readonly manifest: V5WorkflowPluginManifest = { plugins: [] }
  readonly context: V5WorkflowPluginContext
  private currentState: ResumeAgentState = 'received'

  constructor(private readonly options: V5StageRuntimeOptions = {}) {
    const timeoutMs = options.timeoutMs ?? 600000
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_V5_WORKFLOW_TIMEOUT')
    const deadline = Date.now() + timeoutMs
    this.context = {
      runContext: this.runContext,
      eventBus: options.eventBus ?? createHarnessEventBus(),
      remainingMs: () => Math.max(1, deadline - Date.now()),
      shared: {},
      config: {
        enableQualityJudge: false,
        releaseGateMode: 'deterministic_product_delivery_v2',
        ...options.config,
      },
      manifest: this.manifest,
      completedPluginIds: new Set(),
      providers: { primary: options.provider, judge: options.judgeProvider ?? options.provider },
    }
  }

  get state() {
    return this.currentState
  }

  async setState(state: ResumeAgentState) {
    const previous = this.currentState
    this.currentState = state
    await this.context.eventBus.publish(createHarnessEvent({
      type: 'workflow.state.changed',
      runId: this.runContext.runId,
      requestId: this.runContext.requestId,
      payload: { previous, state },
    }))
  }

  async execute<TInput, TOutput>(input: {
    plugin: V5WorkflowPlugin<TInput, TOutput>
    input: TInput
    enabled?: boolean
  }): Promise<TOutput> {
    this.registry.register(input.plugin)
    const override = this.options.pluginOverrides?.[input.plugin.id]
    if (override) {
      if (override.id !== input.plugin.id) throw new Error('V5_PLUGIN_OVERRIDE_ID_MISMATCH')
      this.registry.replace(override)
    }
    if (input.enabled === false) this.registry.disable(input.plugin.id)
    this.registry.assertReady()
    const result = await this.registry.execute<TInput, TOutput>(input.plugin.id, this.context, input.input)
    // 可选插件禁用/失败沿用 Registry 的 undefined 输出契约，调用者负责分支处理。
    return result.output as TOutput
  }
}
