import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { ChatCompletionInput, ChatCompletionResult, LlmProvider } from '@/providers/llm-provider'
import { EvaluationBudgetController } from '@/v5/evaluation-budget'
import {
  BudgetedEvaluationProvider,
  CASE_2_CANARY_LIMITS,
  FULL_CASE_LIMITS,
  FULL_RUN_LIMITS,
  LARGE_RESUME_SINGLE_CASE_LIMITS,
  EvaluationRunnerSafetyError,
  assertResumeExtractionReplaySafe,
  acquireEvaluationRunLock,
  assertOutputDirectoryPolicy,
  assertStrictDeepSeekEndpoint,
  budgetProfileForCases,
  parseEvaluationRunnerArgs,
  readCheckpoint,
  v5CasePhysicalCallUpperBound,
  writeCheckpoint,
  type EvaluationCheckpointFingerprints,
  type EvaluationUsageEntry,
} from '@/v5/evaluation-runner-support'

const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const path = await mkdtemp(resolve(tmpdir(), 'reffo-v5-runner-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

function fingerprints(overrides: Partial<EvaluationCheckpointFingerprints> = {}): EvaluationCheckpointFingerprints {
  return {
    inputDigest: 'a'.repeat(64),
    implementationDigest: 'b'.repeat(64),
    configDigest: 'c'.repeat(64),
    ...overrides,
  }
}

function request(overrides: Partial<ChatCompletionInput> = {}): ChatCompletionInput {
  return {
    messages: [{ role: 'user', content: 'test' }],
    maxOutputTokens: 100,
    promptVersion: '5.0.0-p01-test',
    ...overrides,
  }
}

describe('evaluation runner CLI and immutable safety configuration', () => {
  test('keeps provider/workflow initialization behind the dry-run return and avoids SQLite persistence', async () => {
    const runnerSource = await readFile(
      resolve(import.meta.dir, '../../../scripts/run-v5-nonprod-nine-case-blind-eval.ts'),
      'utf8'
    )
    expect(runnerSource).not.toMatch(/^import\s+.*@\/providers\/deepseek-provider/m)
    expect(runnerSource).not.toMatch(/^import\s+.*@\/v5\/main\/workflow/m)
    expect(runnerSource).toContain("import('@/providers/deepseek-provider')")
    expect(runnerSource.indexOf('if (args.dryRun) return')).toBeLessThan(
      runnerSource.indexOf("import('@/providers/deepseek-provider')")
    )
    expect(runnerSource).not.toContain('PersistenceSubscriber')
    expect(runnerSource).toContain("resolve(args.outputRoot, 'harness.sqlite')")
    expect(runnerSource).not.toContain("resolve(backendRoot, 'data', 'harness.sqlite')")
  })

  test('defaults to a case-2 dry-run-safe canary selection', () => {
    const parsed = parseEvaluationRunnerArgs([], {
      backendRoot: '/repo/backend',
      now: new Date('2026-09-01T00:00:00.000Z'),
    })
    expect(parsed.selectedCases).toEqual([2])
    expect(parsed.dryRun).toBe(true)
    expect(parsed.live).toBe(false)
    expect(parsed.failFast).toBe(true)
    expect(parsed.resume).toBe(false)
    expect(parsed.outputRoot).toContain('v5-nonprod-nine-safe-2026-09-01T00-00-00-000Z')
  })

  test('parses sorted unique case lists and ranges', () => {
    const parsed = parseEvaluationRunnerArgs(['--cases', '3,1-2,2,9', '--dry-run', '--fail-fast'], {
      backendRoot: '/repo/backend',
    })
    expect(parsed.selectedCases).toEqual([1, 2, 3, 9])
    expect(parsed.dryRun).toBe(true)
  })

  test('rejects invalid cases, unknown flags and implicit resume directories', () => {
    expect(() => parseEvaluationRunnerArgs(['--cases', '0'], { backendRoot: '/repo/backend' }))
      .toThrow(EvaluationRunnerSafetyError)
    expect(() => parseEvaluationRunnerArgs(['--unknown'], { backendRoot: '/repo/backend' }))
      .toThrow('未知参数')
    expect(() => parseEvaluationRunnerArgs(['--resume'], { backendRoot: '/repo/backend' }))
      .toThrow('--resume 必须同时提供明确的 --output')
    expect(() => parseEvaluationRunnerArgs(['--live'], { backendRoot: '/repo/backend' }))
      .toThrow('--live 必须提供明确的全新或恢复 --output')
    expect(() => parseEvaluationRunnerArgs(['--live', '--dry-run', '--output', '/tmp/run'], { backendRoot: '/repo/backend' }))
      .toThrow('--live 与 --dry-run 不能同时使用')
  })

  test('requires an explicit output directory before enabling live mode', () => {
    const parsed = parseEvaluationRunnerArgs(['--live', '--output', '/tmp/reffo-explicit-run'], {
      backendRoot: '/repo/backend',
    })
    expect(parsed.live).toBe(true)
    expect(parsed.dryRun).toBe(false)
    expect(parsed.outputWasExplicit).toBe(true)
  })

  test('uses exact mandatory canary, full-run and per-case limits', () => {
    expect(budgetProfileForCases([2])).toEqual({
      name: 'case_2_canary',
      runLimits: CASE_2_CANARY_LIMITS,
      caseLimits: CASE_2_CANARY_LIMITS,
    })
    expect(budgetProfileForCases([1, 2, 3, 4, 5, 6, 7, 8, 9])).toEqual({
      name: 'bounded_batch',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    })
    expect(budgetProfileForCases([3], 'full', 61)).toEqual({
      name: 'large_resume_single_case',
      runLimits: LARGE_RESUME_SINGLE_CASE_LIMITS,
      caseLimits: LARGE_RESUME_SINGLE_CASE_LIMITS,
    })
  })

  test('includes the full 19-call non-extraction worst case', () => {
    expect(v5CasePhysicalCallUpperBound(2)).toBe(23)
    expect(v5CasePhysicalCallUpperBound(9)).toBe(37)
    expect(() => v5CasePhysicalCallUpperBound(0)).toThrow('resumeChunks 必须是正安全整数')
  })

  test('accepts only the exact HTTPS DeepSeek host', () => {
    expect(assertStrictDeepSeekEndpoint(undefined)).toBe('https://api.deepseek.com')
    expect(assertStrictDeepSeekEndpoint('https://api.deepseek.com/')).toBe('https://api.deepseek.com')
    for (const unsafe of [
      'http://api.deepseek.com',
      'https://api.deepseek.com.evil.example',
      'https://user@api.deepseek.com',
      'https://api.deepseek.com:8443',
      'https://api.deepseek.com/v1',
      'https://api.deepseek.com/?proxy=true',
      'https://api.deepseek.com/#fragment',
    ]) {
      expect(() => assertStrictDeepSeekEndpoint(unsafe)).toThrow(EvaluationRunnerSafetyError)
    }
  })

  test('blocks cross-process replay when a completed case owned the same extraction', () => {
    const completedResumeDigests = new Set(['same-resume'])
    expect(() => assertResumeExtractionReplaySafe({
      resume: true,
      hasV5Checkpoint: false,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).toThrow(EvaluationRunnerSafetyError)
    expect(() => assertResumeExtractionReplaySafe({
      resume: true,
      hasV5Checkpoint: true,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).not.toThrow()
    expect(() => assertResumeExtractionReplaySafe({
      resume: false,
      hasV5Checkpoint: false,
      resumeDigest: 'same-resume',
      completedResumeDigests,
    })).not.toThrow()
  })
})

describe('evaluation runner output and checkpoint protection', () => {
  test('atomically locks one live writer and requires manual stale-lock handling', async () => {
    const path = resolve(await temporaryDirectory(), 'new-run')
    const first = await acquireEvaluationRunLock({ outputRoot: path, resume: false })
    await expect(acquireEvaluationRunLock({ outputRoot: path, resume: true })).rejects.toMatchObject({
      code: 'RUN_LOCK_HELD',
    })
    await first.release()
    const resumed = await acquireEvaluationRunLock({ outputRoot: path, resume: true })
    await resumed.release()
  })

  test('refuses a non-empty output directory unless resume is explicit', async () => {
    const path = await temporaryDirectory()
    await assertOutputDirectoryPolicy(path, false)
    await writeFile(resolve(path, 'existing.json'), '{}')
    await expect(assertOutputDirectoryPolicy(path, false)).rejects.toMatchObject({
      code: 'OUTPUT_DIRECTORY_NOT_EMPTY',
    })
    await expect(assertOutputDirectoryPolicy(path, true)).resolves.toBeUndefined()
  })

  test('round-trips a versioned atomic checkpoint and verifies every fingerprint', async () => {
    const path = resolve(await temporaryDirectory(), 'checkpoint.json')
    const expected = fingerprints()
    await writeCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { result: 'ok' },
    })
    const loaded = await readCheckpoint<{ result: string }>({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
    })
    expect(loaded?.payload).toEqual({ result: 'ok' })
    await expect(writeCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { result: 'replacement' },
    })).rejects.toMatchObject({ code: 'CHECKPOINT_ALREADY_EXISTS' })
    await expect(readCheckpoint({
      path,
      kind: 'v5_result',
      caseId: 'case-02',
      fingerprints: fingerprints({ implementationDigest: 'd'.repeat(64) }),
    })).rejects.toMatchObject({ code: 'CHECKPOINT_FINGERPRINT_MISMATCH' })
  })

  test('rejects legacy raw JSON, corrupt JSON and payload tampering', async () => {
    const directory = await temporaryDirectory()
    const expected = fingerprints()
    const read = (path: string) => readCheckpoint({
      path,
      kind: 'blind_ab',
      caseId: 'case-02',
      fingerprints: expected,
    })

    const legacyPath = resolve(directory, 'legacy.json')
    await writeFile(legacyPath, JSON.stringify({ forward: {}, reverse: {} }))
    await expect(read(legacyPath)).rejects.toMatchObject({ code: 'CHECKPOINT_LEGACY_OR_INVALID' })

    const corruptPath = resolve(directory, 'corrupt.json')
    await writeFile(corruptPath, '{broken')
    await expect(read(corruptPath)).rejects.toMatchObject({ code: 'CHECKPOINT_CORRUPT' })

    const tamperedPath = resolve(directory, 'tampered.json')
    await writeCheckpoint({
      path: tamperedPath,
      kind: 'blind_ab',
      caseId: 'case-02',
      fingerprints: expected,
      payload: { ok: true },
    })
    const envelope = JSON.parse(await readFile(tamperedPath, 'utf8'))
    envelope.payload.ok = false
    await writeFile(tamperedPath, JSON.stringify(envelope))
    await expect(read(tamperedPath)).rejects.toMatchObject({ code: 'CHECKPOINT_PAYLOAD_DIGEST_MISMATCH' })
  })
})

describe('BudgetedEvaluationProvider', () => {
  test('reserves before the one direct attempt and propagates a shared abort signal', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let calls = 0
    const directProvider: LlmProvider = {
      complete: async input => {
        calls += 1
        expect(budget.snapshot().run.usage.physicalAttempts).toBe(1)
        expect(input.maxProviderAttempts).toBe(1)
        expect(input.model).toBe('deepseek-chat')
        expect(input.signal).toBeInstanceOf(AbortSignal)
        return {
          provider: 'deepseek',
          model: 'deepseek-chat',
          content: '{}',
          latencyMs: 12,
          inputTokens: 20,
          outputTokens: 5,
        }
      },
    }
    const provider = new BudgetedEvaluationProvider({
      directProvider,
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).resolves.toMatchObject({ content: '{}' })
    expect(calls).toBe(1)
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 1,
      settledInputTokens: 20,
      settledOutputTokens: 5,
    })
    expect(usage).toHaveLength(1)
    expect(usage[0]).toMatchObject({ outcome: 'success', caseId: 'case-02', finishReason: null })
    budget.dispose()
  })

  test('counts a failed physical attempt, aborts the run and never retries it', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-failure-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let calls = 0
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          calls += 1
          throw new Error('provider failed')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).rejects.toThrow('provider failed')
    expect(calls).toBe(1)
    expect(budget.aborted).toBe(true)
    expect(budget.snapshot().run.usage).toMatchObject({ physicalAttempts: 1, failedAttempts: 1 })
    expect(usage).toHaveLength(1)
    expect(usage[0].outcome).toBe('failure')
    budget.dispose()
  })

  test('settles an in-flight failure even when another fail-fast condition already aborted the budget', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-concurrent-abort-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          try {
            await budget.failFast(new Error('another branch failed'), 'case-02')
          } catch {
            // Simulates a shared abort arriving while this physical call is in flight.
          }
          throw new Error('in-flight request observed abort')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async entry => { usage.push(entry) },
    })

    await expect(provider.complete(request())).rejects.toThrow('in-flight request observed abort')
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 1,
      settledAttempts: 1,
      failedAttempts: 1,
      pendingInputTokens: 0,
      pendingOutputTokens: 0,
    })
    expect(budget.snapshot().terminal?.kind).toBe('external_failure')
    expect(usage[0].outcome).toBe('failure')
    budget.dispose()
  })

  test('drains every concurrently aborted physical call before final accounting', async () => {
    const usage: EvaluationUsageEntry[] = []
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-drain-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    let invocation = 0
    let releaseSecond!: () => void
    const secondMayFinish = new Promise<void>(resolve => { releaseSecond = resolve })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async (): Promise<ChatCompletionResult> => {
          invocation += 1
          if (invocation === 1) throw new Error('first branch failed')
          await secondMayFinish
          throw new Error('second branch observed shared abort')
        },
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async entry => { usage.push(entry) },
    })

    const first = provider.complete(request({ promptVersion: '5.0.0-p12-a' }))
    const second = provider.complete(request({ promptVersion: '5.0.0-p12-b' }))
    await expect(first).rejects.toThrow('first branch failed')
    expect(budget.snapshot().run.usage.pendingInputTokens).toBeGreaterThan(0)
    let drained = false
    const draining = provider.drain().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    releaseSecond()
    await expect(second).rejects.toThrow('second branch observed shared abort')
    await draining
    expect(budget.snapshot().run.usage).toMatchObject({
      physicalAttempts: 2,
      settledAttempts: 2,
      failedAttempts: 2,
      pendingInputTokens: 0,
      pendingOutputTokens: 0,
    })
    expect(usage).toHaveLength(2)
    budget.dispose()
  })

  test('blocks an unexpected model before reserving any call', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-model-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: { complete: async () => { throw new Error('must not run') } },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async () => {},
    })

    await expect(provider.complete(request({ model: 'fallback-model' }))).rejects.toMatchObject({
      code: 'MODEL_OVERRIDE_BLOCKED',
    })
    expect(budget.snapshot().run.usage.physicalAttempts).toBe(0)
    budget.dispose()
  })

  test('rejects a response from anything other than the direct DeepSeek provider', async () => {
    const budget = await EvaluationBudgetController.create({
      runId: 'runner-provider-identity-test',
      runLimits: FULL_RUN_LIMITS,
      caseLimits: FULL_CASE_LIMITS,
    }, { enableWallClockTimer: false })
    const provider = new BudgetedEvaluationProvider({
      directProvider: {
        complete: async () => ({
          provider: 'fallback',
          model: 'fallback-model',
          content: '{}',
          latencyMs: 1,
        }),
      },
      budget,
      caseId: 'case-02',
      model: 'deepseek-chat',
      usageSink: async () => {},
    })

    await expect(provider.complete(request())).rejects.toThrow('只接受 DeepSeek provider 响应')
    expect(budget.snapshot().run.usage).toMatchObject({ physicalAttempts: 1, failedAttempts: 1 })
    expect(budget.aborted).toBe(true)
    budget.dispose()
  })
})
