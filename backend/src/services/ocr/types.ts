import type { HarnessEventBus } from '@/harness/event-bus'
import type { StepExecutionContext } from '@/harness/run-context'

export type OcrProviderName = 'glm-ocr'
export type OcrFileType = 'pdf' | 'image'
export type OcrPurpose = 'resume' | 'jobDescription'

export interface OcrProvider {
  parseDocument(input: ParseDocumentInput, options?: OcrProviderOptions): Promise<ParsedDocumentResult>
}

export interface OcrProviderOptions {
  eventBus?: HarnessEventBus
  stepContext?: StepExecutionContext
}

export interface ParseDocumentInput {
  fileName: string
  mimeType: string
  fileType: OcrFileType
  buffer: ArrayBuffer
  purpose: OcrPurpose
  signal?: AbortSignal
}

export interface ParsedDocumentResult {
  provider: OcrProviderName
  fileName: string
  fileType: OcrFileType
  rawText: string
  markdown?: string
  structured?: ParsedJobDescriptionResult
  usage?: OcrUsage
  warnings: string[]
}

export interface ParsedJobDescriptionResult {
  companyName: string
  positionName: string
  jdText: string
  responsibilities: string[]
  requirements: string[]
}

export interface OcrUsage {
  inputTokens?: number
  outputTokens?: number
  costCny?: number
  latencyMs?: number
}

export type OcrProviderErrorCode =
  | 'OCR_CONFIG_MISSING'
  | 'OCR_REQUEST_FAILED'
  | 'OCR_AUTH_FAILED'
  | 'OCR_RATE_LIMITED'
  | 'OCR_TIMEOUT'
  | 'OCR_UNSUPPORTED_FILE'
  | 'OCR_EMPTY_OUTPUT'

export class OcrProviderError extends Error {
  readonly code: OcrProviderErrorCode
  readonly status?: number
  readonly details?: unknown

  constructor(code: OcrProviderErrorCode, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message)
    this.name = 'OcrProviderError'
    this.code = code
    this.status = options.status
    this.details = options.details
  }
}
