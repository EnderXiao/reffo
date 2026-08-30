import Taro from '@tarojs/taro'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import {parseApi} from '@/services/parse'
import {
  canUseBrowserFilePicker,
  pickBrowserFile,
  type BrowserPickedFile,
} from '@/utils/web-file'
import {formatResumeFileSize} from '@/utils/resume-file-upload'
import type {UploadedJobDescriptionFile} from '../types'
import {
  extractJobMetadataFromOcrText,
  normalizeCompanyNameCandidate,
  resolveBaseLocationCandidate,
  resolvePositionNameCandidate,
} from './jobMetadata'

export const JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES = [
  '.png',
  '.jpg',
  '.jpeg',
] as const

export const JOB_DESCRIPTION_FILE_MAX_SIZE_MB = 10

const SUPPORTED_JOB_DESCRIPTION_FILE_TYPES = new Set<string>(
  JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES,
)

export function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

export function getJobDescriptionFileValidationMessage(file: BrowserPickedFile) {
  if (!SUPPORTED_JOB_DESCRIPTION_FILE_TYPES.has(getFileExtension(file.name))) {
    return '仅支持 PNG、JPG、JPEG 图片'
  }

  if (file.size > JOB_DESCRIPTION_FILE_MAX_SIZE_MB * 1024 * 1024) {
    return `文件不能超过 ${JOB_DESCRIPTION_FILE_MAX_SIZE_MB}MB`
  }

  return null
}

export async function pickJobDescriptionFile(): Promise<BrowserPickedFile | null> {
  const canPickBrowserFile = canUseBrowserFilePicker()
  const browserFile = canPickBrowserFile
    ? await pickBrowserFile({accept: JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES})
    : null

  if (browserFile) {
    return browserFile
  }

  if (canPickBrowserFile) {
    return null
  }

  const chooseMessageFile = (Taro as any).chooseMessageFile

  if (typeof chooseMessageFile === 'function') {
    const response = await chooseMessageFile({
      count: 1,
      type: 'file',
      extension: JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES.map(type => type.replace('.', '')),
    })

    return response.tempFiles?.[0] ?? null
  }

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

  if (!permission.granted) {
    throw new Error('未获得相册访问权限')
  }

  const imageResult = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: false,
    quality: 1,
  })

  if (imageResult.canceled) {
    return null
  }

  const asset = imageResult.assets?.[0]

  if (!asset?.uri) {
    return null
  }

  const fileInfo = await FileSystem.getInfoAsync(asset.uri)

  return {
    name: asset.fileName || asset.uri.split('/').pop() || 'job-description.png',
    path: asset.uri,
    size: fileInfo.exists && 'size' in fileInfo && typeof fileInfo.size === 'number'
      ? fileInfo.size
      : asset.fileSize || 0,
  }
}

export async function parseJobDescriptionAttachment(file: BrowserPickedFile) {
  const attachment: UploadedJobDescriptionFile = {
    name: file.name,
    path: file.path,
    size: file.size,
    extension: getFileExtension(file.name),
    sizeLabel: formatResumeFileSize(file.size),
    previewPath: file.path,
  }
  const parsedDocument = await parseApi.parseJobDescriptionImage(file)
  const parsedJob = parsedDocument.structured
  const content = parsedJob?.jdText?.trim() || parsedDocument.rawText.trim()

  if (!content) {
    throw new Error('JD 图片解析结果为空，请重新上传或切换到文字输入')
  }

  const metadata = extractJobMetadataFromOcrText(content)
  const companyName = normalizeCompanyNameCandidate(parsedJob?.companyName || '')
  const positionName = resolvePositionNameCandidate(
    parsedJob?.positionName || '',
    metadata.positionName,
  )
  const baseLocation = resolveBaseLocationCandidate(
    [metadata.baseLocation],
    [companyName, metadata.companyName, positionName],
  )

  return {
    attachment,
    content,
    companyName: companyName || metadata.companyName,
    positionName,
    baseLocation,
  }
}
