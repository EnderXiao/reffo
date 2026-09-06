import { describe, expect, test } from 'bun:test'
import { buildMvpProcessErrorResponse } from '@/routes/mvp'
import { V5WorkflowBlockedError } from '@/v5/errors'

function privateIssue() {
  return {
    issueId: 'private-issue',
    severity: 'error' as const,
    code: 'OUTPUT_CONTENT_UNDERSIZED',
    outputPath: 'experience[0]',
    claimId: 'claim-private',
    evidenceIds: ['ev-private'],
    requirementIds: ['req-private'],
    message: '私密简历原文不应出现在响应中',
    expectedConstraint: '私密完整性约束',
    replacementText: '私密替换文本',
  }
}

describe('MVP process error boundary', () => {
  test('maps a product-quality block to a redacted non-retryable 422', () => {
    const failure = buildMvpProcessErrorResponse(new V5WorkflowBlockedError({
      code: 'V5_PRODUCT_QUALITY_BLOCKED',
      state: 'blocked_quality_validation',
      message: '内部详细错误',
      issues: [privateIssue()],
    }))

    expect(failure.status).toBe(422)
    expect(failure.response).toEqual({
      success: false,
      error: {
        code: 'V5_PRODUCT_QUALITY_BLOCKED',
        message: '本次结果未达到可投递质量标准，已停止交付不完整简历',
        details: {
          agent_state: 'blocked_quality_validation',
          issue_codes: ['OUTPUT_CONTENT_UNDERSIZED'],
          retryable: false,
        },
      },
    })
    const serialized = JSON.stringify(failure.response)
    for (const privateValue of [
      '私密简历原文',
      'claim-private',
      'ev-private',
      'req-private',
      '私密替换文本',
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
  })

  test('distinguishes retryable provider failures from internal failures', () => {
    const providerFailure = buildMvpProcessErrorResponse(new V5WorkflowBlockedError({
      code: 'V5_PROVIDER_TEMPORARY_FAILURE',
      state: 'provider_failure',
      message: '上游超时',
      retryable: true,
      httpStatus: 503,
    }))
    expect(providerFailure.status).toBe(503)
    expect(providerFailure.response.error?.details).toMatchObject({ retryable: true })

    const internalFailure = buildMvpProcessErrorResponse(new V5WorkflowBlockedError({
      code: 'V5_INTERNAL_WORKFLOW_FAILURE',
      state: 'workflow_failure',
      message: '内部失败',
    }))
    expect(internalFailure.status).toBe(500)
    expect(internalFailure.response.error?.details).toMatchObject({ retryable: false })
  })
})
