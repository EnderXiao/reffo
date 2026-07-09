import { describe, expect, test } from 'bun:test'
import {
  buildQualityGateAttempt,
  classifyAttemptResult,
  decideNextAction,
  type HarnessAttemptResult,
} from '@/harness/runtime-state'

describe('runtime-state decision policy', () => {
  test('classifies a failed quality gate as revise_output', () => {
    const attempt = buildQualityGateAttempt({
      stepName: 'validate_resume',
      attemptNumber: 1,
      evaluation: {
        evaluatorName: 'markdown-resume-rules',
        evaluatorVersion: 'v1',
        passed: false,
        score: 40,
        issues: [
          {
            severity: 'error',
            code: 'PLACEHOLDER_TEXT_FOUND',
            message: '优化简历包含模板占位文本。',
          },
        ],
      },
    })

    const classification = classifyAttemptResult(attempt)
    const decision = decideNextAction(classification)

    expect(classification).toBe('quality_gate_failed')
    expect(decision).toMatchObject({
      action: 'revise_output',
      revisionStep: 'revise_resume',
    })
  })

  test('maps JSON and schema failures to repair_json decisions', () => {
    const invalidStructuredOutputs: HarnessAttemptResult[] = [
      {
        stepName: 'analyze_resume',
        attemptNumber: 1,
        status: 'failed',
        error: {
          code: 'JSON_PARSE_FAILED',
          category: 'json_parse',
          message: 'JSON 解析失败',
          retryable: false,
          repairable: true,
        },
      },
      {
        stepName: 'parse_jd',
        attemptNumber: 1,
        status: 'failed',
        error: {
          code: 'SCHEMA_VALIDATION_FAILED',
          category: 'schema_validation',
          message: 'Schema 校验失败',
          retryable: false,
          repairable: true,
        },
      },
    ]

    for (const attempt of invalidStructuredOutputs) {
      expect(classifyAttemptResult(attempt)).toBe('structured_output_invalid')
      expect(decideNextAction(classifyAttemptResult(attempt))).toMatchObject({
        action: 'repair_json',
      })
    }
  })
})
