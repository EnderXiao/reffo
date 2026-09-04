import type { ZodTypeAny } from 'zod'
import { env } from '@/config/env'
import { createDigest } from '@/harness/run-context'
import type { ChatMessage } from '@/providers/llm-provider'
import { zodResponseFormat } from 'openai/helpers/zod'
import {
  blindABEvaluationSchema,
  blockingFactJudgeResultSchema,
  blockingFactJudgeResultSchemaWithIssueLimit,
  generatedResumeArtifactSchema,
  interviewPreparationSchema,
  jobExtractionCandidateSchema,
  resumeExtractionCandidateSchema,
  resumeExtractionCandidateSchemaWithFactLimit,
  resumeQualityJudgeResultSchema,
  strategyResolutionSchema,
  v5MatchAnalysisSchema,
  v5ResumePlanSchema,
  repairPatchSchema,
} from '@/v5/schemas'
import { resumeExtractionFactCandidateLimit } from '@/v5/chunked-resume-extraction'
import { buildV5SystemPrompt, buildV5UserPrompt, loadV5Prompt, type V5PromptComponent, V5_PROMPT_VERSIONS } from '@/v5/prompts'
import {
  V5_ADAPTIVE_POLICY_VERSION,
  V5_SCHEMA_VERSION,
  V5_SCORE_FORMULA_VERSION,
  V5_VALIDATOR_VERSION,
  V5_WORKFLOW_VERSION,
} from '@/v5/types'

const TEMPERATURES: Record<V5PromptComponent, number> = {
  P01: 0,
  P01R: 0,
  P02: 0,
  P02R: 0,
  P03: 0.1,
  P03R: 0,
  P04: 0,
  P05: 0.05,
  P05R: 0,
  P06: 0.15,
  P07: 0.05,
  P08: 0,
  P08R: 0,
  P09: 0,
  P10: 0.2,
  P10R: 0,
  P11: 0,
  P12: 0,
}

const OUTPUT_TOKEN_BASE: Record<V5PromptComponent, number> = {
  P01: 12000,
  P01R: 12000,
  P02: 6000,
  P02R: 6000,
  P03: 5000,
  P03R: 5000,
  P04: 1800,
  P05: 7000,
  P05R: 7000,
  P06: 8000,
  P07: 8000,
  P08: 8000,
  P08R: 2400,
  P09: 8000,
  P10: 4500,
  P10R: 4500,
  P11: 3500,
  P12: 5000,
}

export interface CompiledV5Prompt {
  component: V5PromptComponent
  messages: ChatMessage[]
  schema: ZodTypeAny
  schemaName: string
  temperature: number
  maxOutputTokens: number
  promptVersion: string
  promptSha256: string
  estimatedInputTokens: number
  contextWindowTokens: number
  manifest: {
    workflowVersion: string
    componentPromptId: string
    componentPromptVersion: string
    compiledPromptSha256: string
    schemaVersion: string
    validatorVersion: string
    adaptivePolicyVersion: string
    scoreFormulaVersion: string
    temperature: number
    inputDocumentIds: string[]
    repairAttempt: number
    promptFileSha256: string
    promptFilePath: string
    inputSummary: V5PromptInputSummary
  }
}

export interface V5PromptInputSummary {
  envelopeBytes: number
  envelopeTopLevelFields: string[]
  messageCount: number
  messageCharacterCounts: number[]
  estimatedInputTokens: number
}

function canonicalResumeBlockCount(value: unknown, depth = 0): number | null {
  if (depth > 8 || typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = canonicalResumeBlockCount(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  const document = record.canonicalSourceDocument
  if (typeof document === 'object' && document !== null) {
    const blocks = (document as Record<string, unknown>).blocks
    if (Array.isArray(blocks)) return blocks.length
  }
  for (const nested of Object.values(record)) {
    const found = canonicalResumeBlockCount(nested, depth + 1)
    if (found !== null) return found
  }
  return null
}

function artifactClaimCount(value: unknown, depth = 0): number | null {
  if (depth > 8 || typeof value !== 'object' || value === null) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = artifactClaimCount(item, depth + 1)
      if (found !== null) return found
    }
    return null
  }
  const record = value as Record<string, unknown>
  const artifact = record.artifact
  if (typeof artifact === 'object' && artifact !== null) {
    const claims = (artifact as Record<string, unknown>).claims
    if (Array.isArray(claims)) return claims.length
  }
  for (const nested of Object.values(record)) {
    const found = artifactClaimCount(nested, depth + 1)
    if (found !== null) return found
  }
  return null
}

