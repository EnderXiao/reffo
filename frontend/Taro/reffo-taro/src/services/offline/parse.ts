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
  provider: 'local'
  fileName: string
  fileType: 'pdf' | 'image' | 'text'
  rawText: string
  markdown?: string
  structured?: ParsedJobDescriptionResult
  usage?: OcrUsage
  warnings: string[]
  run_id?: string
}

function readTextFile(file: BrowserPickedFile): Promise<string> {
  const pickedFile = file.file
  if (!pickedFile) {
    return Promise.reject(new Error('离线小工具无法读取该文件，请粘贴文本内容'))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('文件读取失败'))
      }
    }
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(pickedFile)
  })
}

function isTextFile(name: string) {
  return /\.(md|markdown|txt)$/i.test(name)
}

export class ParseApi {
  async parseResumeFile(file: BrowserPickedFile, _options?: {landing?: boolean}): Promise<ParsedDocumentResult> {
    if (!isTextFile(file.name)) {
      throw new Error('离线小工具仅支持 Markdown 或 TXT，请直接粘贴简历内容')
    }

    const rawText = (await readTextFile(file)).trim()
    if (!rawText) {
      throw new Error('文件内容为空')
    }

    return {
      provider: 'local',
      fileName: file.name,
      fileType: 'text',
      rawText,
      markdown: rawText,
      warnings: ['使用本地文本读取，未进行 OCR'],
    }
  }

  async parseJobDescriptionImage(_file: BrowserPickedFile): Promise<ParsedDocumentResult> {
    throw new Error('离线小工具不支持图片 OCR，请切换到文字输入')
  }
}

export const parseApi = new ParseApi()
