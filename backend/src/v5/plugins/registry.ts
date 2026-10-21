import type {
  V5PluginFailureMapping,
  V5PluginExecutionResult,
  V5PluginManifestEntry,
  V5PluginStage,
  V5WorkflowPlugin,
  V5WorkflowPluginContext,
} from '@/v5/plugins/contract'

export type V5PluginRegistryErrorCode =
  | 'PLUGIN_ID_REQUIRED'
  | 'PLUGIN_VERSION_REQUIRED'
  | 'PLUGIN_DUPLICATE'
  | 'PLUGIN_NOT_FOUND'
  | 'PLUGIN_REQUIRED_DISABLE_FORBIDDEN'
  | 'PLUGIN_DEPENDENCY_MISSING'
  | 'PLUGIN_DEPENDENCY_DISABLED'
  | 'PLUGIN_DEPENDENCY_NOT_COMPLETED'
  | 'PLUGIN_DEPENDENCY_CYCLE'

export class V5PluginRegistryError extends Error {
  constructor(
    readonly code: V5PluginRegistryErrorCode,
    message: string,
    readonly pluginId?: string
  ) {
    super(message)
    this.name = 'V5PluginRegistryError'
  }
}

export class V5PluginExecutionError extends Error {
  constructor(
    readonly pluginId: string,
    readonly stage: V5PluginStage,
    readonly code: 'PLUGIN_EXECUTION_FAILED' | 'PLUGIN_TIMEOUT' | 'PLUGIN_CANCELLED',
    readonly apiCode: string,
    readonly agentState: V5PluginFailureMapping['agentState'],
    message: string,
    readonly cause: unknown
  ) {
    super(message)
    this.name = 'V5PluginExecutionError'
  }
}

interface ErasedWorkflowPlugin<TShared extends object> {
  id: string
  version: string
  stage: V5PluginStage
  optional?: boolean
  dependencies?: readonly string[]
  timeoutMs?: number
  failureMapping?: V5PluginFailureMapping
  beforeRun?: (context: V5WorkflowPluginContext<TShared>, input: unknown) => void | Promise<void>
  run: (context: V5WorkflowPluginContext<TShared>, input: unknown) => unknown | Promise<unknown>
  validate?: (
    context: V5WorkflowPluginContext<TShared>,
    input: unknown,
    output: unknown
  ) => void | Promise<void>
  afterRun?: (
    context: V5WorkflowPluginContext<TShared>,
    input: unknown,
    output: unknown
  ) => void | Promise<void>
  onError?: (
    context: V5WorkflowPluginContext<TShared>,
    input: unknown,
    error: unknown
  ) => void | Promise<void>
}

interface RegisteredPlugin<TShared extends object> {
  plugin: ErasedWorkflowPlugin<TShared>
  enabled: boolean
}

function erasePlugin<TInput, TOutput, TShared extends object>(
  plugin: V5WorkflowPlugin<TInput, TOutput, TShared>
): ErasedWorkflowPlugin<TShared> {
  return {
    id: plugin.id,
    version: plugin.version,
    stage: plugin.stage,
    optional: plugin.optional,
    dependencies: plugin.dependencies,
    timeoutMs: plugin.timeoutMs,
    failureMapping: plugin.failureMapping,
    beforeRun: plugin.beforeRun
      ? (context, input) => plugin.beforeRun?.(context, input as TInput)
      : undefined,
    run: (context, input) => plugin.run(context, input as TInput),
    validate: plugin.validate
      ? (context, input, output) => plugin.validate?.(context, input as TInput, output as TOutput)
      : undefined,
    afterRun: plugin.afterRun
      ? (context, input, output) => plugin.afterRun?.(context, input as TInput, output as TOutput)
      : undefined,
    onError: plugin.onError
      ? (context, input, error) => plugin.onError?.(context, input as TInput, error)
      : undefined,
  }
}

export class V5WorkflowPluginRegistry<TShared extends object = Record<string, unknown>> {
  private readonly plugins = new Map<string, RegisteredPlugin<TShared>>()

  register<TInput, TOutput>(plugin: V5WorkflowPlugin<TInput, TOutput, TShared>) {
    this.validateIdentity(plugin)
    if (this.plugins.has(plugin.id)) {
      throw new V5PluginRegistryError('PLUGIN_DUPLICATE', `插件 ${plugin.id} 已注册。`, plugin.id)
    }
    this.plugins.set(plugin.id, { plugin: erasePlugin(plugin), enabled: true })
    return this
  }

  replace<TInput, TOutput>(plugin: V5WorkflowPlugin<TInput, TOutput, TShared>) {
    this.validateIdentity(plugin)
    if (!this.plugins.has(plugin.id)) {
      throw new V5PluginRegistryError('PLUGIN_NOT_FOUND', `插件 ${plugin.id} 未注册，无法替换。`, plugin.id)
    }
    this.plugins.set(plugin.id, { plugin: erasePlugin(plugin), enabled: true })
    return this
  }

