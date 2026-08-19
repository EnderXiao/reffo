import Taro from '@tarojs/taro'
import {parseApi} from '@/services/parse'
import {
  canUseBrowserFilePicker,
  pickBrowserFile,
  readBrowserTextFile,
} from '@/utils/web-file'

export const RESUME_FILE_ACCEPT_TYPES = ['.pdf', '.doc', '.docx', '.md', '.txt'] as const
export const RESUME_FILE_MAX_SIZE_MB = 10

const TEXT_FILE_TYPES = new Set(['.md', '.txt'])
const SUPPORTED_RESUME_FILE_TYPES = new Set<string>(RESUME_FILE_ACCEPT_TYPES)
const FILE_PICK_CANCEL_PATTERN = /cancel|取消/i

export interface ParsedResumeUploadFile {
  name: string
  path: string
  size: number
  extension: string
  extractedText: string
  file?: File
}

interface PickedResumeFile {
  name: string
  path: string
  size: number
  file?: File
}

interface PickAndParseResumeFileOptions {
  isActive?: () => boolean
  onFileSelected?: (file: Omit<ParsedResumeUploadFile, 'extractedText'>) => void
  onProgress?: (progress: number) => void
  allowGuest?: boolean
}

function wait(duration: number) {
  return new Promise<void>(resolve => {
    setTimeout(resolve, duration)
  })
}

function readTextFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fileManager = Taro.getFileSystemManager?.()

    if (!fileManager?.readFile) {
      reject(new Error('当前环境暂不支持读取该文件'))
      return
    }

    fileManager.readFile({
      filePath,
      encoding: 'utf8',
      success: result => resolve(String(result.data ?? '')),
      fail: reject,
    })
  })
}

export function getResumeFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function formatResumeFileSize(size: number) {
  const sizeInMb = size / (1024 * 1024)
  if (sizeInMb >= 1) {
    return `${sizeInMb.toFixed(sizeInMb >= 10 ? 0 : 1)} Mb`
  }

  return `${Math.max(1, Math.round(size / 1024))} Kb`
}

export function isResumeFileUploadCancelled(error: unknown) {
  const message = typeof error === 'object' && error !== null
    ? `${(error as {message?: string}).message || ''}${(error as {errMsg?: string}).errMsg || ''}`
    : String(error || '')

  return FILE_PICK_CANCEL_PATTERN.test(message)
}

export async function pickAndParseResumeFile({
  isActive = () => true,
  onFileSelected,
  onProgress,
  allowGuest = false,
}: PickAndParseResumeFileOptions = {}): Promise<ParsedResumeUploadFile | null> {
  const canPickBrowserFile = canUseBrowserFilePicker()
  const browserFile = canPickBrowserFile
    ? await pickBrowserFile({accept: RESUME_FILE_ACCEPT_TYPES})
    : null

  if (canPickBrowserFile && !browserFile) {
    return null
  }

  const response = browserFile
    ? {tempFiles: [browserFile]}
    : await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: RESUME_FILE_ACCEPT_TYPES.map(type => type.replace('.', '')),
      })
  const selectedFile = response.tempFiles?.[0] as PickedResumeFile | undefined

  if (!selectedFile) {
    return null
  }

  const extension = getResumeFileExtension(selectedFile.name)
  if (!SUPPORTED_RESUME_FILE_TYPES.has(extension)) {
    throw new Error('仅支持 PDF、DOC、DOCX、MD、TXT 文件')
  }

  if (selectedFile.size > RESUME_FILE_MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`文件不能超过 ${RESUME_FILE_MAX_SIZE_MB}MB`)
  }

  const pendingFile = {
    name: selectedFile.name,
    path: selectedFile.path,
    size: selectedFile.size,
    extension,
    file: selectedFile.file,
  }

  onFileSelected?.(pendingFile)
  onProgress?.(18)

  await wait(120)
  if (!isActive()) {
    return null
  }

  onProgress?.(52)

  let extractedText: string
  if (TEXT_FILE_TYPES.has(extension)) {
    extractedText = selectedFile.file
      ? await readBrowserTextFile(selectedFile.file)
      : await readTextFile(selectedFile.path)
  } else if (extension === '.pdf') {
    const parsedDocument = await parseApi.parseResumeFile(selectedFile, {landing: allowGuest})
    extractedText = parsedDocument.markdown?.trim() || parsedDocument.rawText.trim()
  } else {
    throw new Error('暂不支持 DOC/DOCX 解析，请另存为 PDF、MD 或 TXT')
  }

  if (!isActive()) {
    return null
  }

  const normalizedResume = extractedText.trim()
  if (!normalizedResume) {
    throw new Error('文件解析结果为空，请更换文件后重试')
  }

  onProgress?.(84)
  await wait(120)

  if (!isActive()) {
    return null
  }

  return {
    ...pendingFile,
    extractedText: normalizedResume,
  }
}
