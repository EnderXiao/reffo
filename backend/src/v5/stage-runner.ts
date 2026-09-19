import type { z } from 'zod'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, type StepExecutionContext } from '@/harness/run-context'
import type { HarnessEventBus } from '@/harness/event-bus'
import {
  fallbackLlmProvider,
  getErrorStatus,
  isProviderTransientError,
} from '@/providers/fallback-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { compileV5Prompt, type CompiledV5Prompt } from '@/v5/prompt-compiler'
import type { V5PromptComponent } from '@/v5/prompts'
import { normalizeBlindABEvaluationSemanticsWithAudit } from '@/v5/schemas'
import { materializeResumeExtractionTransport, resumeDocumentFromEnvelope } from '@/v5/resume-extraction-transport'
import { isEntryWritingEnvelope, normalizeEntryWritingOutput } from '@/v5/writing/entries'

export interface V5StageRunOptions {
  provider?: LlmProvider
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  inputDocumentIds?: string[]
  repairAttempt?: number
  model?: string
  onContentDelta?: (text: string) => void
  maxProviderAttempts?: number
  maxProviderModels?: number
}

export interface V5StageRunResult<T> {
  value: T
  providerResult: ChatCompletionResult
  compiled: CompiledV5Prompt
  outputAudit: V5StageOutputAudit
}

export interface V5StageOutputAudit {
  rawOutputDigest: string
  validatedOutputDigest: string
  normalizationApplied: boolean
  normalizationChanges: string[]
}

function deterministicJsonCleanup(content: string) {
  let cleaned = content.trim().replace(/^\uFEFF/, '')
  const fenced = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) cleaned = fenced[1].trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace > 0 && lastBrace > firstBrace) cleaned = cleaned.slice(firstBrace, lastBrace + 1)
  return cleaned.replace(/,\s*([}\]])/g, '$1')
}

function summarizeZodIssues(error: z.ZodError) {
  return error.issues.slice(0, 20).map(issue => ({
    path: issue.path.join('.'),
    code: issue.code,
    message: issue.message,
  }))
}

export class V5StructuredOutputError extends Error {
  readonly code: 'V5_OUTPUT_TRUNCATED' | 'V5_JSON_PARSE_FAILED' | 'V5_SCHEMA_VALIDATION_FAILED'
  readonly component: V5PromptComponent
  readonly validationIssues: Array<{ path: string; code: string; message: string }>
  readonly outputAudit?: V5StageOutputAudit
  readonly unsafeOutput: unknown

  constructor(input: {
    code: V5StructuredOutputError['code']
    component: V5PromptComponent
    message: string
    validationIssues?: Array<{ path: string; code: string; message: string }>
    outputAudit?: V5StageOutputAudit
    unsafeOutput?: unknown
  }) {
    super(input.message)
    this.name = 'V5StructuredOutputError'
    this.code = input.code
    this.component = input.component
    this.validationIssues = input.validationIssues ?? []
    this.outputAudit = input.outputAudit
    this.unsafeOutput = input.unsafeOutput
  }
}

export class V5ProviderCallError extends Error {
  readonly code = 'V5_PROVIDER_CALL_FAILED' as const
  readonly component: V5PromptComponent
  readonly retryable: boolean
  readonly status?: number
  readonly cause: unknown

  constructor(input: {
    component: V5PromptComponent
    cause: unknown
  }) {
    super(`${input.component} Provider 调用失败`)
    this.name = 'V5ProviderCallError'
    this.component = input.component
    this.retryable = isProviderTransientError(input.cause)
    this.status = getErrorStatus(input.cause)
    this.cause = input.cause
  }
}

interface V5TransportRecoveryInput {
  component: V5PromptComponent
  action: 'repair_json' | 'disable_thinking'
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  reason: string
  triggerErrorCode: 'V5_JSON_PARSE_FAILED' | 'V5_OUTPUT_TRUNCATED'
  recoveryMode: 'json_repair' | 'thinking_disabled'
  outputDigest?: string
  providerResult?: ChatCompletionResult
}

