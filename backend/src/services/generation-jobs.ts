import {generationJobRepository, type GenerationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {v5SingleStepAdapter} from '@/v5/single-step-adapter'
import {V5WorkflowBlockedError} from '@/v5/errors'
import {ResumeQuotaError} from './resume-quota'
import {summarizeGenerationJob, type GenerationJob} from '@/types/generation-job'
import type {ResumeHistoryRepositoryContract} from '@/repositories/interfaces'
import {publishGenerationJobUpdate} from '@/services/generation-job-events'
import type {ResultSessionProgressRecord, SaveResumeHistoryInput} from '@/types'

export function generationJobProgress(job: GenerationJob, failed = false): ResultSessionProgressRecord {
  const stages = ['analysis', 'matching', 'optimized', 'interview'] as const
  const currentIndex = stages.indexOf(job.stage as typeof stages[number])
  const payload = {
    analysis: job.payload.analysis,
    matching: job.payload.matching,
    optimized: job.payload.optimized,
    interview: job.payload.interview,
  }

  return stages.reduce<Record<typeof stages[number], ResultSessionProgressRecord['analysis']>>((progress, stage, index) => {
    progress[stage] = payload[stage]
      ? 'done'
      : failed && index === currentIndex
        ? 'failed'
        : index <= currentIndex
          ? 'generating'
          : 'pending'
    return progress
  }, {
    analysis: 'pending',
    matching: 'pending',
    optimized: 'pending',
    interview: 'pending',
  }) as ResultSessionProgressRecord
}

export function jobHistory(
  job: GenerationJob,
  progress: ResultSessionProgressRecord = generationJobProgress(job),
): SaveResumeHistoryInput {
  const {input, analysis, matching, optimized, interview} = job.payload
  if (!analysis) throw new Error('简历分析结果不存在')
  const summary = summarizeGenerationJob(job)
  const context = {company: summary.company, position: summary.position, location: summary.location,
    resumeContent: input.resume_markdown, jdContent: input.jd_text}
  const normalizedMatching = matching ? {...matching,
    hard_requirements_match: Object.entries(matching.hard_requirements_match ?? {}).map(([requirement, matched]) => ({requirement, matched})),
    skill_match: {...matching.skill_match, matched_skills: matching.skill_match.matched ?? [],
      missing_skills: matching.skill_match.missing ?? [], match_percentage: matching.match_score},
    experience_match: {years_required: 0, years_actual: 0, match_percentage: 0,
      relevant_experience: matching.experience_match ? [matching.experience_match] : []},
  } : undefined
  return {
    id: `JD-${job.id}`, company: summary.company, position: summary.position,
    name: analysis.structured_resume.personal_info.name || '候选人', created_at: job.created_at,
    quality_score: analysis.quality_score, match_score: matching?.match_score ?? 0,
    tags: (matching?.skill_match.matched ?? []).slice(0, 3), resume_content: input.resume_markdown,
    jd_content: input.jd_text, optimized_content: optimized?.optimized_resume ?? '',
    optimization_suggestions: matching?.optimization_suggestions ?? [], changes_summary: optimized?.changes_summary ?? [],
    process_result: {
      analysis,
      ...(normalizedMatching ? {matching: normalizedMatching} : {}),
      ...(optimized ? {optimized} : {}),
      ...(interview ? {interview} : {}),
    },
    result_context: context,
    progress,
  }
}

export class GenerationJobWorker {
  private ticking = false
  private active = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly repository: GenerationJobRepository = generationJobRepository,
    private readonly adapter = v5SingleStepAdapter,
    private readonly histories: ResumeHistoryRepositoryContract = resumeHistoryRepository,
  ) {}

  async execute(initial: GenerationJob) {
    let job = initial
    let lostLease = false
    const heartbeat = setInterval(() => {
      void this.repository.renew(job).then(value => {if (!value) lostLease = true}).catch(() => {lostLease = true})
    }, 20000)
    heartbeat.unref?.()
    const save = async (changes: Partial<GenerationJob>) => {
      if (lostLease) throw new Error('JOB_LEASE_LOST')
      const updated = await this.repository.patch(job.user_id, job.id, changes, {lease: job.lease_token!, status: 'running'})
      if (!updated) {lostLease = true; throw new Error('JOB_LEASE_LOST')}
      job = updated
      publishGenerationJobUpdate(updated)
    }
    const saveHistory = async (
      nextJob: GenerationJob,
      progress: ResultSessionProgressRecord,
    ) => {
      const input = jobHistory(nextJob, progress)
      return nextJob.history_id
        ? this.histories.update({userId: job.user_id, useServiceRole: true}, nextJob.history_id, input)
        : this.histories.save({userId: job.user_id, useServiceRole: true}, input)
    }

    try {
      if (!job.payload.analysis) {
        await save({stage: 'analysis'})
        const result = await this.adapter.analyze(job.payload.input.resume_markdown, job.user_id,
          {onCacheMiss: () => this.repository.quota(job, false)})
        if (result.cache.status === 'miss' || result.cache.status === 'disabled') await this.repository.quota(job, true)
        const payload = {...job.payload, analysis: result.data}
        const nextJob = {...job, payload}
        const history = await saveHistory(nextJob, {
          analysis: 'done',
          matching: 'generating',
          optimized: 'pending',
          interview: 'pending',
        })
        if (!history) throw new Error('生成阶段历史保存失败')
        await save({payload, stage: 'matching', history_id: history.id})
      } else if (!job.history_id) {
        const history = await saveHistory(job, generationJobProgress(job))
        if (!history) throw new Error('生成阶段历史保存失败')
        await save({history_id: history.id, stage: job.stage === 'analysis' ? 'matching' : job.stage})
      }
      if (!job.payload.matching) {
        await save({stage: 'matching'})
        const result = await this.adapter.match(job.payload.analysis!.structured_resume, job.payload.input.jd_text, job.user_id)
        const payload = {...job.payload, matching: result.data}
        const history = await saveHistory({...job, payload}, {
          analysis: 'done',
          matching: 'done',
          optimized: 'generating',
          interview: 'pending',
        })
        if (!history) throw new Error('匹配阶段历史保存失败')
        await save({payload, stage: 'optimized', history_id: history.id})
      }
      if (!job.payload.optimized) {
        await save({stage: 'optimized'})
        const result = await this.adapter.generate(job.payload.analysis!.structured_resume, job.payload.matching, job.user_id)
        const payload = {...job.payload, optimized: result.data}
        const history = await saveHistory({...job, payload}, {
          analysis: 'done',
          matching: 'done',
          optimized: 'done',
          interview: 'generating',
        })
        if (!history) throw new Error('优化阶段历史保存失败')
        await save({payload, stage: 'interview', history_id: history.id})
      }
      if (!job.payload.interview) {
        await save({stage: 'interview'})
        const result = await this.adapter.interview(job.payload.analysis, job.payload.matching, job.payload.optimized!.optimized_resume, job.user_id)
        const payload = {...job.payload, interview: result.data}
        const history = await saveHistory({...job, payload}, {
          analysis: 'done',
          matching: 'done',
          optimized: 'done',
          interview: 'done',
        })
        if (!history) throw new Error('面试阶段历史保存失败')
        await save({payload, stage: 'saving', history_id: history.id})
      }
      await save({stage: 'saving'})
      if (!job.history_id) throw new Error('生成结果历史编号不存在')
      await saveHistory(job, generationJobProgress(job))
      await save({status: 'completed', history_id: job.history_id, error: null, lease_token: null})
    } catch (error) {
      // 任务失败必须落一条可见日志：worker 只向外收敛 message，
      // 原始错误此前被完全吞掉，排障只能反查 harness 库。
      console.error('[GenerationJobWorker] execute failed:', {
        jobId: job.id,
        stage: job.stage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode: error && typeof error === 'object' && 'code' in error
          ? String((error as {code?: unknown}).code)
          : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        agentState: error && typeof error === 'object' && 'state' in error
          ? String((error as {state?: unknown}).state)
          : undefined,
      })
      if (!lostLease) {
        const message = error instanceof ResumeQuotaError ? error.message
          : error instanceof V5WorkflowBlockedError && error.state === 'provider_failure' ? '模型服务暂时不可用，请稍后重试'
            : '本次生成未完成，请重试'
        if (job.history_id) {
          await saveHistory(job, generationJobProgress(job, true)).catch(() => undefined)
        }
        const failed = await this.repository.patch(job.user_id, job.id, {status: 'failed', error: message, lease_token: null},
          {lease: job.lease_token!, status: 'running'})
        if (failed) publishGenerationJobUpdate(failed)
      }
    } finally {
      clearInterval(heartbeat)
    }
  }

  async tick() {
    if (this.ticking || this.active >= 2) return
    this.ticking = true
    try {
      const job = await this.repository.claim()
      if (!job) return
      publishGenerationJobUpdate(job)
      this.active += 1
      void this.execute(job).catch(() => console.error('生成任务状态保存失败'))
        .finally(() => {this.active -= 1; void this.tick()})
    } catch {
      console.error('生成任务队列不可用，请检查数据库迁移')
    } finally {
      this.ticking = false
    }
  }

  start() {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), 2000)
    this.timer.unref?.()
    void this.tick()
  }
}

export const generationJobWorker = new GenerationJobWorker()
