import { z } from 'zod'
import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
import { buildResumeJudgeMessages } from '@/prompts/prompts'
import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'
import { fallbackLlmProvider } from '@/providers/fallback-provider'
import type { LlmProvider } from '@/providers/llm-provider'
import type { MatchAnalysis, ResumeAnalysis } from '@/types'
import type { EvaluationResult } from '@/harness/evaluators/markdown-resume-evaluator'

const evaluationIssueSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
}).passthrough()

const evaluationResultSchema = z.object({
  evaluatorName: z.string(),
  evaluatorVersion: z.string(),
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  issues: z.array(evaluationIssueSchema),
}).passthrough()

function isEvaluationResult(value: unknown): value is EvaluationResult {
  return evaluationResultSchema.safeParse(value).success
}

export interface LlmJudgeInput {
  resumeAnalysis: ResumeAnalysis
  matchAnalysis: MatchAnalysis
  optimizedResume: string
  promptVariant?: string
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
  provider?: LlmProvider
}

export async function judgeResumeWithLlm(input: LlmJudgeInput): Promise<EvaluationResult> {
  const provider = input.provider ?? fallbackLlmProvider
  const promptVariant = resolvePromptVariant(input.promptVariant)

  const response = await provider.complete({
    messages: buildResumeJudgeMessages(input),
    responseFormat: 'json_object',
    temperature: 0,
    promptVersion: getPromptVersion('llm-resume-judge', promptVariant),
    eventBus: input.eventBus,
    stepContext: input.stepContext,
  })

  return await parseJsonOutput({
    content: response.content,
    validator: isEvaluationResult,
    outputName: 'LlmJudgeEvaluation',
    eventBus: input.eventBus,
    stepContext: input.stepContext,
  })
}