async function publishV5TransportRecoveryStatus(
  input: V5TransportRecoveryInput,
  type: 'recovery.planned' | 'recovery.started' | 'recovery.succeeded' | 'recovery.failed'
) {
  if (!input.eventBus || !input.stepContext) return
  await input.eventBus.publish(createHarnessEvent({
    type,
    runId: input.stepContext.runId,
    requestId: input.stepContext.requestId,
    stepRunId: input.stepContext.stepRunId,
    attemptId: input.stepContext.attemptId,
    payload: {
      triggerStep: input.stepContext.stepName,
      action: input.action,
      outputName: input.component,
      triggerErrorCode: input.triggerErrorCode,
      recoveryMode: input.recoveryMode,
      attempts: 1,
      maxAttempts: 1,
      reason: input.reason,
      ...(input.outputDigest ? { outputDigest: input.outputDigest } : {}),
      ...(input.providerResult ? {
        finishReason: input.providerResult.finishReason,
        inputTokens: input.providerResult.inputTokens,
        outputTokens: input.providerResult.outputTokens,
      } : {}),
    },
  }))
}

async function repairV5JsonOutput(input: {
  component: V5PromptComponent
  compiled: CompiledV5Prompt
  provider: LlmProvider
  providerPromptManifest: NonNullable<ChatCompletionInput['promptManifest']>
  malformedOutput: string
  parseErrorMessage: string
  options?: V5StageRunOptions
}): Promise<{ content: string; providerResult: ChatCompletionResult }> {
  const recoveryInput: V5TransportRecoveryInput = {
    component: input.component,
    action: 'repair_json',
    eventBus: input.options?.eventBus,
    stepContext: input.options?.stepContext,
    reason: input.parseErrorMessage,
    triggerErrorCode: 'V5_JSON_PARSE_FAILED',
    recoveryMode: 'json_repair',
    outputDigest: createDigest(input.malformedOutput),
  }
  await publishV5TransportRecoveryStatus(recoveryInput, 'recovery.planned')
  await publishV5TransportRecoveryStatus(recoveryInput, 'recovery.started')

  try {
    const providerResult = await input.provider.complete({
      messages: [
        ...input.compiled.messages,
        { role: 'assistant' as const, content: input.malformedOutput },
        {
          role: 'user' as const,
          content: [
            '上一次结构化输出无法解析为 JSON。',
            `解析错误：${input.parseErrorMessage}`,
            '请忽略损坏的输出片段，根据原始任务、输入材料和 STRICT_OUTPUT_JSON_SCHEMA 重新生成一个完整 JSON 对象。',
            '只返回 JSON，不复述输入，不输出 Markdown，不保留无法验证的残缺字段。',
          ].join('\n'),
        },
      ],
      model: input.options?.model,
      temperature: input.compiled.temperature,
      structuredOutput: {
        name: input.compiled.schemaName,
        schema: input.compiled.providerSchema,
        strict: true,
      },
      maxOutputTokens: input.compiled.maxOutputTokens,
      promptVersion: input.compiled.promptVersion,
      promptManifest: input.providerPromptManifest,
      eventBus: input.options?.eventBus,
      stepContext: input.options?.stepContext,
      callMetadata: {
        callReason: 'json_repair',
        contextMode: 'full',
        repairScope: ['json_output'],
        retryIndex: 1,
        budgetRemaining: null,
      },
      thinkingOverride: 'disabled',
      maxProviderAttempts: 1,
      maxProviderModels: 1,
    })

    if (providerResult.finishReason === 'length') {
      await publishV5TransportRecoveryStatus({
        ...recoveryInput,
        reason: 'JSON 修复输出达到模型长度上限',
        providerResult,
      }, 'recovery.failed')
      throw new V5StructuredOutputError({
        code: 'V5_OUTPUT_TRUNCATED',
        component: input.component,
        message: `${input.component} JSON 修复输出达到模型长度上限；禁止解析残缺结果。`,
        unsafeOutput: providerResult.content,
      })
    }

    const content = deterministicJsonCleanup(providerResult.content)
    return { content, providerResult }
  } catch (error) {
    if (!(error instanceof V5StructuredOutputError)) {
      await publishV5TransportRecoveryStatus({
        ...recoveryInput,
        reason: 'JSON 修复 Provider 请求失败',
      }, 'recovery.failed')
      throw new V5ProviderCallError({ component: input.component, cause: error })
    }
    throw error
  }
}

