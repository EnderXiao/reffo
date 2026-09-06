import type { ZodTypeAny } from 'zod'
import { env } from '@/config/env'
import { createDigest } from '@/harness/run-context'
import type { ChatMessage } from '@/providers/llm-provider'
import { zodResponseFormat } from 'openai/helpers/zod'
import { p06CompositionOutputSchema } from '@/v5/composition/contract'
import { p06DslOutputSchema } from '@/v5/composition/dsl'
import { isJobTargetedEnvelope, jobFitMapSchema, targetedJobExtractionSchema } from '@/v5/targeting/contracts'
import { resumeDocumentFromEnvelope, resumeExtractionTransportSchema } from '@/v5/resume-extraction-transport'
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
} from '@/v5/schemas'
import {
  DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  estimateResumeExtractionOutputTokens,
  resumeExtractionRawFactCandidateLimit,
} from '@/v5/chunked-resume-extraction'
import { buildV5SystemPrompt, buildV5UserPrompt, loadV5Prompt, type V5PromptComponent, V5_PROMPT_VERSIONS } from '@/v5/prompts'
import {
  V5_ADAPTIVE_POLICY_VERSION,
  V5_SCHEMA_VERSION,
  V5_SCORE_FORMULA_VERSION,
  V5_VALIDATOR_VERSION,
  V5_WORKFLOW_VERSION,
  type SourceBlock,
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
  P06C: 0.1,
  P06D: 0,
  P07: 0.05,
  P08: 0,
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
  P06C: 3600,
  P06D: 2200,
  P07: 8000,
  P08: 8000,
  P09: 8000,
  P10: 4500,
  P10R: 4500,
  P11: 3500,
  P12: 5000,
}

export const V5_PROMPT_MAX_OUTPUT_TOKENS: Readonly<Record<V5PromptComponent, number>> = Object.freeze({
  P01: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  P01R: DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
  P02: 7200,
  P02R: 7200,
  P03: 6000,
  P03R: 6000,
  P04: 2160,
  P05: 8400,
  P05R: 8400,
  P06: 9600,
  P06C: 4800,
  P06D: 3000,
  P07: 9600,
  P08: 9600,
  P09: 9600,
  P10: 5400,
  P10R: 5400,
  P11: 4200,
  P12: 6000,
})

export interface CompiledV5Prompt {
  component: V5PromptComponent
  messages: ChatMessage[]
  schema: ZodTypeAny
  providerSchema: ZodTypeAny
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
  }
}

function canonicalResumeBlocks(
  value: unknown,
  depth = 0
): Array<{ text: string }> | null {
  if (depth > 8 || typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  // Repair output and issue details are model-controlled and must never size
  // the contract. Only the original source and known server envelope wrappers do.
  for (const key of ['originalEnvelope', 'payload'] as const) {
    const found = canonicalResumeBlocks(record[key], depth + 1)
    if (found !== null) return found
  }
  const document = record.canonicalSourceDocument
  if (typeof document === 'object' && document !== null) {
    const blocks = (document as Record<string, unknown>).blocks
    if (Array.isArray(blocks) && blocks.every(block => (
      typeof block === 'object'
      && block !== null
      && typeof (block as Record<string, unknown>).text === 'string'
    ))) {
      return blocks.map(block => ({ text: String((block as Record<string, unknown>).text) }))
    }
  }
  return null
}

/** Prompt-only reduction: keep the local Zod contract and every referenced definition intact. */
export function compactV5PromptJsonSchema(
  schema: Record<string, unknown>,
  schemaName: string
): Record<string, unknown> {
  const { definitions, $schema: dialect, ...root } = schema
  if (typeof definitions !== 'object' || definitions === null || Array.isArray(definitions)) return schema
  const definitionMap = definitions as Record<string, unknown>
  if (JSON.stringify(definitionMap[schemaName]) !== JSON.stringify(root)) return schema
  const remainingDefinitions = { ...definitionMap }
  delete remainingDefinitions[schemaName]
  const compacted = {
    ...root,
    ...(Object.keys(remainingDefinitions).length > 0 ? { definitions: remainingDefinitions } : {}),
    ...(dialect === undefined ? {} : { $schema: dialect }),
  }
  const pointer = `#/definitions/${schemaName.replaceAll('~', '~0').replaceAll('/', '~1')}`
  const referencesRoot = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(referencesRoot)
    if (typeof value !== 'object' || value === null) return false
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string') {
      let reference = record.$ref
      try { reference = decodeURIComponent(reference) } catch { /* Retain literal non-URI references. */ }
      if (reference === pointer || reference.startsWith(`${pointer}/`)) return true
    }
    return Object.values(record).some(referencesRoot)
  }
  return referencesRoot(compacted) ? schema : compacted
}

