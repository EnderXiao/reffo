import {loadCompletionBaselineBundle} from './resume-completion-baseline'
import {persistGenerationInputTrace} from './generation-input-trace'
import {generationJobRepository, type GenerationJobRepository} from '@/repositories/generation-job-repository'
import {resumeHistoryRepository} from '@/repositories/resume-history-repository'
import {singleStepFingerprint, v5SingleStepAdapter} from '@/v5/single-step-adapter'
import {summarizeGenerationJob, type GenerationJob} from '@/types/generation-job'
import type {SaveResumeHistoryInput} from '@/types'
import type {ResumeHistoryRepositoryContract} from '@/repositories/interfaces'
import {publishGenerationJobUpdate} from '@/services/generation-job-events'
import {assertGenerationJobVersion, currentGenerationStageFingerprints, hasGenerationStages, withoutGenerationFailure} from './generation-job-version'
import {generationJobFailure} from './generation-job-failure'
import {hasLinkedCompletion} from '@/shared/resume-completion'

export function jobHistory(job: GenerationJob): SaveResumeHistoryInput {
  const {input, analysis, matching, optimized, interview} = job.payload
  if (!analysis || !matching || !optimized || !interview) throw new Error('生成阶段不完整')
  const summary = summarizeGenerationJob(job)
  const context = {company: summary.company, position: summary.position, location: summary.location,
    resumeContent: input.resume_markdown, jdContent: input.jd_text, ...(input.jd_parse_id ? {jdParseId: input.jd_parse_id} : {}),
    ...(input.resume_parse_id ? {resumeParseId: input.resume_parse_id} : {})}
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
    completion_baseline: optimized.completion_document,
    action_baseline: optimized.action_plan && optimized.resolved_action_plan ? {actionPlan:optimized.action_plan,resolvedPlan:optimized.resolved_action_plan,review:optimized.action_review,changeManifest:optimized.change_manifest,identityState:optimized.identity_state,deliveryState:optimized.delivery_state,matching} : undefined,
    commit_id: `generation-${job.id}`,
    progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'} as const,
  }
}

export class GenerationJobWorker {
  private ticking = false
  private active = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly repository: Pick<GenerationJobRepository, 'renew' | 'patch' | 'quota' | 'claim'> = generationJobRepository,
    private readonly adapter: Pick<typeof v5SingleStepAdapter, 'analyze' | 'match' | 'generate' | 'interview'> = v5SingleStepAdapter,
    private readonly histories: Pick<ResumeHistoryRepositoryContract, 'findById' | 'save'> = resumeHistoryRepository,
    private readonly releaseFingerprint = singleStepFingerprint,
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
      // A previous attempt may have saved history before losing its final lease.
      // Reuse that record so retry never overwrites subsequent user edits.
      const savedHistory = await this.histories.findById(
        {userId: job.user_id, useServiceRole: true}, job.history_id || `JD-${job.id}`,
      )
      if (savedHistory) {
        await save({status: 'completed', history_id: savedHistory.id, error: null, lease_token: null,
          ...(job.payload.failure ? {payload: withoutGenerationFailure(job.payload)} : {})})
        return
      }
      const fingerprint = this.releaseFingerprint()
      assertGenerationJobVersion(job.payload, fingerprint)
      if (!hasGenerationStages(job.payload) && (!job.payload.stageFingerprints || job.payload.releaseFingerprint !== fingerprint)) {
        await save({payload: {...job.payload, releaseFingerprint: fingerprint, stageFingerprints:currentGenerationStageFingerprints()}})
      }
      if (!job.payload.analysis) {
        await save({stage: 'analysis'})
        const result = await this.adapter.analyze(job.payload.input.resume_markdown, job.user_id,
          {onCacheMiss: async () => {if (!job.quota_charged) await this.repository.quota(job, false)}})
        if (!job.quota_charged && (result.cache.status === 'miss' || result.cache.status === 'disabled')) {
          await this.repository.quota(job, true)
          await save({quota_charged: true})
        }
        await persistGenerationInputTrace(job, 'analysis', result.runId)
        await save({payload: {...job.payload, analysis: result.data,
          traceRunIds: {...job.payload.traceRunIds, ...(result.runId ? {analysis: result.runId} : {})}}})
      }
      if (!job.payload.matching) {
        await save({stage: 'matching'})
        const result = await this.adapter.match(job.payload.analysis!.structured_resume, job.payload.input.jd_text, job.user_id)
        await persistGenerationInputTrace(job, 'matching', result.runId)
        await save({payload: {...job.payload, matching: result.data,
          traceRunIds: {...job.payload.traceRunIds, ...(result.runId ? {matching: result.runId} : {})}}})
      }
      if (!job.payload.optimized) {
        await save({stage: 'optimized'})
        const result = await this.adapter.generate(job.payload.analysis!.structured_resume, job.payload.matching, job.user_id)
        await persistGenerationInputTrace(job, 'optimized', result.runId)
        await save({payload: {...job.payload, optimized: result.data,
          traceRunIds: {...job.payload.traceRunIds, ...(result.runId ? {optimized: result.runId} : {})}}})
      }
      if (!job.payload.interview) {
        await save({stage: 'interview'})
        const result = await this.adapter.interview(job.payload.analysis, job.payload.matching, job.payload.optimized!.optimized_resume, job.user_id)
        await persistGenerationInputTrace(job, 'interview', result.runId)
        await save({payload: {...job.payload, interview: result.data,
          traceRunIds: {...job.payload.traceRunIds, ...(result.runId ? {interview: result.runId} : {})}}})
      }
      await save({stage: 'saving'})
      const historyInput = jobHistory(job)
      if (job.payload.optimized?.completion_document && hasLinkedCompletion(job.payload.optimized.completion_document)) {
        const trusted = await loadCompletionBaselineBundle(job.user_id, historyInput.process_result)
        historyInput.action_baseline = trusted.actionBaseline
      }
      const history = await this.histories.save({userId: job.user_id, useServiceRole: true}, historyInput)
      await save({status: 'completed', history_id: history.id, error: null, lease_token: null,
        ...(job.payload.failure ? {payload: withoutGenerationFailure(job.payload)} : {})})
    } catch (error) {
      if (!lostLease) {
        const {message, failure} = generationJobFailure(error, job.stage)
        if (failure.runId) await persistGenerationInputTrace(job, job.stage, failure.runId)
        const failed = await this.repository.patch(job.user_id, job.id, {status: 'failed', error: message, lease_token: null,
          payload: {...job.payload, failure}},
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
