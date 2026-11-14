import {createDigest} from '@/harness/run-context'
import {env} from '@/config/env'
import {V5_WORKFLOW_VERSION} from '@/v5/types'
import manifest from '@/v5/prompts/manifest.json'
import {ENTRY_WRITING_POLICY,SKELETON_POLICY_VERSION} from '@/v5/writing/entries'
import {V5_PROMPT_BUDGET_VERSION,V5_PROMPT_MAX_OUTPUT_TOKENS} from '@/v5/prompt-compiler'

// 版本读取真实 Prompt manifest；变更模型、思考模式或 Prompt 后旧检查点不能混用。
export function singleStepFingerprint() {
  return createDigest({workflow: V5_WORKFLOW_VERSION, manifest, protocol: 'v5-single-step-v3',
    writer: ENTRY_WRITING_POLICY, skeleton: SKELETON_POLICY_VERSION, document: 'resume-completion-v2',
    promptBudget: {version: V5_PROMPT_BUDGET_VERSION, ceilings: V5_PROMPT_MAX_OUTPUT_TOKENS,
      contextWindowTokens: env.V5_CONTEXT_WINDOW_TOKENS},
    model: env.AI_MODEL, endpoint: env.OPENAI_BASE_URL, thinking: env.DEEPSEEK_THINKING_MODE,
    extractionThinking: env.DEEPSEEK_P01_THINKING_MODE, structuredOutput: env.V5_STRUCTURED_OUTPUT_MODE})
}
