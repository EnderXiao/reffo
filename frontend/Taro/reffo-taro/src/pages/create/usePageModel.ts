import {useEffect, useMemo, useRef, useState} from 'react'
import Taro, {useRouter} from '@tarojs/taro'
import * as FileSystem from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import {parseApi} from '@/services/parse'
import {resumeApi} from '@/services/resume'
import {sourceResumeApi} from '@/services/sourceResume'
import {useHistoryStore, useJDStore, useResumeStore, useSourceResumeStore} from '@/store'
import type {
  MatchingResult,
  ProcessResult,
  ResumeAnalysis,
  ResumeHistory,
  SourceResumeSummary,
} from '@/types'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {feedback} from '@/utils/feedback'
import {navigation} from '@/utils/navigation'
import {saveLatestResultSession} from '@/utils/result-session'
import {toHistoryCardItem} from '../index/model/homeCardData'
import {
  canUseBrowserFilePicker,
  pickBrowserFile,
} from '@/utils/web-file'
import {
  formatResumeFileSize,
  isResumeFileUploadCancelled,
  pickAndParseResumeFile,
} from '@/utils/resume-file-upload'
import {
  CREATE_STEP_META,
  CREATE_STEP_SEQUENCE,
  type CreateGenerationState,
  type CreateStepId,
  type CreateStepMeta,
  type JobDescriptionInputMode,
  type JobDescriptionStepState,
  type ResumeSummaryStepState,
  type ResumeUploadStepState,
  type UploadedJobDescriptionFile,
  type UploadedResumeFile,
} from './types'
import {
  buildSourceResumePayload,
} from './utils/resumeMarkdown'
import {
  extractJobMetadataFromOcrText,
  normalizeCompanyNameCandidate,
  resolveBaseLocationCandidate,
  resolvePositionNameCandidate,
} from './utils/jobMetadata'

export interface CreatePageViewModel {
  currentStep: CreateStepId
  currentStepMeta: CreateStepMeta
  resumeUploadState: ResumeUploadStepState
  resumeSummaryState: ResumeSummaryStepState | null
  jobDescriptionState: JobDescriptionStepState
  generationState: CreateGenerationState | null
  isHistoryEditMode: boolean
  editingHistoryCard: HomeCardItem | null
  canSaveCurrentStep: boolean
  isSavingCurrentStep: boolean
  primaryActionLabel: string
  handlePickResumeFile: () => Promise<void>
  handleRemoveResumeFile: () => void
  handleEditSourceResume: () => void
  handleDeleteSourceResume: () => Promise<void>
  handleResumeMarkdownChange: (content: string) => void
  handleJobDescriptionChange: (content: string) => void
  handleJobCompanyNameChange: (content: string) => void
  handleJobPositionNameChange: (content: string) => void
  handleJobLocationChange: (content: string) => void
  handleJobInputModeChange: (mode: JobDescriptionInputMode) => void
  handlePickJobAttachment: () => Promise<void>
  handlePrimaryAction: () => Promise<boolean>
  handleDeleteHistoryResume: () => Promise<boolean>
  handleReturnHome: () => Promise<void>
  handleCancelGeneration: () => void
  handleClose: () => void
}

const JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES = [
  '.png',
  '.jpg',
  '.jpeg',
] as const
const JOB_DESCRIPTION_FILE_MAX_SIZE_MB = 10
const SUPPORTED_JOB_DESCRIPTION_FILE_TYPES = new Set<string>(
  JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES,
)

const HISTORY_EDIT_STEP_META: CreateStepMeta = {
  id: 'jobDescription',
  titleSegments: [
    {text: '编辑', tone: 'warm'},
    {text: '申请', tone: 'default'},
  ],
  description: '仅可编辑公司名称和岗位名称以及工作地信息，不可重新上传目标岗位描述生成最佳简历哦。',
  actionLabel: '更新信息',
}

