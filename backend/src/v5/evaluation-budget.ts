export const EVALUATION_BUDGET_JOURNAL_VERSION = 'reffo-v5-evaluation-budget-journal-v1' as const

export interface EvaluationBudgetLimits {
  maxPhysicalCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxWallTimeMs: number
}

export interface EvaluationBudgetConfig {
  runId: string
  runLimits: EvaluationBudgetLimits
  caseLimits: EvaluationBudgetLimits
  caseLimitOverrides?: Record<string, Partial<EvaluationBudgetLimits>>
  startedAtMs?: number
}

interface NormalizedEvaluationBudgetConfig {
  runId: string
  runLimits: EvaluationBudgetLimits
  caseLimits: EvaluationBudgetLimits
  caseLimitOverrides: Record<string, Partial<EvaluationBudgetLimits>>
  startedAtMs: number
}

export interface PhysicalCallRequest {
  caseId: string
  estimatedInputTokens: number
  maxOutputTokens: number
  label?: string
}

export interface PhysicalCallReservation {
  reservationId: string
  caseId: string
  estimatedInputTokens: number
  maxOutputTokens: number
  reservedAtMs: number
  label?: string
  /** All calls in one evaluation run intentionally share this signal. */
  signal: AbortSignal
}

export interface PhysicalCallSettlement {
  inputTokens?: number
  outputTokens?: number
}

export type EvaluationBudgetMetric = 'physicalCalls' | 'inputTokens' | 'outputTokens' | 'wallTimeMs'
export type EvaluationBudgetScope = 'run' | 'case'
export type EvaluationBudgetTerminalKind =
  | 'budget_exceeded'
  | 'wall_clock_exceeded'
  | 'physical_call_failed'
  | 'external_failure'
  | 'journal_failure'

interface JournalBase {
  journalVersion: typeof EVALUATION_BUDGET_JOURNAL_VERSION
  sequence: number
  runId: string
  atMs: number
}

export interface BudgetInitializedJournalEntry extends JournalBase {
  type: 'budget_initialized'
  config: NormalizedEvaluationBudgetConfig
}

export interface CallReservedJournalEntry extends JournalBase {
  type: 'call_reserved'
  reservationId: string
  caseId: string
  estimatedInputTokens: number
  maxOutputTokens: number
  label?: string
}

export interface CallSettledJournalEntry extends JournalBase {
  type: 'call_settled'
  reservationId: string
  caseId: string
  outcome: 'success' | 'failure'
  inputTokens: number
  outputTokens: number
  inputAccounting: 'actual' | 'estimated'
  outputAccounting: 'actual' | 'reserved_max'
  error?: SerializedBudgetError
}

export interface CaseCompletedJournalEntry extends JournalBase {
  type: 'case_completed'
  caseId: string
}

export interface BudgetTerminalJournalEntry extends JournalBase {
  type: 'budget_terminal'
  kind: EvaluationBudgetTerminalKind
  message: string
  caseId?: string
  reservationId?: string
  scope?: EvaluationBudgetScope
  metric?: EvaluationBudgetMetric
  limit?: number
  projected?: number
  error?: SerializedBudgetError
}

export type EvaluationBudgetJournalEntry =
  | BudgetInitializedJournalEntry
  | CallReservedJournalEntry
  | CallSettledJournalEntry
  | CaseCompletedJournalEntry
  | BudgetTerminalJournalEntry

export interface SerializedBudgetError {
  name: string
  message: string
  code?: string
}

export interface EvaluationBudgetUsageSnapshot {
  physicalAttempts: number
  settledAttempts: number
  successfulAttempts: number
  failedAttempts: number
  settledInputTokens: number
  settledOutputTokens: number
  pendingInputTokens: number
  pendingOutputTokens: number
  committedInputTokens: number
  committedOutputTokens: number
  estimatedInputSettlements: number
  reservedOutputSettlements: number
  startedAtMs: number
  completedAtMs: number | null
  elapsedMs: number
}

export interface EvaluationBudgetCaseSnapshot {
  caseId: string
  limits: EvaluationBudgetLimits
  usage: EvaluationBudgetUsageSnapshot
  completed: boolean
}

export interface EvaluationBudgetSnapshot {
  journalVersion: typeof EVALUATION_BUDGET_JOURNAL_VERSION
  runId: string
  sequence: number
  capturedAtMs: number
  aborted: boolean
  terminal: Omit<BudgetTerminalJournalEntry, 'journalVersion' | 'sequence' | 'runId'> | null
  run: {
    limits: EvaluationBudgetLimits
    usage: EvaluationBudgetUsageSnapshot
  }
  cases: EvaluationBudgetCaseSnapshot[]
  pendingReservations: Array<Omit<PhysicalCallReservation, 'signal'>>
}

export interface EvaluationBudgetOptions {
  now?: () => number
  journalSink?: (entry: EvaluationBudgetJournalEntry) => void | Promise<void>
  /** Disable only for deterministic unit tests; production should keep the timer armed. */
  enableWallClockTimer?: boolean
}

