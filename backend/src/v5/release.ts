import { env } from '@/config/env'
import { v5ReleaseWorkflowOptions } from '@/config/v5-release'
import manifest from '@/v5/prompts/manifest.json'
import { ENTRY_LAYOUT_VERSION } from '@/v5/writing/entry-layout'

export function getV5ReleaseDescriptor() {
  const profile = env.V5_RELEASE_PROFILE
  const writerVersion = manifest.variants.P06C_ENTRY
  if (profile === 'entry-r5' && writerVersion !== '5.2.0-p06c-entry-writer-r5') {
    throw new Error('V5_RELEASE_PROMPT_VERSION_MISMATCH')
  }
  return { profile, environment: env.APP_ENV, model: env.AI_MODEL,
    thinkingMode: env.DEEPSEEK_THINKING_MODE, extractionThinkingMode: env.DEEPSEEK_P01_THINKING_MODE,
    ...v5ReleaseWorkflowOptions(profile),
    writerPromptVersion: profile === 'entry-r5' ? writerVersion : null,
    layoutVersion: profile === 'entry-r5' ? ENTRY_LAYOUT_VERSION : null }
}
