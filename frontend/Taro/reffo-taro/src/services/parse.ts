import Taro from '@tarojs/taro'
import * as FileSystem from 'expo-file-system'
import {apiClient} from './api'
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
  content_base64: string
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

function getMimeType(file: BrowserPickedFile, fallbackMimeType: string) {
  return file.file?.type || fallbackMimeType
}

async function buildPayload(file: BrowserPickedFile, fallbackMimeType: string): Promise<ParseFilePayload> {
  return {
    file_name: file.name,
    mime_type: getMimeType(file, fallbackMimeType),
    content_base64: await readPickedFileAsBase64(file),
  }
}

export class ParseApi {
  async parseResumeFile(file: BrowserPickedFile): Promise<ParsedDocumentResult> {
    const payload = await buildPayload(file, 'application/pdf')
    return apiClient.post<ParsedDocumentResult>('/parse/resume-file', payload, {timeout: 180000})
  }

  async parseJobDescriptionImage(file: BrowserPickedFile): Promise<ParsedDocumentResult> {
    const payload = await buildPayload(file, 'image/png')
    return apiClient.post<ParsedDocumentResult>('/parse/jd-image', payload, {timeout: 60000})
  }
}

export const parseApi = new ParseApi()