interface ReservationState {
  reservationId: string
  caseId: string
  estimatedInputTokens: number
  maxOutputTokens: number
  reservedAtMs: number
  label?: string
  settlement?: CallSettledJournalEntry
}

interface CaseState {
  caseId: string
  startedAtMs: number
  completedAtMs: number | null
}

interface LimitViolation {
  scope: EvaluationBudgetScope
  caseId?: string
  metric: EvaluationBudgetMetric
  limit: number
  projected: number
}

export class EvaluationBudgetError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'EvaluationBudgetError'
  }
}

export class EvaluationBudgetExceededError extends EvaluationBudgetError {
  readonly scope: EvaluationBudgetScope
  readonly caseId?: string
  readonly metric: EvaluationBudgetMetric
  readonly limit: number
  readonly projected: number

  constructor(violation: LimitViolation) {
    const target = violation.scope === 'run' ? 'run' : `case ${violation.caseId ?? 'unknown'}`
    super(
      'EVALUATION_BUDGET_EXCEEDED',
      `${target} ${violation.metric} budget exceeded: projected ${violation.projected}, limit ${violation.limit}`
    )
    this.name = 'EvaluationBudgetExceededError'
    this.scope = violation.scope
    this.caseId = violation.caseId
    this.metric = violation.metric
    this.limit = violation.limit
    this.projected = violation.projected
  }
}

export class EvaluationBudgetAbortedError extends EvaluationBudgetError {
  constructor(message: string, options?: ErrorOptions) {
    super('EVALUATION_BUDGET_ABORTED', message, options)
    this.name = 'EvaluationBudgetAbortedError'
  }
}

export class EvaluationBudgetJournalError extends EvaluationBudgetError {
  constructor(message: string, options?: ErrorOptions) {
    super('EVALUATION_BUDGET_JOURNAL_ERROR', message, options)
    this.name = 'EvaluationBudgetJournalError'
  }
}

export class EvaluationPhysicalCallFailedError extends EvaluationBudgetError {
  readonly reservationId: string
  readonly caseId: string

  constructor(reservation: Pick<PhysicalCallReservation, 'reservationId' | 'caseId'>, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause)
    super(
      'EVALUATION_PHYSICAL_CALL_FAILED',
      `Physical model call ${reservation.reservationId} failed: ${causeMessage}`,
      cause instanceof Error ? { cause } : undefined
    )
    this.name = 'EvaluationPhysicalCallFailedError'
    this.reservationId = reservation.reservationId
    this.caseId = reservation.caseId
  }
}

function assertFiniteInteger(value: unknown, field: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new EvaluationBudgetJournalError(`${field} must be a safe integer >= ${minimum}`)
  }
}

function validateLimits(limits: EvaluationBudgetLimits, field: string) {
  if (!limits || typeof limits !== 'object') throw new EvaluationBudgetJournalError(`${field} is required`)
  assertFiniteInteger(limits.maxPhysicalCalls, `${field}.maxPhysicalCalls`)
  assertFiniteInteger(limits.maxInputTokens, `${field}.maxInputTokens`)
  assertFiniteInteger(limits.maxOutputTokens, `${field}.maxOutputTokens`)
  assertFiniteInteger(limits.maxWallTimeMs, `${field}.maxWallTimeMs`, 1)
}

function cloneLimits(limits: EvaluationBudgetLimits): EvaluationBudgetLimits {
  return { ...limits }
}

function normalizeConfig(config: EvaluationBudgetConfig, now: number): NormalizedEvaluationBudgetConfig {
  if (!config.runId?.trim()) throw new EvaluationBudgetJournalError('runId is required')
  validateLimits(config.runLimits, 'runLimits')
  validateLimits(config.caseLimits, 'caseLimits')
  const startedAtMs = config.startedAtMs ?? now
  assertFiniteInteger(startedAtMs, 'startedAtMs')
  const overrides: Record<string, Partial<EvaluationBudgetLimits>> = {}
  for (const [caseId, override] of Object.entries(config.caseLimitOverrides ?? {})) {
    if (!caseId.trim()) throw new EvaluationBudgetJournalError('caseLimitOverrides contains an empty caseId')
    const merged = { ...config.caseLimits, ...override }
    validateLimits(merged, `caseLimitOverrides.${caseId}`)
    overrides[caseId] = { ...override }
  }
  return {
    runId: config.runId,
    runLimits: cloneLimits(config.runLimits),
    caseLimits: cloneLimits(config.caseLimits),
    caseLimitOverrides: overrides,
    startedAtMs,
  }
}

