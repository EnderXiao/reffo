import { env } from '@/config/env'
import { createDigest } from '@/harness/run-context'
import { createHarnessEvent } from '@/harness/events'
import type {
  OcrProvider,
  OcrProviderOptions,
  OcrUsage,
  ParsedDocumentResult,
  ParsedJobDescriptionResult,
  ParseDocumentInput,
} from '@/services/ocr/types'
import { OcrProviderError } from '@/services/ocr/types'

interface GlmLayoutParsingResponse {
  id?: string
  request_id?: string
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    input_tokens?: number
    output_tokens?: number
  }
  choices?: Array<{
    message?: {
      content?: string
    }
    content?: string
    finish_reason?: string
  }>
  content?: string
  text?: string
  markdown?: string
  md_results?: string | string[]
  data?: unknown
  error?: {
    code?: string
    message?: string
  }
}

const COST_PER_MILLION_TOKENS_CNY = 0.2

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function normalizeLayoutParsingEndpoint(value: string) {
  const endpoint = trimTrailingSlash(value)
  return endpoint.endsWith('/layout_parsing') ? endpoint : `${endpoint}/layout_parsing`
}

function resolveEndpoint() {
  const configuredEndpoint = env.GLM_OCR_ENDPOINT || env.GLM_ENDPOINT
  const baseUrl = env.GLM_OCR_BASE_URL || env.GLM_BASE_URL

  if (configuredEndpoint) {
    return normalizeLayoutParsingEndpoint(configuredEndpoint)
  }

  return normalizeLayoutParsingEndpoint(baseUrl)
}

function getApiKey() {
  return env.GLM_OCR_API_KEY || env.GLM_API_KEY
}

function toBase64(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString('base64')
}

function formatDataUri(input: ParseDocumentInput) {
  return `data:${input.mimeType};base64,${toBase64(input.buffer)}`
}

function pickText(response: GlmLayoutParsingResponse) {
  if (Array.isArray(response.md_results)) return response.md_results.join('\n\n')
  if (typeof response.md_results === 'string') return response.md_results
  if (typeof response.markdown === 'string') return response.markdown
  if (typeof response.content === 'string') return response.content
  if (typeof response.text === 'string') return response.text

  const choiceContent = response.choices?.find(choice => {
    const content = choice.message?.content ?? choice.content
    return typeof content === 'string' && content.trim().length > 0
  })

  if (choiceContent) {
    return choiceContent.message?.content ?? choiceContent.content ?? ''
  }

  if (response.data && typeof response.data === 'object') {
    const nestedData = response.data as { md_results?: unknown; markdown?: unknown; content?: unknown; text?: unknown }
    if (Array.isArray(nestedData.md_results)) return nestedData.md_results.join('\n\n')
    if (typeof nestedData.md_results === 'string') return nestedData.md_results
    if (typeof nestedData.markdown === 'string') return nestedData.markdown
    if (typeof nestedData.content === 'string') return nestedData.content
    if (typeof nestedData.text === 'string') return nestedData.text
  }

  if (response.data) {
    return JSON.stringify(response.data)
  }

  return ''
}

function normalizeList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(item => String(item).trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|；|;|、/)
      .map(item => item.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean)
  }

  return []
}

function extractJsonBlock(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? value
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')

  if (start < 0 || end <= start) {
    return null
  }

  return candidate.slice(start, end + 1)
}

function parseStructuredJobDescription(text: string): ParsedJobDescriptionResult | undefined {
  const jsonBlock = extractJsonBlock(text)
  if (!jsonBlock) {
    return undefined
  }

  try {
    const parsed = JSON.parse(jsonBlock) as Record<string, unknown>
    const companyName = typeof parsed.companyName === 'string'
      ? parsed.companyName
      : typeof parsed.company_name === 'string'
        ? parsed.company_name
        : ''
    const positionName = typeof parsed.positionName === 'string'
      ? parsed.positionName
      : typeof parsed.position_name === 'string'
        ? parsed.position_name
        : ''
    const jdText = typeof parsed.jdText === 'string'
      ? parsed.jdText
      : typeof parsed.jd_text === 'string'
        ? parsed.jd_text
        : text

    return {
      companyName: companyName.trim(),
      positionName: positionName.trim(),
      jdText: jdText.trim() || text.trim(),
      responsibilities: normalizeList(parsed.responsibilities),
      requirements: normalizeList(parsed.requirements),
    }
  } catch {
    return undefined
  }
}

