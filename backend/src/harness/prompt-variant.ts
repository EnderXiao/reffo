import { env } from '@/config/env'

export type PromptVariant = 'v1' | 'v2'

export function resolvePromptVariant(value?: string): PromptVariant {
  return value === 'v2' ? 'v2' : env.PROMPT_VARIANT === 'v2' ? 'v2' : 'v1'
}

export function getPromptVersion(name: string, variant: PromptVariant) {
  return `${name}.${variant}`
}

export function renderPromptVariantInstruction(variant: PromptVariant) {
  if (variant === 'v2') {
    return 'A/B Prompt v2：请更严格地区分源简历事实、JD 要求和模型推断；对不确定内容保持保守表达，不要补充未经来源支持的经历。'
  }

  return ''
}
