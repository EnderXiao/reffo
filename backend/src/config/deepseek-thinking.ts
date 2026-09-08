export interface DeepSeekThinkingSettings {
  mode: 'default' | 'enabled' | 'disabled'
  effort: 'low' | 'high' | 'max'
}

export type DeepSeekExtractionThinkingMode = 'inherit' | 'enabled' | 'disabled'

export function parseDeepSeekExtractionThinking(value = 'inherit'): DeepSeekExtractionThinkingMode {
  if (value !== 'inherit' && value !== 'enabled' && value !== 'disabled') throw new Error('INVALID_DEEPSEEK_P01_THINKING_MODE')
  return value
}

/** Only trusted request metadata selects a stage, never text in a résumé. */
export function isResumeExtractionRequest(input: {
  promptManifest?: { componentPromptId: string }
  promptVersion?: string
}) {
  const component = input.promptManifest?.componentPromptId
  if (component !== undefined) return component === 'P01' || component === 'P01R'
  return /^5\.0\.0-p01(?:-resume-evidence|r-resume-evidence-repair)-r\d+$/u.test(input.promptVersion ?? '')
}

export function resolveDeepSeekStageThinking(
  global: DeepSeekThinkingSettings,
  extractionMode: DeepSeekExtractionThinkingMode,
  extractionRequest: boolean
): DeepSeekThinkingSettings {
  return extractionRequest && extractionMode !== 'inherit'
    ? { ...global, mode: extractionMode }
    : global
}

/** Pure configuration shared by the request adapter and the cache fingerprint. */
export function parseDeepSeekThinking(mode = 'default', effort = 'high'): DeepSeekThinkingSettings {
  if (mode !== 'default' && mode !== 'enabled' && mode !== 'disabled') throw new Error('INVALID_DEEPSEEK_THINKING_MODE')
  if (effort !== 'low' && effort !== 'high' && effort !== 'max') throw new Error('INVALID_DEEPSEEK_REASONING_EFFORT')
  return { mode, effort }
}

export function deepSeekThinkingParameters(model: string, endpoint: string, settings: DeepSeekThinkingSettings) {
  if (settings.mode === 'default') return {}
  if (!/^https:\/\/api\.deepseek\.com(?:\/v1)?\/?$/u.test(endpoint)
    || !/^deepseek-v4-(?:flash|pro)$/u.test(model)) throw new Error('DEEPSEEK_THINKING_MODEL_MISMATCH')
  return settings.mode === 'enabled'
    ? { thinking: { type: 'enabled' as const }, reasoning_effort: settings.effort }
    : { thinking: { type: 'disabled' as const } }
}

export function evaluationDeepSeekPolicy(model: string, mode?: string, effort?: string) {
  const settings = parseDeepSeekThinking(mode, effort)
  if (model === 'deepseek-chat' && settings.mode === 'default') return null
  if (model !== 'deepseek-v4-flash' || settings.mode === 'default') throw new Error('EVALUATION_MODEL_OR_MODE_NOT_APPROVED')
  return { version: 'deepseek-thinking-v1' as const, model,
    ...deepSeekThinkingParameters(model, 'https://api.deepseek.com', settings),
    outputAccounting: 'completion_tokens_including_reasoning' as const }
}
