import type { z } from 'zod'
import { createHarnessEvent } from '@/harness/events'
import { createDigest, type StepExecutionContext } from '@/harness/run-context'
import type { HarnessEventBus } from '@/harness/event-bus'
import {
  fallbackLlmProvider,
  getErrorStatus,
  isProviderTransientError,
} from '@/providers/fallback-provider'
import type { ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { compileV5Prompt, type CompiledV5Prompt } from '@/v5/prompt-compiler'
import type { V5PromptComponent } from '@/v5/prompts'
import { normalizeBlindABEvaluationSemanticsWithAudit } from '@/v5/schemas'
import { materializeResumeExtractionTransport, resumeDocumentFromEnvelope } from '@/v5/resume-extraction-transport'

export interface V5StageRunOptions {
  provider?: LlmProvider
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  inputDocumentIds?: string[]
  repairAttempt?: number
  model?: string
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
  }
  const provider = input.options?.provider ?? fallbackLlmProvider
  let providerResult: ChatCompletionResult
  try {
    providerResult = await provider.complete({
      messages: compiled.messages,
      model: input.options?.model,
      temperature: compiled.temperature,
      structuredOutput: { name: compiled.schemaName, schema: compiled.providerSchema, strict: true },
      maxOutputTokens: compiled.maxOutputTokens,
      promptVersion: compiled.promptVersion,
      promptManifest: providerPromptManifest,
      eventBus: input.options?.eventBus,
      stepContext: input.options?.stepContext,
    })
  } catch (error) {
    throw new V5ProviderCallError({ component: input.component, cause: error })
  }
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
  const rawParsedDigest = createDigest(parsed)
  let normalizationApplied = false
  let normalizationChanges: string[] = []
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
