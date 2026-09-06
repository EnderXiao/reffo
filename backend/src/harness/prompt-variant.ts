import { PROMPT_VARIANT, PROMPT_VERSION } from '@/prompts/prompts'

export type PromptVariant = typeof PROMPT_VARIANT

export function resolvePromptVariant(_value?: string): PromptVariant {
  return PROMPT_VARIANT
}

export function getPromptVersion(name: string, variant: PromptVariant) {
  const revision = /^(?:jd-parser|matching)(?:\.|$)/u.test(name) ? '.requirements-r1' : ''
  return `${name}.${variant}.${PROMPT_VERSION}${revision}`
}
