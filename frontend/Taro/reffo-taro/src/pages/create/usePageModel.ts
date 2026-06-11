import {useEffect, useMemo, useRef, useState} from 'react'
import Taro, {useRouter} from '@tarojs/taro'
import {resumeApi} from '@/services/resume'
import {sourceResumeApi} from '@/services/sourceResume'
import {useJDStore, useResumeStore, useSourceResumeStore} from '@/store'
import type {SourceResumeSummary} from '@/types'
import {saveLatestResultSession} from '@/utils/result-session'
import {
  CREATE_STEP_META,
  CREATE_STEP_SEQUENCE,
  type CreateGenerationState,
  type CreateStepId,
  type CreateStepMeta,
  type JobDescriptionInputMode,
  type JobDescriptionStepState,
  type ResumeSummaryStepState,
  RESUME_FILE_ACCEPT_TYPES,
  RESUME_FILE_MAX_SIZE_MB,
  type ResumeUploadStepState,
  type UploadedJobDescriptionFile,
  type UploadedResumeFile,
} from './types'
import {
  buildSourceResumePayload,
  createUploadedFileMarkdownStub,
} from './utils/resumeMarkdown'

export interface CreatePageViewModel {
  currentStep: CreateStepId
  currentStepMeta: CreateStepMeta
  resumeUploadState: ResumeUploadStepState
  resumeSummaryState: ResumeSummaryStepState | null
  jobDescriptionState: JobDescriptionStepState
  generationState: CreateGenerationState | null
  canSaveCurrentStep: boolean
  isSavingCurrentStep: boolean
  handlePickResumeFile: () => Promise<void>
  handleRemoveResumeFile: () => void
  handleResumeMarkdownChange: (content: string) => void
  handleJobDescriptionChange: (content: string) => void
  handleJobCompanyNameChange: (content: string) => void
  handleJobPositionNameChange: (content: string) => void
  handleJobInputModeChange: (mode: JobDescriptionInputMode) => void
  handlePickJobAttachment: () => Promise<void>
  handlePrimaryAction: () => Promise<void>
  handleCancelGeneration: () => void
  handleClose: () => void
}

const TEXT_FILE_TYPES = new Set(['.md', '.txt'])
const JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES = [
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
] as const
const JOB_DESCRIPTION_FILE_MAX_SIZE_MB = 10
const CANCEL_PATTERN = /cancel|取消/i
const SUPPORTED_RESUME_FILE_TYPES = new Set<string>(RESUME_FILE_ACCEPT_TYPES)
const SUPPORTED_JOB_DESCRIPTION_FILE_TYPES = new Set<string>(
  JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES,
)

function createInitialResumeUploadState(): ResumeUploadStepState {
  return {
    status: 'idle',
    progress: 0,
    file: null,
    markdown: '',
    errorMessage: null,
  }
}

function createInitialJobDescriptionState(
  initialContent = '',
): JobDescriptionStepState {
  return {
    content: initialContent,
    companyName: '',
    positionName: '',
    inputMode: initialContent.trim() ? 'manual' : 'upload',
    attachmentStatus: 'idle',
    attachment: null,
    attachmentErrorMessage: null,
  }
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

function isSupportedResumeFile(fileName: string) {
  return SUPPORTED_RESUME_FILE_TYPES.has(getFileExtension(fileName))
}

function isSupportedJobDescriptionFile(fileName: string) {
  return SUPPORTED_JOB_DESCRIPTION_FILE_TYPES.has(getFileExtension(fileName))
}

function isTextFile(fileName: string) {
  return TEXT_FILE_TYPES.has(getFileExtension(fileName))
}

function formatFileSize(size: number) {
  const sizeInMb = size / (1024 * 1024)
  if (sizeInMb >= 1) {
    return `${sizeInMb.toFixed(sizeInMb >= 10 ? 0 : 1)} Mb`
  }

  return `${Math.max(1, Math.round(size / 1024))} Kb`
}

function isUserCancelled(error: unknown) {
  const message =
    typeof error === 'object' && error !== null
      ? `${(error as any).message || ''}${(error as any).errMsg || ''}`
      : String(error || '')

  return CANCEL_PATTERN.test(message)
}

function wait(duration: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), duration)
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

interface PickedTempFile {
  name: string
  path: string
  size: number
}

