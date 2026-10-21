/** 公共接口固定使用同一套 R5 编排，不读取环境变量选择工作流。 */
export function v5ReleaseWorkflowOptions() {
  return { artifactGenerationMode: 'writer_v1' as const, jobTargetingPolicy: 'job-targeted-v1' as const,
    entryWritingPolicy: 'entry-writing-v1' as const }
}

export function assertV5ReleaseConfiguration(config: {
  AI_MODEL: string; OPENAI_BASE_URL: string
  DEEPSEEK_THINKING_MODE: string; DEEPSEEK_P01_THINKING_MODE: string
}) {
  if (config.AI_MODEL !== 'deepseek-v4-flash'
    || config.OPENAI_BASE_URL.replace(/\/$/u, '') !== 'https://api.deepseek.com'
    || !['enabled', 'disabled'].includes(config.DEEPSEEK_THINKING_MODE)
    || !['enabled', 'disabled'].includes(config.DEEPSEEK_P01_THINKING_MODE)) {
    throw new Error('entry-r5 requires the release configuration: DeepSeek endpoint, deepseek-v4-flash, and explicit global/P01 thinking modes')
  }
}

export function assertV5ProductionWorkflow(config: {APP_ENV: string}, options: {
  artifactGenerationMode: string; jobTargetingPolicy?: string; entryWritingPolicy?: string
}) {
  if (config.APP_ENV !== 'prod' || !options.jobTargetingPolicy) return
  if (options.artifactGenerationMode !== 'writer_v1'
    || options.jobTargetingPolicy !== 'job-targeted-v1' || options.entryWritingPolicy !== 'entry-writing-v1') {
    throw new Error('JOB_TARGETING_NOT_PRODUCTION_ACCEPTED')
  }
}