async function retryWithThinkingDisabled(input: {
  component: V5PromptComponent
  compiled: CompiledV5Prompt
  provider: LlmProvider
  providerPromptManifest: NonNullable<ChatCompletionInput['promptManifest']>
  options?: V5StageRunOptions
}): Promise<ChatCompletionResult> {
  const recoveryInput: V5TransportRecoveryInput = {
    component: input.component,
    action: 'disable_thinking',
    eventBus: input.options?.eventBus,
    stepContext: input.options?.stepContext,
    reason: 'reasoning-only structured output truncation',
    triggerErrorCode: 'V5_OUTPUT_TRUNCATED',
    recoveryMode: 'thinking_disabled',
  }
  await publishV5TransportRecoveryStatus(recoveryInput, 'recovery.planned')
  await publishV5TransportRecoveryStatus(recoveryInput, 'recovery.started')

  try {
    const providerResult = await input.provider.complete({
      messages: input.compiled.messages,
      model: input.options?.model,
      temperature: input.compiled.temperature,
      structuredOutput: {
        name: input.compiled.schemaName,
        schema: input.compiled.providerSchema,
        strict: true,
      },
      maxOutputTokens: input.compiled.maxOutputTokens,
      promptVersion: input.compiled.promptVersion,
      promptManifest: input.providerPromptManifest,
      eventBus: input.options?.eventBus,
      stepContext: input.options?.stepContext,
      callMetadata: {
        callReason: 'thinking_fallback',
        contextMode: 'full',
        repairScope: ['thinking_disabled'],
        retryIndex: 1,
        budgetRemaining: null,
      },
      thinkingOverride: 'disabled',
      maxProviderAttempts: 1,
      maxProviderModels: 1,
    })

    if (providerResult.finishReason === 'length') {
      await publishV5TransportRecoveryStatus({
        ...recoveryInput,
        reason: 'thinking-disabled structured output still reached the length limit',
        providerResult,
      }, 'recovery.failed')
      throw new V5StructuredOutputError({
        code: 'V5_OUTPUT_TRUNCATED',
        component: input.component,
        message: `${input.component} thinking-disabled 重试仍达到模型长度上限；停止继续追问。`,
        unsafeOutput: providerResult.content,
      })
    }

    await publishV5TransportRecoveryStatus({
      ...recoveryInput,
      reason: 'thinking-disabled structured output completed',
      outputDigest: createDigest(providerResult.content),
      providerResult,
    }, 'recovery.succeeded')
    return providerResult
  } catch (error) {
    if (!(error instanceof V5StructuredOutputError)) {
      await publishV5TransportRecoveryStatus({
        ...recoveryInput,
        reason: 'thinking-disabled Provider 请求失败',
      }, 'recovery.failed')
      throw new V5ProviderCallError({ component: input.component, cause: error })
    }
    throw error
  }
}

function isReasoningOnlyTruncation(result: ChatCompletionResult) {
  if (result.finishReason !== 'length') return false
  if (!result.content.trim()) return true
  const reasoningTokens = result.reasoningTokens ?? 0
  const outputTokens = result.outputTokens ?? 0
  return reasoningTokens > 0 && outputTokens > 0 && reasoningTokens / outputTokens >= 0.8
}

