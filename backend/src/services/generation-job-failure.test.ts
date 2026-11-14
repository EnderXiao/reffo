import {describe, expect, test} from 'bun:test'
import {V5WorkflowBlockedError} from '@/v5/errors'
import {summarizeGenerationJob, type GenerationJob} from '@/types/generation-job'
import {generationJobFailure} from './generation-job-failure'

describe('生成失败的可操作提示和安全诊断', () => {
  test('区分服务容量阻断与匹配结果校验，不把修复体积问题归因于用户材料', () => {
    const result = generationJobFailure(new V5WorkflowBlockedError({code: 'V5_CONTEXT_BUDGET_EXCEEDED',
      state: 'blocked_input_validation', message: '修复草稿预计占用 38847 tokens'}), 'matching')
    expect(result.failure).toMatchObject({code: 'V5_CONTEXT_BUDGET_EXCEEDED', stage: 'matching', retryable: false,
      action: 'reduce_context_or_split_input'})
    expect(result.message).toContain('岗位分析处理超出本次服务容量')
    expect(result.message).not.toContain('tokens')
    expect(result.message).not.toContain('缩短')
    expect(result.message).not.toContain('请重试')
  })

  test('暂时的模型故障允许稍后重试，配置故障不使用相同引导', () => {
    const transient = generationJobFailure(new V5WorkflowBlockedError({code: 'V5_PROVIDER_UNAVAILABLE',
      state: 'provider_failure', message: 'provider upstream', retryable: true}), 'matching')
    const permanent = generationJobFailure(new V5WorkflowBlockedError({code: 'V5_PROVIDER_AUTH_FAILED',
      state: 'provider_failure', message: 'secret provider credentials', retryable: false}), 'matching')
    expect(transient.failure.retryable).toBe(true)
    expect(transient.message).toContain('请稍后重试')
    expect(permanent.failure.retryable).toBe(false)
    expect(permanent.message).toContain('检查服务配置')
    expect(permanent.message).not.toContain('重试')
    expect(JSON.stringify(permanent)).not.toContain('secret provider')
  })

  test('未知异常不将原始错误详情展示或保存到诊断', () => {
    const result = generationJobFailure(new Error('API Key secret, full private resume'), 'saving')
    expect(result.failure).toMatchObject({code: 'GENERATION_FAILED', stage: 'saving', retryable: false})
    expect(result.message).toContain('结果保存')
    expect(JSON.stringify(result)).not.toContain('private resume')
  })

  test('正文终因与恢复链完整传入持久化失败摘要且丢弃隐私字段', () => {
    const diagnostics = {initialIssueCodes: ['WRITER_GAP_BOUNDARY_INVALID'],
      finalIssueCodes: ['WRITER_SKILL_RECOVERY_UNSUPPORTED'], recoveredEntryIds: ['entry:4'],
      privateResume: '完整源简历与联系方式', decisions: [{attempt: 2, entryId: 'entry:4',
        disposition: 'local_recovery' as const, issueCodes: ['WRITER_GAP_BOUNDARY_INVALID'], outcome: 'validated' as const,
        candidateDigest: 'a'.repeat(64), privateText: '完整源简历与联系方式'},
        {attempt: 2, entryId: 'entry:9', disposition: 'blocked' as const,
          issueCodes: ['WRITER_SKILL_RECOVERY_UNSUPPORTED'], outcome: 'blocked' as const}]}
    const error = new V5WorkflowBlockedError({code: 'V5_SUPPORTED_WRITING_BLOCKED', state: 'blocked_fact_validation',
      message: '私有候选正文', writingRecovery: diagnostics,
      issues: [{issueId: 'final', severity: 'error', code: 'WRITER_SKILL_RECOVERY_UNSUPPORTED', outputPath: 'skills[1]',
        claimId: null, evidenceIds: [], requirementIds: [], message: '私有技能段落', expectedConstraint: '', replacementText: null}]})
    const result = generationJobFailure(error, 'optimized')
    expect(result.failure.issueCodes).toEqual(['WRITER_SKILL_RECOVERY_UNSUPPORTED'])
    expect(result.failure.writingRecovery).toMatchObject({initialIssueCodes: ['WRITER_GAP_BOUNDARY_INVALID'],
      finalIssueCodes: ['WRITER_SKILL_RECOVERY_UNSUPPORTED'], recoveredEntryIds: ['entry:4']})
    expect(result.failure.writingRecovery?.decisions).toHaveLength(2)
    expect(JSON.stringify(result)).not.toMatch(/完整源简历|联系方式|私有候选|私有技能|privateResume|privateText/u)
  })

  test('任务摘要公开安全失败类别，继续隐藏内部输入和身份', () => {
    const failure = generationJobFailure(new V5WorkflowBlockedError({code: 'P03_VALIDATION_FAILED',
      state: 'blocked_fact_validation', message: 'private draft'}), 'matching').failure
    const job = {id: 'task-id', user_id: 'private-user', status: 'failed', stage: 'matching', error: '岗位分析未通过检查',
      payload: {input: {resume_markdown: 'private-resume', jd_text: 'private-jd', company: '示例公司', position: '产品经理', location: ''},
        failure}} as GenerationJob
    const summary = summarizeGenerationJob(job)
    expect(summary.failure).toEqual(failure)
    expect(summary.error).toBe(job.error)
    expect(summary).not.toHaveProperty('payload')
    expect(summary).not.toHaveProperty('user_id')
    expect(JSON.stringify(summary)).not.toContain('private')
  })
})