export function resumeExtractionOutputTokenCapForBlocks(
  blocks: readonly Pick<SourceBlock, 'text'>[]
) {
  return Math.min(
    DEFAULT_RESUME_EXTRACTION_MAX_ESTIMATED_OUTPUT_TOKENS,
    Math.max(Math.ceil(OUTPUT_TOKEN_BASE.P01 * 1.2), estimateResumeExtractionOutputTokens(blocks))
  )
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
      const blocks = canonicalResumeBlocks(envelope)
      return blocks === null
        ? resumeExtractionCandidateSchema
        : resumeExtractionCandidateSchemaWithFactLimit(
            resumeExtractionRawFactCandidateLimit(blocks)
          )
    }
    case 'P02':
    case 'P02R':
      return isJobTargetedEnvelope(envelope) ? targetedJobExtractionSchema : jobExtractionCandidateSchema
    case 'P03':
    case 'P03R':
      return isJobTargetedEnvelope(envelope) ? jobFitMapSchema : v5MatchAnalysisSchema
    case 'P04':
      return strategyResolutionSchema
    case 'P05':
    case 'P05R':
      return v5ResumePlanSchema
    case 'P06':
    case 'P07':
    case 'P08':
      return generatedResumeArtifactSchema
    case 'P06C':
      return p06CompositionOutputSchema
    case 'P06D':
      return p06DslOutputSchema
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

export function estimateV5TextTokens(value: string) {
  const cjk = (value.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const remaining = Math.max(0, value.length - cjk)
  return Math.ceil(cjk / 1.6 + remaining / 4)
}

export function estimateV5PromptInputTokens(messages: readonly ChatMessage[]) {
  return estimateV5TextTokens(messages.map(message => message.content).join('\n'))
}

function calculateMaxOutputTokens(component: V5PromptComponent, envelope: unknown, envelopeLength: number) {
  const structuralHeadroom = Math.ceil(OUTPUT_TOKEN_BASE[component] * 1.2)
  if (component === 'P01' || component === 'P01R') {
    return resumeExtractionOutputTokenCapForBlocks(canonicalResumeBlocks(envelope) ?? [])
  }
  const inputScaled = Math.ceil(envelopeLength / 8)
  return Math.min(V5_PROMPT_MAX_OUTPUT_TOKENS[component], Math.max(structuralHeadroom, inputScaled))
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
  const extractionDocument = input.component === 'P01' || input.component === 'P01R'
    ? resumeDocumentFromEnvelope(input.envelope) : null
  const providerSchema = extractionDocument ? resumeExtractionTransportSchema(extractionDocument) : schema
  const schemaName = input.component === 'P06C'
    ? 'reffo_p06c_composition_v1'
    : input.component === 'P06D'
      ? 'reffo_p06d_dsl_v1'
    : `reffo_${input.component.toLowerCase()}_${V5_SCHEMA_VERSION.replaceAll('.', '_')}`
  const generatedOutputContract = zodResponseFormat(providerSchema, schemaName).json_schema.schema
  if (!generatedOutputContract) throw new Error(`${input.component} JSON Schema 生成失败。`)
  const outputContract = compactV5PromptJsonSchema(generatedOutputContract, schemaName)
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
  const estimatedInputTokens = estimateV5PromptInputTokens(messages)
  const desiredOutputTokens = calculateMaxOutputTokens(input.component, input.envelope, serializedEnvelope.length)
  const availableOutputTokens = env.V5_CONTEXT_WINDOW_TOKENS - estimatedInputTokens - 2048
  const minimumOutputTokens = input.component === 'P01' || input.component === 'P01R'
    ? desiredOutputTokens
    : Math.min(OUTPUT_TOKEN_BASE[input.component], desiredOutputTokens)
  if (availableOutputTokens < minimumOutputTokens) {
    throw new V5PromptBudgetError(input.component, estimatedInputTokens, env.V5_CONTEXT_WINDOW_TOKENS)
  }
  const maxOutputTokens = Math.max(minimumOutputTokens, Math.min(desiredOutputTokens, availableOutputTokens))

  return {
    component: input.component,
    messages,
    schema,
    providerSchema,
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
      inputSummary: {
        envelopeBytes: serializedEnvelope.length,
        envelopeTopLevelFields: Object.keys(input.envelope ?? {}).sort(),
        messageCount: messages.length,
        messageCharacterCounts: messages.map(message => message.content.length),
        estimatedInputTokens,
      },
      promptFileSha256: promptFile.sha256,
      promptFilePath: promptFile.filePath,
    },
  }
}
