import Taro from '@tarojs/taro'
import * as FileSystem from 'expo-file-system'
import {apiClient} from './api'
import {authApi, type AuthSession} from './auth'
import type {BrowserPickedFile} from '@/utils/web-file'

export interface OcrUsage {
  inputTokens?: number
  outputTokens?: number
  costCny?: number
  latencyMs?: number
}

export interface ParsedJobDescriptionResult {
  companyName: string
  positionName: string
  location?: string
  jdText: string
  responsibilities: string[]
  requirements: string[]
}

export interface ParsedDocumentResult {
  provider: 'glm-ocr'
  fileName: string
  fileType: 'pdf' | 'image'
  rawText: string
  markdown?: string
  structured?: ParsedJobDescriptionResult
  usage?: OcrUsage
  warnings: string[]
  run_id?: string
}

interface ParseFilePayload {
  file_name: string
  mime_type: string
  content_base64?: string
  bucket?: string
  storage_path?: string
  size_bytes?: number
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('文件读取失败'))
        return
      }

      resolve(result.replace(/^data:[^;]+;base64,/, ''))
    }

    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsDataURL(file)
  })
}

function readPathWithTaroFileSystem(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileManager = Taro.getFileSystemManager?.()

    if (!fileManager?.readFile) {
      reject(new Error('当前环境暂不支持读取该文件'))
      return
    }

    fileManager.readFile({
      filePath: path,
      encoding: 'base64',
      success: result => resolve(String(result.data ?? '')),
      fail: reject,
    })
  })
}

async function readPickedFileAsBase64(file: BrowserPickedFile) {
  if (file.file) {
    return readFileAsBase64(file.file)
  }

  try {
    return await readPathWithTaroFileSystem(file.path)
  } catch (error) {
    if (typeof FileSystem.readAsStringAsync === 'function') {
      return FileSystem.readAsStringAsync(file.path, {
        encoding: 'base64' as never,
      })
    }

    throw error
  }
}

function getSupabaseStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '') || ''
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || ''
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'user-files'

  if (!supabaseUrl || !publishableKey) {
    return null
  }

  return {supabaseUrl, publishableKey, bucket}
}

function sanitizeStorageFileName(fileName: string) {
  return fileName
    .trim()
    .replace(/[^\w.\-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'upload'
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], {type: mimeType})
}

async function uploadToSupabaseStorage(input: {
  file: BrowserPickedFile
  base64: string
  mimeType: string
  purpose: 'resume' | 'jobDescription'
  session: AuthSession
}) {
  const config = getSupabaseStorageConfig()

  if (!config) {
    return null
  }

  const safeName = sanitizeStorageFileName(input.file.name)
  const storagePath = `${input.session.user.id}/${input.purpose}/${Date.now()}-${safeName}`
  const response = await fetch(
    `${config.supabaseUrl}/storage/v1/object/${config.bucket}/${storagePath}`,
    {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        Authorization: `Bearer ${input.session.accessToken}`,
        'Content-Type': input.mimeType,
        'x-upsert': 'false',
      },
      body: base64ToBlob(input.base64, input.mimeType),
    },
  )

  if (!response.ok) {
    throw new Error('上传文件失败')
  }

  return {
    bucket: config.bucket,
    storage_path: storagePath,
    size_bytes: Math.ceil(input.base64.length * 0.75),
  }
}

function getMimeType(file: BrowserPickedFile, fallbackMimeType: string) {
  return file.file?.type || fallbackMimeType
}

async function buildPayload(
  file: BrowserPickedFile,
  fallbackMimeType: string,
  purpose: 'resume' | 'jobDescription',
): Promise<ParseFilePayload> {
  const mimeType = getMimeType(file, fallbackMimeType)
  const contentBase64 = await readPickedFileAsBase64(file)
  const session = await authApi.restoreSession()
  const storageFile = session
    ? await uploadToSupabaseStorage({
      file,
      base64: contentBase64,
      mimeType,
      purpose,
      session,
    })
    : null

  if (storageFile) {
    return {
      file_name: file.name,
      mime_type: mimeType,
      ...storageFile,
    }
  }

  return {
    file_name: file.name,
    mime_type: mimeType,
    content_base64: contentBase64,
  }
}

export class ParseApi {
  async parseResumeFile(file: BrowserPickedFile): Promise<ParsedDocumentResult> {
    const payload = await buildPayload(file, 'application/pdf', 'resume')
    return apiClient.post<ParsedDocumentResult>('/parse/resume-file', payload, {timeout: 180000})
  }

  async parseJobDescriptionImage(file: BrowserPickedFile): Promise<ParsedDocumentResult> {
    const payload = await buildPayload(file, 'image/png', 'jobDescription')
    return apiClient.post<ParsedDocumentResult>('/parse/jd-image', payload, {timeout: 60000})
  }
}

export const parseApi = new ParseApi()
