import { expect, spyOn, test } from 'bun:test'
import { V5CheckpointRepository, V5CheckpointError } from '@/repositories/v5-checkpoint-repository'
import { analysisCacheKeyFor, sessionStepTimeoutMs, V5SessionBudgetError, V5SingleStepAdapter } from '@/v5/single-step-adapter'
import { createSingleStepFixture } from './single-step-fixtures'
import { MemoryCheckpointStorage } from './checkpoint-storage-fixture'
import { MemoryAnalysisCacheStorage } from './analysis-cache-storage-fixture'
import { V5AnalysisCacheRepository } from '@/repositories/v5-analysis-cache-repository'
import { FIXTURE_RESUME, FIXTURE_JD } from './fixtures'

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]))
}

class JsonbReorderingAnalysisCacheStorage extends MemoryAnalysisCacheStorage {
  async complete(input: Parameters<MemoryAnalysisCacheStorage['complete']>[0]) {
    await super.complete({...input, payload: reverseObjectKeys(input.payload)})
  }
}

test('legacy-shaped single requests run V5 only, preserve context across instances and cache successful generation', async () => {
  const storage = new MemoryCheckpointStorage()
  const analysisCacheStorage = new JsonbReorderingAnalysisCacheStorage()
  const {createWorkflow, versions} = createSingleStepFixture()
  const adapter = () => new V5SingleStepAdapter(
    new V5CheckpointRepository('fixture', storage),
    createWorkflow,
    new V5AnalysisCacheRepository(analysisCacheStorage),
  )
  let cacheMissChecks = 0
  const analysis = await adapter().analyze(FIXTURE_RESUME, 'user1', {
    onCacheMiss: async () => { cacheMissChecks += 1 },
  })
  expect(analysis.data.structured_resume._v5_context).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(analysis.data)).not.toContain('resumeEvidenceBundle')
  await expect(adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user2')).rejects.toBeInstanceOf(V5CheckpointError)
  await expect(adapter().match({...analysis.data.structured_resume, personal_info: {name: '伪造'}}, FIXTURE_JD, 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  expect(versions).toHaveLength(1)
  const cacheMiss = analysis.cache.status
  const cachedAnalysis = await adapter().analyze(FIXTURE_RESUME, 'user1', {
    onCacheMiss: async () => { throw new Error('cache hit invoked quota check') },
  })
  expect(cacheMiss).toBe('miss')
  expect(cacheMissChecks).toBe(1)
  expect(cachedAnalysis.cache.status).toBe('hit')
  expect(cachedAnalysis.data.structured_resume._v5_context).toMatch(/^[a-f0-9]{64}$/)
  expect(cachedAnalysis.data.structured_resume._v5_context).not.toBe(analysis.data.structured_resume._v5_context)
  expect(JSON.stringify([...analysisCacheStorage.rows.values()][0]?.payload)).not.toContain('_v5_context')
  expect(versions).toHaveLength(1)

  const matching = await adapter().match(cachedAnalysis.data.structured_resume, FIXTURE_JD, 'user1')
  expect(versions).toHaveLength(3)
  expect(matching.data.match_score).toBeGreaterThanOrEqual(0)
  expect(matching.data.match_score).toBeLessThanOrEqual(100)
  // 前端的匹配标准化会重建外层对象，但原样保留 jd_structure。
  const normalized = {match_score: 999, jd_structure: JSON.parse(JSON.stringify(matching.data.jd_structure))}
  const generated = await adapter().generate(cachedAnalysis.data.structured_resume, normalized, 'user1')
  expect(versions).toHaveLength(4)
  expect(generated.data.optimized_resume).toContain('产品迭代')
  expect(await adapter().generate(cachedAnalysis.data.structured_resume, normalized, 'user1')).toEqual(generated)
  expect(versions).toHaveLength(4)

  await expect(adapter().interview(cachedAnalysis.data, normalized, '伪造的成品', 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  const interview = await adapter().interview(cachedAnalysis.data, normalized, generated.data.optimized_resume, 'user1')
  expect(versions).toHaveLength(5)
  expect(versions[4]).toContain('-p10-')
  expect(interview.data.questions).toHaveLength(4)
  expect(interview.data.story_recommendations).toHaveLength(1)
  expect(interview.data.follow_up_questions).toHaveLength(3)
  expect(await adapter().interview(cachedAnalysis.data, normalized, generated.data.optimized_resume, 'user1')).toEqual(interview)
  expect(versions).toHaveLength(5)
})

test('analysis cache keys isolate users, resume content and release configuration', () => {
  const base = analysisCacheKeyFor(FIXTURE_RESUME, 'user1')
  expect(analysisCacheKeyFor(FIXTURE_RESUME, 'user1')).toBe(base)
  expect(analysisCacheKeyFor(`${FIXTURE_RESUME}\n\n新增项目经历`, 'user1')).not.toBe(base)
  expect(analysisCacheKeyFor(FIXTURE_RESUME, 'user2')).not.toBe(base)
})

test('analysis continues with a fresh checkpoint when persistent cache is unavailable', async () => {
  class CacheUnavailableStorage extends MemoryAnalysisCacheStorage {
    async claim(): Promise<never> {
      throw new Error('v5_analysis_cache missing')
    }
  }
  const log = spyOn(console, 'error').mockImplementation(() => {})
  const checkpointStorage = new MemoryCheckpointStorage()
  const {createWorkflow, versions} = createSingleStepFixture()
  const adapter = new V5SingleStepAdapter(
    new V5CheckpointRepository('fixture', checkpointStorage),
    createWorkflow,
    new V5AnalysisCacheRepository(new CacheUnavailableStorage()),
  )
  let cacheMissChecks = 0
  try {
    const analysis = await adapter.analyze(FIXTURE_RESUME, 'user1', {
      onCacheMiss: async () => { cacheMissChecks += 1 },
    })
    expect(analysis.cache.status).toBe('disabled')
    expect(cacheMissChecks).toBe(1)
    expect(versions).toHaveLength(1)
    expect(analysis.data.structured_resume._v5_context).toMatch(/^[a-f0-9]{64}$/)
    expect(checkpointStorage.rows.size).toBe(1)
  } finally {
    log.mockRestore()
  }
})

test('checkpoint tokens reject expired, unknown and different-release state', async () => {
  const storage = new MemoryCheckpointStorage()
  const repo = new V5CheckpointRepository('release1', storage)
  const token = await repo.save('user1', {kind: 'test'})
  expect((await repo.load(token, 'user1')).payload).toEqual({kind: 'test'})
  await expect(new V5CheckpointRepository('release2', storage).load(token, 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  await expect(repo.load('invalid', 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  await expect(repo.load('0'.repeat(64), 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  const row = storage.rows.values().next().value!
  row.expires_at = '2000-01-01T00:00:00.000Z'
  await expect(repo.load(token, 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  await storage.cleanup()
  expect(storage.rows.size).toBe(0)
})

test('session budget cap applies only when the remaining session time is tighter', () => {
  expect(sessionStepTimeoutMs(undefined, 180000)).toBe(180000)
  expect(sessionStepTimeoutMs({deadlineMs: Date.now() + 300000, totalMs: 480000}, 180000)).toBe(180000)
  expect(sessionStepTimeoutMs({deadlineMs: Date.now() + 50000, totalMs: 480000}, 180000)).toBeLessThanOrEqual(50000)
  expect(sessionStepTimeoutMs({deadlineMs: Date.now() + 50000, totalMs: 480000}, 180000)).toBeGreaterThan(40000)
  expect(() => sessionStepTimeoutMs({deadlineMs: Date.now() - 1, totalMs: 480000}, 180000)).toThrow(V5SessionBudgetError)
})

test('session budget flows through steps and response meta carries the shared run chain', async () => {
  const storage = new MemoryCheckpointStorage()
  const {createWorkflow} = createSingleStepFixture()
  const adapter = () => new V5SingleStepAdapter(
    new V5CheckpointRepository('fixture', storage),
    createWorkflow,
    new V5AnalysisCacheRepository(new MemoryAnalysisCacheStorage()),
  )
  const analysis = await adapter().analyze(FIXTURE_RESUME, 'user1')
  expect(analysis.remainingBudgetMs).toBeGreaterThan(0)

  const matching = await adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user1')
  expect(matching.remainingBudgetMs).toBeGreaterThan(0)
  expect(matching.parentRunId).toBe(analysis.runId)

  const normalized = {match_score: 999, jd_structure: JSON.parse(JSON.stringify(matching.data.jd_structure))}
  const generated = await adapter().generate(analysis.data.structured_resume, normalized, 'user1')
  expect(generated.remainingBudgetMs).toBeGreaterThan(0)
  expect(generated.parentRunId).toBe(matching.runId)

  const interview = await adapter().interview(analysis.data, normalized, generated.data.optimized_resume, 'user1')
  expect(interview.remainingBudgetMs).toBeGreaterThan(0)
  expect(interview.parentRunId).toBe(generated.runId)
})

test('expired session budget fails fast while legacy checkpoints keep per-step caps', async () => {
  const storage = new MemoryCheckpointStorage()
  const {createWorkflow} = createSingleStepFixture()
  const adapter = () => new V5SingleStepAdapter(
    new V5CheckpointRepository('fixture', storage),
    createWorkflow,
    new V5AnalysisCacheRepository(new MemoryAnalysisCacheStorage()),
  )
  const analysis = await adapter().analyze(FIXTURE_RESUME, 'user1')

  // 预算到期：/match 应在任何 provider 调用前快速失败
  const expiredRow = [...storage.rows.values()][0]!
  expiredRow.payload = {...(expiredRow.payload as Record<string, unknown>), budget: {deadlineMs: Date.now() - 1000, totalMs: 480000}}
  await expect(adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user1')).rejects.toBeInstanceOf(V5SessionBudgetError)

  // 旧检查点没有 budget 字段：按独立上限继续跑
  const legacyRow = [...storage.rows.values()][0]!
  const legacyPayload = legacyRow.payload as Record<string, unknown>
  delete legacyPayload.budget
  const legacy = await adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user1')
  expect(legacy.remainingBudgetMs).toBeUndefined()
})

test('cached generation and interview stay available after the session budget expires', async () => {
  const storage = new MemoryCheckpointStorage()
  const {createWorkflow} = createSingleStepFixture()
  const adapter = () => new V5SingleStepAdapter(
    new V5CheckpointRepository('fixture', storage),
    createWorkflow,
    new V5AnalysisCacheRepository(new MemoryAnalysisCacheStorage()),
  )
  const analysis = await adapter().analyze(FIXTURE_RESUME, 'user1')
  const matching = await adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user1')
  const normalized = {match_score: 999, jd_structure: JSON.parse(JSON.stringify(matching.data.jd_structure))}
  const generated = await adapter().generate(analysis.data.structured_resume, normalized, 'user1')
  const interview = await adapter().interview(analysis.data, normalized, generated.data.optimized_resume, 'user1')

  // 会话预算过期后，已缓存的生成结果与面试建议仍可幂等读取，不再消耗模型预算
  const matchingRow = [...storage.rows.values()].find(row => (row.payload as Record<string, unknown>).kind === 'matching')!
  matchingRow.payload = {...(matchingRow.payload as Record<string, unknown>), budget: {deadlineMs: Date.now() - 1000, totalMs: 480000}}
  expect(await adapter().generate(analysis.data.structured_resume, normalized, 'user1')).toEqual(generated)
  expect(await adapter().interview(analysis.data, normalized, generated.data.optimized_resume, 'user1')).toEqual(interview)
})
