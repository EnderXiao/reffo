import { expect, spyOn, test } from 'bun:test'
import { getV5AnalysisCacheHealth, V5AnalysisCacheRepository } from '@/repositories/v5-analysis-cache-repository'
import { MemoryAnalysisCacheStorage } from './analysis-cache-storage-fixture'

const input = {
  cacheKey: 'same-analysis',
  owner: 'user1',
  fingerprint: 'release1',
  pollIntervalMs: 5,
}

test('coalesces concurrent analysis across repository instances and serves the persisted result later', async () => {
  const storage = new MemoryAnalysisCacheStorage()
  const firstRepository = new V5AnalysisCacheRepository(storage)
  const secondRepository = new V5AnalysisCacheRepository(storage)
  let computeCalls = 0
  let release: (() => void) | undefined
  const blocked = new Promise<void>(resolve => { release = resolve })
  const compute = async () => {
    computeCalls += 1
    await blocked
    return {analysis: 'result'}
  }

  const first = firstRepository.resolve<{analysis: string}>({...input, compute})
  const second = secondRepository.resolve<{analysis: string}>({...input, compute: async () => {
    throw new Error('duplicate model call')
  }})
  await Promise.resolve()
  release?.()

  expect(await first).toEqual({value: {analysis: 'result'}, cacheStatus: 'miss'})
  expect(await second).toEqual({value: {analysis: 'result'}, cacheStatus: 'hit'})
  expect(computeCalls).toBe(1)

  const cached = await new V5AnalysisCacheRepository(storage).resolve<{analysis: string}>({
    ...input,
    compute: async () => { throw new Error('cache miss') },
  })
  expect(cached).toEqual({value: {analysis: 'result'}, cacheStatus: 'hit'})
  expect(computeCalls).toBe(1)
  expect([...storage.rows.values()][0]?.hit_count).toBe(2)
})

test('clears the failed lease so the next request can retry', async () => {
  const storage = new MemoryAnalysisCacheStorage()
  const repository = new V5AnalysisCacheRepository(storage)
  await expect(repository.resolve({...input, compute: async () => {
    throw new Error('model failed')
  }})).rejects.toThrow('model failed')
  expect(storage.rows.size).toBe(0)

  const result = await repository.resolve({...input, compute: async () => 'recovered'})
  expect(result).toEqual({value: 'recovered', cacheStatus: 'miss'})
})

test('falls back to direct analysis when cache coordination is unavailable', async () => {
  class ClaimUnavailableStorage extends MemoryAnalysisCacheStorage {
    async claim(): Promise<never> {
      throw new Error('cache table missing')
    }
  }
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let computeCalls = 0
  try {
    const result = await new V5AnalysisCacheRepository(new ClaimUnavailableStorage()).resolve({
      ...input,
      compute: async () => {
        computeCalls += 1
        return {analysis: 'direct'}
      },
    })
    expect(result).toEqual({value: {analysis: 'direct'}, cacheStatus: 'disabled'})
    expect(computeCalls).toBe(1)
    expect(JSON.stringify(log.mock.calls)).toContain('V5_ANALYSIS_CACHE_UNAVAILABLE')
  } finally {
    log.mockRestore()
  }
})

test('returns a computed result without recompute when cache completion fails', async () => {
  class CompletionUnavailableStorage extends MemoryAnalysisCacheStorage {
    async complete(): Promise<void> {
      throw new Error('cache completion unavailable')
    }
  }
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let computeCalls = 0
  try {
    const result = await new V5AnalysisCacheRepository(new CompletionUnavailableStorage()).resolve({
      ...input,
      compute: async () => {
        computeCalls += 1
        return 'computed'
      },
    })
    expect(result).toEqual({value: 'computed', cacheStatus: 'disabled'})
    expect(computeCalls).toBe(1)
  } finally {
    log.mockRestore()
  }
})

test('does not replace compute failures with cache fallback', async () => {
  class ClaimUnavailableStorage extends MemoryAnalysisCacheStorage {
    async claim(): Promise<never> {
      throw new Error('cache table missing')
    }
  }
  const log = spyOn(console, 'error').mockImplementation(() => {})
  let computeCalls = 0
  try {
    await expect(new V5AnalysisCacheRepository(new ClaimUnavailableStorage()).resolve({
      ...input,
      compute: async () => {
        computeCalls += 1
        throw new Error('model failed')
      },
    })).rejects.toThrow('model failed')
    expect(computeCalls).toBe(1)
  } finally {
    log.mockRestore()
  }
})

test('reports analysis cache dependency health without exposing provider details', async () => {
  class HealthUnavailableStorage extends MemoryAnalysisCacheStorage {
    async health(): Promise<void> {
      throw new Error('private provider detail')
    }
  }
  expect(await getV5AnalysisCacheHealth(new HealthUnavailableStorage())).toEqual({
    status: 'degraded',
    errorCode: 'V5_ANALYSIS_CACHE_UNAVAILABLE',
  })
})