async function pickJobDescriptionFile(): Promise<PickedTempFile | null> {
  const chooseMessageFile = (Taro as any).chooseMessageFile

  if (typeof chooseMessageFile === 'function') {
    const response = await chooseMessageFile({
      count: 1,
      type: 'file',
      extension: JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES.map(type =>
        type.replace('.', ''),
      ),
    })

    return response.tempFiles?.[0] ?? null
  }

  const [ImagePicker, FileSystem] = await Promise.all([
    import('expo-image-picker'),
    import('expo-file-system'),
  ])
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()

  if (!permission.granted) {
    throw new Error('未获得相册权限')
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: false,
    quality: 1,
  })

  if (result.canceled || !result.assets?.length) {
    throw new Error('cancel')
  }

  const asset = result.assets[0]
  const fileInfo = await FileSystem.getInfoAsync(asset.uri, {size: true} as any)
  const fallbackName = asset.uri.split('/').pop() || `job-description-${Date.now()}.jpg`

  return {
    name: asset.fileName || fallbackName,
    path: asset.uri,
    size:
      typeof asset.fileSize === 'number'
        ? asset.fileSize
        : typeof (fileInfo as any)?.size === 'number'
          ? (fileInfo as any).size
          : 0,
  }
}

function normalizeRouteStep(value?: string): CreateStepId | null {
  if (!value) {
    return null
  }

  return CREATE_STEP_SEQUENCE.includes(value as CreateStepId)
    ? (value as CreateStepId)
    : null
}

function resolveInitialStep(
  requestedStep: CreateStepId | null,
  hasSourceResume: boolean,
) {
  if (!requestedStep || requestedStep === 'resumeUpload') {
    return 'resumeUpload' as const
  }

  return hasSourceResume ? requestedStep : 'resumeUpload'
}

function padDateUnit(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return `${date.getFullYear()}.${padDateUnit(date.getMonth() + 1)}.${padDateUnit(
    date.getDate(),
  )} ${padDateUnit(date.getHours())}:${padDateUnit(date.getMinutes())}`
}

function buildResumeSummaryState(
  latestSourceResume: SourceResumeSummary | null,
): ResumeSummaryStepState | null {
  if (!latestSourceResume) {
    return null
  }

  return {
    title: latestSourceResume.title,
    fileName:
      latestSourceResume.originalFileName || `${latestSourceResume.title}.md`,
    sizeLabel: null,
    updatedAtLabel: formatDateTime(latestSourceResume.updatedAt),
    sourceTypeLabel:
      latestSourceResume.sourceType === 'file' ? '来自文件上传' : 'Markdown 输入',
  }
}