function buildInitialProcessResult(
  analysis: ResumeAnalysis,
  matching?: MatchingResult,
): ProcessResult {
  return {
    analysis,
    matching: matching || {
      match_score: 0,
      hard_requirements_match: [],
      skill_match: {
        matched_skills: [],
        missing_skills: [],
        match_percentage: 0,
      },
      experience_match: {
        years_required: 0,
        years_actual: 0,
        relevant_experience: [],
        match_percentage: 0,
      },
      optimization_suggestions: [],
    },
    optimized: {
      optimized_resume: '',
      changes_summary: [],
      improvement_score: 0,
    },
    interview: {
      questions: [],
      story_recommendations: [],
      follow_up_questions: [],
    },
  }
}

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
    baseLocation: '',
    inputMode: initialContent.trim() ? 'manual' : 'upload',
    attachmentStatus: 'idle',
    attachmentProgress: 0,
    attachment: null,
    attachmentErrorMessage: null,
  }
}

function buildJobDescriptionStateFromHistory(history: ResumeHistory): JobDescriptionStepState {
  const context = history.resultContext

  return {
    content: context?.jdContent || history.jdContent,
    companyName: context?.company || history.company,
    positionName: context?.position || history.position,
    baseLocation: context?.location || '',
    inputMode: 'manual',
    attachmentStatus: 'idle',
    attachmentProgress: 0,
    attachment: null,
    attachmentErrorMessage: null,
  }
}

function getFileExtension(fileName: string) {
  const dotIndex = fileName.lastIndexOf('.')
  return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : ''
}

function isSupportedJobDescriptionFile(fileName: string) {
  return SUPPORTED_JOB_DESCRIPTION_FILE_TYPES.has(getFileExtension(fileName))
}

function wait(duration: number) {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), duration)
  })
}

interface PickedTempFile {
  name: string
  path: string
  size: number
  file?: File
}

async function pickJobDescriptionFile(): Promise<PickedTempFile | null> {
  const canPickBrowserFile = canUseBrowserFilePicker()
  const browserFile = canPickBrowserFile
    ? await pickBrowserFile({
        accept: JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES,
      })
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
      extension: JOB_DESCRIPTION_IMAGE_ACCEPT_TYPES.map(type =>
        type.replace('.', ''),
      ),
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
    id: latestSourceResume.id,
    title: latestSourceResume.title,
    fileName:
      latestSourceResume.originalFileName || `${latestSourceResume.title}.md`,
    sizeLabel: `${latestSourceResume.resumeMarkdown.length.toLocaleString()} 字符`,
    updatedAtLabel: formatDateTime(latestSourceResume.updatedAt),
    sourceTypeLabel:
      latestSourceResume.sourceType === 'file' ? '来自文件上传' : 'Markdown 输入',
    markdown: latestSourceResume.resumeMarkdown,
  }
}