export function schemaForV5Component(component: V5PromptComponent, envelope?: unknown): ZodTypeAny {
  switch (component) {
    case 'P01':
    case 'P01R': {
      const blockCount = canonicalResumeBlockCount(envelope)
      return blockCount === null
        ? resumeExtractionCandidateSchema
        : resumeExtractionCandidateSchemaWithFactLimit(resumeExtractionFactCandidateLimit(blockCount))
    }
    case 'P02':
    case 'P02R':
      return jobExtractionCandidateSchema
    case 'P03':
    case 'P03R':
      return v5MatchAnalysisSchema
    case 'P04':
      return strategyResolutionSchema
    case 'P05':
    case 'P05R':
      return v5ResumePlanSchema
    case 'P06':
    case 'P07':
    case 'P08':
      return generatedResumeArtifactSchema
    case 'P08R':
      return repairPatchSchema
    case 'P09': {
      const claimCount = artifactClaimCount(envelope)
      return claimCount === null
        ? blockingFactJudgeResultSchema
        : blockingFactJudgeResultSchemaWithIssueLimit(claimCount)
    }
    case 'P10':
    case 'P10R':
      return interviewPreparationSchema
    case 'P11':
      return resumeQualityJudgeResultSchema
    case 'P12':
      return blindABEvaluationSchema
  }
}

function estimateTokens(value: string) {
  const cjk = (value.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const remaining = Math.max(0, value.length - cjk)
  return Math.ceil(cjk / 1.6 + remaining / 4)
}

function topLevelFields(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>).sort()
}

function calculateMaxOutputTokens(component: V5PromptComponent, envelopeLength: number) {
  const structuralHeadroom = Math.ceil(OUTPUT_TOKEN_BASE[component] * 1.2)
  if (component === 'P01' || component === 'P01R') {
    return Math.min(16000, Math.max(structuralHeadroom, Math.ceil(envelopeLength * 2)))
  }
  const inputScaled = Math.ceil(envelopeLength / 8)
  return Math.min(32000, Math.max(structuralHeadroom, inputScaled))
}

export class V5PromptBudgetError extends Error {
  readonly code = 'V5_CONTEXT_BUDGET_EXCEEDED'
  constructor(
    readonly component: V5PromptComponent,
    readonly estimatedInputTokens: number,
    readonly contextWindowTokens: number
  ) {
    super(`${component} 预计输入 ${estimatedInputTokens} tokens，超过保守上下文预算 ${contextWindowTokens}。`)
    this.name = 'V5PromptBudgetError'
  }
}

export function compileV5Prompt(input: {
  component: V5PromptComponent
  envelope: unknown
  inputDocumentIds?: string[]
  repairAttempt?: number
}): CompiledV5Prompt {
  const serializedEnvelope = JSON.stringify(input.envelope)
  const schema = schemaForV5Component(input.component, input.envelope)
  const schemaName = `reffo_${input.component.toLowerCase()}_${V5_SCHEMA_VERSION.replaceAll('.', '_')}`
  const outputContract = zodResponseFormat(schema, schemaName).json_schema.schema
  const messages: ChatMessage[] = [
    { role: 'system', content: buildV5SystemPrompt(input.component) },
    {
      role: 'user',
      content: `${buildV5UserPrompt(input.component, serializedEnvelope)}\n\nSTRICT_OUTPUT_JSON_SCHEMA:\n${JSON.stringify(outputContract)}`,
    },
  ]
  const promptSha256 = createDigest(messages)
  const promptVersion = V5_PROMPT_VERSIONS[input.component]
  const promptFile = loadV5Prompt(input.component)
  const temperature = TEMPERATURES[input.component]
  const estimatedInputTokens = estimateTokens(messages.map(message => message.content).join('\n'))
  const inputSummary: V5PromptInputSummary = {
    envelopeBytes: new TextEncoder().encode(serializedEnvelope).byteLength,
    envelopeTopLevelFields: topLevelFields(input.envelope),
    messageCount: messages.length,
    messageCharacterCounts: messages.map(message => message.content.length),
    estimatedInputTokens,
  }
  const desiredOutputTokens = calculateMaxOutputTokens(input.component, serializedEnvelope.length)
  const availableOutputTokens = env.V5_CONTEXT_WINDOW_TOKENS - estimatedInputTokens - 2048
  const minimumOutputTokens = Math.min(OUTPUT_TOKEN_BASE[input.component], desiredOutputTokens)
  if (availableOutputTokens < minimumOutputTokens) {
    throw new V5PromptBudgetError(input.component, estimatedInputTokens, env.V5_CONTEXT_WINDOW_TOKENS)
  }
  const maxOutputTokens = Math.max(minimumOutputTokens, Math.min(desiredOutputTokens, availableOutputTokens))

  return {
    component: input.component,
    messages,
    schema,
    schemaName,
    temperature,
    maxOutputTokens,
    promptVersion,
    promptSha256,
    estimatedInputTokens,
    contextWindowTokens: env.V5_CONTEXT_WINDOW_TOKENS,
    manifest: {
      workflowVersion: V5_WORKFLOW_VERSION,
      componentPromptId: input.component,
      componentPromptVersion: promptVersion,
      compiledPromptSha256: promptSha256,
      schemaVersion: V5_SCHEMA_VERSION,
      validatorVersion: V5_VALIDATOR_VERSION,
      adaptivePolicyVersion: V5_ADAPTIVE_POLICY_VERSION,
      scoreFormulaVersion: V5_SCORE_FORMULA_VERSION,
      temperature,
      inputDocumentIds: input.inputDocumentIds ?? [],
      repairAttempt: input.repairAttempt ?? 0,
      promptFileSha256: promptFile.sha256,
      promptFilePath: promptFile.filePath,
      inputSummary,
    },
  }
}
