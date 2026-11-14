import {describe, expect, test} from 'bun:test'
import type {GenerationJob, GenerationJobPayload} from '@/types/generation-job'
import {assertGenerationJobVersion, generationJobRetryChanges, GenerationJobVersionError} from './generation-job-version'
import {GenerationJobWorker} from './generation-jobs'
import type {v5SingleStepAdapter} from '@/v5/single-step-adapter'
import type {ResumeHistoryRecord} from '@/types'
import {V5WorkflowBlockedError} from '@/v5/errors'
import {writingIssue} from '@/v5/writing/facts'

const fingerprint = 'completion-v1-test'
const now = '2026-11-10T00:00:00.000Z'
const analysis = {structured_resume: {personal_info: {name: '示例候选人'}}, quality_score: 70} as NonNullable<GenerationJobPayload['analysis']>

function makeJob(overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {id: '00000000-0000-4000-8000-000000000001', user_id: 'test-user', status: 'running', stage: 'analysis',
    background: false, read_at: null, confirmed_at: null, history_id: null, error: null,
    created_at: now, updated_at: now, lease_token: 'test-lease', lease_expires_at: now, quota_charged: false,
    payload: {input: {resume_markdown: '测试源简历', jd_text: '测试目标岗位', company: '示例公司', position: '产品经理', location: ''}},
    ...overrides}
}

function workerHarness(initial: GenerationJob, options: {existingHistory?: ResumeHistoryRecord; matchingError?: Error} = {}) {
  let current = structuredClone(initial)
  const calls = {model: 0, quota: [] as boolean[], historySave: 0}
  const repository: ConstructorParameters<typeof GenerationJobWorker>[0] = {
    renew: async () => current,
    claim: async () => null,
    patch: async (_user, _id, changes, guard) => {
      if (guard?.lease && guard.lease !== current.lease_token) return null
      current = {...current, ...structuredClone(changes)}
      return current
    },
    quota: async (_job, consume) => {calls.quota.push(consume)},
  }
  const adapter: ConstructorParameters<typeof GenerationJobWorker>[1] = {
    analyze: async (_source, _owner, request) => {
      calls.model++
      await request?.onCacheMiss?.()
      return {runId: 'test', data: analysis, steps: [], cache: {status: 'miss'}} as Awaited<ReturnType<typeof v5SingleStepAdapter.analyze>>
    },
    match: async () => {calls.model++; throw options.matchingError ?? new Error('test stops after analysis')},
    generate: async () => {calls.model++; throw new Error('unexpected generation')},
    interview: async () => {calls.model++; throw new Error('unexpected interview')},
  }
  const histories: ConstructorParameters<typeof GenerationJobWorker>[2] = {
    findById: async () => options.existingHistory ?? null,
    save: async () => {calls.historySave++; throw new Error('unexpected history overwrite')},
  }
  return {worker: new GenerationJobWorker(repository, adapter, histories, () => fingerprint),
    getJob: () => current, calls}
}

