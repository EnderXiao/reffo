export interface HarnessRecoveryAdvice {
  retryable: boolean
  action: string
  message: string
}

const ADVICE_BY_CODE: Record<string, HarnessRecoveryAdvice> = {
  V6_LLM_CALL_BUDGET_EXCEEDED: {
    retryable: false,
    action: 'reduce_context_or_disable_optional_stage',
    message: '已达到本次 LLM 调用预算；缩小上下文或关闭可选阶段后再试。',
  },
  V5_CONTEXT_BUDGET_EXCEEDED: {
    retryable: false,
    action: 'reduce_context_or_split_input',
    message: '输入上下文超过安全窗口；缩小输入或拆分文档后再试。',
  },
  V5_OUTPUT_TRUNCATED: {
    retryable: false,
    action: 'reduce_output_scope',
    message: '模型输出被截断；减少输出范围或提高结构化输出预算后再试。',
  },
  STEP_TIMEOUT: {
    retryable: true,
    action: 'retry_once_with_remaining_budget',
    message: '阶段执行超时；确认 Provider 可用后仅重试一次，并继续受共享预算限制。',
  },
  PROVIDER_TIMEOUT: {
    retryable: true,
    action: 'retry_once_with_remaining_budget',
    message: 'Provider 请求超时；确认网络后仅重试一次，并继续受共享预算限制。',
  },
  FACT_SAFETY_BLOCKED: {
    retryable: false,
    action: 'preserve_source_and_review',
    message: '事实安全门禁阻断；保留源材料，不自动补写未经证明的事实。',
  },
  P01_CHUNK_MERGE_VALIDATION_FAILED: {
    retryable: false,
    action: 'inspect_chunk_integrity',
    message: '分块合并未通过完整性校验；检查 chunk 顺序、去重和缺块记录。',
  },
}

export function recoveryAdviceForErrorCode(errorCode: string | undefined): HarnessRecoveryAdvice {
  if (errorCode && ADVICE_BY_CODE[errorCode]) return ADVICE_BY_CODE[errorCode]
  return {
    retryable: false,
    action: 'inspect_harness_events',
    message: '错误未匹配已知恢复策略；先查看 Harness 事件和阶段输入摘要，再决定是否重试。',
  }
}
