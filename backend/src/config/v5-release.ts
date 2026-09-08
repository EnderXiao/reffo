export type V5ReleaseProfile = 'legacy-dsl' | 'entry-r5'

export function parseV5ReleaseProfile(value: string | undefined): V5ReleaseProfile {
  const profile = value?.trim() || 'legacy-dsl'
  if (profile !== 'legacy-dsl' && profile !== 'entry-r5') throw new Error('V5_RELEASE_PROFILE must be legacy-dsl or entry-r5')
  return profile
}

/** One coherent rollout switch; request bodies cannot select generation modes. */
export function v5ReleaseWorkflowOptions(profile: V5ReleaseProfile) {
  return profile === 'entry-r5'
    ? { artifactGenerationMode: 'writer_v1' as const, jobTargetingPolicy: 'job-targeted-v1' as const,
      entryWritingPolicy: 'entry-writing-v1' as const }
    : { artifactGenerationMode: 'dsl_v1' as const }
}

export function assertV5ReleaseConfiguration(config: {
  V5_RELEASE_PROFILE: V5ReleaseProfile; AI_MODEL: string; OPENAI_BASE_URL: string
  DEEPSEEK_THINKING_MODE: string; DEEPSEEK_P01_THINKING_MODE: string
}) {
  if (config.V5_RELEASE_PROFILE !== 'entry-r5') return
  if (config.AI_MODEL !== 'deepseek-v4-flash'
    || config.OPENAI_BASE_URL.replace(/\/$/u, '') !== 'https://api.deepseek.com'
    || config.DEEPSEEK_THINKING_MODE !== 'disabled' || config.DEEPSEEK_P01_THINKING_MODE !== 'disabled') {
    throw new Error('entry-r5 requires the release configuration: DeepSeek endpoint, deepseek-v4-flash, global and P01 thinking disabled')
  }
}

export function assertV5ProductionWorkflow(config: {APP_ENV: string; V5_RELEASE_PROFILE: V5ReleaseProfile}, options: {
  artifactGenerationMode: string; jobTargetingPolicy?: string; entryWritingPolicy?: string
}) {
  if (config.APP_ENV !== 'prod' || !options.jobTargetingPolicy) return
  if (config.V5_RELEASE_PROFILE !== 'entry-r5' || options.artifactGenerationMode !== 'writer_v1'
    || options.jobTargetingPolicy !== 'job-targeted-v1' || options.entryWritingPolicy !== 'entry-writing-v1') {
    throw new Error('JOB_TARGETING_NOT_PRODUCTION_ACCEPTED')
  }
}
