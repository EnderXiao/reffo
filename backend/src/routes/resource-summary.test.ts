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
import { resumeHistoryRoutes, toSummary } from '@/routes/resume-history'
import { sourceResumeRoutes } from '@/routes/source-resume'
import {resumeTextFingerprint, type ResumeStrategyReview} from '../../../shared/resume-strategy'

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
      strategy_title: '优化建议',
      strategy_body: '突出 AI 产品落地。\n\n补充增长结果。',
      card_color: '#1C77EB',
    }])
  })

  test('历史摘要使用当前正文的业务引用且保留未上线边界', async () => {
    const quote = '完成产品原型，尚未上线。'
    const content = `# 示例候选人\n邮箱：private@example.test\n\n## 项目经历\n- ${quote}`
    const review: ResumeStrategyReview = {
      version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(content), items: [{
        strategyId: 'strategy_gap1', strategy: '保留产品交付阶段。', status: 'linked', explanation: '对应正文如下。',
        references: [
          {outputPath: 'identity.contact', location: '个人信息', quote: '邮箱：private@example.test'},
          {outputPath: 'project.scope_1.bullets[0]', location: '项目经历 · 第1段', quote: `- ${quote}`},
        ],
      }],
    }
    historyRecords = [summaryRecord({optimized_content: content, process_result: {optimized: {strategy_review: review}}})]
    const response = await resumeHistoryRoutes.handle(new Request('http://localhost/api/v1/resume-history/summaries'))
    expect(response.status).toBe(200)
    const payload = await response.json() as {data: ResumeHistorySummaryRecord[]}
    expect(payload.data[0].strategy_title).toBe('这份简历的重点')
    expect(payload.data[0].strategy_body).toBe(`项目经历 · 第1段：${quote}`)
    expect(JSON.stringify(payload)).not.toContain('private@example.test')
    expect(payload.data[0]).not.toHaveProperty('process_result')
  })

  test('空建议数组不吞后续真实建议，改动总结不作为建议回退', () => {
    const record = summaryRecord({optimization_suggestions: [], changes_summary: ['不能作为建议的改动总结'],
      process_result: {matching: {optimization_suggestions: ['  ']},
        optimized: {changes_summary: ['也不是建议']}, analysis: {suggestions: ['补充实际分工。']}}})
    expect(toSummary(record).strategy_body).toBe('补充实际分工。')
    expect(toSummary({...record, process_result: undefined}).strategy_body).toBe('暂无可展示的优化建议。')
    expect(toSummary(record).strategy_title).toBe('优化建议')
  })

  test('人工编辑后历史摘要回退真实建议而不使用旧正文引用', () => {
    const original = '## 工作经历\n- 完成原型，尚未上线。'
    const review: ResumeStrategyReview = {version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(original),
      items: [{strategyId: 'strategy_gap1', strategy: '说明交付范围。', status: 'linked', explanation: '对应正文。',
        references: [{outputPath: 'experience.scope_1.bullets[0]', location: '工作经历 · 第1段', quote: '完成原型，尚未上线。'}]}]}
    const summary = toSummary(summaryRecord({optimized_content: `${original}\n新增内容。`, optimization_suggestions: [],
      process_result: {optimized: {strategy_review: review}, matching: {optimization_suggestions: ['核对最新表述。']}}}))
    expect(summary.strategy_title).toBe('优化建议')
    expect(summary.strategy_body).toBe('核对最新表述。')
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

function summaryRecord(overrides: Partial<ResumeHistoryRecord> = {}): ResumeHistoryRecord {
  return {id: 'history-summary', position: '产品经理', company: '示例公司', name: '候选人',
    created_at: '2026-09-27T00:00:00Z', updated_at: '2026-09-27T00:00:00Z', quality_score: 70, match_score: 65,
    tags: [], resume_content: '私密源简历', jd_content: '目标岗位', optimized_content: '', ...overrides}
}
