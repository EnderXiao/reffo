import { beforeEach, describe, expect, mock, test } from 'bun:test'
import type {
  ResumeHistoryRecord,
  ResumeHistorySummaryRecord,
  SourceResumeRecord,
  SourceResumeSummaryRecord,
} from '@/types'

let historyRecords: ResumeHistoryRecord[] = []
let latestSourceResume: SourceResumeRecord | null = null

class TestRequestAuthError extends Error {
  readonly status = 401
  readonly code = 'AUTH_REQUIRED'
}

mock.module('@/auth/request-context', () => ({
  RequestAuthError: TestRequestAuthError,
  resolveRequestUser: async () => ({
    userId: 'user-1',
    useServiceRole: true,
  }),
}))

mock.module('@/repositories/resume-history-repository', () => ({
  resumeHistoryRepository: {
    list: async () => historyRecords,
  },
}))

mock.module('@/repositories/source-resume-repository', () => ({
  sourceResumeRepository: {
    getLatest: async () => latestSourceResume,
  },
}))

const { resumeHistoryRoutes } = await import('@/routes/resume-history')
const { sourceResumeRoutes } = await import('@/routes/source-resume')

describe('resource summary routes', () => {
  beforeEach(() => {
    historyRecords = []
    latestSourceResume = null
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