  disable(pluginId: string) {
    const registered = this.require(pluginId)
    if (!registered.plugin.optional) {
      throw new V5PluginRegistryError(
        'PLUGIN_REQUIRED_DISABLE_FORBIDDEN',
        `必选插件 ${pluginId} 不允许禁用。`,
        pluginId
      )
    }
    registered.enabled = false
    return this
  }

  enable(pluginId: string) {
    this.require(pluginId).enabled = true
    return this
  }

  list(stage?: V5PluginStage) {
    return [...this.plugins.values()]
      .filter(item => !stage || item.plugin.stage === stage)
      .map(item => ({
        id: item.plugin.id,
        version: item.plugin.version,
        stage: item.plugin.stage,
        optional: item.plugin.optional ?? false,
        dependencies: [...(item.plugin.dependencies ?? [])],
        enabled: item.enabled,
      }))
  }

  assertReady() {
    for (const { plugin, enabled } of this.plugins.values()) {
      if (!enabled) continue
      for (const dependencyId of plugin.dependencies ?? []) {
        const dependency = this.plugins.get(dependencyId)
        if (!dependency) {
          throw new V5PluginRegistryError(
            'PLUGIN_DEPENDENCY_MISSING',
            `插件 ${plugin.id} 缺少依赖 ${dependencyId}。`,
            plugin.id
          )
        }
        if (!dependency.enabled) {
          throw new V5PluginRegistryError(
            'PLUGIN_DEPENDENCY_DISABLED',
            `插件 ${plugin.id} 的依赖 ${dependencyId} 已禁用。`,
            plugin.id
          )
        }
      }
    }
    this.assertAcyclic()
    return this
  }

  async execute<TInput, TOutput>(
    pluginId: string,
    context: V5WorkflowPluginContext<TShared>,
    input: TInput
  ): Promise<V5PluginExecutionResult<TOutput>> {
    const registered = this.require(pluginId)
    const plugin = registered.plugin
    const startedAt = new Date().toISOString()
    const startedMs = Date.now()
    if (!registered.enabled) {
      const result = this.result<TOutput>(plugin, 'skipped', startedMs)
      this.recordManifest(context, plugin, result, startedAt)
      return result
    }
    this.assertDependenciesCompleted(plugin, context.completedPluginIds)

    try {
      const output = await this.executeLifecycle(plugin, context, input) as TOutput
      context.completedPluginIds.add(plugin.id)
      const result = this.result(plugin, 'succeeded', startedMs, output)
      this.recordManifest(context, plugin, result, startedAt)
      return result
    } catch (error) {
      let wrapped = this.wrapExecutionError(plugin, error)
      try {
        await plugin.onError?.(context, input, error)
      } catch (hookError) {
        wrapped = this.executionError(
          plugin,
          wrapped.code,
          `插件 ${plugin.id} 执行失败，onError 处理也失败。`,
          new AggregateError([wrapped.cause, hookError], 'plugin and onError failures')
        )
      }
      if (plugin.optional) {
        const result = this.result<TOutput>(plugin, 'partial', startedMs, undefined, wrapped)
        this.recordManifest(context, plugin, result, startedAt)
        return result
      }
      this.recordManifest(context, plugin, {
        status: 'failed',
        durationMs: Math.max(0, Date.now() - startedMs),
        error: wrapped,
      }, startedAt)
      throw wrapped
    }
  }

  private validateIdentity(plugin: Pick<V5WorkflowPlugin<never, never, TShared>, 'id' | 'version'>) {
    if (!plugin.id.trim()) {
      throw new V5PluginRegistryError('PLUGIN_ID_REQUIRED', '插件 ID 不能为空。')
    }
    if (!plugin.version.trim()) {
      throw new V5PluginRegistryError('PLUGIN_VERSION_REQUIRED', `插件 ${plugin.id} 版本不能为空。`, plugin.id)
    }
  }

  private require(pluginId: string) {
    const registered = this.plugins.get(pluginId)
    if (!registered) {
      throw new V5PluginRegistryError('PLUGIN_NOT_FOUND', `插件 ${pluginId} 未注册。`, pluginId)
    }
    return registered
  }

  private assertDependenciesCompleted(
    plugin: ErasedWorkflowPlugin<TShared>,
    completedPluginIds: Set<string>
  ) {
    for (const dependencyId of plugin.dependencies ?? []) {
      const dependency = this.plugins.get(dependencyId)
      if (!dependency) {
        throw new V5PluginRegistryError('PLUGIN_DEPENDENCY_MISSING', `插件 ${plugin.id} 缺少依赖 ${dependencyId}。`, plugin.id)
      }
      if (!dependency.enabled) {
        throw new V5PluginRegistryError('PLUGIN_DEPENDENCY_DISABLED', `插件 ${plugin.id} 的依赖 ${dependencyId} 已禁用。`, plugin.id)
      }
      if (!completedPluginIds.has(dependencyId)) {
        throw new V5PluginRegistryError(
          'PLUGIN_DEPENDENCY_NOT_COMPLETED',
          `插件 ${plugin.id} 的依赖 ${dependencyId} 尚未完成。`,
          plugin.id
        )
      }
    }
  }

