import { createHarnessEvent } from '@/harness/events'
import { createDigest, type StepExecutionContext } from '@/harness/run-context'
import type { HarnessEventBus } from '@/harness/event-bus'

export type OutputValidator<T> = (value: unknown) => value is T

export interface ParseJsonOutputInput<T> {
  content: string
  validator: OutputValidator<T>
  outputName: string
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  repair?: (input: JsonRepairInput) => Promise<string>
  maxRepairAttempts?: number
}

export interface JsonRepairInput {
  outputName: string
  content: string
  errorMessage: string
}

export type JsonOutputErrorCode = 'JSON_PARSE_FAILED' | 'SCHEMA_VALIDATION_FAILED'

export class JsonOutputError extends Error {
  readonly code: JsonOutputErrorCode

  constructor(code: JsonOutputErrorCode, message: string) {
    super(message)
    this.name = 'JsonOutputError'
    this.code = code
  }
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '未知错误'
}

async function publishValidationResult<T>(input: ParseJsonOutputInput<T>, passed: boolean, errorMessage?: string) {
  if (!input.eventBus || !input.stepContext) {
    return
  }

  await input.eventBus.publish(
    createHarnessEvent({
      type: 'output.validated',
      runId: input.stepContext.runId,
      requestId: input.stepContext.requestId,
      stepRunId: input.stepContext.stepRunId,
      attemptId: input.stepContext.attemptId,
      payload: {
        outputName: input.outputName,
        outputDigest: createDigest(input.content),
        passed,
        errorMessage,
      },
    })
  )
}

export async function parseJsonOutput<T>(input: ParseJsonOutputInput<T>): Promise<T> {
  const maxRepairAttempts = input.maxRepairAttempts ?? 1
  let content = input.content
  let repairAttempt = 0

  while (true) {
    try {
      return await parseJsonOutputOnce({ ...input, content })
    } catch (error) {
      const errorMessage = toErrorMessage(error)

      await publishValidationResult({ ...input, content }, false, errorMessage)

      if (!input.repair || repairAttempt >= maxRepairAttempts) {
        throw error
      }

      repairAttempt += 1
      content = await input.repair({
        outputName: input.outputName,
        content,
        errorMessage,
      })
    }
  }
}

async function parseJsonOutputOnce<T>(input: ParseJsonOutputInput<T>): Promise<T> {
  let parsed: unknown

  try {
    parsed = JSON.parse(input.content)
  } catch (error) {
    throw new JsonOutputError(
      'JSON_PARSE_FAILED',
      `${input.outputName} JSON 解析失败: ${error instanceof Error ? error.message : '未知错误'}`
    )
  }

  if (input.eventBus && input.stepContext) {
    await input.eventBus.publish(
      createHarnessEvent({
        type: 'output.parsed',
        runId: input.stepContext.runId,
        requestId: input.stepContext.requestId,
        stepRunId: input.stepContext.stepRunId,
        attemptId: input.stepContext.attemptId,
        payload: {
          outputName: input.outputName,
          outputDigest: createDigest(input.content),
        },
      })
    )
  }

  if (!input.validator(parsed)) {
    throw new JsonOutputError('SCHEMA_VALIDATION_FAILED', `${input.outputName} 结构校验失败`)
  }

  await publishValidationResult(input, true)

  return parsed
}