export async function runV5StructuredStage<T>(input: {
  component: V5PromptComponent
  envelope: unknown
  options?: V5StageRunOptions
}): Promise<V5StageRunResult<T>> {
  const compiled = compileV5Prompt({
    component: input.component,
    envelope: input.envelope,
    inputDocumentIds: input.options?.inputDocumentIds,
    repairAttempt: input.options?.repairAttempt,
  })
  const providerPromptManifest = {
    workflowVersion: compiled.manifest.workflowVersion,
    componentPromptId: compiled.manifest.componentPromptId,
    componentPromptVersion: compiled.manifest.componentPromptVersion,
    compiledPromptSha256: compiled.manifest.compiledPromptSha256,
    schemaVersion: compiled.manifest.schemaVersion,
    validatorVersion: compiled.manifest.validatorVersion,
    adaptivePolicyVersion: compiled.manifest.adaptivePolicyVersion,
    scoreFormulaVersion: compiled.manifest.scoreFormulaVersion,
    temperature: compiled.manifest.temperature,
    // Document IDs and local prompt paths are intentionally excluded from
    // provider events; they are not needed for aggregate cost observability.
    inputDocumentIds: [],
    repairAttempt: compiled.manifest.repairAttempt,
    transportRepairAttempt: 0,
    transportRecoveryMode: undefined,
  }
  const provider = input.options?.provider ?? fallbackLlmProvider
  let providerResult: ChatCompletionResult
  let continuation = ''
  const maxContinuations = 2
  let thinkingFallbackAttempted = false
  try {
    for (let attempt = 0; ; attempt += 1) {
      const messages = continuation
        ? [...compiled.messages, {role: 'assistant' as const, content: continuation}, {
            role: 'user' as const,
            content: '上一次输出因长度限制被截断。请从截断位置继续输出，保持同一个 JSON 对象，不要重复已经输出的内容，不要添加 Markdown。',
          }]
        : compiled.messages
      providerResult = await provider.complete({
      messages,
      model: input.options?.model,
      temperature: compiled.temperature,
      structuredOutput: { name: compiled.schemaName, schema: compiled.providerSchema, strict: true },
      maxOutputTokens: compiled.maxOutputTokens,
      promptVersion: compiled.promptVersion,
      promptManifest: providerPromptManifest,
      eventBus: input.options?.eventBus,
      stepContext: input.options?.stepContext,
      onContentDelta: input.options?.onContentDelta,
      maxProviderAttempts: input.options?.maxProviderAttempts,
      maxProviderModels: input.options?.maxProviderModels,
      })
      if (providerResult.finishReason !== 'length') break
      if (!thinkingFallbackAttempted && isReasoningOnlyTruncation(providerResult)) {
        providerResult = await retryWithThinkingDisabled({
          component: input.component,
          compiled,
          provider,
          providerPromptManifest: {
            ...providerPromptManifest,
            transportRepairAttempt: 0,
            transportRecoveryMode: 'thinking_disabled',
          },
          options: input.options,
        })
        thinkingFallbackAttempted = true
        continuation = ''
        break
      }
      if (attempt >= maxContinuations) break
      continuation += providerResult.content
    }
  } catch (error) {
    if (error instanceof V5StructuredOutputError) throw error
    throw new V5ProviderCallError({ component: input.component, cause: error })
  }
  if (continuation) providerResult = {...providerResult, content: continuation + providerResult.content}
  if (providerResult.finishReason === 'length') {
    throw new V5StructuredOutputError({
      code: 'V5_OUTPUT_TRUNCATED',
      component: input.component,
      message: `${input.component} 输出达到模型长度上限，有界 transport 恢复已耗尽；禁止解析或进入结构修复。`,
      unsafeOutput: providerResult.content,
    })
  }
  let cleaned = deterministicJsonCleanup(providerResult.content)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (error) {
    const parseErrorMessage = error instanceof Error ? error.message : '未知错误'
    const repaired = await repairV5JsonOutput({
      component: input.component,
      compiled,
      provider,
      providerPromptManifest: {
        ...providerPromptManifest,
        transportRepairAttempt: 1,
        transportRecoveryMode: 'json_repair',
      },
      malformedOutput: cleaned,
      parseErrorMessage,
      options: input.options,
    })
    providerResult = repaired.providerResult
    cleaned = repaired.content
    try {
      parsed = JSON.parse(cleaned)
    } catch (repairError) {
      await publishV5TransportRecoveryStatus({
        component: input.component,
        action: 'repair_json',
        eventBus: input.options?.eventBus,
        stepContext: input.options?.stepContext,
        reason: repairError instanceof Error ? repairError.message : 'JSON 修复输出仍无法解析',
        triggerErrorCode: 'V5_JSON_PARSE_FAILED',
        recoveryMode: 'json_repair',
        outputDigest: createDigest(cleaned),
        providerResult,
      }, 'recovery.failed')
      throw new V5StructuredOutputError({
        code: 'V5_JSON_PARSE_FAILED',
        component: input.component,
        message: `${input.component} JSON 修复后仍解析失败：${repairError instanceof Error ? repairError.message : '未知错误'}`,
        unsafeOutput: cleaned,
      })
    }
    await publishV5TransportRecoveryStatus({
      component: input.component,
      action: 'repair_json',
      eventBus: input.options?.eventBus,
      stepContext: input.options?.stepContext,
      reason: 'JSON transport repair parsed successfully',
      triggerErrorCode: 'V5_JSON_PARSE_FAILED',
      recoveryMode: 'json_repair',
      outputDigest: createDigest(cleaned),
      providerResult,
    }, 'recovery.succeeded')
  }
  const rawParsedDigest = createDigest(parsed)
  let normalizationApplied = false
  let normalizationChanges: string[] = []
  if (input.component === 'P06C' && isEntryWritingEnvelope(input.envelope)) {
    const normalized = normalizeEntryWritingOutput(parsed)
    parsed = normalized.value
    normalizationApplied = normalized.removedNotes > 0
    if (normalizationApplied) normalizationChanges = ['empty_entry_id_note_removed']
  }
  if ((input.component === 'P01' || input.component === 'P01R') && !compiled.schema.safeParse(parsed).success) {
    const document = resumeDocumentFromEnvelope(input.envelope)
    if (document) {
      const materialized = materializeResumeExtractionTransport(parsed, document)
      if (!materialized.success) throw new V5StructuredOutputError({
        code: 'V5_SCHEMA_VALIDATION_FAILED', component: input.component,
        message: `${input.component} 紧凑提取契约校验失败`,
        validationIssues: summarizeZodIssues(materialized.error), unsafeOutput: parsed,
      })
      parsed = materialized.data
      normalizationApplied = true
      normalizationChanges = ['source_block_fields_materialized']
    }
  }
  if (input.component === 'P12') {
    const normalized = normalizeBlindABEvaluationSemanticsWithAudit(parsed)
    parsed = normalized.value
    normalizationApplied = normalized.audit.applied
    normalizationChanges = normalized.audit.changes
  }
  const validatedInputDigest = createDigest(parsed)
  const outputAudit: V5StageOutputAudit = {
    rawOutputDigest: rawParsedDigest,
    validatedOutputDigest: validatedInputDigest,
    normalizationApplied,
    normalizationChanges,
  }

  if (input.options?.eventBus && input.options.stepContext) {
    await input.options.eventBus.publish(createHarnessEvent({
      type: 'output.parsed',
      runId: input.options.stepContext.runId,
      requestId: input.options.stepContext.requestId,
      stepRunId: input.options.stepContext.stepRunId,
      attemptId: input.options.stepContext.attemptId,
      payload: {
        outputName: input.component,
        outputDigest: createDigest(cleaned),
        summary: `strict_schema:${compiled.schemaName}`,
      },
    }))
  }

  const validated = compiled.schema.safeParse(parsed)
  if (!validated.success) {
    const validationIssues = summarizeZodIssues(validated.error)
    if (input.options?.eventBus && input.options.stepContext) {
      await input.options.eventBus.publish(createHarnessEvent({
        type: 'output.validated',
        runId: input.options.stepContext.runId,
        requestId: input.options.stepContext.requestId,
        stepRunId: input.options.stepContext.stepRunId,
        attemptId: input.options.stepContext.attemptId,
        payload: {
          outputName: input.component,
          outputDigest: validatedInputDigest,
          rawOutputDigest: rawParsedDigest,
          normalizationApplied,
          normalizationChanges,
          passed: false,
          errorCode: 'V5_SCHEMA_VALIDATION_FAILED',
          validationIssueCount: validationIssues.length,
          validationIssueCodes: [...new Set(validationIssues.map(item => item.code))].sort(),
        },
      }))
    }
    throw new V5StructuredOutputError({
      code: 'V5_SCHEMA_VALIDATION_FAILED',
      component: input.component,
      message: `${input.component} 严格 Schema 校验失败`,
      validationIssues,
      outputAudit,
      unsafeOutput: parsed,
    })
  }

  if (input.options?.eventBus && input.options.stepContext) {
    await input.options.eventBus.publish(createHarnessEvent({
      type: 'output.validated',
      runId: input.options.stepContext.runId,
      requestId: input.options.stepContext.requestId,
      stepRunId: input.options.stepContext.stepRunId,
      attemptId: input.options.stepContext.attemptId,
      payload: {
        outputName: input.component,
        outputDigest: validatedInputDigest,
        rawOutputDigest: rawParsedDigest,
        normalizationApplied,
        normalizationChanges,
        passed: true,
        strictSchema: compiled.schemaName,
      },
    }))
  }

  return { value: validated.data as T, providerResult, compiled, outputAudit }
}