describe('生成版本与显式重试', () => {
  test('旧的部分结果不能混入新版本，纯输入可以执行', () => {
    const job = makeJob()
    expect(() => assertGenerationJobVersion(job.payload, fingerprint)).not.toThrow()
    expect(() => assertGenerationJobVersion({...job.payload, analysis}, fingerprint)).toThrow(GenerationJobVersionError)
    expect(() => assertGenerationJobVersion({...job.payload, analysis, releaseFingerprint: fingerprint}, fingerprint)).not.toThrow()
  })

  test('显式重试清除失配中间结果，保留任务身份与已扣次数', () => {
    const job = makeJob({status: 'failed', quota_charged: true})
    job.payload = {...job.payload, analysis, releaseFingerprint: 'old'}
    const next = {...job, ...generationJobRetryChanges(job, fingerprint, now)}
    expect(next.id).toBe(job.id)
    expect(next.user_id).toBe(job.user_id)
    expect(next.quota_charged).toBe(true)
    expect(next.payload).toEqual({input: job.payload.input, releaseFingerprint: fingerprint})
    expect(next.stage).toBe('analysis')
    expect(job.payload.analysis).toBe(analysis)
  })

  test('相同版本重试保留可用检查点', () => {
    const job = makeJob({status: 'failed', stage: 'matching'})
    job.payload = {...job.payload, analysis, releaseFingerprint: fingerprint}
    const changes = generationJobRetryChanges(job, fingerprint, now)
    expect(changes).not.toHaveProperty('payload')
    expect(changes).not.toHaveProperty('stage')
  })

  test('重试清理上次失败诊断并保留同版本已完成阶段', () => {
    const job = makeJob({status: 'failed', stage: 'matching'})
    job.payload = {...job.payload, analysis, releaseFingerprint: fingerprint,
      failure: {code: 'P03_VALIDATION_FAILED', stage: 'matching', runId: 'failed-run', issueCodes: [],
        retryable: false, action: 'inspect_stage_validation', occurredAt: now}}
    const changes = generationJobRetryChanges(job, fingerprint, now)
    expect(changes.payload?.analysis).toBe(analysis)
    expect(changes.payload).not.toHaveProperty('failure')
    expect(job.payload.failure?.runId).toBe('failed-run')
    expect(changes.error).toBeNull()
  })

  test('带阶段指纹的重试清除旧诊断，并仅丢弃失配阶段后的检查点', async () => {
    const {currentGenerationStageFingerprints} = await import('./generation-job-version')
    const job = makeJob({status: 'failed', stage: 'matching'})
    job.payload = {...job.payload, analysis, releaseFingerprint: fingerprint,
      stageFingerprints: currentGenerationStageFingerprints(),
      failure: {code: 'P03_VALIDATION_FAILED', stage: 'matching', issueCodes: [],
        retryable: false, action: 'inspect_stage_validation', occurredAt: now}}
    for (const incompatibleMatching of [false, true]) {
      if (incompatibleMatching) {
        job.payload.matching = {} as NonNullable<GenerationJobPayload['matching']>
        job.payload.stageFingerprints!.matching = 'incompatible-release'
      }
      const changes = generationJobRetryChanges(job, fingerprint, now)
      expect(changes.payload?.analysis).toBe(analysis)
      expect(changes.payload).not.toHaveProperty('failure')
      if (incompatibleMatching) {
        expect(changes.payload).not.toHaveProperty('matching')
        expect(changes.stage).toBe('matching')
      }
    }
  })

  test('已完成阶段的旧版本只需保存，可继续完成', () => {
    const job = makeJob()
    job.payload = {...job.payload, analysis,
      matching: {} as NonNullable<GenerationJobPayload['matching']>,
      optimized: {optimized_resume: '已生成正文'} as NonNullable<GenerationJobPayload['optimized']>,
      interview: {} as NonNullable<GenerationJobPayload['interview']>}
    expect(() => assertGenerationJobVersion(job.payload, fingerprint)).not.toThrow()
    expect(generationJobRetryChanges(job, fingerprint, now)).not.toHaveProperty('payload')
  })

  test('worker 对旧部分结果明确失败且不调用模型', async () => {
    const job = makeJob()
    job.payload = {...job.payload, analysis, releaseFingerprint: 'old'}
    const harness = workerHarness(job)
    await harness.worker.execute(job)
    expect(harness.calls.model).toBe(0)
    expect(harness.getJob().status).toBe('failed')
    expect(harness.getJob().error).toContain('生成服务已更新')
  })

  test('已扣次数的跨版本重试不再次校验或消费配额', async () => {
    const job = makeJob({quota_charged: true})
    const harness = workerHarness(job)
    await harness.worker.execute(job)
    expect(harness.calls.quota).toEqual([])
    expect(harness.getJob().quota_charged).toBe(true)
    expect(harness.getJob().payload.releaseFingerprint).toBe(fingerprint)
    expect(harness.getJob().payload.analysis).toEqual(analysis)
  })

  test('新任务分析缺少缓存时仅消费一次并持久化标记', async () => {
    const job = makeJob()
    const harness = workerHarness(job)
    await harness.worker.execute(job)
    expect(harness.calls.quota).toEqual([false, true])
    expect(harness.getJob().quota_charged).toBe(true)
  })

  test('历史已保存但任务未确认时复用记录，不覆盖人工编辑', async () => {
    const job = makeJob({stage: 'saving'})
    job.payload.failure = {code: 'GENERATION_FAILED', stage: 'saving', issueCodes: [], retryable: false,
      action: 'inspect_harness_events', occurredAt: now}
    const existing = {id: `JD-${job.id}`, optimized_content: '用户后来填写的正文'} as ResumeHistoryRecord
    const harness = workerHarness(job, {existingHistory: existing})
    await harness.worker.execute(job)
    expect(harness.calls.model).toBe(0)
    expect(harness.calls.historySave).toBe(0)
    expect(harness.getJob().status).toBe('completed')
    expect(harness.getJob().history_id).toBe(existing.id)
    expect(harness.getJob().payload).not.toHaveProperty('failure')
  })

  test('匹配失败保留检查点、失败运行编号与错误类别，不保存模型原文或建议盲目重试', async () => {
    const job = makeJob({stage: 'matching', quota_charged: true})
    job.payload = {...job.payload, analysis, releaseFingerprint: fingerprint}
    const error = new V5WorkflowBlockedError({code: 'P03_VALIDATION_FAILED', state: 'blocked_fact_validation',
      message: '不能保存的原始简历或模型草稿', issues: [writingIssue('JOB_FIT_INVENTED_SPECIALTY_GATE',
        'private-evidence', ['sensitive-evidence'], '敏感来源细节')]})
    error.runId = 'b607d80f-f055-473f-b058-15ae58d60d14'
    const harness = workerHarness(job, {matchingError: error})
    await harness.worker.execute(job)
    const failed = harness.getJob()
    expect(failed.status).toBe('failed')
    expect(failed.stage).toBe('matching')
    expect(failed.payload.analysis).toEqual(analysis)
    expect(failed.payload.failure).toMatchObject({code: 'P03_VALIDATION_FAILED', stage: 'matching', runId: error.runId,
      issueCodes: ['JOB_FIT_INVENTED_SPECIALTY_GATE'], retryable: false, action: 'inspect_stage_validation'})
    expect(JSON.stringify(failed.payload.failure)).not.toContain('敏感')
    expect(JSON.stringify(failed.payload.failure)).not.toContain('private-evidence')
    expect(failed.error).toContain('岗位分析结果未通过')
    expect(failed.error).not.toContain('请重试')
    expect(harness.calls.model).toBe(1)
    expect(harness.calls.quota).toEqual([])
  })
})