function buildJobDescriptionPayload(state: JobDescriptionStepState) {
  const isUploadMode = state.inputMode === 'upload'
  const content = isUploadMode ? '' : state.content.trim()
  const attachmentNote = isUploadMode && state.attachment
    ? `岗位描述附件：${state.attachment.name}${
        state.attachment.sizeLabel ? `（${state.attachment.sizeLabel}）` : ''
      }`
    : null
  const uploadFallbackNote =
    isUploadMode && state.attachment
      ? '补充说明：用户通过上传截图/附件提供岗位信息；若附件内容无法直接解析，请优先结合公司名称和岗位名称理解岗位方向。'
      : null
  const segments = [
    state.companyName.trim()
      ? `公司名称：${state.companyName.trim()}`
      : null,
    state.positionName.trim()
      ? `岗位名称：${state.positionName.trim()}`
      : null,
    content || null,
    attachmentNote,
    uploadFallbackNote,
  ].filter(Boolean)

  return segments.join('\n\n')
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function readCardMonogram(...segments: Array<string | null | undefined>) {
  for (const segment of segments) {
    const normalized = segment?.trim()

    if (!normalized) {
      continue
    }

    const match = normalized.match(/[A-Za-z0-9\u4e00-\u9fa5]/u)

    if (match?.[0]) {
      return /[A-Za-z]/.test(match[0]) ? match[0].toUpperCase() : match[0]
    }
  }

  return 'R'
}

function buildGenerationState(args: {
  latestSourceResumeTitle?: string | null
  fallbackResumeFileName?: string | null
  jobDescriptionState: JobDescriptionStepState
}): CreateGenerationState {
  const {latestSourceResumeTitle, fallbackResumeFileName, jobDescriptionState} = args
  const resumeTitle = truncateText(
    latestSourceResumeTitle?.trim() ||
      fallbackResumeFileName?.trim() ||
      '未命名简历',
    28,
  )
  const companyName = truncateText(jobDescriptionState.companyName.trim(), 24)
  const positionName = truncateText(jobDescriptionState.positionName.trim(), 24)
  const descriptionSummary =
    jobDescriptionState.inputMode === 'upload'
      ? jobDescriptionState.attachment?.name
        ? `岗位附件 · ${truncateText(jobDescriptionState.attachment.name, 22)}`
        : ''
      : jobDescriptionState.content.trim()
        ? `岗位描述 · ${truncateText(
            jobDescriptionState.content.trim().replace(/\s+/g, ' '),
            22,
          )}`
        : ''
  const detailItems = [
    `简历 · ${resumeTitle}`,
    companyName ? `公司 · ${companyName}` : '',
    positionName ? `岗位 · ${positionName}` : '',
    descriptionSummary,
  ].filter(Boolean)

  return {
    resumeTitle,
    companyName,
    positionName,
    monogram: readCardMonogram(
      latestSourceResumeTitle,
      fallbackResumeFileName,
      jobDescriptionState.companyName,
      jobDescriptionState.positionName,
    ),
    detailItems,
  }
}

export function usePageModel(): CreatePageViewModel {
  const router = useRouter()
  const requestedStepRef = useRef(normalizeRouteStep(router.params?.step))
  const uploadRequestRef = useRef(0)
  const jobAttachmentRequestRef = useRef(0)
  const generationRequestRef = useRef(0)
  const initialSourceResume = useSourceResumeStore.getState().latestSourceResume
  const [currentStep, setCurrentStep] = useState<CreateStepId>(() =>
    resolveInitialStep(requestedStepRef.current, Boolean(initialSourceResume)),
  )
  const [hasResolvedLatestSourceResume, setHasResolvedLatestSourceResume] =
    useState(Boolean(initialSourceResume))
  const routeStepAppliedRef = useRef(
    !requestedStepRef.current ||
      requestedStepRef.current === 'resumeUpload' ||
      Boolean(initialSourceResume),
  )
  const [resumeUploadState, setResumeUploadState] = useState<ResumeUploadStepState>(
    createInitialResumeUploadState(),
  )
  const [jobDescriptionState, setJobDescriptionState] =
    useState<JobDescriptionStepState>(() =>
      createInitialJobDescriptionState(useJDStore.getState().jdContent),
    )
  const [generationState, setGenerationState] = useState<CreateGenerationState | null>(
    null,
  )
  const [isSavingCurrentStep, setIsSavingCurrentStep] = useState(false)
  const {
    latestSourceResume,
    loadLatestSourceResume,
  } = useSourceResumeStore()

  useEffect(() => {
    return () => {
      uploadRequestRef.current += 1
      jobAttachmentRequestRef.current += 1
      generationRequestRef.current += 1
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    void loadLatestSourceResume().finally(() => {
      if (isMounted) {
        setHasResolvedLatestSourceResume(true)
      }
    })

    return () => {
      isMounted = false
    }
  }, [loadLatestSourceResume])

  useEffect(() => {
    const requestedStep = requestedStepRef.current

    if (!requestedStep || routeStepAppliedRef.current) {
      return
    }

    if (!latestSourceResume && !hasResolvedLatestSourceResume) {
      return
    }

    setCurrentStep(latestSourceResume ? requestedStep : 'resumeUpload')
    routeStepAppliedRef.current = true
  }, [hasResolvedLatestSourceResume, latestSourceResume])

  useEffect(() => {
    if (!latestSourceResume?.resumeMarkdown) {
      return
    }

    useResumeStore.getState().setResumeContent(latestSourceResume.resumeMarkdown)
    setResumeUploadState(previous => {
      if (previous.markdown.trim()) {
        return previous
      }

      return {
        ...previous,
        markdown: latestSourceResume.resumeMarkdown,
        errorMessage: null,
      }
    })
  }, [latestSourceResume?.id, latestSourceResume?.resumeMarkdown])

  const currentStepMeta = CREATE_STEP_META[currentStep]
  const resumeSummaryState = useMemo(
    () => buildResumeSummaryState(latestSourceResume),
    [
    latestSourceResume?.id,
    latestSourceResume?.originalFileName,
    latestSourceResume?.sourceType,
    latestSourceResume?.title,
    latestSourceResume?.updatedAt,
    ],
  )

  const canSaveCurrentStep = useMemo(() => {
    if (currentStep === 'resumeUpload') {
      return (
        !isSavingCurrentStep &&
        resumeUploadState.status !== 'uploading' &&
        resumeUploadState.markdown.trim().length > 0
      )
    }

    if (currentStep === 'resumeSummary') {
      return !isSavingCurrentStep
    }

    const hasManualDescription = jobDescriptionState.content.trim().length > 0
    const hasUploadedAttachment =
      jobDescriptionState.attachmentStatus === 'success' &&
      Boolean(jobDescriptionState.attachment)

    const canSaveJobDescription =
      jobDescriptionState.inputMode === 'upload'
        ? hasUploadedAttachment
        : hasManualDescription

    return !isSavingCurrentStep && canSaveJobDescription
  }, [
    currentStep,
    isSavingCurrentStep,
    jobDescriptionState.attachment,
    jobDescriptionState.attachmentStatus,
    jobDescriptionState.content,
    jobDescriptionState.inputMode,
    resumeUploadState.markdown,
    resumeUploadState.status,
  ])

  const handleResumeMarkdownChange = (content: string) => {
    setResumeUploadState(previous => ({
      ...previous,
      markdown: content,
    }))
  }

  const handleJobDescriptionChange = (content: string) => {
    setJobDescriptionState(previous => ({
      ...previous,
      content,
      inputMode: 'manual',
    }))
  }

  const handleJobCompanyNameChange = (content: string) => {
    setJobDescriptionState(previous => ({
      ...previous,
      companyName: content,
    }))
  }

  const handleJobPositionNameChange = (content: string) => {
    setJobDescriptionState(previous => ({
      ...previous,
      positionName: content,
    }))
  }

  const handleJobInputModeChange = (mode: JobDescriptionInputMode) => {
    setJobDescriptionState(previous => ({
      ...previous,
      inputMode: mode,
    }))
  }

  const handleRemoveResumeFile = () => {
    uploadRequestRef.current += 1
    setResumeUploadState(previous => ({
      ...previous,
      status: 'idle',
      progress: 0,
      file: null,
      errorMessage: null,
    }))
  }

  const handlePickResumeFile = async () => {
    try {
      const response = await Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: RESUME_FILE_ACCEPT_TYPES.map(type => type.replace('.', '')),
      })

      const selectedFile = response.tempFiles?.[0]
      if (!selectedFile) {
        return
      }

      if (!isSupportedResumeFile(selectedFile.name)) {
        setResumeUploadState(previous => ({
          ...previous,
          status: 'error',
          progress: 0,
          file: null,
          errorMessage: '上传失败',
        }))
        Taro.showToast({
          title: '仅支持 PDF、DOC、DOCX、MD、TXT 文件',
          icon: 'none',
          duration: 2200,
        })
        return
      }

      if (selectedFile.size > RESUME_FILE_MAX_SIZE_MB * 1024 * 1024) {
        setResumeUploadState(previous => ({
          ...previous,
          status: 'error',
          progress: 0,
          file: null,
          errorMessage: '上传失败',
        }))
        Taro.showToast({
          title: `文件不能超过 ${RESUME_FILE_MAX_SIZE_MB}MB`,
          icon: 'none',
          duration: 2200,
        })
        return
      }

      const requestId = uploadRequestRef.current + 1
      uploadRequestRef.current = requestId

      setResumeUploadState(previous => ({
        ...previous,
        status: 'uploading',
        progress: 18,
        file: null,
        errorMessage: null,
      }))

      await wait(120)
      if (uploadRequestRef.current !== requestId) {
        return
      }

      setResumeUploadState(previous => ({
        ...previous,
        progress: 52,
      }))

      let extractedText: string | undefined
      if (isTextFile(selectedFile.name)) {
        extractedText = await readTextFile(selectedFile.path)
        if (uploadRequestRef.current !== requestId) {
          return
        }

        if (!extractedText.trim()) {
          throw new Error('文件内容为空')
        }

        setResumeUploadState(previous => ({
          ...previous,
          progress: 84,
        }))
      } else {
        await wait(100)
        if (uploadRequestRef.current !== requestId) {
          return
        }

        setResumeUploadState(previous => ({
          ...previous,
          progress: 84,
        }))
      }

      await wait(120)
      if (uploadRequestRef.current !== requestId) {
        return
      }

      const uploadedFile: UploadedResumeFile = {
        name: selectedFile.name,
        path: selectedFile.path,
        size: selectedFile.size,
        extension: getFileExtension(selectedFile.name),
        extractedText,
      }
      const nextMarkdown =
        extractedText?.trim() || createUploadedFileMarkdownStub(selectedFile.name)

      setResumeUploadState(previous => ({
        ...previous,
        status: 'success',
        progress: 100,
        file: uploadedFile,
        markdown: previous.markdown.trim() ? previous.markdown : nextMarkdown,
        errorMessage: null,
      }))

      Taro.showToast({
        title: `${selectedFile.name} 已上传`,
        icon: 'success',
        duration: 1500,
      })
    } catch (error) {
      if (isUserCancelled(error)) {
        return
      }

      console.error('resume upload failed', error)
      setResumeUploadState(previous => ({
        ...previous,
        status: 'error',
        progress: 0,
        file: null,
        errorMessage: '上传失败',
      }))
      Taro.showToast({
        title: '上传失败，请重试',
        icon: 'none',
        duration: 2200,
      })
    }
  }

  const handlePickJobAttachment = async () => {
    try {
      const selectedFile = await pickJobDescriptionFile()
      if (!selectedFile) {
        return
      }

      if (!isSupportedJobDescriptionFile(selectedFile.name)) {
        setJobDescriptionState(previous => ({
          ...previous,
          inputMode: 'upload',
          attachmentStatus: 'error',
          attachment: null,
          attachmentErrorMessage: '仅支持 PNG、JPG、JPEG、WEBP 图片',
        }))
        Taro.showToast({
          title: '仅支持 PNG、JPG、JPEG、WEBP 图片',
          icon: 'none',
          duration: 2200,
        })
        return
      }

      if (selectedFile.size > JOB_DESCRIPTION_FILE_MAX_SIZE_MB * 1024 * 1024) {
        setJobDescriptionState(previous => ({
          ...previous,
          inputMode: 'upload',
          attachmentStatus: 'error',
          attachment: null,
          attachmentErrorMessage: `文件不能超过 ${JOB_DESCRIPTION_FILE_MAX_SIZE_MB}MB`,
        }))
        Taro.showToast({
          title: `文件不能超过 ${JOB_DESCRIPTION_FILE_MAX_SIZE_MB}MB`,
          icon: 'none',
          duration: 2200,
        })
        return
      }

      const requestId = jobAttachmentRequestRef.current + 1
      jobAttachmentRequestRef.current = requestId

      setJobDescriptionState(previous => ({
        ...previous,
        inputMode: 'upload',
        attachmentStatus: 'uploading',
        attachment: null,
        attachmentErrorMessage: null,
      }))

      await wait(120)
      if (jobAttachmentRequestRef.current !== requestId) {
        return
      }

      const attachment: UploadedJobDescriptionFile = {
        name: selectedFile.name,
        path: selectedFile.path,
        size: selectedFile.size,
        extension: getFileExtension(selectedFile.name),
        sizeLabel: formatFileSize(selectedFile.size),
        previewPath: selectedFile.path,
      }

      await wait(220)
      if (jobAttachmentRequestRef.current !== requestId) {
        return
      }

      setJobDescriptionState(previous => ({
        ...previous,
        attachmentStatus: 'success',
        attachment,
        inputMode: 'upload',
        attachmentErrorMessage: null,
      }))

      Taro.showToast({
        title: `${selectedFile.name} 已选择`,
        icon: 'success',
        duration: 1500,
      })
    } catch (error) {
      if (isUserCancelled(error)) {
        return
      }

      console.error('job description attachment failed', error)
      setJobDescriptionState(previous => ({
        ...previous,
        inputMode: 'upload',
        attachmentStatus: 'error',
        attachment: null,
        attachmentErrorMessage: '文件读取失败，请重试',
      }))
      Taro.showToast({
        title: '文件读取失败，请重试',
        icon: 'none',
        duration: 2200,
      })
    }
  }

  const handlePrimaryAction = async () => {
    if (currentStep === 'resumeSummary') {
      setCurrentStep('resumeUpload')
      return
    }

    if (!canSaveCurrentStep) {
      Taro.showToast({
        title:
          currentStep === 'resumeUpload'
            ? '请先填写或整理 Markdown 简历'
            : jobDescriptionState.inputMode === 'upload'
              ? '请先上传岗位描述截图，或切换到“文字输入”补充岗位描述'
              : '请先填写目标岗位描述',
        icon: 'none',
        duration: 2200,
      })
      return
    }

    if (isSavingCurrentStep) {
      return
    }

    if (currentStep === 'resumeUpload') {
      setIsSavingCurrentStep(true)

      try {
        const payload = buildSourceResumePayload(
          resumeUploadState.markdown,
          resumeUploadState.file,
        )
        const savedSourceResume = await sourceResumeApi.saveSourceResume({
          title: payload.title,
          resume_markdown: payload.resumeMarkdown,
          source_type: payload.sourceType,
          original_file_name: payload.originalFileName,
        })

        useResumeStore.getState().setResumeContent(payload.resumeMarkdown)
        await useSourceResumeStore
          .getState()
          .setLatestSourceResume(savedSourceResume)

        Taro.showToast({
          title: '源简历已保存',
          icon: 'success',
          duration: 1200,
        })

        setCurrentStep('resumeSummary')
      } catch (error) {
        console.error('save source resume failed', error)
        Taro.showToast({
          title: '源简历保存失败，请重试',
          icon: 'none',
          duration: 2200,
        })
      } finally {
        setIsSavingCurrentStep(false)
      }

      return
    }

    setIsSavingCurrentStep(true)
    const requestId = generationRequestRef.current + 1
    generationRequestRef.current = requestId

    try {
      const resumeMarkdown =
        latestSourceResume?.resumeMarkdown.trim() ||
        useResumeStore.getState().resumeContent.trim() ||
        resumeUploadState.markdown.trim()
      const jdText = buildJobDescriptionPayload(jobDescriptionState)

      if (!resumeMarkdown) {
        throw new Error('源简历内容不存在')
      }

      setGenerationState(
        buildGenerationState({
          latestSourceResumeTitle: latestSourceResume?.title,
          fallbackResumeFileName: latestSourceResume?.originalFileName,
          jobDescriptionState,
        }),
      )

      useResumeStore.getState().setResumeContent(resumeMarkdown)
      useJDStore.getState().setJDContent(jdText)

      const processResult = await resumeApi.processResume(resumeMarkdown, jdText)

      if (generationRequestRef.current !== requestId) {
        return
      }

      useResumeStore.getState().setAnalysis(processResult.analysis)
      useJDStore.getState().setMatching(processResult.matching)

      await saveLatestResultSession({
        result: processResult,
        context: {
          company: jobDescriptionState.companyName.trim(),
          position: jobDescriptionState.positionName.trim(),
          resumeContent: resumeMarkdown,
          jdContent: jdText,
        },
      })

      if (generationRequestRef.current !== requestId) {
        return
      }

      await Taro.navigateTo({url: '/pages/result/index'})
    } catch (error) {
      if (generationRequestRef.current !== requestId) {
        return
      }
      console.error('process resume failed', error)
      Taro.showToast({
        title: error instanceof Error ? error.message : '生成失败，请重试',
        icon: 'none',
        duration: 2200,
      })
    } finally {
      if (generationRequestRef.current !== requestId) {
        return
      }

      setGenerationState(null)
      setIsSavingCurrentStep(false)
    }
  }

  const handleCancelGeneration = () => {
    if (!generationState) {
      return
    }

    generationRequestRef.current += 1
    setGenerationState(null)
    setIsSavingCurrentStep(false)
  }

  const handleClose = () => {
    Taro.navigateBack()
  }

  const resumeUploadViewState: ResumeUploadStepState = {
    ...resumeUploadState,
    file: resumeUploadState.file
      ? {
          ...resumeUploadState.file,
          sizeLabel: formatFileSize(resumeUploadState.file.size),
        }
      : null,
  }

  return {
    currentStep,
    currentStepMeta,
    resumeUploadState: resumeUploadViewState,
    resumeSummaryState,
    jobDescriptionState,
    generationState,
    canSaveCurrentStep,
    isSavingCurrentStep,
    handlePickResumeFile,
    handleRemoveResumeFile,
    handleResumeMarkdownChange,
    handleJobDescriptionChange,
    handleJobCompanyNameChange,
    handleJobPositionNameChange,
    handleJobInputModeChange,
    handlePickJobAttachment,
    handlePrimaryAction,
    handleCancelGeneration,
    handleClose,
  }
}
