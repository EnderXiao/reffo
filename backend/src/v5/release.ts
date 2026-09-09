import { env } from '@/config/env'
import { v5ReleaseWorkflowOptions } from '@/config/v5-release'
import manifest from '@/v5/prompts/manifest.json'
import { ENTRY_LAYOUT_VERSION } from '@/v5/writing/entry-layout'

export function getV5ReleaseDescriptor() {
  const profile = 'entry-r5' as const
  const writerVersion = manifest.variants.P06C_ENTRY
  return { profile, environment: env.APP_ENV, model: env.AI_MODEL,
    thinkingMode: env.DEEPSEEK_THINKING_MODE, extractionThinkingMode: env.DEEPSEEK_P01_THINKING_MODE,
    ...v5ReleaseWorkflowOptions(),
    writerPromptVersion: writerVersion,
    layoutVersion: ENTRY_LAYOUT_VERSION }
}
