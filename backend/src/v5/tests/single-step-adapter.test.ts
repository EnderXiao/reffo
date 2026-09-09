import { expect, test } from 'bun:test'
import { V5CheckpointRepository, V5CheckpointError } from '@/repositories/v5-checkpoint-repository'
import { V5SingleStepAdapter } from '@/v5/single-step-adapter'
import { createSingleStepFixture } from './single-step-fixtures'
import { MemoryCheckpointStorage } from './checkpoint-storage-fixture'
import { FIXTURE_RESUME, FIXTURE_JD } from './fixtures'

test('legacy-shaped single requests run V5 only, preserve context across instances and cache successful generation', async () => {
  const storage = new MemoryCheckpointStorage()
  const {createWorkflow, versions} = createSingleStepFixture()
  const adapter = () => new V5SingleStepAdapter(new V5CheckpointRepository('fixture', storage), createWorkflow)
  const analysis = await adapter().analyze(FIXTURE_RESUME, 'user1')
  expect(analysis.data.structured_resume._v5_context).toMatch(/^[a-f0-9]{64}$/)
  expect(JSON.stringify(analysis.data)).not.toContain('resumeEvidenceBundle')
  await expect(adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user2')).rejects.toBeInstanceOf(V5CheckpointError)
  await expect(adapter().match({...analysis.data.structured_resume, personal_info: {name: '伪造'}}, FIXTURE_JD, 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  expect(versions).toHaveLength(1)

  const matching = await adapter().match(analysis.data.structured_resume, FIXTURE_JD, 'user1')
  expect(versions).toHaveLength(3)
  expect(matching.data.match_score).toBeGreaterThanOrEqual(0)
  expect(matching.data.match_score).toBeLessThanOrEqual(100)
  // 前端的匹配标准化会重建外层对象，但原样保留 jd_structure。
  const normalized = {match_score: 999, jd_structure: JSON.parse(JSON.stringify(matching.data.jd_structure))}
  const generated = await adapter().generate(analysis.data.structured_resume, normalized, 'user1')
  expect(versions).toHaveLength(4)
  expect(generated.data.optimized_resume).toContain('产品迭代')
  expect(await adapter().generate(analysis.data.structured_resume, normalized, 'user1')).toEqual(generated)
  expect(versions).toHaveLength(4)

  await expect(adapter().interview(analysis.data, normalized, '伪造的成品', 'user1')).rejects.toBeInstanceOf(V5CheckpointError)
  const interview = await adapter().interview(analysis.data, normalized, generated.data.optimized_resume, 'user1')
  expect(versions).toHaveLength(5)
  expect(versions[4]).toContain('-p10-')
  expect(interview.data.questions).toHaveLength(4)
  expect(interview.data.story_recommendations).toHaveLength(1)
  expect(interview.data.follow_up_questions).toHaveLength(3)
  expect(await adapter().interview(analysis.data, normalized, generated.data.optimized_resume, 'user1')).toEqual(interview)
  expect(versions).toHaveLength(5)
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
