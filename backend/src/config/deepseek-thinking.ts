export const V5_THINKING_MODE = 'disabled' as const

export function deepSeekThinkingParameters(model: string, endpoint: string) {
  if (!/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/u.test(endpoint)
    || !/^(?:deepseek-chat|deepseek-v4-(?:flash|pro))$/u.test(model)) {
    throw new Error('DEEPSEEK_THINKING_MODEL_MISMATCH')
  }
  return { thinking: { type: V5_THINKING_MODE } }
}

export function evaluationDeepSeekPolicy(model: string) {
  if (model !== 'deepseek-v4-flash' && model !== 'deepseek-chat') throw new Error('EVALUATION_MODEL_NOT_APPROVED')
  return { version: 'deepseek-thinking-v1' as const, model,
    ...deepSeekThinkingParameters(model, 'https://api.deepseek.com'),
    outputAccounting: 'completion_tokens_including_reasoning' as const }
}
