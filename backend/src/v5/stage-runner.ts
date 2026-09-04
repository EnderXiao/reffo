import type { z } from 'zod'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, type StepExecutionContext } from '@/harness/run-context'
import type { HarnessEventBus } from '@/harness/event-bus'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { compileV5Prompt, type CompiledV5Prompt } from '@/v5/prompt-compiler'
import type { V5PromptComponent } from '@/v5/prompts'

export interface V5StageRunOptions {
  provider?: LlmProvider
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  inputDocumentIds?: string[]
  repairAttempt?: number
  callReason?: NonNullable<ChatCompletionInput['callMetadata']>['callReason']
  contextMode?: NonNullable<ChatCompletionInput['callMetadata']>['contextMode']
  repairScope?: string[]
  retryIndex?: number
  budgetRemaining?: number | null
  model?: string
}

export interface V5StageRunResult<T> {
  value: T
  providerResult: ChatCompletionResult
  compiled: CompiledV5Prompt
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
  readonly unsafeOutput: unknown

  constructor(input: {
    code: V5StructuredOutputError['code']
    component: V5PromptComponent
    message: string
    validationIssues?: Array<{ path: string; code: string; message: string }>
    unsafeOutput?: unknown
  }) {
    super(input.message)
    this.name = 'V5StructuredOutputError'
    this.code = input.code
    this.component = input.component
    this.validationIssues = input.validationIssues ?? []
    this.unsafeOutput = input.unsafeOutput
  }
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
  const provider = input.options?.provider ?? fallbackLlmProvider
  const providerResult = await provider.complete({
    messages: compiled.messages,
    model: input.options?.model,
    temperature: compiled.temperature,
    structuredOutput: { name: compiled.schemaName, schema: compiled.schema, strict: true },
    maxOutputTokens: compiled.maxOutputTokens,
    promptVersion: compiled.promptVersion,
    promptManifest: compiled.manifest,
    callMetadata: {
      callReason: input.options?.callReason
        ?? (compiled.manifest.repairAttempt > 0 ? 'validation_repair' : input.component === 'P09' ? 'semantic_gate' : 'business_stage'),
      contextMode: input.options?.contextMode ?? (compiled.manifest.repairAttempt > 0 ? 'full' : 'scoped'),
      repairScope: input.options?.repairScope ?? [],
      retryIndex: input.options?.retryIndex ?? 0,
      budgetRemaining: input.options?.budgetRemaining ?? null,
    },
    eventBus: input.options?.eventBus,
    stepContext: input.options?.stepContext,
  })
  if (providerResult.finishReason === 'length') {
    throw new V5StructuredOutputError({
      code: 'V5_OUTPUT_TRUNCATED',
      component: input.component,
      message: `${input.component} 输出达到模型长度上限，已按截断失败处理；禁止解析或进入结构修复。`,
      unsafeOutput: providerResult.content,
    })
  }
  const cleaned = deterministicJsonCleanup(providerResult.content)
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (error) {
    throw new V5StructuredOutputError({
      code: 'V5_JSON_PARSE_FAILED',
      component: input.component,
      message: `${input.component} JSON 解析失败：${error instanceof Error ? error.message : '未知错误'}`,
      unsafeOutput: cleaned,
    })
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
          outputDigest: createDigest(cleaned),
          passed: false,
          errorCode: 'V5_SCHEMA_VALIDATION_FAILED',
          validationIssues,
        },
      }))
    }
    throw new V5StructuredOutputError({
      code: 'V5_SCHEMA_VALIDATION_FAILED',
      component: input.component,
      message: `${input.component} 严格 Schema 校验失败`,
      validationIssues,
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
        outputDigest: createDigest(cleaned),
        passed: true,
        strictSchema: compiled.schemaName,
      },
    }))
  }

  return { value: validated.data as T, providerResult, compiled }
}
