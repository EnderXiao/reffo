import { describe, expect, test } from 'bun:test'
import {
  EvaluationBudgetAbortedError,
  EvaluationBudgetController,
  EvaluationBudgetExceededError,
  EvaluationBudgetJournalError,
  EvaluationPhysicalCallFailedError,
  type EvaluationBudgetConfig,
  type EvaluationBudgetJournalEntry,
} from '@/v5/evaluation-budget'

function config(overrides: Partial<EvaluationBudgetConfig> = {}): EvaluationBudgetConfig {
  return {
    runId: 'run-test',
    startedAtMs: 1_000,
    runLimits: {
      maxPhysicalCalls: 10,
      maxInputTokens: 10_000,
      maxOutputTokens: 5_000,
      maxWallTimeMs: 60_000,
    },
    caseLimits: {
      maxPhysicalCalls: 5,
      maxInputTokens: 5_000,
      maxOutputTokens: 2_500,
      maxWallTimeMs: 30_000,
    },
    ...overrides,
  }
}

function deterministicOptions(now: () => number, journal?: EvaluationBudgetJournalEntry[]) {
  return {
    now,
    enableWallClockTimer: false,
    journalSink: journal ? (entry: EvaluationBudgetJournalEntry) => {
      journal.push(structuredClone(entry))
    } : undefined,
  }
}

