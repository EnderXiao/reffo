import { describe, expect, test } from 'bun:test'
import { createHarnessEventBus } from '@/harness/event-bus'
import type { HarnessEvent } from '@/harness/events'
import { runHarnessedRequest } from '@/harness/harnessed-request'
import { createRunContext } from '@/harness/run-context'
import type { StepRunSnapshot } from '@/harness/run-step'

describe('Harnessed request', () => {
  test('reuses an injected V5 run context without duplicating workflow lifecycle events', async () => {
    const events: HarnessEvent[] = []
    const eventBus = createHarnessEventBus()
    eventBus.subscribe('*', event => { events.push(event) })
    const runContext = createRunContext('v5-test')
    const steps: StepRunSnapshot[] = []

    const wrapped = await runHarnessedRequest({
      workflowVersion: 'ignored-when-run-context-is-injected',
      inputDigestSource: {resume: 'source'},
      runContext,
      eventBus,
      steps,
      publishWorkflowEvents: false,
      createFailureSample: false,
      execute: async context => {
        context.steps.push({
          stepRunId: 'step-1',
          stepName: 'v5_test',
          status: 'succeeded',
          startedAt: runContext.startedAt,
          finishedAt: new Date().toISOString(),
        })
        return context.runContext.runId
      },
    })

    expect(wrapped.result).toBe(runContext.runId)
    expect(wrapped.meta.run_id).toBe(runContext.runId)
    expect(wrapped.meta.step_statuses).toBe(steps)
    expect(events).toEqual([])
  })

  test('keeps default workflow lifecycle events when V5 does not own them', async () => {
    const events: HarnessEvent[] = []
    const eventBus = createHarnessEventBus()
    eventBus.subscribe('*', event => { events.push(event) })

    await runHarnessedRequest({
      workflowVersion: 'v5-test',
      inputDigestSource: {resume: 'source'},
      eventBus,
      createFailureSample: false,
      execute: async () => 'ok',
    })

    expect(events.map(event => event.type)).toEqual(['workflow.started', 'workflow.succeeded'])
  })
})