function buildJobDescriptionPayload(state: JobDescriptionStepState) {
  const content = state.content.trim()
  const attachmentNote = state.attachment
    ? `岗位描述附件：${state.attachment.name}${
        state.attachment.sizeLabel ? `（${state.attachment.sizeLabel}）` : ''
      }`
    : null
  const uploadFallbackNote =
    state.attachment && !content
      ? '补充说明：用户通过上传截图/附件提供岗位信息；若附件内容无法直接解析，请优先结合公司名称和岗位名称理解岗位方向。'
      : null
  const segments = [
    state.companyName.trim()
      ? `公司名称：${state.companyName.trim()}`
      : null,
    state.positionName.trim()
      ? `岗位名称：${state.positionName.trim()}`
      : null,
    state.baseLocation.trim()
      ? `工作地：${state.baseLocation.trim()}`
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
  const baseLocation = truncateText(jobDescriptionState.baseLocation.trim(), 16)
  const normalizedDescription = jobDescriptionState.content.trim().replace(/\s+/g, ' ')
  const descriptionSummary = normalizedDescription
    ? `岗位描述 · ${truncateText(normalizedDescription, 22)}`
    : jobDescriptionState.attachment?.name
      ? `岗位附件 · ${truncateText(jobDescriptionState.attachment.name, 22)}`
      : ''
  const detailItems = [
    `简历 · ${resumeTitle}`,
    companyName ? `公司 · ${companyName}` : '',
    positionName ? `岗位 · ${positionName}` : '',
    baseLocation ? `工作地 · ${baseLocation}` : '',
    descriptionSummary,
  ].filter(Boolean)

  return {
    resumeTitle,
    companyName,
    positionName,
    baseLocation,
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
  const editHistoryId = typeof router.params?.historyId === 'string'
    ? router.params.historyId
    : null
  const isHistoryEditMode = router.params?.mode === 'editHistory' && Boolean(editHistoryId)
  const uploadRequestRef = useRef(0)
  const jobAttachmentRequestRef = useRef(0)
  const jobAttachmentProgressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const generationRequestRef = useRef(0)
  const initialSourceResume = useSourceResumeStore.getState().latestSourceResume
  const [currentStep, setCurrentStep] = useState<CreateStepId>(() =>
    isHistoryEditMode
      ? 'jobDescription'
      : resolveInitialStep(requestedStepRef.current, Boolean(initialSourceResume)),
  )
  const [editingHistory, setEditingHistory] = useState<ResumeHistory | null>(null)
  const [hasLoadedEditingHistory, setHasLoadedEditingHistory] = useState(!isHistoryEditMode)
  const [hasResolvedLatestSourceResume, setHasResolvedLatestSourceResume] =
    useState(Boolean(initialSourceResume))
  const routeStepAppliedRef = useRef(
    isHistoryEditMode ||
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
      if (jobAttachmentProgressTimerRef.current) {
        clearInterval(jobAttachmentProgressTimerRef.current)
      }
    }
  }, [])

  const stopJobAttachmentProgress = () => {
    if (jobAttachmentProgressTimerRef.current) {
      clearInterval(jobAttachmentProgressTimerRef.current)
      jobAttachmentProgressTimerRef.current = null
    }
  }

  const startJobAttachmentProgress = (requestId: number) => {
    stopJobAttachmentProgress()
    jobAttachmentProgressTimerRef.current = setInterval(() => {
      if (jobAttachmentRequestRef.current !== requestId) {
        stopJobAttachmentProgress()
        return
      }

      setJobDescriptionState(previous => {
        if (previous.attachmentStatus !== 'uploading') {
          return previous
        }

        const nextProgress = Math.min(
          92,
          Math.round(previous.attachmentProgress + Math.max(2, (92 - previous.attachmentProgress) * 0.18)),
        )

        return {
          ...previous,
          attachmentProgress: nextProgress,
        }
      })
    }, 260)
  }

  useEffect(() => {
    let isMounted = true

    if (isHistoryEditMode) {
      setHasResolvedLatestSourceResume(true)
      return () => {
        isMounted = false
      }
    }

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
    if (!isHistoryEditMode || !editHistoryId) {
      return
    }

    let isMounted = true

    const loadEditingHistory = async () => {
      setHasLoadedEditingHistory(false)

      try {
        let {histories} = useHistoryStore.getState()
        let history = histories.find(item => item.id === editHistoryId)

        if (!history) {
          await useHistoryStore.getState().loadHistories()
          histories = useHistoryStore.getState().histories
          history = histories.find(item => item.id === editHistoryId)
        }

        if (!isMounted) {
          return
        }

        if (!history) {
          feedback.message('未找到要编辑的简历')
          void navigation.returnHome()
          return
        }

        setEditingHistory(history)
        setJobDescriptionState(buildJobDescriptionStateFromHistory(history))
        useResumeStore.getState().setResumeContent(
          history.resultContext?.resumeContent || history.resumeContent,
        )
        useJDStore.getState().setJDContent(
          history.resultContext?.jdContent || history.jdContent,
        )
        setCurrentStep('jobDescription')
      } catch (error) {
        console.error('load editing history failed', error)
        feedback.error('加载简历信息失败')
      } finally {
        if (isMounted) {
          setHasLoadedEditingHistory(true)
        }
      }
    }

    void loadEditingHistory()

    return () => {
      isMounted = false
    }
  }, [editHistoryId, isHistoryEditMode])

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

  useEffect(() => {
    if (
      currentStep === 'resumeSummary' &&
      !isHistoryEditMode &&
      hasResolvedLatestSourceResume &&
      !latestSourceResume
    ) {
      setCurrentStep('resumeUpload')
    }
  }, [currentStep, hasResolvedLatestSourceResume, isHistoryEditMode, latestSourceResume])

  const currentStepMeta = isHistoryEditMode && currentStep === 'jobDescription'
    ? HISTORY_EDIT_STEP_META
    : CREATE_STEP_META[currentStep]
  const primaryActionLabel = currentStepMeta.actionLabel
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
  const editingHistoryCard = useMemo(() => {
    if (!editingHistory) {
      return null
    }

    const company = jobDescriptionState.companyName.trim() || editingHistory.company
    const position = jobDescriptionState.positionName.trim() || editingHistory.position
    const location = jobDescriptionState.baseLocation.trim() || editingHistory.resultContext?.location

    return toHistoryCardItem({
      ...editingHistory,
      company,
      position,
      jdContent: buildJobDescriptionPayload(jobDescriptionState),
      resultContext: {
        company,
        position,
        ...(location ? {location} : {}),
        resumeContent: editingHistory.resultContext?.resumeContent || editingHistory.resumeContent,
        jdContent: buildJobDescriptionPayload(jobDescriptionState),
      },
    })
  }, [
    editingHistory,
    jobDescriptionState.baseLocation,
    jobDescriptionState.companyName,
    jobDescriptionState.content,
    jobDescriptionState.positionName,
  ])

  const canSaveCurrentStep = useMemo(() => {
    if (isHistoryEditMode && !hasLoadedEditingHistory) {
      return false
    }

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

    const canSaveJobDescription = hasManualDescription || hasUploadedAttachment

    return !isSavingCurrentStep && canSaveJobDescription
  }, [
    currentStep,
    hasLoadedEditingHistory,
    isHistoryEditMode,
    isSavingCurrentStep,
    jobDescriptionState.attachment,
    jobDescriptionState.attachmentStatus,
    jobDescriptionState.content,
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
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

    setJobDescriptionState(previous => ({
      ...previous,
      content,
      inputMode: 'manual',
    }))
  }

  const handleJobCompanyNameChange = (content: string) => {
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

    setJobDescriptionState(previous => ({
      ...previous,
      companyName: content,
    }))
  }

  const handleJobPositionNameChange = (content: string) => {
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

    setJobDescriptionState(previous => ({
      ...previous,
      positionName: content,
    }))
  }

  const handleJobLocationChange = (content: string) => {
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

    setJobDescriptionState(previous => ({
      ...previous,
      baseLocation: content,
    }))
  }

  const handleJobInputModeChange = (mode: JobDescriptionInputMode) => {
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

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

  const handleEditSourceResume = () => {
    const sourceResume = latestSourceResume
    if (!sourceResume) {
      setCurrentStep('resumeUpload')
      return
    }

    useResumeStore.getState().setResumeContent(sourceResume.resumeMarkdown)
    setResumeUploadState(previous => ({
      ...previous,
      status: 'success',
      progress: 100,
      file: sourceResume.sourceType === 'file' && sourceResume.originalFileName
        ? {
            name: sourceResume.originalFileName,
            path: '',
            size: sourceResume.resumeMarkdown.length,
            extension: getFileExtension(sourceResume.originalFileName),
            extractedText: sourceResume.resumeMarkdown,
          }
        : null,
      markdown: sourceResume.resumeMarkdown,
      errorMessage: null,
    }))
    setCurrentStep('resumeUpload')
  }

  const handleDeleteSourceResume = async () => {
    const sourceResume = latestSourceResume
    if (!sourceResume) {
      setCurrentStep('resumeUpload')
      return
    }

    const confirmed = await new Promise<boolean>(resolve => {
      feedback.modal({
        title: '删除源简历？',
        content: '删除后需要重新上传或填写源简历，之后才能继续生成。',
        cancelText: '取消',
        confirmText: '删除',
        tone: 'danger',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      })
    })

    if (!confirmed) {
      return
    }

    setIsSavingCurrentStep(true)
    setCurrentStep('resumeUpload')
    setResumeUploadState(createInitialResumeUploadState())

    try {
      await useSourceResumeStore
        .getState()
        .deleteLatestSourceResume(sourceResume.id)
      useResumeStore.getState().setResumeContent('')
      feedback.success('请上传新的源简历', {duration: 1400})
    } catch (error) {
      console.error('delete source resume failed', error)
      setCurrentStep('resumeSummary')
      feedback.error(error instanceof Error ? error.message : '删除源简历失败，请重试')
    } finally {
      setIsSavingCurrentStep(false)
    }
  }

  const handlePickResumeFile = async () => {
    const requestId = uploadRequestRef.current + 1
    uploadRequestRef.current = requestId

    try {
      const parsedFile = await pickAndParseResumeFile({
        isActive: () => uploadRequestRef.current === requestId,
        onFileSelected: selectedFile => {
          const pendingFile: UploadedResumeFile = {
            name: selectedFile.name,
            path: selectedFile.path,
            size: selectedFile.size,
            sizeLabel: formatResumeFileSize(selectedFile.size),
            extension: selectedFile.extension,
          }

          setResumeUploadState(previous => ({
            ...previous,
            status: 'uploading',
            progress: 0,
            file: pendingFile,
            errorMessage: null,
          }))
        },
        onProgress: progress => {
          setResumeUploadState(previous => ({
            ...previous,
            progress,
          }))
        },
      })

      if (!parsedFile || uploadRequestRef.current !== requestId) {
        return
      }

      const uploadedFile: UploadedResumeFile = {
        name: parsedFile.name,
        path: parsedFile.path,
        size: parsedFile.size,
        sizeLabel: formatResumeFileSize(parsedFile.size),
        extension: parsedFile.extension,
        extractedText: parsedFile.extractedText,
      }

      setResumeUploadState(previous => ({
        ...previous,
        status: 'success',
        progress: 100,
        file: uploadedFile,
        markdown: parsedFile.extractedText,
        errorMessage: null,
      }))

      feedback.success(`${parsedFile.name} 已上传`)
    } catch (error) {
      if (isResumeFileUploadCancelled(error)) {
        return
      }

      const message = error instanceof Error ? error.message : '上传失败，请重试'
      const uploadCardMessage = message.startsWith('仅支持') || message.startsWith('文件不能超过')
        ? '上传失败'
        : message
      console.error('resume upload failed', error)
      setResumeUploadState(previous => ({
        ...previous,
        status: 'error',
        progress: 0,
        file: null,
        errorMessage: uploadCardMessage,
      }))
      feedback.error(message)
    }
  }

  const handlePickJobAttachment = async () => {
    if (jobDescriptionState.attachmentStatus === 'uploading') {
      return
    }

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
          attachmentProgress: 0,
          attachment: null,
          attachmentErrorMessage: '仅支持 PNG、JPG、JPEG 图片',
        }))
        feedback.error('仅支持 PNG、JPG、JPEG 图片')
        return
      }

      if (selectedFile.size > JOB_DESCRIPTION_FILE_MAX_SIZE_MB * 1024 * 1024) {
        setJobDescriptionState(previous => ({
          ...previous,
          inputMode: 'upload',
          attachmentStatus: 'error',
          attachmentProgress: 0,
          attachment: null,
          attachmentErrorMessage: `文件不能超过 ${JOB_DESCRIPTION_FILE_MAX_SIZE_MB}MB`,
        }))
        feedback.error(`文件不能超过 ${JOB_DESCRIPTION_FILE_MAX_SIZE_MB}MB`)
        return
      }

      const requestId = jobAttachmentRequestRef.current + 1
      jobAttachmentRequestRef.current = requestId

      setJobDescriptionState(previous => ({
        ...previous,
        inputMode: 'upload',
        attachmentStatus: 'uploading',
        attachmentProgress: 8,
        attachment: null,
        attachmentErrorMessage: null,
      }))
      startJobAttachmentProgress(requestId)

      await wait(120)
      if (jobAttachmentRequestRef.current !== requestId) {
        return
      }

      setJobDescriptionState(previous => ({
        ...previous,
        attachmentProgress: Math.max(previous.attachmentProgress, 28),
      }))

      const attachment: UploadedJobDescriptionFile = {
        name: selectedFile.name,
        path: selectedFile.path,
        size: selectedFile.size,
        extension: getFileExtension(selectedFile.name),
        sizeLabel: formatResumeFileSize(selectedFile.size),
        previewPath: selectedFile.path,
      }

      const parsedDocument = await parseApi.parseJobDescriptionImage(selectedFile)
      if (jobAttachmentRequestRef.current !== requestId) {
        return
      }
      stopJobAttachmentProgress()

      const parsedJob = parsedDocument.structured
      const ocrText = parsedJob?.jdText?.trim() || parsedDocument.rawText.trim()

      if (!ocrText) {
        throw new Error('JD 图片解析结果为空，请重新上传或切换到文字输入')
      }

      const extractedJobMetadata = extractJobMetadataFromOcrText(ocrText)
      const parsedCompanyName = normalizeCompanyNameCandidate(parsedJob?.companyName || '')
      const parsedPositionName = resolvePositionNameCandidate(
        parsedJob?.positionName || '',
        extractedJobMetadata.positionName,
      )
      const parsedBaseLocation = resolveBaseLocationCandidate(
        [extractedJobMetadata.baseLocation],
        [
          parsedCompanyName,
          extractedJobMetadata.companyName,
          parsedPositionName,
        ],
      )

      setJobDescriptionState(previous => ({
        ...previous,
        attachmentStatus: 'success',
        attachmentProgress: 100,
        attachment,
        inputMode: 'manual',
        content: ocrText,
        companyName:
          previous.companyName.trim() ||
          parsedCompanyName ||
          extractedJobMetadata.companyName,
        positionName: previous.positionName.trim() || parsedPositionName,
        baseLocation: previous.baseLocation.trim() || parsedBaseLocation,
        attachmentErrorMessage: null,
      }))

      feedback.success(`${selectedFile.name} 已解析，可继续编辑`)
    } catch (error) {
      if (isResumeFileUploadCancelled(error)) {
        return
      }

      const message = error instanceof Error ? error.message : '文件读取失败，请重试'
      console.error('job description attachment failed', error)
      stopJobAttachmentProgress()
      setJobDescriptionState(previous => ({
        ...previous,
        inputMode: 'upload',
        attachmentStatus: 'error',
        attachmentProgress: 0,
        attachment: null,
        attachmentErrorMessage: message,
      }))
      feedback.error(message)
    }
  }

  const handlePrimaryAction = async () => {
    if (currentStep === 'resumeSummary') {
      if (!latestSourceResume) {
        setCurrentStep('resumeUpload')
        return true
      }

      setCurrentStep('jobDescription')
      return true
    }

    if (!canSaveCurrentStep) {
      feedback.message(
        currentStep === 'resumeUpload'
          ? '请先填写或整理 Markdown 简历'
          : '请先上传岗位描述截图，或输入目标岗位描述',
        {duration: 2200},
      )
      return false
    }

    if (isSavingCurrentStep) {
      return false
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

        feedback.success('源简历已保存', {duration: 1200})

        setCurrentStep('resumeSummary')
        return true
      } catch (error) {
        console.error('save source resume failed', error)
        feedback.error('源简历保存失败，请重试')
        return false
      } finally {
        setIsSavingCurrentStep(false)
      }
    }

    if (isHistoryEditMode && editHistoryId) {
      const history = editingHistory
      if (!history) {
        feedback.message('简历信息还在加载中')
        return false
      }

      setIsSavingCurrentStep(true)

      try {
        const jdText = buildJobDescriptionPayload(jobDescriptionState)
        const company = jobDescriptionState.companyName.trim() || history.company
        const position = jobDescriptionState.positionName.trim() || history.position
        const location = jobDescriptionState.baseLocation.trim()
        const resumeContent = history.resultContext?.resumeContent || history.resumeContent

        await useHistoryStore.getState().updateHistory(editHistoryId, {
          company,
          position,
          jdContent: jdText,
          resultContext: {
            company,
            position,
            ...(location ? {location} : {}),
            resumeContent,
            jdContent: jdText,
          },
        })

        feedback.success('信息已更新', {duration: 1200})
        await navigation.redirectTo('/pages/result/index', {
          id: editHistoryId,
          fromCard: 1,
        })
        return true
      } catch (error) {
        console.error('update history resume failed', error)
        feedback.error(error instanceof Error ? error.message : '更新信息失败，请重试')
        return false
      } finally {
        setIsSavingCurrentStep(false)
      }
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

      const analysis = await resumeApi.analyzeResume(resumeMarkdown)

      if (generationRequestRef.current !== requestId) {
        return false
      }

      const matching = await resumeApi.matchResume(analysis, jdText)

      if (generationRequestRef.current !== requestId) {
        return false
      }

      const parsedJdInfo = matching.jd_structure?.basic_info
      const extractedJdMetadata = extractJobMetadataFromOcrText(jobDescriptionState.content)
      const resolvedCompanyName =
        jobDescriptionState.companyName.trim() ||
        normalizeCompanyNameCandidate(parsedJdInfo?.company || '') ||
        extractedJdMetadata.companyName
      const resolvedPositionName =
        jobDescriptionState.positionName.trim() ||
        resolvePositionNameCandidate(parsedJdInfo?.title || '', extractedJdMetadata.positionName)
      const resolvedBaseLocation =
        jobDescriptionState.baseLocation.trim() ||
        resolveBaseLocationCandidate(
          [extractedJdMetadata.baseLocation],
          [
            resolvedCompanyName,
            normalizeCompanyNameCandidate(parsedJdInfo?.company || ''),
            extractedJdMetadata.companyName,
            resolvedPositionName,
          ],
        )

      setJobDescriptionState(previous => ({
        ...previous,
        companyName: resolvedCompanyName || previous.companyName,
        positionName: resolvedPositionName || previous.positionName,
        baseLocation: resolvedBaseLocation || previous.baseLocation,
      }))

      const processResult = buildInitialProcessResult(analysis, matching)

      useResumeStore.getState().setAnalysis(processResult.analysis)
      useJDStore.getState().setMatching(processResult.matching)

      await saveLatestResultSession({
        result: processResult,
        context: {
          company: resolvedCompanyName,
          position: resolvedPositionName,
          location: resolvedBaseLocation,
          resumeContent: resumeMarkdown,
          jdContent: jdText,
        },
        progress: {
          analysis: 'done',
          matching: 'done',
          optimized: 'pending',
          interview: 'pending',
        },
      })

      if (generationRequestRef.current !== requestId) {
        return false
      }

      await navigation.navigateTo('/pages/result/index')
      return true
    } catch (error) {
      if (generationRequestRef.current !== requestId) {
        return false
      }
      console.error('process resume failed', error)
      feedback.error(error instanceof Error ? error.message : '生成失败，请重试')
      return false
    } finally {
      if (generationRequestRef.current === requestId) {
        setGenerationState(null)
        setIsSavingCurrentStep(false)
      }
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

  const handleDeleteHistoryResume = async () => {
    if (!isHistoryEditMode || !editHistoryId) {
      return false
    }

    setIsSavingCurrentStep(true)

    try {
      await useHistoryStore.getState().deleteHistory(editHistoryId)
      feedback.success('简历已删除', {duration: 1200})
      return true
    } catch (error) {
      console.error('delete history resume failed', error)
      feedback.error(error instanceof Error ? error.message : '删除简历失败，请重试')
      return false
    } finally {
      setIsSavingCurrentStep(false)
    }
  }

  const handleReturnHome = () => {
    return navigation.reLaunch('/pages/index/index')
  }

  const handleClose = () => {
    void navigation.navigateBack()
  }

  const resumeUploadViewState: ResumeUploadStepState = {
    ...resumeUploadState,
    file: resumeUploadState.file
      ? {
          ...resumeUploadState.file,
          sizeLabel: formatResumeFileSize(resumeUploadState.file.size),
        }
      : null,
  }

  return {
    currentStep,
    currentStepMeta,
    primaryActionLabel,
    resumeUploadState: resumeUploadViewState,
    resumeSummaryState,
    jobDescriptionState,
    generationState,
    isHistoryEditMode,
    editingHistoryCard,
    canSaveCurrentStep,
    isSavingCurrentStep,
    handlePickResumeFile,
    handleRemoveResumeFile,
    handleEditSourceResume,
    handleDeleteSourceResume,
    handleResumeMarkdownChange,
    handleJobDescriptionChange,
    handleJobCompanyNameChange,
    handleJobPositionNameChange,
    handleJobLocationChange,
    handleJobInputModeChange,
    handlePickJobAttachment,
    handlePrimaryAction,
    handleDeleteHistoryResume,
    handleReturnHome,
    handleCancelGeneration,
    handleClose,
  }
}
