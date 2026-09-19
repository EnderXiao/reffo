import { expect, test } from 'bun:test'
import { V5AnalysisCacheRepository } from '@/repositories/v5-analysis-cache-repository'
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
