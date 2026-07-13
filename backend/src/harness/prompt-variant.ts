import { PROMPT_VARIANT, PROMPT_VERSION } from '@/prompts/prompts'

export type PromptVariant = typeof PROMPT_VARIANT

export function resolvePromptVariant(_value?: string): PromptVariant {
  return PROMPT_VARIANT
}

export function getPromptVersion(name: string, variant: PromptVariant) {
  return `${name}.${variant}.${PROMPT_VERSION}`
}
