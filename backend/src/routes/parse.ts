import { Elysia, t } from 'elysia'
import { env } from '@/config/env'
import { OcrParseWorkflow } from '@/workflows/ocr-parse-workflow'
import { OcrProviderError, type OcrFileType, type OcrPurpose } from '@/services/ocr/types'
import type { ApiResponse } from '@/types'

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg'])
const PDF_MIME_TYPES = new Set(['application/pdf'])
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg'])
const PDF_EXTENSIONS = new Set(['pdf'])

interface ParseBody {
  file_name: string
  mime_type: string
  content_base64: string
}

function getExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : ''
}

function decodeBase64(contentBase64: string) {
  const normalized = contentBase64.replace(/^data:[^;]+;base64,/, '')
  return Buffer.from(normalized, 'base64')
}

function validateFile(input: {
  fileName: string
  mimeType: string
  buffer: Buffer
  allowedMimeTypes: Set<string>
  allowedExtensions: Set<string>
}) {
  const extension = getExtension(input.fileName)
  const maxBytes = env.OCR_MAX_FILE_SIZE_MB * 1024 * 1024

  if (input.buffer.byteLength <= 0) {
    return '文件内容为空'
  }

  if (input.buffer.byteLength > maxBytes) {
    return `文件不能超过 ${env.OCR_MAX_FILE_SIZE_MB}MB`
  }

  if (!input.allowedExtensions.has(extension)) {
    return '文件类型不支持'
  }

  if (!input.allowedMimeTypes.has(input.mimeType.toLowerCase())) {
    return '文件 MIME 类型不支持'
  }

  return null
}

async function parseDocument(body: ParseBody, purpose: OcrPurpose, fileType: OcrFileType) {
  const buffer = decodeBase64(body.content_base64)
  const validationError = validateFile({
    fileName: body.file_name,
    mimeType: body.mime_type,
    buffer,
    allowedMimeTypes: fileType === 'image' ? IMAGE_MIME_TYPES : PDF_MIME_TYPES,
    allowedExtensions: fileType === 'image' ? IMAGE_EXTENSIONS : PDF_EXTENSIONS,
  })

  if (validationError) {
    throw new OcrProviderError('OCR_UNSUPPORTED_FILE', validationError)
  }

  const workflow = new OcrParseWorkflow()
  return workflow.run({
    fileName: body.file_name,
    mimeType: body.mime_type,
    fileType,
    buffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    purpose,
  })
}

function toErrorResponse(error: unknown) {
  if (error instanceof OcrProviderError) {
    return {
      status: error.status && error.status >= 400 ? error.status : 400,
      response: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      } satisfies ApiResponse<never>,
    }
  }

  return {
    status: 500,
    response: {
      success: false,
      error: {
        code: 'OCR_PARSE_FAILED',
        message: error instanceof Error ? error.message : '文件解析失败',
      },
    } satisfies ApiResponse<never>,
  }
}

export const parseRoutes = new Elysia({ prefix: '/api/v1/parse' })
  .post(
    '/resume-file',
    async ({ body, set }) => {
      try {
        const result = await parseDocument(body, 'resume', 'pdf')
        return {
          success: true,
          data: result,
        } satisfies ApiResponse<typeof result>
      } catch (error) {
        const { status, response } = toErrorResponse(error)
        set.status = status
        return response
      }
    },
    {
      body: t.Object({
        file_name: t.String({ minLength: 1, description: '文件名' }),
        mime_type: t.String({ minLength: 1, description: 'MIME 类型' }),
        content_base64: t.String({ minLength: 1, description: '文件 base64 内容' }),
      }),
      detail: {
        summary: '解析简历 PDF',
        description: '使用 GLM-OCR 解析简历 PDF，返回 Markdown 文本和 OCR 使用量信息',
        tags: ['Parse'],
      },
    }
  )
  .post(
    '/jd-image',
    async ({ body, set }) => {
      try {
        const result = await parseDocument(body, 'jobDescription', 'image')
        return {
          success: true,
          data: result,
        } satisfies ApiResponse<typeof result>
      } catch (error) {
        const { status, response } = toErrorResponse(error)
        set.status = status
        return response
      }
    },
    {
      body: t.Object({
        file_name: t.String({ minLength: 1, description: '文件名' }),
        mime_type: t.String({ minLength: 1, description: 'MIME 类型' }),
        content_base64: t.String({ minLength: 1, description: '文件 base64 内容' }),
      }),
      detail: {
        summary: '解析 JD 图片',
        description: '使用 GLM-OCR 解析岗位图片，返回岗位文本、公司名和岗位名等结构化信息',
        tags: ['Parse'],
      },
    }
  )
