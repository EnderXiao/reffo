import {describe, expect, test} from 'bun:test'
import {generationJobProgress, jobHistory} from './generation-jobs'
import {isHistoryFullyDelivered} from './generation-job-delivery'

describe('生成历史完成度判定', () => {
  test('只有 analysis 的历史不算完成', () => {
    expect(isHistoryFullyDelivered({
      progress: {analysis: 'done', matching: 'generating', optimized: 'pending', interview: 'pending'},
      process_result: {analysis: {}},
      optimized_content: '',
    })).toBe(false)
  })

  test('全部阶段 done 才算完成', () => {
    expect(isHistoryFullyDelivered({
      progress: {analysis: 'done', matching: 'done', optimized: 'done', interview: 'done'},
      optimized_content: '',
    })).toBe(true)
  })

  test('进度缺失但结果里有 optimized 与 interview 也算完成', () => {
    expect(isHistoryFullyDelivered({process_result: {optimized: {}, interview: {}}, optimized_content: ''})).toBe(true)
    expect(isHistoryFullyDelivered({process_result: {optimized: {}}, optimized_content: ''})).toBe(false)
  })

  test('已有可展示正文视为完成，避免重跑覆盖用户编辑', () => {
    expect(isHistoryFullyDelivered({optimized_content: '用户后来填写的正文'})).toBe(true)
    expect(isHistoryFullyDelivered({optimized_content: '   '})).toBe(false)
  })
})

describe('取消时的进度收敛', () => {
  const job = {
    id: 'job-1', created_at: '2026-11-20T00:00:00.000Z', stage: 'matching',
    payload: {input: {resume_markdown: '# R', jd_text: 'JD'}, analysis: {quality_score: 70, structured_resume: {personal_info: {name: '张三'}}}},
    company: '公司', position: '岗位', location: '', score: null, error: null, background: false,
    read_at: null, confirmed_at: null, history_id: 'JD-job-1', user_id: 'u1', status: 'cancelled', quota_charged: false,
  } as never

  test('failed 标记落在当前进行中的阶段', () => {
    const progress = generationJobProgress(job, true)
    expect(progress).toMatchObject({analysis: 'done', matching: 'failed', optimized: 'pending', interview: 'pending'})
    expect(jobHistory(job, progress).progress).toEqual(progress)
  })
})
