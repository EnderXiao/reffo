import {generationJobRepository, type GenerationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {v5SingleStepAdapter} from '@/v5/single-step-adapter'
import {V5WorkflowBlockedError} from '@/v5/errors'
import {ResumeQuotaError} from './resume-quota'
import {summarizeGenerationJob, type GenerationJob} from '@/types/generation-job'
import type {ResumeHistoryRepositoryContract} from '@/repositories/interfaces'
import {publishGenerationJobUpdate} from '@/services/generation-job-events'

export function jobHistory(job: GenerationJob) {
  const {input, analysis, matching, optimized, interview} = job.payload
  if (!analysis || !matching || !optimized || !interview) throw new Error('生成阶段不完整')
  const summary = summarizeGenerationJob(job)
  const context = {company: summary.company, position: summary.position, location: summary.location,
    resumeContent: input.resume_markdown, jdContent: input.jd_text}
  const normalizedMatching = {...matching,
    hard_requirements_match: Object.entries(matching.hard_requirements_match ?? {}).map(([requirement, matched]) => ({requirement, matched})),
    skill_match: {...matching.skill_match, matched_skills: matching.skill_match.matched ?? [],
      missing_skills: matching.skill_match.missing ?? [], match_percentage: matching.match_score},
    experience_match: {years_required: 0, years_actual: 0, match_percentage: 0,
      relevant_experience: matching.experience_match ? [matching.experience_match] : []},
  }
  return {
    id: `JD-${job.id}`, company: summary.company, position: summary.position,
    name: analysis.structured_resume.personal_info.name, created_at: job.created_at,
    quality_score: analysis.quality_score, match_score: matching.match_score,
    tags: (matching.skill_match.matched ?? []).slice(0, 3), resume_content: input.resume_markdown,
    jd_content: input.jd_text, optimized_content: optimized.optimized_resume,
    optimization_suggestions: matching.optimization_suggestions, changes_summary: optimized.changes_summary,
    process_result: {analysis, matching: normalizedMatching, optimized, interview}, result_context: context,
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const,
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

    try {
      if (!job.payload.analysis) {
        await save({stage: 'analysis'})
        const result = await this.adapter.analyze(job.payload.input.resume_markdown, job.user_id,
          {onCacheMiss: () => this.repository.quota(job, false)})
        if (result.cache.status === 'miss' || result.cache.status === 'disabled') await this.repository.quota(job, true)
        await save({payload: {...job.payload, analysis: result.data}})
      }
      if (!job.payload.matching) {
        await save({stage: 'matching'})
        const result = await this.adapter.match(job.payload.analysis!.structured_resume, job.payload.input.jd_text, job.user_id)
        await save({payload: {...job.payload, matching: result.data}})
      }
      if (!job.payload.optimized) {
        await save({stage: 'optimized'})
        const result = await this.adapter.generate(job.payload.analysis!.structured_resume, job.payload.matching, job.user_id)
        await save({payload: {...job.payload, optimized: result.data}})
      }
      if (!job.payload.interview) {
        await save({stage: 'interview'})
        const result = await this.adapter.interview(job.payload.analysis, job.payload.matching, job.payload.optimized!.optimized_resume, job.user_id)
        await save({payload: {...job.payload, interview: result.data}})
      }
      await save({stage: 'saving'})
      const history = await this.histories.save({userId: job.user_id, useServiceRole: true}, jobHistory(job))
      await save({status: 'completed', history_id: history.id, error: null, lease_token: null})
    } catch (error) {
      if (!lostLease) {
        const message = error instanceof ResumeQuotaError ? error.message
          : error instanceof V5WorkflowBlockedError && error.state === 'provider_failure' ? '模型服务暂时不可用，请稍后重试'
            : '本次生成未完成，请重试'
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