describe('EvaluationBudgetController', () => {
  test('reserves before a call and replaces pending estimates with actual usage on success', async () => {
    let now = 1_000
    const journal: EvaluationBudgetJournalEntry[] = []
    const budget = await EvaluationBudgetController.create(config(), deterministicOptions(() => now, journal))

    const reservation = await budget.reservePhysicalCall({
      caseId: 'case-1',
      label: 'P01',
      estimatedInputTokens: 800,
      maxOutputTokens: 400,
    })
    expect(reservation.signal).toBe(budget.signal)
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 0,
      pendingInputTokens: 800,
      pendingOutputTokens: 400,
      committedInputTokens: 800,
      committedOutputTokens: 400,
    })

    now = 1_250
    await budget.settleSuccess(reservation, { inputTokens: 720, outputTokens: 180 })
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 1,
      successfulAttempts: 1,
      settledInputTokens: 720,
      settledOutputTokens: 180,
      pendingInputTokens: 0,
      pendingOutputTokens: 0,
      committedInputTokens: 720,
      committedOutputTokens: 180,
    })
    expect(journal.map(entry => entry.type)).toEqual(['budget_initialized', 'call_reserved', 'call_settled'])
    expect(JSON.parse(JSON.stringify(budget.snapshot())).run.usage.physicalAttempts).toBe(1)
    budget.dispose()
  })

  test('charges conservative estimates when the provider omits usage', async () => {
    const budget = await EvaluationBudgetController.create(config(), deterministicOptions(() => 1_000))
    const reservation = await budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 900, maxOutputTokens: 300 })
    await budget.settleSuccess(reservation)
    expect(budget.snapshot().run.usage).toMatchObject({
      settledInputTokens: 900,
      settledOutputTokens: 300,
      estimatedInputSettlements: 1,
      reservedOutputSettlements: 1,
    })
    budget.dispose()
  })

  test('serializes concurrent reservations so only one can consume the final call slot', async () => {
    const persisted: EvaluationBudgetJournalEntry[] = []
    const budget = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 1, maxInputTokens: 10_000, maxOutputTokens: 5_000, maxWallTimeMs: 60_000 },
    }), {
      ...deterministicOptions(() => 1_000),
      journalSink: async entry => {
        await Promise.resolve()
        persisted.push(structuredClone(entry))
      },
    })

    const results = await Promise.allSettled([
      budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 10, maxOutputTokens: 10 }),
      budget.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 10, maxOutputTokens: 10 }),
    ])
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(item => item.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(EvaluationBudgetExceededError)
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(1)
    expect(budget.signal.aborted).toBe(true)
    expect(persisted.map(entry => entry.type)).toEqual(['budget_initialized', 'call_reserved', 'budget_terminal'])
    budget.dispose()
  })

  test('enforces case and run token budgets independently', async () => {
    const caseBudget = await EvaluationBudgetController.create(config({
      caseLimits: { maxPhysicalCalls: 5, maxInputTokens: 100, maxOutputTokens: 2_500, maxWallTimeMs: 30_000 },
    }), deterministicOptions(() => 1_000))
    await expect(caseBudget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 101, maxOutputTokens: 1 }))
      .rejects.toMatchObject({ scope: 'case', metric: 'inputTokens' })
    expect(caseBudget.snapshot().run.usage.physicalAttempts).toBe(0)
    caseBudget.dispose()

    const runBudget = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 10, maxInputTokens: 150, maxOutputTokens: 5_000, maxWallTimeMs: 60_000 },
    }), deterministicOptions(() => 1_000))
    const first = await runBudget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 100, maxOutputTokens: 1 })
    await runBudget.settleSuccess(first, { inputTokens: 100, outputTokens: 1 })
    await runBudget.completeCase('case-1')
    await expect(runBudget.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 51, maxOutputTokens: 1 }))
      .rejects.toMatchObject({ scope: 'run', metric: 'inputTokens' })
    expect(runBudget.snapshot().run.usage.physicalAttempts).toBe(1)
    runBudget.dispose()
  })

  test('a failed physical call is settled, counted and aborts every concurrent call', async () => {
    const budget = await EvaluationBudgetController.create(config(), deterministicOptions(() => 1_000))
    const first = await budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 100, maxOutputTokens: 50 })
    const second = await budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 200, maxOutputTokens: 60 })
    expect(first.signal).toBe(second.signal)

    await expect(budget.settleFailure(first, new Error('provider timeout')))
      .rejects.toBeInstanceOf(EvaluationPhysicalCallFailedError)
    expect(first.signal.aborted).toBe(true)
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 2,
      settledAttempts: 1,
      failedAttempts: 1,
      pendingInputTokens: 200,
      pendingOutputTokens: 60,
    })
    await expect(budget.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toBeInstanceOf(EvaluationBudgetAbortedError)
    budget.dispose()
  })

  test('actual usage that exceeds a limit is recorded before fail-fast abort', async () => {
    const budget = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 10, maxInputTokens: 100, maxOutputTokens: 5_000, maxWallTimeMs: 60_000 },
    }), deterministicOptions(() => 1_000))
    const reservation = await budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 90, maxOutputTokens: 20 })
    await expect(budget.settleSuccess(reservation, { inputTokens: 110, outputTokens: 10 }))
      .rejects.toMatchObject({ scope: 'run', metric: 'inputTokens' })
    expect(budget.snapshot().run.usage.settledInputTokens).toBe(110)
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(1)
    expect(budget.signal.aborted).toBe(true)
    budget.dispose()
  })

  test('wall-clock exhaustion fails before reserving another physical call', async () => {
    let now = 1_000
    const budget = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 10, maxInputTokens: 10_000, maxOutputTokens: 5_000, maxWallTimeMs: 100 },
    }), deterministicOptions(() => now))
    now = 1_100
    await expect(budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toMatchObject({ scope: 'run', metric: 'wallTimeMs' })
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(0)
    expect(budget.signal.aborted).toBe(true)
    budget.dispose()
  })

  test('case completion freezes elapsed time and prevents later reuse', async () => {
    let now = 1_000
    const budget = await EvaluationBudgetController.create(config(), deterministicOptions(() => now))
    const reservation = await budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 1, maxOutputTokens: 1 })
    now = 1_100
    await budget.settleSuccess(reservation, { inputTokens: 1, outputTokens: 1 })
    await budget.completeCase('case-1')
    now = 50_000
    const row = budget.snapshot().cases[0]
    expect(row.completed).toBe(true)
    expect(row.usage.elapsedMs).toBe(100)
    await expect(budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toMatchObject({ code: 'EVALUATION_CASE_COMPLETED' })
    budget.dispose()
  })

  test('restores settled and pending usage from an append-only journal', async () => {
    let now = 1_000
    const journal: EvaluationBudgetJournalEntry[] = []
    const original = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 3, maxInputTokens: 1_000, maxOutputTokens: 500, maxWallTimeMs: 60_000 },
    }), deterministicOptions(() => now, journal))
    const settled = await original.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 100, maxOutputTokens: 80 })
    await original.settleSuccess(settled, { inputTokens: 90, outputTokens: 40 })
    await original.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 200, maxOutputTokens: 100 })
    original.dispose()

    now = 1_500
    const restored = await EvaluationBudgetController.restore(journal, deterministicOptions(() => now))
    expect(restored.snapshot().run.usage).toMatchObject({
      physicalAttempts: 2,
      settledAttempts: 1,
      pendingInputTokens: 200,
      pendingOutputTokens: 100,
      committedInputTokens: 290,
      committedOutputTokens: 140,
    })
    const third = await restored.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 1, maxOutputTokens: 1 })
    expect(third.reservationId).toBe('run-test:physical:3')
    await expect(restored.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toMatchObject({ scope: 'run', metric: 'physicalCalls' })
    restored.dispose()
  })

  test('restores terminal state and rejects malformed journals', async () => {
    const journal: EvaluationBudgetJournalEntry[] = []
    const budget = await EvaluationBudgetController.create(config(), deterministicOptions(() => 1_000, journal))
    await expect(budget.failFast(new Error('quality gate failed'), 'case-1')).rejects.toBeInstanceOf(EvaluationBudgetAbortedError)
    budget.dispose()

    const restored = await EvaluationBudgetController.restore(journal, deterministicOptions(() => 1_100))
    expect(restored.signal.aborted).toBe(true)
    await expect(restored.reservePhysicalCall({ caseId: 'case-2', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toBeInstanceOf(EvaluationBudgetAbortedError)
    restored.dispose()

    const malformed = structuredClone(journal)
    malformed[1].sequence = 99
    await expect(EvaluationBudgetController.restore(malformed, deterministicOptions(() => 1_100)))
      .rejects.toBeInstanceOf(EvaluationBudgetJournalError)
  })

  test('recovery closes crash gaps after a failed call or an over-budget settlement', async () => {
    const failedJournal: EvaluationBudgetJournalEntry[] = []
    const failed = await EvaluationBudgetController.create(config(), deterministicOptions(() => 1_000, failedJournal))
    const failedReservation = await failed.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 10, maxOutputTokens: 10 })
    await expect(failed.settleFailure(failedReservation, new Error('connection reset'))).rejects.toBeInstanceOf(EvaluationPhysicalCallFailedError)
    failed.dispose()

    const failedWithoutTerminal = failedJournal.filter(entry => entry.type !== 'budget_terminal')
    const recoveredFailure = await EvaluationBudgetController.restore(failedWithoutTerminal, deterministicOptions(() => 1_100))
    expect(recoveredFailure.signal.aborted).toBe(true)
    expect(recoveredFailure.snapshot().terminal?.kind).toBe('physical_call_failed')
    recoveredFailure.dispose()

    const exceededJournal: EvaluationBudgetJournalEntry[] = []
    const exceeded = await EvaluationBudgetController.create(config({
      runLimits: { maxPhysicalCalls: 10, maxInputTokens: 100, maxOutputTokens: 5_000, maxWallTimeMs: 60_000 },
    }), deterministicOptions(() => 1_000, exceededJournal))
    const exceededReservation = await exceeded.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 90, maxOutputTokens: 10 })
    await expect(exceeded.settleSuccess(exceededReservation, { inputTokens: 101, outputTokens: 1 }))
      .rejects.toBeInstanceOf(EvaluationBudgetExceededError)
    exceeded.dispose()

    const exceededWithoutTerminal = exceededJournal.filter(entry => entry.type !== 'budget_terminal')
    const recoveredExceeded = await EvaluationBudgetController.restore(exceededWithoutTerminal, deterministicOptions(() => 1_100))
    expect(recoveredExceeded.signal.aborted).toBe(true)
    expect(recoveredExceeded.snapshot().terminal).toMatchObject({ kind: 'budget_exceeded', metric: 'inputTokens' })
    recoveredExceeded.dispose()
  })

  test('journal persistence failure aborts before a reservation can be returned', async () => {
    let writes = 0
    const budget = await EvaluationBudgetController.create(config(), {
      now: () => 1_000,
      enableWallClockTimer: false,
      journalSink: () => {
        writes += 1
        if (writes > 1) throw new Error('disk full')
      },
    })
    await expect(budget.reservePhysicalCall({ caseId: 'case-1', estimatedInputTokens: 1, maxOutputTokens: 1 }))
      .rejects.toBeInstanceOf(EvaluationBudgetJournalError)
    expect(budget.signal.aborted).toBe(true)
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(0)
    expect(budget.snapshot().terminal?.kind).toBe('journal_failure')
    budget.dispose()
  })
})