  private assertAcyclic() {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (pluginId: string) => {
      if (visited.has(pluginId)) return
      if (visiting.has(pluginId)) {
        throw new V5PluginRegistryError('PLUGIN_DEPENDENCY_CYCLE', `插件依赖存在循环：${pluginId}。`, pluginId)
      }
      visiting.add(pluginId)
      const registered = this.plugins.get(pluginId)
      if (registered?.enabled) {
        for (const dependencyId of registered.plugin.dependencies ?? []) visit(dependencyId)
      }
      visiting.delete(pluginId)
      visited.add(pluginId)
    }
    for (const [pluginId, registered] of this.plugins) {
      if (registered.enabled) visit(pluginId)
    }
  }

  private async executeLifecycle(
    plugin: ErasedWorkflowPlugin<TShared>,
    context: V5WorkflowPluginContext<TShared>,
    input: unknown
  ) {
    const remainingMs = context.remainingMs()
    const timeoutMs = Math.min(plugin.timeoutMs ?? remainingMs, remainingMs)
    if (timeoutMs <= 0) {
      throw this.executionError(
        plugin,
        'PLUGIN_TIMEOUT',
        `插件 ${plugin.id} 没有剩余执行时间。`,
        new Error('workflow deadline exceeded')
      )
    }

    const controller = new AbortController()
    let rejectCancellation: ((reason: V5PluginExecutionError) => void) | undefined
    const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject })
    const abortFromParent = () => {
      controller.abort(context.signal?.reason)
      rejectCancellation?.(this.executionError(
        plugin,
        'PLUGIN_CANCELLED',
        `插件 ${plugin.id} 已取消。`,
        context.signal?.reason
      ))
    }
    if (context.signal?.aborted) abortFromParent()
    else context.signal?.addEventListener('abort', abortFromParent, { once: true })
    const pluginContext = { ...context, signal: controller.signal }
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort(new Error(`plugin timeout after ${timeoutMs}ms`))
        reject(this.executionError(
          plugin,
          'PLUGIN_TIMEOUT',
          `插件 ${plugin.id} 在 ${timeoutMs}ms 后超时。`,
          controller.signal.reason
        ))
      }, timeoutMs)
    })

    try {
      return await Promise.race([
        (async () => {
          await plugin.beforeRun?.(pluginContext, input)
          const output = await plugin.run(pluginContext, input)
          await plugin.validate?.(pluginContext, input, output)
          await plugin.afterRun?.(pluginContext, input, output)
          return output
        })(),
        timeout,
        cancellation,
      ])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      context.signal?.removeEventListener('abort', abortFromParent)
    }
  }

  private result<TOutput>(
    plugin: ErasedWorkflowPlugin<TShared>,
    status: V5PluginExecutionResult<TOutput>['status'],
    startedMs: number,
    output?: TOutput,
    error?: unknown
  ): V5PluginExecutionResult<TOutput> {
    return {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      stage: plugin.stage,
      status,
      output,
      error,
      durationMs: Math.max(0, Date.now() - startedMs),
    }
  }

  private wrapExecutionError(plugin: ErasedWorkflowPlugin<TShared>, error: unknown) {
    return error instanceof V5PluginExecutionError
      ? error
      : this.executionError(plugin, 'PLUGIN_EXECUTION_FAILED', `插件 ${plugin.id} 执行失败。`, error)
  }

  private executionError(
    plugin: ErasedWorkflowPlugin<TShared>,
    code: V5PluginExecutionError['code'],
    message: string,
    cause: unknown
  ) {
    const mapping = plugin.failureMapping ?? {
      apiCode: `V5_PLUGIN_${plugin.id.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_FAILED`,
      agentState: 'provider_failure' as const,
    }
    return new V5PluginExecutionError(
      plugin.id,
      plugin.stage,
      code,
      mapping.apiCode,
      mapping.agentState,
      message,
      cause
    )
  }

  private recordManifest<TOutput>(
    context: V5WorkflowPluginContext<TShared>,
    plugin: ErasedWorkflowPlugin<TShared>,
    result: Pick<V5PluginExecutionResult<TOutput>, 'durationMs' | 'error'> & {
      status: V5PluginManifestEntry['status']
    },
    startedAt: string
  ) {
    const entry: V5PluginManifestEntry = {
      pluginId: plugin.id,
      pluginVersion: plugin.version,
      stage: plugin.stage,
      optional: plugin.optional ?? false,
      status: result.status,
      startedAt,
      durationMs: result.durationMs,
      errorCode: result.error instanceof V5PluginExecutionError ? result.error.apiCode : undefined,
    }
    context.manifest.plugins.push(entry)
  }
}
