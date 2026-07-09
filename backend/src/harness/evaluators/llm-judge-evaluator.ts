import { z } from 'zod'
import { parseJsonOutput } from '@/harness/json-output'
import { getPromptVersion, resolvePromptVariant } from '@/harness/prompt-variant'
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
  const prompt = `你是一位严格的简历质量审查员。请基于源简历分析、匹配分析和优化后的简历，判断优化简历是否忠于事实且适合投递。

简历分析：
\`\`\`json
${JSON.stringify(input.resumeAnalysis, null, 2)}
\`\`\`

匹配分析：
\`\`\`json
${JSON.stringify(input.matchAnalysis, null, 2)}
\`\`\`

优化后的简历：
\`\`\`markdown
${input.optimizedResume}
\`\`\`

请严格返回 JSON：
{
  "evaluatorName": "llm-resume-judge",
  "evaluatorVersion": "v1",
  "passed": true,
  "score": 0-100,
  "issues": [{ "severity": "info|warning|error", "code": "问题代码", "message": "问题说明", "path": "可选位置" }]
}

判断重点：不得编造经历；是否覆盖 JD 核心要求；表达是否夸大；是否适合直接投递。`

  const response = await provider.complete({
    messages: [{ role: 'user', content: prompt }],
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
