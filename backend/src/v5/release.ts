import {V5_THINKING_MODE} from '@/config/deepseek-thinking'
import { env } from '@/config/env'
import { v5ReleaseWorkflowOptions } from '@/config/v5-release'
import manifest from '@/v5/prompts/manifest.json'
import { ENTRY_LAYOUT_VERSION } from '@/v5/writing/entry-layout'

export function getV5ReleaseDescriptor() {
  const profile = 'resume-linked-release-v1' as const
  const writerVersion = manifest.variants.P06C_ENTRY
  return { profile, environment: env.APP_ENV, model: env.AI_MODEL,
    thinkingMode: V5_THINKING_MODE,
    extractionThinkingMode: V5_THINKING_MODE,
    interviewThinkingMode: V5_THINKING_MODE,
    reasoningEffort: null,
    ...v5ReleaseWorkflowOptions(),
    writerPromptVersion: writerVersion,
    deliveryPolicy: 'five-element-cloze-v4',
    completionDocumentVersion: 'resume-completion-v4',
    layoutVersion: ENTRY_LAYOUT_VERSION }
}
