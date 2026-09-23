import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { env } from '@/config/env'
import { resumeHistoryRepository } from '@/repositories/resume-history-repository'
import { sourceResumeRepository } from '@/repositories/source-resume-repository'
import type {
  ResumeHistoryRecord,
  ResumeHistorySummaryRecord,
  SourceResumeRecord,
  SourceResumeSummaryRecord,
} from '@/types'
import { resumeHistoryRoutes } from '@/routes/resume-history'
import { sourceResumeRoutes } from '@/routes/source-resume'

let historyRecords: ResumeHistoryRecord[] = []
let latestSourceResume: SourceResumeRecord | null = null
const originalEnv = {
  APP_ENV: env.APP_ENV,
  AUTH_REQUIRED: env.AUTH_REQUIRED,
}

describe('resource summary routes', () => {
  beforeEach(() => {
    historyRecords = []
    latestSourceResume = null
    env.APP_ENV = 'local'
    env.AUTH_REQUIRED = false
    spyOn(resumeHistoryRepository, 'list').mockImplementation(async () => historyRecords)
    spyOn(sourceResumeRepository, 'getLatest').mockImplementation(async () => latestSourceResume)
  })

  afterEach(() => {
    mock.restore()
    Object.assign(env, originalEnv)
  })

  test('历史摘要只返回首页卡片所需字段', async () => {
    historyRecords = [{
      id: 'history-1',
      position: 'AI 产品经理',
      company: 'Reffo',
      name: '候选人',
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T01:00:00.000Z',
      quality_score: 88,
      match_score: 84,
      tags: ['AI', '产品'],
      resume_content: '# 私密简历正文',
      jd_content: '岗位名称：AI 产品经理\n工作地点：北京',
      optimized_content: '# 私密优化简历正文',
      optimization_suggestions: ['突出 AI 产品落地。', '补充增长结果。'],
      result_context: {
        company: 'Reffo',
        position: 'AI 产品经理',
        location: '上海',
        resumeContent: '# 私密简历正文',
        jdContent: '岗位名称：AI 产品经理',
      },
      card_color: '#1C77EB',
    }]

    const response = await resumeHistoryRoutes.handle(
      new Request('http://localhost/api/v1/resume-history/summaries'),
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      success: boolean
      data: ResumeHistorySummaryRecord[]
    }
    expect(payload.success).toBe(true)
    expect(payload.data).toEqual([{
      id: 'history-1',
      position: 'AI 产品经理',
      company: 'Reffo',
      name: '候选人',
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T01:00:00.000Z',
      quality_score: 88,
      match_score: 84,
      tags: ['AI', '产品'],
      location: '上海',
      strategy_body: '突出 AI 产品落地。\n\n补充增长结果。',
      card_color: '#1C77EB',
    }])
  })

  test('源简历摘要不返回简历 Markdown 正文', async () => {
    latestSourceResume = {
      id: 'source-1',
      title: '我的简历',
      resume_markdown: '# 私密简历正文',
      source_type: 'file',
      original_file_name: 'resume.pdf',
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T01:00:00.000Z',
    }

    const response = await sourceResumeRoutes.handle(
      new Request('http://localhost/api/v1/source-resume/latest-summary'),
    )

    expect(response.status).toBe(200)
    const payload = await response.json() as {
      success: boolean
      data: SourceResumeSummaryRecord
    }
    expect(payload.success).toBe(true)
    expect(payload.data).toEqual({
      id: 'source-1',
      title: '我的简历',
      source_type: 'file',
      original_file_name: 'resume.pdf',
      created_at: '2026-09-23T00:00:00.000Z',
      updated_at: '2026-09-23T01:00:00.000Z',
    })
  })
})
