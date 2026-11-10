import {expect, test} from 'bun:test'
import {GenerationJobWorker} from '@/services/generation-jobs'
import type {GenerationJob} from '@/types/generation-job'
import type {ResumeHistoryRecord, SaveResumeHistoryInput} from '@/types'

function createJob(): GenerationJob {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    user_id: 'user-1',
    status: 'running',
    stage: 'analysis',
    background: false,
    read_at: null,
    confirmed_at: null,
    history_id: null,
    error: null,
    created_at: '2026-10-13T12:00:00.000Z',
    updated_at: '2026-10-13T12:00:01.000Z',
    lease_token: 'lease-token',
    lease_expires_at: '2026-10-13T12:05:00.000Z',
    quota_charged: false,
    payload: {
      input: {
        resume_markdown: '# Jeremy Smith\n\n## Experience',
        jd_text: '岗位职责：负责前端架构与交付',
        company: 'OpenAI',
        position: '前端工程师',
        location: '上海',
      },
    },
  }
}

const analysis = {
  quality_score: 88,
  structured_resume: {
    personal_info: {name: 'Jeremy Smith'},
    education: [],
    experience: [],
    projects: [],
    skills: {hard_skills: [], soft_skills: []},
  },
  strengths: [],
  weaknesses: [],
  suggestions: [],
  capability_summary: '',
}

const matching = {
  match_score: 91,
  hard_requirements_match: {TypeScript: true},
  skill_match: {matched: ['TypeScript'], missing: []},
  experience_match: '具备相关经验',
  optimization_suggestions: ['补充量化结果'],
}

const optimized = {
  optimized_resume: '# Jeremy Smith\n\n## Optimized',
  changes_summary: ['突出架构能力'],
  improvement_score: 4,
}

const interview = {
  questions: ['请介绍一次架构优化'],
  story_recommendations: [],
  follow_up_questions: [],
}

test('后台任务分析完成后写入部分历史，并逐阶段更新同一结果', async () => {
  let job = createJob()
  const historyInputs: SaveResumeHistoryInput[] = []
  const repository = {
    patch: async (
      _userId: string,
      _id: string,
      changes: Partial<GenerationJob>,
    ) => {
      job = {...job, ...changes}
      return job
    },
    renew: async () => job,
    quota: async () => undefined,
    claim: async () => null,
    create: async () => job,
    get: async () => job,
    list: async () => [job],
  }
  const histories = {
    save: async (_context: unknown, input: SaveResumeHistoryInput) => {
      historyInputs.push(input)
      return input as unknown as ResumeHistoryRecord
    },
    update: async (_context: unknown, _id: string, input: SaveResumeHistoryInput) => {
      historyInputs.push(input)
      return input as unknown as ResumeHistoryRecord
    },
    list: async () => [],
    findById: async () => null,
    delete: async () => true,
    clear: async () => 0,
  }
  const adapter = {
    analyze: async () => ({data: analysis, cache: {status: 'miss'}}),
    match: async () => ({data: matching}),
    generate: async () => ({data: optimized}),
    interview: async () => ({data: interview}),
  }
  const worker = new GenerationJobWorker(
    repository as never,
    adapter as never,
    histories as never,
  )

  await worker.execute(createJob())

  expect(historyInputs).toHaveLength(5)
  expect(historyInputs[0].id).toBe(`JD-${job.id}`)
  expect(historyInputs[0].process_result).toMatchObject({analysis})
  expect(historyInputs[0].process_result).not.toHaveProperty('matching')
  expect(historyInputs[0].progress).toEqual({
    analysis: 'done',
    matching: 'generating',
    optimized: 'pending',
    interview: 'pending',
  })
  expect(historyInputs[1].progress).toEqual({
    analysis: 'done',
    matching: 'done',
    optimized: 'generating',
    interview: 'pending',
  })
  expect(historyInputs[2].progress).toEqual({
    analysis: 'done',
    matching: 'done',
    optimized: 'done',
    interview: 'generating',
  })
  const finalResult = historyInputs.at(-1)?.process_result as {
    analysis?: typeof analysis
    matching?: {match_score?: number}
    optimized?: typeof optimized
    interview?: typeof interview
  }
  expect(finalResult).toMatchObject({analysis, optimized, interview})
  expect(finalResult.matching?.match_score).toBe(matching.match_score)
  expect(job.status).toBe('completed')
  expect(job.history_id).toBe(`JD-${job.id}`)
})
