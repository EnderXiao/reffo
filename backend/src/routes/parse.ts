import { Elysia, t } from 'elysia'
import { resolveRequestUser } from '@/auth/request-context'
import { env, getOcrEnvStatus } from '@/config/env'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
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
  content_base64?: string
  bucket?: string
  storage_path?: string
  size_bytes?: number
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

async function downloadStorageObject(input: {
  bucket: string
  storagePath: string
  accessToken: string
}) {
  const objectPath = `${input.bucket}/${input.storagePath}`
  const response = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/${objectPath}`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${input.accessToken}`,
    },
  })

  if (!response.ok) {
    throw new OcrProviderError('STORAGE_FILE_DOWNLOAD_FAILED', '读取上传文件失败', { status: response.status })
  }

  return Buffer.from(await response.arrayBuffer())
}

async function getParseBuffer(
  body: ParseBody,
  headers: Record<string, string | undefined>,
) {
  if (body.storage_path) {
    const userContext = await resolveRequestUser(headers)

    if (!userContext.accessToken) {
      throw new OcrProviderError('AUTH_REQUIRED', '请先登录后再上传文件', { status: 401 })
    }

    const bucket = body.bucket || env.SUPABASE_STORAGE_BUCKET
    const buffer = await downloadStorageObject({
      bucket,
      storagePath: body.storage_path,
      accessToken: userContext.accessToken,
    })

    await createSupabaseRestClient({
      accessToken: userContext.accessToken,
      useServiceRole: false,
    }).request('/rest/v1/user_files', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        user_id: userContext.userId,
        purpose: body.storage_path.includes('/jobDescription/') ? 'jobDescription' : 'resume',
        bucket,
        storage_path: body.storage_path,
        original_file_name: body.file_name,
        mime_type: body.mime_type,
        size_bytes: body.size_bytes ?? buffer.byteLength,
      },
    })

    return buffer
  }

  if (!body.content_base64) {
    throw new OcrProviderError('OCR_FILE_MISSING', '文件内容为空')
  }

  return decodeBase64(body.content_base64)
}

async function parseDocument(
  body: ParseBody,
  headers: Record<string, string | undefined>,
  purpose: OcrPurpose,
  fileType: OcrFileType,
) {
  const buffer = await getParseBuffer(body, headers)
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
    console.error('[Parse Error]', JSON.stringify({
      code: error.code,
      message: error.message,
      status: error.status,
    }))

    return {
      status: error.status && error.status >= 400 ? error.status : 400,
      response: {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      } satisfies ApiResponse<never>,
    }
  }

  console.error('[Parse Error]', error)

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
  .get(
    '/health',
    () => ({
      success: true,
      data: getOcrEnvStatus(),
    }),
    {
      detail: {
        summary: 'OCR 配置状态',
        description: '返回 GLM-OCR 是否已配置，以及缺失的环境变量。',
        tags: ['Parse'],
      },
    }
  )
  .post(
    '/resume-file',
    async ({ body, headers, set }) => {
      try {
        const result = await parseDocument(body, headers, 'resume', 'pdf')
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
        content_base64: t.Optional(t.String({ minLength: 1, description: '文件 base64 内容' })),
        bucket: t.Optional(t.String({ minLength: 1, description: 'Supabase Storage bucket' })),
        storage_path: t.Optional(t.String({ minLength: 1, description: 'Supabase Storage object path' })),
        size_bytes: t.Optional(t.Number({ description: '文件大小' })),
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
    async ({ body, headers, set }) => {
      try {
        const result = await parseDocument(body, headers, 'jobDescription', 'image')
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
        content_base64: t.Optional(t.String({ minLength: 1, description: '文件 base64 内容' })),
        bucket: t.Optional(t.String({ minLength: 1, description: 'Supabase Storage bucket' })),
        storage_path: t.Optional(t.String({ minLength: 1, description: 'Supabase Storage object path' })),
        size_bytes: t.Optional(t.Number({ description: '文件大小' })),
      }),
      detail: {
        summary: '解析 JD 图片',
        description: '使用 GLM-OCR 解析岗位图片，返回岗位文本、公司名和岗位名等结构化信息',
        tags: ['Parse'],
      },
    }
  )
