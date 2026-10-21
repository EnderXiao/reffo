import type { HarnessEventBus } from '@/harness/event-bus'
import type { RunContext } from '@/harness/run-context'
import type { LlmProvider } from '@/providers/llm-provider'
import type { ResumeAgentState } from '@/v5/types'

export const V5_PLUGIN_STAGES = [
  'normalize',
  'extract',
  'match',
  'strategy',
  'plan',
  'generate',
  'fact_judge',
  'interview',
  'quality_judge',
  'response',
] as const

export type V5PluginStage = typeof V5_PLUGIN_STAGES[number]

export interface V5PluginFailureMapping {
  apiCode: string
  agentState: ResumeAgentState
}

export interface V5PluginManifestEntry {
  pluginId: string
  pluginVersion: string
  stage: V5PluginStage
  optional: boolean
  status: 'succeeded' | 'partial' | 'skipped' | 'failed'
  startedAt: string
  durationMs: number
  errorCode?: string
}

export interface V5WorkflowPluginManifest {
  plugins: V5PluginManifestEntry[]
}

export interface V5WorkflowPluginContext<TShared extends object = Record<string, unknown>> {
  runContext: RunContext
  eventBus: HarnessEventBus
  signal?: AbortSignal
  remainingMs: () => number
  shared: TShared
  config: Readonly<Record<string, unknown>>
  manifest: V5WorkflowPluginManifest
  completedPluginIds: Set<string>
  providers: {
    primary?: LlmProvider
    judge?: LlmProvider
  }
}

export interface V5WorkflowPlugin<TInput = unknown, TOutput = unknown, TShared extends object = Record<string, unknown>> {
  id: string
  version: string
  stage: V5PluginStage
  optional?: boolean
  dependencies?: readonly string[]
  timeoutMs?: number
  failureMapping?: V5PluginFailureMapping
  beforeRun?: (context: V5WorkflowPluginContext<TShared>, input: TInput) => void | Promise<void>
  run: (context: V5WorkflowPluginContext<TShared>, input: TInput) => TOutput | Promise<TOutput>
  validate?: (
    context: V5WorkflowPluginContext<TShared>,
    input: TInput,
    output: TOutput
  ) => void | Promise<void>
  afterRun?: (
    context: V5WorkflowPluginContext<TShared>,
    input: TInput,
    output: TOutput
  ) => void | Promise<void>
  onError?: (
    context: V5WorkflowPluginContext<TShared>,
    input: TInput,
    error: unknown
  ) => void | Promise<void>
}

export interface V5PluginExecutionResult<TOutput = unknown> {
  pluginId: string
  pluginVersion: string
  stage: V5PluginStage
  status: 'succeeded' | 'partial' | 'skipped'
  output?: TOutput
  error?: unknown
  durationMs: number
}
