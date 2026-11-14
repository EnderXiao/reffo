export interface HarnessRecoveryAdvice {
  retryable: boolean
  action: string
  message: string
}

const ADVICE_BY_CODE: Record<string, HarnessRecoveryAdvice> = {
  RESUME_STAGE_BUSY: {
    retryable: true,
    action: 'retry_preserved_checkpoint',
    message: '相同输入的阶段正在处理或恢复中，已有检查点已保留；稍后重试将复用已完成阶段，本次不会再发起同阶段模型调用。',
  },
  V6_LLM_CALL_BUDGET_EXCEEDED: {
    retryable: false,
    action: 'reduce_context_or_disable_optional_stage',
    message: '已达到本次 LLM 调用预算；缩小上下文或关闭可选阶段后再试。',
  },
  V5_CONTEXT_BUDGET_EXCEEDED: {
    retryable: false,
    action: 'reduce_context_or_split_input',
    message: '阶段请求连同输出预留超过安全窗口；检查是否重复携带草稿，缩小修复范围或按目标拆分后再执行。不要仅要求用户缩短源材料。',
  },
  P03_VALIDATION_FAILED: {
    retryable: false,
    action: 'inspect_stage_validation',
    message: '岗位匹配在有界修复后仍未通过；检查精确岗位边界、证据引用和校验误报，保留已通过的阶段，不重复提交同一修复请求。',
  },
  V5_SCHEMA_VALIDATION_FAILED: {
    retryable: false,
    action: 'inspect_stage_validation',
    message: '结构化结果未符合阶段契约；检查错误字段与局部修复范围，不把无效结构当作已验证事实放行。',
  },
  V5_OUTPUT_TRUNCATED: {
    retryable: false,
    action: 'retry_with_thinking_disabled_and_reduced_scope',
    message: '模型输出被截断；有界 thinking 降级已耗尽，需减少输出范围或提高结构化输出预算后再试。',
  },
  V5_JSON_PARSE_FAILED: {
    retryable: false,
    action: 'repair_structured_json_output',
    message: '结构化输出在一次有界 JSON 修复后仍未通过；检查阶段输出契约和 Harness 事件。',
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