function buildStructuredJobDescriptionFromText(text: string): ParsedJobDescriptionResult {
  const companyMatch = text.match(/(?:公司名称|公司|Company)[:：\s]+([^\n]+)/i)
  const positionMatch = text.match(/(?:岗位名称|职位名称|岗位|职位|Position|Title)[:：\s]+([^\n]+)/i)
  const requirementLines = text
    .split('\n')
    .map(line => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(line => /要求|熟练|精通|经验|能力|技能|负责|职责|Type/i.test(line))

  return {
    companyName: companyMatch?.[1]?.trim() ?? '',
    positionName: positionMatch?.[1]?.trim() ?? '',
    jdText: text.trim(),
    responsibilities: requirementLines.filter(line => /负责|职责/.test(line)),
    requirements: requirementLines.filter(line => !/负责|职责/.test(line)),
  }
}

function buildUsage(response: GlmLayoutParsingResponse, latencyMs: number): OcrUsage {
  const inputTokens = response.usage?.input_tokens ?? response.usage?.prompt_tokens
  const outputTokens = response.usage?.output_tokens ?? response.usage?.completion_tokens
  const totalTokens = response.usage?.total_tokens ?? (inputTokens ?? 0) + (outputTokens ?? 0)

  return {
    inputTokens,
    outputTokens,
    costCny: totalTokens > 0 ? Number(((totalTokens / 1000000) * COST_PER_MILLION_TOKENS_CNY).toFixed(6)) : undefined,
    latencyMs,
  }
}

function resolveErrorCode(status: number) {
  if (status === 401 || status === 403) return 'OCR_AUTH_FAILED'
  if (status === 429) return 'OCR_RATE_LIMITED'
  if (status === 408 || status === 504) return 'OCR_TIMEOUT'
  return 'OCR_REQUEST_FAILED'
}

export class GlmOcrProvider implements OcrProvider {
  async parseDocument(input: ParseDocumentInput, options: OcrProviderOptions = {}): Promise<ParsedDocumentResult> {
    const apiKey = getApiKey()
    if (!apiKey) {
      throw new OcrProviderError('OCR_CONFIG_MISSING', 'GLM-OCR API Key 未配置')
    }

    const endpoint = resolveEndpoint()
    const startedAt = Date.now()
    const inputDigest = createDigest({
      fileName: input.fileName,
      mimeType: input.mimeType,
      fileType: input.fileType,
      purpose: input.purpose,
      byteLength: input.buffer.byteLength,
    })

    if (options.eventBus && options.stepContext) {
      await options.eventBus.publish(createHarnessEvent({
        type: 'provider.requested',
        runId: options.stepContext.runId,
        requestId: options.stepContext.requestId,
        stepRunId: options.stepContext.stepRunId,
        attemptId: options.stepContext.attemptId,
        payload: {
          provider: 'glm-ocr',
          model: env.GLM_OCR_MODEL,
          promptVersion: input.purpose === 'jobDescription' ? 'ocr-jd:v1' : 'ocr-resume:v1',
          inputDigest,
        },
      }))
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), env.OCR_TIMEOUT_MS)
    const abortFromStep = () => controller.abort()
    input.signal?.addEventListener('abort', abortFromStep, { once: true })

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: env.GLM_OCR_MODEL,
          file: formatDataUri(input),
          return_crop_images: false,
          need_layout_visualization: false,
        }),
        signal: controller.signal,
      })

      const latencyMs = Date.now() - startedAt
      const responseText = await response.text()
      let payload: GlmLayoutParsingResponse

      try {
        payload = responseText ? JSON.parse(responseText) : {}
      } catch {
        payload = { text: responseText }
      }

      if (!response.ok || payload.error) {
        throw new OcrProviderError(
          resolveErrorCode(response.status),
          payload.error?.message || `GLM-OCR 请求失败（HTTP ${response.status}）`,
          { status: response.status, details: payload.error }
        )
      }

      const rawText = pickText(payload).trim()
      if (!rawText) {
        throw new OcrProviderError('OCR_EMPTY_OUTPUT', 'GLM-OCR 未返回可用文本')
      }

      const structured = input.purpose === 'jobDescription'
        ? parseStructuredJobDescription(rawText) ?? buildStructuredJobDescriptionFromText(rawText)
        : undefined
      const usage = buildUsage(payload, latencyMs)
      const result: ParsedDocumentResult = {
        provider: 'glm-ocr',
        fileName: input.fileName,
        fileType: input.fileType,
        rawText: structured?.jdText || rawText,
        markdown: input.purpose === 'resume' ? rawText : undefined,
        structured,
        usage,
        warnings: [],
      }

      if (options.eventBus && options.stepContext) {
        await options.eventBus.publish(createHarnessEvent({
          type: 'provider.responded',
          runId: options.stepContext.runId,
          requestId: options.stepContext.requestId,
          stepRunId: options.stepContext.stepRunId,
          attemptId: options.stepContext.attemptId,
          payload: {
            provider: 'glm-ocr',
            model: payload.model || env.GLM_OCR_MODEL,
            providerRequestId: payload.id || payload.request_id,
            finishReason: payload.choices?.[0]?.finish_reason || 'stop',
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            latencyMs,
            outputDigest: createDigest({
              rawText: result.rawText,
              markdown: result.markdown,
              structured: result.structured,
            }),
          },
        }))
      }

      console.log('[GLM-OCR]', JSON.stringify({
        fileName: input.fileName,
        fileType: input.fileType,
        purpose: input.purpose,
        byteLength: input.buffer.byteLength,
        latencyMs,
      }))

      return result
    } catch (error) {
      if (error instanceof OcrProviderError) {
        throw error
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new OcrProviderError('OCR_TIMEOUT', 'GLM-OCR 解析超时')
      }

      throw new OcrProviderError(
        'OCR_REQUEST_FAILED',
        error instanceof Error ? error.message : 'GLM-OCR 请求失败',
        { details: error }
      )
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', abortFromStep)
    }
  }
}

export const glmOcrProvider = new GlmOcrProvider()