function serializeError(error: unknown): SerializedBudgetError {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
    return {
      name: error.name || 'Error',
      message: error.message.slice(0, 500),
      ...(code ? { code } : {}),
    }
  }
  return { name: 'Error', message: String(error).slice(0, 500) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJournalEntry<T extends EvaluationBudgetJournalEntry>(entry: T): T {
  return structuredClone(entry)
}

/**
 * Owns the hard budget for one evaluation run. Every provider invocation must reserve here
 * immediately before it starts and settle exactly once when it returns or throws.
 */
export class EvaluationBudgetController {
  private readonly controller = new AbortController()
  private readonly now: () => number
  private readonly journalSink?: EvaluationBudgetOptions['journalSink']
  private readonly enableWallClockTimer: boolean
  private readonly journalEntries: EvaluationBudgetJournalEntry[] = []
  private readonly reservations = new Map<string, ReservationState>()
  private readonly cases = new Map<string, CaseState>()
  private operationTail: Promise<void> = Promise.resolve()
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null
  private config: NormalizedEvaluationBudgetConfig
  private terminalEntry: BudgetTerminalJournalEntry | null = null
  private nextSequence = 1

  private constructor(config: NormalizedEvaluationBudgetConfig, options: EvaluationBudgetOptions) {
    this.config = config
    this.now = options.now ?? Date.now
    this.journalSink = options.journalSink
    this.enableWallClockTimer = options.enableWallClockTimer ?? true
  }

  static async create(config: EvaluationBudgetConfig, options: EvaluationBudgetOptions = {}) {
    const now = options.now ?? Date.now
    const normalized = normalizeConfig(config, now())
    const budget = new EvaluationBudgetController(normalized, options)
    await budget.exclusive(async () => {
      await budget.appendAndApply({
        journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
        sequence: budget.nextSequence,
        runId: normalized.runId,
        atMs: normalized.startedAtMs,
        type: 'budget_initialized',
        config: structuredClone(normalized),
      })
    })
    budget.refreshDeadlineTimer()
    return budget
  }

  static async restore(
    entries: readonly EvaluationBudgetJournalEntry[],
    options: EvaluationBudgetOptions = {}
  ) {
    if (entries.length === 0) throw new EvaluationBudgetJournalError('Budget journal is empty')
    const first = entries[0]
    if (first.type !== 'budget_initialized') {
      throw new EvaluationBudgetJournalError('Budget journal must start with budget_initialized')
    }
    validateJournalEntryBase(first, 1, first.runId)
    const normalized = normalizeConfig(first.config, first.config.startedAtMs)
    if (normalized.runId !== first.runId || normalized.startedAtMs !== first.atMs) {
      throw new EvaluationBudgetJournalError('budget_initialized metadata does not match its config')
    }
    const budget = new EvaluationBudgetController(normalized, options)
    for (let index = 0; index < entries.length; index += 1) {
      const entry = cloneJournalEntry(entries[index])
      validateJournalEntryBase(entry, index + 1, normalized.runId)
      budget.applyJournalEntry(entry, true)
      budget.journalEntries.push(entry)
      budget.nextSequence = entry.sequence + 1
    }
    if (budget.terminalEntry) {
      budget.controller.abort(new EvaluationBudgetAbortedError(budget.terminalEntry.message))
    } else {
      const failedReservation = [...budget.reservations.values()]
        .filter(item => item.settlement?.outcome === 'failure')
        .sort((left, right) => left.settlement!.sequence - right.settlement!.sequence)[0]
      if (failedReservation) {
        await budget.exclusive(async () => {
          const failure = new EvaluationPhysicalCallFailedError(
            failedReservation,
            new Error(failedReservation.settlement?.error?.message ?? 'Recovered failed physical call')
          )
          await budget.tripLocked(
            'physical_call_failed',
            failure,
            undefined,
            failedReservation.reservationId,
            failedReservation.caseId
          )
        })
      } else {
        const violation = budget.findAnyCurrentViolation(budget.now())
        if (violation) {
          await budget.exclusive(async () => {
            const error = new EvaluationBudgetExceededError(violation)
            await budget.tripLocked(
              violation.metric === 'wallTimeMs' ? 'wall_clock_exceeded' : 'budget_exceeded',
              error,
              violation
            )
          })
        }
      }
    }
    budget.refreshDeadlineTimer()
    return budget
  }

  get signal() {
    return this.controller.signal
  }

  get aborted() {
    return this.controller.signal.aborted
  }

  async reservePhysicalCall(input: PhysicalCallRequest): Promise<PhysicalCallReservation> {
    return this.exclusive(async () => {
      this.assertRequest(input)
      this.assertActive()
      const now = this.now()
      const wallViolation = this.findWallClockViolation(now, input.caseId)
      if (wallViolation) {
        const error = new EvaluationBudgetExceededError(wallViolation)
        await this.tripLocked('wall_clock_exceeded', error, wallViolation)
        throw error
      }

      const projected = this.findReservationViolation(input, now)
      if (projected) {
        const error = new EvaluationBudgetExceededError(projected)
        await this.tripLocked('budget_exceeded', error, projected)
        throw error
      }

      const reservationId = `${this.config.runId}:physical:${this.countPhysicalAttempts() + 1}`
      const entry: CallReservedJournalEntry = {
        journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
        sequence: this.nextSequence,
        runId: this.config.runId,
        atMs: now,
        type: 'call_reserved',
        reservationId,
        caseId: input.caseId,
        estimatedInputTokens: input.estimatedInputTokens,
        maxOutputTokens: input.maxOutputTokens,
        ...(input.label ? { label: input.label.slice(0, 120) } : {}),
      }
      await this.appendAndApply(entry)
      this.refreshDeadlineTimer()
      return {
        reservationId,
        caseId: input.caseId,
        estimatedInputTokens: input.estimatedInputTokens,
        maxOutputTokens: input.maxOutputTokens,
        reservedAtMs: now,
        ...(entry.label ? { label: entry.label } : {}),
        signal: this.signal,
      }
    })
  }

  async settleSuccess(
    reservation: Pick<PhysicalCallReservation, 'reservationId' | 'caseId'>,
    usage: PhysicalCallSettlement = {}
  ) {
    await this.exclusive(async () => {
      await this.settleLocked(reservation, usage, 'success')
      const violation = this.findTokenOrCallViolation(reservation.caseId)
      if (violation && !this.terminalEntry) {
        const error = new EvaluationBudgetExceededError(violation)
        await this.tripLocked('budget_exceeded', error, violation, reservation.reservationId)
        throw error
      }
    })
  }

  async settleFailure(
    reservation: Pick<PhysicalCallReservation, 'reservationId' | 'caseId'>,
    cause: unknown,
    usage: PhysicalCallSettlement = {}
  ): Promise<never> {
    return this.exclusive(async () => {
      await this.settleLocked(reservation, usage, 'failure', cause)
      const failure = new EvaluationPhysicalCallFailedError(reservation, cause)
      if (!this.terminalEntry) {
        await this.tripLocked(
          'physical_call_failed',
          failure,
          undefined,
          reservation.reservationId,
          reservation.caseId
        )
      }
      throw failure
    })
  }

  async failFast(cause: unknown, caseId?: string): Promise<never> {
    return this.exclusive(async () => {
      const failure = cause instanceof EvaluationBudgetError
        ? cause
        : new EvaluationBudgetAbortedError(
            cause instanceof Error ? cause.message : String(cause),
            cause instanceof Error ? { cause } : undefined
          )
      if (!this.terminalEntry) await this.tripLocked('external_failure', failure, undefined, undefined, caseId)
      throw failure
    })
  }

  async completeCase(caseId: string) {
    await this.exclusive(async () => {
      if (!caseId.trim()) throw new EvaluationBudgetJournalError('caseId is required')
      this.assertActive()
      const state = this.cases.get(caseId)
      if (!state) throw new EvaluationBudgetError('EVALUATION_CASE_NOT_STARTED', `Case ${caseId} has not started`)
      if (state.completedAtMs !== null) return
      const hasPending = [...this.reservations.values()].some(
        reservation => reservation.caseId === caseId && !reservation.settlement
      )
      if (hasPending) {
        throw new EvaluationBudgetError(
          'EVALUATION_CASE_HAS_PENDING_CALLS',
          `Case ${caseId} cannot complete while physical calls are pending`
        )
      }
      await this.appendAndApply({
        journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
        sequence: this.nextSequence,
        runId: this.config.runId,
        atMs: this.now(),
        type: 'case_completed',
        caseId,
      })
      this.refreshDeadlineTimer()
    })
  }

  snapshot(): EvaluationBudgetSnapshot {
    const now = this.now()
    const caseIds = [...this.cases.keys()].sort()
    return {
      journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
      runId: this.config.runId,
      sequence: this.nextSequence - 1,
      capturedAtMs: now,
      aborted: this.aborted,
      terminal: this.terminalEntry ? stripJournalBase(this.terminalEntry) : null,
      run: {
        limits: cloneLimits(this.config.runLimits),
        usage: this.usageSnapshot(undefined, now),
      },
      cases: caseIds.map(caseId => {
        const state = this.cases.get(caseId)!
        return {
          caseId,
          limits: this.limitsForCase(caseId),
          usage: this.usageSnapshot(caseId, now),
          completed: state.completedAtMs !== null,
        }
      }),
      pendingReservations: [...this.reservations.values()]
        .filter(reservation => !reservation.settlement)
        .map(reservation => ({
          reservationId: reservation.reservationId,
          caseId: reservation.caseId,
          estimatedInputTokens: reservation.estimatedInputTokens,
          maxOutputTokens: reservation.maxOutputTokens,
          reservedAtMs: reservation.reservedAtMs,
          ...(reservation.label ? { label: reservation.label } : {}),
        })),
    }
  }

  journal(): EvaluationBudgetJournalEntry[] {
    return this.journalEntries.map(entry => cloneJournalEntry(entry))
  }

  dispose() {
    this.clearDeadlineTimer()
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail
    let release!: () => void
    this.operationTail = new Promise<void>(resolve => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private assertRequest(input: PhysicalCallRequest) {
    if (!input.caseId?.trim()) throw new EvaluationBudgetJournalError('caseId is required')
    assertFiniteInteger(input.estimatedInputTokens, 'estimatedInputTokens')
    assertFiniteInteger(input.maxOutputTokens, 'maxOutputTokens')
    const completed = this.cases.get(input.caseId)?.completedAtMs
    if (completed !== undefined && completed !== null) {
      throw new EvaluationBudgetError('EVALUATION_CASE_COMPLETED', `Case ${input.caseId} is already complete`)
    }
  }

  private assertActive() {
    if (!this.terminalEntry && !this.signal.aborted) return
    const message = this.terminalEntry?.message ?? 'Evaluation budget has been aborted'
    throw new EvaluationBudgetAbortedError(message)
  }

  private limitsForCase(caseId: string): EvaluationBudgetLimits {
    return {
      ...this.config.caseLimits,
      ...(this.config.caseLimitOverrides[caseId] ?? {}),
    }
  }

  private countPhysicalAttempts(caseId?: string) {
    return [...this.reservations.values()].filter(item => caseId === undefined || item.caseId === caseId).length
  }

  private usageSnapshot(caseId: string | undefined, now: number): EvaluationBudgetUsageSnapshot {
    const reservations = [...this.reservations.values()].filter(
      reservation => caseId === undefined || reservation.caseId === caseId
    )
    const settlements = reservations.flatMap(reservation => reservation.settlement ? [reservation.settlement] : [])
    const pending = reservations.filter(reservation => !reservation.settlement)
    const caseState = caseId === undefined ? undefined : this.cases.get(caseId)
    const startedAtMs = caseState?.startedAtMs ?? this.config.startedAtMs
    const completedAtMs = caseState?.completedAtMs ?? null
    const settledInputTokens = settlements.reduce((sum, item) => sum + item.inputTokens, 0)
    const settledOutputTokens = settlements.reduce((sum, item) => sum + item.outputTokens, 0)
    const pendingInputTokens = pending.reduce((sum, item) => sum + item.estimatedInputTokens, 0)
    const pendingOutputTokens = pending.reduce((sum, item) => sum + item.maxOutputTokens, 0)
    return {
      physicalAttempts: reservations.length,
      settledAttempts: settlements.length,
      successfulAttempts: settlements.filter(item => item.outcome === 'success').length,
      failedAttempts: settlements.filter(item => item.outcome === 'failure').length,
      settledInputTokens,
      settledOutputTokens,
      pendingInputTokens,
      pendingOutputTokens,
      committedInputTokens: settledInputTokens + pendingInputTokens,
      committedOutputTokens: settledOutputTokens + pendingOutputTokens,
      estimatedInputSettlements: settlements.filter(item => item.inputAccounting === 'estimated').length,
      reservedOutputSettlements: settlements.filter(item => item.outputAccounting === 'reserved_max').length,
      startedAtMs,
      completedAtMs,
      elapsedMs: Math.max(0, (completedAtMs ?? now) - startedAtMs),
    }
  }

  private findWallClockViolation(now: number, requestedCaseId?: string): LimitViolation | null {
    const runElapsed = Math.max(0, now - this.config.startedAtMs)
    if (runElapsed >= this.config.runLimits.maxWallTimeMs) {
      return {
        scope: 'run',
        metric: 'wallTimeMs',
        limit: this.config.runLimits.maxWallTimeMs,
        projected: runElapsed,
      }
    }

    const activeCases = new Map(this.cases)
    if (requestedCaseId && !activeCases.has(requestedCaseId)) {
      activeCases.set(requestedCaseId, { caseId: requestedCaseId, startedAtMs: now, completedAtMs: null })
    }
    for (const state of activeCases.values()) {
      if (state.completedAtMs !== null) continue
      const elapsed = Math.max(0, now - state.startedAtMs)
      const limit = this.limitsForCase(state.caseId).maxWallTimeMs
      if (elapsed >= limit) {
        return { scope: 'case', caseId: state.caseId, metric: 'wallTimeMs', limit, projected: elapsed }
      }
    }
    return null
  }

  private findReservationViolation(input: PhysicalCallRequest, now: number): LimitViolation | null {
    const checks: Array<{ scope: EvaluationBudgetScope; caseId?: string; limits: EvaluationBudgetLimits; usage: EvaluationBudgetUsageSnapshot }> = [
      { scope: 'run', limits: this.config.runLimits, usage: this.usageSnapshot(undefined, now) },
      { scope: 'case', caseId: input.caseId, limits: this.limitsForCase(input.caseId), usage: this.usageSnapshot(input.caseId, now) },
    ]
    for (const check of checks) {
      const projectedCalls = check.usage.physicalAttempts + 1
      if (projectedCalls > check.limits.maxPhysicalCalls) {
        return { scope: check.scope, caseId: check.caseId, metric: 'physicalCalls', limit: check.limits.maxPhysicalCalls, projected: projectedCalls }
      }
      const projectedInput = check.usage.committedInputTokens + input.estimatedInputTokens
      if (projectedInput > check.limits.maxInputTokens) {
        return { scope: check.scope, caseId: check.caseId, metric: 'inputTokens', limit: check.limits.maxInputTokens, projected: projectedInput }
      }
      const projectedOutput = check.usage.committedOutputTokens + input.maxOutputTokens
      if (projectedOutput > check.limits.maxOutputTokens) {
        return { scope: check.scope, caseId: check.caseId, metric: 'outputTokens', limit: check.limits.maxOutputTokens, projected: projectedOutput }
      }
    }
    return null
  }

  private findTokenOrCallViolation(caseId: string): LimitViolation | null {
    const now = this.now()
    const checks: Array<{ scope: EvaluationBudgetScope; caseId?: string; limits: EvaluationBudgetLimits; usage: EvaluationBudgetUsageSnapshot }> = [
      { scope: 'run', limits: this.config.runLimits, usage: this.usageSnapshot(undefined, now) },
      { scope: 'case', caseId, limits: this.limitsForCase(caseId), usage: this.usageSnapshot(caseId, now) },
    ]
    for (const check of checks) {
      if (check.usage.physicalAttempts > check.limits.maxPhysicalCalls) {
        return { scope: check.scope, caseId: check.caseId, metric: 'physicalCalls', limit: check.limits.maxPhysicalCalls, projected: check.usage.physicalAttempts }
      }
      if (check.usage.committedInputTokens > check.limits.maxInputTokens) {
        return { scope: check.scope, caseId: check.caseId, metric: 'inputTokens', limit: check.limits.maxInputTokens, projected: check.usage.committedInputTokens }
      }
      if (check.usage.committedOutputTokens > check.limits.maxOutputTokens) {
        return { scope: check.scope, caseId: check.caseId, metric: 'outputTokens', limit: check.limits.maxOutputTokens, projected: check.usage.committedOutputTokens }
      }
    }
    return this.findWallClockViolation(now)
  }

  private findAnyCurrentViolation(now: number): LimitViolation | null {
    const runUsage = this.usageSnapshot(undefined, now)
    if (runUsage.physicalAttempts > this.config.runLimits.maxPhysicalCalls) {
      return {
        scope: 'run',
        metric: 'physicalCalls',
        limit: this.config.runLimits.maxPhysicalCalls,
        projected: runUsage.physicalAttempts,
      }
    }
    if (runUsage.committedInputTokens > this.config.runLimits.maxInputTokens) {
      return {
        scope: 'run',
        metric: 'inputTokens',
        limit: this.config.runLimits.maxInputTokens,
        projected: runUsage.committedInputTokens,
      }
    }
    if (runUsage.committedOutputTokens > this.config.runLimits.maxOutputTokens) {
      return {
        scope: 'run',
        metric: 'outputTokens',
        limit: this.config.runLimits.maxOutputTokens,
        projected: runUsage.committedOutputTokens,
      }
    }
    for (const caseId of this.cases.keys()) {
      const usage = this.usageSnapshot(caseId, now)
      const limits = this.limitsForCase(caseId)
      if (usage.physicalAttempts > limits.maxPhysicalCalls) {
        return { scope: 'case', caseId, metric: 'physicalCalls', limit: limits.maxPhysicalCalls, projected: usage.physicalAttempts }
      }
      if (usage.committedInputTokens > limits.maxInputTokens) {
        return { scope: 'case', caseId, metric: 'inputTokens', limit: limits.maxInputTokens, projected: usage.committedInputTokens }
      }
      if (usage.committedOutputTokens > limits.maxOutputTokens) {
        return { scope: 'case', caseId, metric: 'outputTokens', limit: limits.maxOutputTokens, projected: usage.committedOutputTokens }
      }
    }
    return this.findWallClockViolation(now)
  }

  private async settleLocked(
    reservation: Pick<PhysicalCallReservation, 'reservationId' | 'caseId'>,
    usage: PhysicalCallSettlement,
    outcome: 'success' | 'failure',
    cause?: unknown
  ) {
    const state = this.reservations.get(reservation.reservationId)
    if (!state || state.caseId !== reservation.caseId) {
      throw new EvaluationBudgetError('EVALUATION_RESERVATION_NOT_FOUND', `Unknown reservation ${reservation.reservationId}`)
    }
    if (state.settlement) {
      throw new EvaluationBudgetError('EVALUATION_RESERVATION_ALREADY_SETTLED', `Reservation ${reservation.reservationId} is already settled`)
    }
    if (usage.inputTokens !== undefined) assertFiniteInteger(usage.inputTokens, 'inputTokens')
    if (usage.outputTokens !== undefined) assertFiniteInteger(usage.outputTokens, 'outputTokens')
    await this.appendAndApply({
      journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
      sequence: this.nextSequence,
      runId: this.config.runId,
      atMs: this.now(),
      type: 'call_settled',
      reservationId: state.reservationId,
      caseId: state.caseId,
      outcome,
      inputTokens: usage.inputTokens ?? state.estimatedInputTokens,
      outputTokens: usage.outputTokens ?? state.maxOutputTokens,
      inputAccounting: usage.inputTokens === undefined ? 'estimated' : 'actual',
      outputAccounting: usage.outputTokens === undefined ? 'reserved_max' : 'actual',
      ...(outcome === 'failure' ? { error: serializeError(cause) } : {}),
    })
  }

  private async appendAndApply(entry: EvaluationBudgetJournalEntry) {
    try {
      await this.journalSink?.(cloneJournalEntry(entry))
    } catch (cause) {
      const error = new EvaluationBudgetJournalError('Failed to persist evaluation budget journal entry', {
        cause: cause instanceof Error ? cause : undefined,
      })
      this.abortForJournalFailure(error)
      throw error
    }
    this.applyJournalEntry(entry, false)
    this.journalEntries.push(cloneJournalEntry(entry))
    this.nextSequence = entry.sequence + 1
  }

  private applyJournalEntry(entry: EvaluationBudgetJournalEntry, restoring: boolean) {
    switch (entry.type) {
      case 'budget_initialized':
        if (entry.sequence !== 1) throw new EvaluationBudgetJournalError('budget_initialized must be sequence 1')
        if (restoring && this.journalEntries.length > 0) throw new EvaluationBudgetJournalError('Duplicate budget_initialized entry')
        this.config = normalizeConfig(entry.config, entry.config.startedAtMs)
        return
      case 'call_reserved': {
        if (this.terminalEntry) throw new EvaluationBudgetJournalError('Journal reserves a call after terminal state')
        assertFiniteInteger(entry.estimatedInputTokens, 'call_reserved.estimatedInputTokens')
        assertFiniteInteger(entry.maxOutputTokens, 'call_reserved.maxOutputTokens')
        if (!entry.caseId?.trim() || !entry.reservationId?.trim()) throw new EvaluationBudgetJournalError('Invalid call_reserved identity')
        if (this.reservations.has(entry.reservationId)) throw new EvaluationBudgetJournalError(`Duplicate reservation ${entry.reservationId}`)
        const completedCase = this.cases.get(entry.caseId)
        if (completedCase?.completedAtMs !== null && completedCase?.completedAtMs !== undefined) {
          throw new EvaluationBudgetJournalError(`Journal reserves a call after case ${entry.caseId} completed`)
        }
        if (!completedCase) this.cases.set(entry.caseId, { caseId: entry.caseId, startedAtMs: entry.atMs, completedAtMs: null })
        this.reservations.set(entry.reservationId, {
          reservationId: entry.reservationId,
          caseId: entry.caseId,
          estimatedInputTokens: entry.estimatedInputTokens,
          maxOutputTokens: entry.maxOutputTokens,
          reservedAtMs: entry.atMs,
          ...(entry.label ? { label: entry.label } : {}),
        })
        return
      }
      case 'call_settled': {
        assertFiniteInteger(entry.inputTokens, 'call_settled.inputTokens')
        assertFiniteInteger(entry.outputTokens, 'call_settled.outputTokens')
        if (!['success', 'failure'].includes(entry.outcome)) {
          throw new EvaluationBudgetJournalError(`Invalid settlement outcome for ${entry.reservationId}`)
        }
        if (!['actual', 'estimated'].includes(entry.inputAccounting)) {
          throw new EvaluationBudgetJournalError(`Invalid input accounting for ${entry.reservationId}`)
        }
        if (!['actual', 'reserved_max'].includes(entry.outputAccounting)) {
          throw new EvaluationBudgetJournalError(`Invalid output accounting for ${entry.reservationId}`)
        }
        const reservation = this.reservations.get(entry.reservationId)
        if (!reservation || reservation.caseId !== entry.caseId) throw new EvaluationBudgetJournalError(`Settlement has no matching reservation ${entry.reservationId}`)
        if (reservation.settlement) throw new EvaluationBudgetJournalError(`Duplicate settlement ${entry.reservationId}`)
        if (entry.inputAccounting === 'estimated' && entry.inputTokens !== reservation.estimatedInputTokens) {
          throw new EvaluationBudgetJournalError(`Estimated input settlement does not match reservation ${entry.reservationId}`)
        }
        if (entry.outputAccounting === 'reserved_max' && entry.outputTokens !== reservation.maxOutputTokens) {
          throw new EvaluationBudgetJournalError(`Reserved output settlement does not match reservation ${entry.reservationId}`)
        }
        reservation.settlement = cloneJournalEntry(entry)
        return
      }
      case 'case_completed': {
        if (!entry.caseId?.trim()) throw new EvaluationBudgetJournalError('Invalid case_completed identity')
        const state = this.cases.get(entry.caseId)
        if (!state) throw new EvaluationBudgetJournalError(`Completed case ${entry.caseId} was never started`)
        if (state.completedAtMs !== null) throw new EvaluationBudgetJournalError(`Duplicate completion for case ${entry.caseId}`)
        const pending = [...this.reservations.values()].some(item => item.caseId === entry.caseId && !item.settlement)
        if (pending) throw new EvaluationBudgetJournalError(`Completed case ${entry.caseId} still has pending calls`)
        state.completedAtMs = entry.atMs
        return
      }
      case 'budget_terminal':
        if (this.terminalEntry) throw new EvaluationBudgetJournalError('Duplicate budget_terminal entry')
        if (!['budget_exceeded', 'wall_clock_exceeded', 'physical_call_failed', 'external_failure', 'journal_failure'].includes(entry.kind)) {
          throw new EvaluationBudgetJournalError('Invalid budget_terminal kind')
        }
        if (!entry.message?.trim()) throw new EvaluationBudgetJournalError('budget_terminal message is required')
        if (entry.scope !== undefined && !['run', 'case'].includes(entry.scope)) {
          throw new EvaluationBudgetJournalError('Invalid budget_terminal scope')
        }
        if (entry.metric !== undefined && !['physicalCalls', 'inputTokens', 'outputTokens', 'wallTimeMs'].includes(entry.metric)) {
          throw new EvaluationBudgetJournalError('Invalid budget_terminal metric')
        }
        if (entry.limit !== undefined) assertFiniteInteger(entry.limit, 'budget_terminal.limit')
        if (entry.projected !== undefined) assertFiniteInteger(entry.projected, 'budget_terminal.projected')
        this.terminalEntry = cloneJournalEntry(entry)
        return
    }
  }

  private async tripLocked(
    kind: EvaluationBudgetTerminalKind,
    error: EvaluationBudgetError,
    violation?: LimitViolation,
    reservationId?: string,
    caseId?: string
  ) {
    if (this.terminalEntry) return
    const entry: BudgetTerminalJournalEntry = {
      journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
      sequence: this.nextSequence,
      runId: this.config.runId,
      atMs: this.now(),
      type: 'budget_terminal',
      kind,
      message: error.message.slice(0, 500),
      ...(caseId || violation?.caseId ? { caseId: caseId ?? violation?.caseId } : {}),
      ...(reservationId ? { reservationId } : {}),
      ...(violation ? {
        scope: violation.scope,
        metric: violation.metric,
        limit: violation.limit,
        projected: violation.projected,
      } : {}),
      error: serializeError(error),
    }
    // Abort first so concurrent provider requests stop even if the journal sink is slow.
    this.terminalEntry = cloneJournalEntry(entry)
    this.controller.abort(error)
    this.clearDeadlineTimer()
    try {
      await this.journalSink?.(cloneJournalEntry(entry))
      this.journalEntries.push(cloneJournalEntry(entry))
      this.nextSequence = entry.sequence + 1
    } catch {
      // The shared abort is already active. The in-memory snapshot retains the terminal reason.
    }
  }

  private abortForJournalFailure(error: EvaluationBudgetJournalError) {
    if (!this.terminalEntry) {
      this.terminalEntry = {
        journalVersion: EVALUATION_BUDGET_JOURNAL_VERSION,
        sequence: this.nextSequence,
        runId: this.config.runId,
        atMs: this.now(),
        type: 'budget_terminal',
        kind: 'journal_failure',
        message: error.message,
        error: serializeError(error),
      }
    }
    this.controller.abort(error)
    this.clearDeadlineTimer()
  }

  private refreshDeadlineTimer() {
    this.clearDeadlineTimer()
    if (!this.enableWallClockTimer || this.terminalEntry) return
    const deadlines = [this.config.startedAtMs + this.config.runLimits.maxWallTimeMs]
    for (const state of this.cases.values()) {
      if (state.completedAtMs === null) deadlines.push(state.startedAtMs + this.limitsForCase(state.caseId).maxWallTimeMs)
    }
    const delay = Math.max(0, Math.min(...deadlines) - this.now())
    this.deadlineTimer = setTimeout(() => {
      void this.exclusive(async () => {
        if (this.terminalEntry) return
        const violation = this.findWallClockViolation(this.now())
        if (!violation) {
          this.refreshDeadlineTimer()
          return
        }
        const error = new EvaluationBudgetExceededError(violation)
        await this.tripLocked('wall_clock_exceeded', error, violation)
      })
    }, delay)
    if (typeof this.deadlineTimer === 'object' && 'unref' in this.deadlineTimer) this.deadlineTimer.unref()
  }

  private clearDeadlineTimer() {
    if (this.deadlineTimer !== null) clearTimeout(this.deadlineTimer)
    this.deadlineTimer = null
  }
}

function validateJournalEntryBase(entry: unknown, expectedSequence: number, runId: string): asserts entry is EvaluationBudgetJournalEntry {
  if (!isRecord(entry)) throw new EvaluationBudgetJournalError(`Journal entry ${expectedSequence} is not an object`)
  if (entry.journalVersion !== EVALUATION_BUDGET_JOURNAL_VERSION) throw new EvaluationBudgetJournalError(`Unsupported journal version at sequence ${expectedSequence}`)
  if (entry.sequence !== expectedSequence) throw new EvaluationBudgetJournalError(`Journal sequence gap: expected ${expectedSequence}`)
  if (entry.runId !== runId) throw new EvaluationBudgetJournalError(`Journal runId mismatch at sequence ${expectedSequence}`)
  assertFiniteInteger(entry.atMs, `journal[${expectedSequence}].atMs`)
  if (!['budget_initialized', 'call_reserved', 'call_settled', 'case_completed', 'budget_terminal'].includes(String(entry.type))) {
    throw new EvaluationBudgetJournalError(`Unknown journal entry type at sequence ${expectedSequence}`)
  }
}

function stripJournalBase(entry: BudgetTerminalJournalEntry): EvaluationBudgetSnapshot['terminal'] {
  const { journalVersion: _journalVersion, sequence: _sequence, runId: _runId, ...terminal } = entry
  return structuredClone(terminal)
}
