import { describe, expect, test } from 'bun:test'
import { parseJsonOutput } from '@/harness/json-output'
import { createRunContext, createStepExecutionContext } from '@/harness/run-context'
import { FakeHarnessEventBus } from '@/harness/testing/fake-event-bus'

interface ParsedValue {
  ok: boolean
}

function isParsedValue(value: unknown): value is ParsedValue {
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === true
}

function createParseContext() {
  const eventBus = new FakeHarnessEventBus()
  const runContext = createRunContext()
  const stepContext = createStepExecutionContext(runContext, 'analyze_resume')

  return { eventBus, stepContext }
}

describe('parseJsonOutput repair recovery events', () => {
  test('repairs invalid JSON and emits recovery success', async () => {
    const { eventBus, stepContext } = createParseContext()

    const result = await parseJsonOutput({
      content: '{ invalid json',
      validator: isParsedValue,
      outputName: 'ParsedValue',
      eventBus,
      stepContext,
      repair: async () => '{"ok":true}',
    })

    expect(result).toEqual({ ok: true })
    expect(eventBus.events.map((event) => event.type)).toEqual([
      'output.validated',
      'recovery.planned',
      'recovery.started',
      'output.parsed',
      'output.validated',
      'recovery.succeeded',
    ])
    expect(eventBus.events.find((event) => event.type === 'recovery.succeeded')?.payload).toMatchObject({
      action: 'repair_json',
      outputName: 'ParsedValue',
      attempts: 1,
      maxAttempts: 1,
    })
  })

  test('emits recovery failure when repair budget is exhausted', async () => {
    const { eventBus, stepContext } = createParseContext()

    await expect(parseJsonOutput({
      content: '{ invalid json',
      validator: isParsedValue,
      outputName: 'ParsedValue',
      eventBus,
      stepContext,
      repair: async () => '{"ok":false}',
      maxRepairAttempts: 1,
    })).rejects.toThrow('ParsedValue 结构校验失败')

    expect(eventBus.events.map((event) => event.type)).toEqual([
      'output.validated',
      'recovery.planned',
      'recovery.started',
      'output.parsed',
      'output.validated',
      'recovery.failed',
    ])
    expect(eventBus.events.find((event) => event.type === 'recovery.failed')?.payload).toMatchObject({
      action: 'repair_json',
      outputName: 'ParsedValue',
      attempts: 1,
      maxAttempts: 1,
      errorCode: 'SCHEMA_VALIDATION_FAILED',
    })
  })
})
