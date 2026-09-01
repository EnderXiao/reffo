import { env } from '@/config/env'
import { createHarnessEvent } from '@/harness/events'
import { deepSeekProvider } from '@/providers/deepseek-provider'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { APIUserAbortError } from 'openai'

const DEFAULT_MAX_PROVIDER_ATTEMPTS = 2

function getErrorStatus(error: unknown) {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const value = error as { status?: unknown; statusCode?: unknown; code?: unknown }
  const status = value.status ?? value.statusCode ?? value.code
  const numericStatus = typeof status === 'number' ? status : Number(status)

  return Number.isFinite(numericStatus) ? numericStatus : undefined
}

function getErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String((error as { code?: unknown }).code)
  }

  const status = getErrorStatus(error)
  return status ? `HTTP_${status}` : 'PROVIDER_CALL_FAILED'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  if (error instanceof APIUserAbortError) {
    return true
  }

  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'AbortError'
    || error.name === 'APIUserAbortError'
    || (error as Error & { code?: unknown }).code === 'ABORT_ERR'
}

function isProviderTransientError(error: unknown) {
  if (isAbortError(error)) {
    return false
  }

  const status = getErrorStatus(error)
  if (status && [408, 409, 429].includes(status)) {
    return true
  }

  if (status && status >= 500) {
    return true
  }

  const message = getErrorMessage(error).toLowerCase()
  return [
    'timeout',
    'timed out',
    'temporarily',
    'rate limit',
    'too many requests',
    'fetch failed',
    'network',
    'econnreset',
    'etimedout',
    'eai_again',
  ].some((pattern) => message.includes(pattern))
}

export class FallbackLlmProvider implements LlmProvider {
  constructor(private readonly primary: LlmProvider = deepSeekProvider) {}

  async complete(input: ChatCompletionInput): Promise<ChatCompletionResult> {
    const models = [input.model ?? env.AI_MODEL, ...env.AI_FALLBACK_MODELS]
    const uniqueModels = [...new Set(models.filter(Boolean))]
    const maxProviderAttempts = Math.max(1, input.maxProviderAttempts ?? DEFAULT_MAX_PROVIDER_ATTEMPTS)
    let lastError: unknown

    for (const model of uniqueModels) {
      const modelIndex = uniqueModels.indexOf(model)
      for (let attemptNumber = 1; attemptNumber <= maxProviderAttempts; attemptNumber += 1) {
        try {
          const result = await this.primary.complete({ ...input, model })

          if (attemptNumber > 1 || modelIndex > 0) {
            await this.publishRecoveryStatus(input, 'recovery.succeeded', {
              action: attemptNumber > 1 ? 'retry_same_step' : 'fallback_model',
              model,
              attempts: attemptNumber,
              maxAttempts: maxProviderAttempts,
              reason: attemptNumber > 1 ? 'provider transient retry succeeded' : 'fallback model succeeded',
            })
          }

          return result
        } catch (error) {
          lastError = error
          if (isAbortError(error) || input.signal?.aborted || input.stepContext?.signal?.aborted) {
            throw error
          }

          const transient = isProviderTransientError(error)
          const errorCode = getErrorCode(error)
          const errorMessage = getErrorMessage(error)
          const canRetrySameModel = transient && attemptNumber < maxProviderAttempts

          if (canRetrySameModel) {
            const payload = {
              action: 'retry_same_step',
              model,
              attempts: attemptNumber + 1,
              maxAttempts: maxProviderAttempts,
              errorCode,
              reason: errorMessage,
            }
            await this.publishRecoveryStatus(input, 'recovery.planned', payload)
            await this.publishRecoveryStatus(input, 'recovery.started', payload)
            continue
          }

          const hasFallbackModel = modelIndex < uniqueModels.length - 1
          if (hasFallbackModel) {
            const fallbackModel = uniqueModels[modelIndex + 1]
            const payload = {
              action: 'fallback_model',
              model,
              fallbackModel,
              attempts: attemptNumber,
              maxAttempts: maxProviderAttempts,
              errorCode,
              reason: errorMessage,
            }
            await this.publishRecoveryStatus(input, 'recovery.planned', payload)
            await this.publishRecoveryStatus(input, 'recovery.started', payload)
          } else {
            await this.publishRecoveryStatus(input, 'recovery.failed', {
              action: transient ? 'retry_same_step' : 'fallback_model',
              model,
              attempts: attemptNumber,
              maxAttempts: maxProviderAttempts,
              errorCode,
              reason: errorMessage,
            })
          }

          break
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('所有 LLM provider fallback 均调用失败')
  }

  private async publishRecoveryStatus(
    input: ChatCompletionInput,
    type: 'recovery.planned' | 'recovery.started' | 'recovery.succeeded' | 'recovery.failed',
    payload: Record<string, unknown>
  ) {
    if (!input.eventBus || !input.stepContext) {
      return
    }

    await input.eventBus.publish(
      createHarnessEvent({
        type,
        runId: input.stepContext.runId,
        requestId: input.stepContext.requestId,
        stepRunId: input.stepContext.stepRunId,
        attemptId: input.stepContext.attemptId,
        payload: {
          triggerStep: input.stepContext.stepName,
          ...payload,
        },
      })
    )
  }
}

export const fallbackLlmProvider = new FallbackLlmProvider()
