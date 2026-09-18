import { describe, expect, test } from 'bun:test'
import { recoveryAdviceForErrorCode } from '@/harness/recovery-advice'

describe('Harness recovery advice', () => {
  test('maps budget and context failures to non-LLM recovery actions', () => {
    expect(recoveryAdviceForErrorCode('V6_LLM_CALL_BUDGET_EXCEEDED')).toMatchObject({
      retryable: false,
      action: 'reduce_context_or_disable_optional_stage',
    })
    expect(recoveryAdviceForErrorCode('V5_CONTEXT_BUDGET_EXCEEDED')).toMatchObject({
      retryable: false,
      action: 'reduce_context_or_split_input',
    })
  })

  test('keeps timeout retry bounded and unknown errors inspectable', () => {
    expect(recoveryAdviceForErrorCode('STEP_TIMEOUT')).toMatchObject({
      retryable: true,
      action: 'retry_once_with_remaining_budget',
    })
    expect(recoveryAdviceForErrorCode('UNKNOWN')).toMatchObject({
      retryable: false,
      action: 'inspect_harness_events',
    })
  })

  test('maps exhausted V5 JSON transport repair to an inspectable recovery action', () => {
    expect(recoveryAdviceForErrorCode('V5_JSON_PARSE_FAILED')).toMatchObject({
      retryable: false,
      action: 'repair_structured_json_output',
    })
  })
})
