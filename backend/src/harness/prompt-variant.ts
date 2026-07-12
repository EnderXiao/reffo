import { FINAL_PROMPT_VARIANT, FINAL_PROMPT_VERSION } from '@/prompts/final-prompts'

export type PromptVariant = typeof FINAL_PROMPT_VARIANT

export function resolvePromptVariant(_value?: string): PromptVariant {
  return FINAL_PROMPT_VARIANT
}

export function getPromptVersion(name: string, variant: PromptVariant) {
  return `${name}.${variant}.${FINAL_PROMPT_VERSION}`
}
