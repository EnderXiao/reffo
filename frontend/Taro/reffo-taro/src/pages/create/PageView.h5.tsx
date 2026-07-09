import {useEffect, useMemo, useRef, useState} from 'react'
import {flushSync} from 'react-dom'
import {Image, Input, Text, Textarea, View} from '@tarojs/components'
import classNames from 'classnames'
import CANCEL_ICON from '@/assets/create/cancel.svg'
import PDF_FILE_ICON from '@/assets/create/pdf-file.svg'
import UPLOAD_ERROR_ICON from '@/assets/create/upload-error.svg'
import UPLOAD_FILE_ICON from '@/assets/create/upload-file.svg'
import UPLOAD_IMAGE_ICON from '@/assets/create/upoad-img.svg'
import {Card} from '@/components/Card'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import {deriveCardPalette} from '@/components/business/HomeCardDeck/palette'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {useVisualTier} from '@/utils'
import type {CreatePageViewModel} from './usePageModel'
import type {
  CreateGenerationState,
  CreateStepMeta,
  JobDescriptionInputMode,
  JobDescriptionStepState,
  ResumeSummaryStepState,
  ResumeUploadStepState,
} from './types'
import '@/pages/index/index.h5.scss'
import './index.h5.scss'

const GENERATION_CARD_PALETTE = deriveCardPalette('#FF6A43')

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

function canUseViewTransition() {
  return typeof document !== 'undefined'
    && typeof (document as DocumentWithViewTransition).startViewTransition === 'function'
}

function buildPendingGenerationState({
  resumeSummaryState,
  jobDescriptionState,
}: {
  resumeSummaryState: ResumeSummaryStepState | null
  jobDescriptionState: JobDescriptionStepState
}): CreateGenerationState {
  const companyName = jobDescriptionState.companyName.trim()
  const positionName = jobDescriptionState.positionName.trim()
  const resumeTitle = resumeSummaryState?.title || resumeSummaryState?.fileName || '源简历'
  const resumeMonogram = resumeTitle.trim().match(/[A-Za-z0-9\u4e00-\u9fa5]/u)?.[0] || 'R'
  const monogram = /[A-Za-z]/.test(resumeMonogram) ? resumeMonogram.toUpperCase() : resumeMonogram

  return {
    resumeTitle,
    companyName,
    positionName,
    monogram,
    detailItems: [],
  }
}

function CreateBackdrop({variant}: {variant: 'cool' | 'warm'}) {
  return (
    <View className={classNames('reffo-create__backdrop', `reffo-create__backdrop--${variant}`)} />
  )
}

function StepHeader({meta}: {meta: CreateStepMeta}) {
  return (
    <View className='reffo-create__hero'>
      <View className='reffo-create__title'>
        {meta.titleSegments.map((segment, index) => (
          <Text
            key={`${segment.text}-${index}`}
            className={classNames('reffo-create__title-segment', {
              'reffo-create__title-segment--accent': segment.tone === 'accent',
              'reffo-create__title-segment--warm': segment.tone === 'warm',
            })}
          >
            {segment.text}
          </Text>
        ))}
      </View>
      <Text className='reffo-create__description'>{meta.description}</Text>
    </View>
  )
}

function UploadIcon({
  status,
  extension,
}: {
  status: ResumeUploadStepState['status']
  extension?: string
}) {
  const isSuccess = status === 'success'
  const isError = status === 'error'
  const extensionLabel = extension?.replace('.', '').toUpperCase()
  const isPdf = extensionLabel === 'PDF'
  const assetIcon = isError ? UPLOAD_ERROR_ICON : !isSuccess ? UPLOAD_FILE_ICON : isPdf ? PDF_FILE_ICON : null

  if (assetIcon) {
    return (
      <Image
        src={assetIcon}
        mode='aspectFit'
        className={classNames('reffo-create-upload__asset-icon', {
          'reffo-create-upload__asset-icon--pdf': isPdf,
        })}
      />
    )
  }

  return (
    <View
      className={classNames('reffo-create-upload__icon', {
        'reffo-create-upload__icon--success': isSuccess,
        'reffo-create-upload__icon--error': isError,
      })}
    >
      <View className='reffo-create-upload__file'>
        {isSuccess ? (
          <Text className='reffo-create-upload__file-type'>
            {extensionLabel === 'PDF' ? 'PDF' : extensionLabel?.slice(0, 3) || 'FILE'}
          </Text>
        ) : (
          <Text className='reffo-create-upload__arrow'>↑</Text>
        )}
      </View>
      {isError ? (
        <View className='reffo-create-upload__error-badge'>
          <Text>!</Text>
        </View>
      ) : null}
    </View>
  )
}

function ResumeUploadStepH5({
  state,
  onPickFile,
  onRemoveFile,
  onMarkdownChange,
}: {
  state: ResumeUploadStepState
  onPickFile: CreatePageViewModel['handlePickResumeFile']
  onRemoveFile: CreatePageViewModel['handleRemoveResumeFile']
  onMarkdownChange: CreatePageViewModel['handleResumeMarkdownChange']
}) {
  const [visualProgress, setVisualProgress] = useState(0)
  const [isCompletingUpload, setIsCompletingUpload] = useState(false)
  const wasUploadingRef = useRef(false)
  const uploadCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const uploadFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)
  const fileKey = state.file ? `${state.file.name}-${state.file.size}` : ''
  const isVisualUploading = state.status === 'uploading' || isCompletingUpload
  const isSuccess = state.status === 'success' && Boolean(state.file) && !isVisualUploading
  const hasError = state.status === 'error'
  const progress = Math.max(0, Math.min(100, visualProgress))
  const uploadProgressStyle = isVisualUploading
    ? ({'--upload-progress': progress / 100} as any)
    : undefined
  const handleRemoveClick = (event: {stopPropagation?: () => void}) => {
    event.stopPropagation?.()
    onRemoveFile()
  }

  useEffect(() => {
    return () => {
      if (uploadCompleteTimerRef.current) {
        clearTimeout(uploadCompleteTimerRef.current)
      }
      if (uploadFrameRef.current) {
        cancelAnimationFrame(uploadFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (uploadCompleteTimerRef.current) {
      clearTimeout(uploadCompleteTimerRef.current)
      uploadCompleteTimerRef.current = null
    }

    if (state.status === 'uploading') {
      const nextProgress = Math.max(6, Math.min(88, state.progress))

      if (!wasUploadingRef.current) {
        wasUploadingRef.current = true
        setIsCompletingUpload(false)
        setVisualProgress(0)
        if (uploadFrameRef.current) {
          cancelAnimationFrame(uploadFrameRef.current)
        }
        uploadFrameRef.current = requestAnimationFrame(() => {
          setVisualProgress(nextProgress)
          uploadFrameRef.current = null
        })
        return
      }

      setIsCompletingUpload(false)
      setVisualProgress(previous => Math.max(previous, nextProgress))
      return
    }

    if (state.status === 'success' && wasUploadingRef.current) {
      setIsCompletingUpload(true)
      setVisualProgress(100)
      uploadCompleteTimerRef.current = setTimeout(() => {
        wasUploadingRef.current = false
        setIsCompletingUpload(false)
      }, 560)
      return
    }

    wasUploadingRef.current = false
    setIsCompletingUpload(false)
    setVisualProgress(0)
  }, [fileKey, state.progress, state.status])

  return (
    <View className='reffo-create-step'>
      <View className='reffo-create-section'>
        <Text className='reffo-create-section__title'>上传源简历</Text>
        <View
          className={classNames('reffo-create-upload', {
            'reffo-create-upload--uploading': isVisualUploading,
            'reffo-create-upload--filled': isSuccess,
            'reffo-create-upload--error': hasError,
          })}
          style={uploadProgressStyle}
          onClick={isSuccess || isVisualUploading ? undefined : onPickFile}
          role='button'
          data-testid={
            hasError
              ? 'resume-upload-error'
              : isSuccess
                ? 'resume-upload-success'
                : isVisualUploading
                  ? 'resume-upload-progress'
                  : 'resume-upload-trigger'
          }
        >
          <UploadIcon status={state.status} extension={state.file?.extension} />
          <View className='reffo-create-upload__body'>
            <Text className='reffo-create-upload__label'>
              {hasError ? state.errorMessage || '上传失败' : state.file ? state.file.name : '上传文件'}
            </Text>
            {state.file?.sizeLabel ? (
              <Text className='reffo-create-upload__meta'>{state.file?.sizeLabel || state.file?.extension}</Text>
            ) : null}
          </View>
          {isSuccess || hasError ? (
            <View
              className='reffo-create-upload__remove'
              onClick={handleRemoveClick}
              role='button'
              data-testid='resume-upload-remove'
            >
              <View className='reffo-create-upload__remove-icon' />
            </View>
          ) : null}
        </View>
      </View>

      <View className='reffo-create-divider'>
        <View className='reffo-create-divider__line' />
        <Text className='reffo-create-divider__text'>OR</Text>
        <View className='reffo-create-divider__line' />
      </View>

      <View className='reffo-create-section'>
        <View className='reffo-create-section__title-row'>
          <Text className='reffo-create-section__title'>输入文字描述</Text>
          <Text className='reffo-create-section__optional'>（可选）</Text>
        </View>
        <Textarea
          value={state.markdown}
          placeholder='描述你的简历内容'
          maxlength={20000}
          onInput={event => onMarkdownChange(event.detail.value)}
          className='reffo-create-textarea reffo-create-textarea--resume'
          data-testid='resume-markdown-input'
        />
      </View>

      <Text className='reffo-create-tip'>您提供的信息越详细，Reffo 就越能为您生成一份与目标职位高度契合的简历</Text>
    </View>
  )
}

function ResumeSummaryStepH5({
  state,
  onEdit,
  onDelete,
}: {
  state: NonNullable<CreatePageViewModel['resumeSummaryState']>
  onEdit: () => void
  onDelete: () => Promise<void>
}) {
  const fileExtension = state.fileName.includes('.')
    ? state.fileName.slice(state.fileName.lastIndexOf('.')).toLowerCase()
    : '.md'

  return (
    <View className='reffo-create-step'>
      <View className='reffo-create-section'>
        <Text className='reffo-create-section__title'>源简历文件</Text>
        <View
          className='reffo-create-summary'
          onClick={onEdit}
          role='button'
          data-testid='resume-summary-card'
        >
          <View className='reffo-create-summary__icon'>
            <UploadIcon status='success' extension={fileExtension} />
          </View>
          <View className='reffo-create-summary__body'>
            <Text className='reffo-create-summary__name'>{state.fileName}</Text>
            <Text className='reffo-create-summary__meta'>{state.sizeLabel || state.sourceTypeLabel}</Text>
          </View>
          <View
            className='reffo-create-summary__delete'
            onClick={event => {
              event.stopPropagation()
              void onDelete()
            }}
            role='button'
            data-testid='resume-summary-delete'
          >
            <Image className='reffo-create-summary__delete-icon' src={CANCEL_ICON} mode='aspectFit' />
          </View>
        </View>
        <Text className='reffo-create-section__hint reffo-create-section__hint--right'>上传时间 {state.updatedAtLabel}</Text>
      </View>
    </View>
  )
}

function ModeTab({
  mode,
  active,
  onClick,
}: {
  mode: JobDescriptionInputMode
  active: boolean
  onClick: () => void
}) {
  return (
    <View
      className={classNames('reffo-create-job__mode', {
        'reffo-create-job__mode--active': active,
      })}
      onClick={onClick}
      role='button'
      data-testid={mode === 'upload' ? 'job-mode-upload' : 'job-mode-manual'}
    >
      <View
        className={classNames('reffo-create-job__mode-icon', `reffo-create-job__mode-icon--${mode}`)}
      />
    </View>
  )
}

function JobUploadPanel({
  state,
  onPickAttachment,
  onContentChange,
}: {
  state: JobDescriptionStepState
  onPickAttachment: CreatePageViewModel['handlePickJobAttachment']
  onContentChange: CreatePageViewModel['handleJobDescriptionChange']
}) {
  const [visibleInputMode, setVisibleInputMode] = useState<JobDescriptionInputMode>(state.inputMode)
  const [isModeFading, setIsModeFading] = useState(false)
  const modeSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const modeSwitchFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null)

  const isUploading = state.attachmentStatus === 'uploading'
  const hasError = state.attachmentStatus === 'error'
  const hasAttachment = Boolean(state.attachment)

  useEffect(() => {
    return () => {
      if (modeSwitchTimerRef.current) {
        clearTimeout(modeSwitchTimerRef.current)
      }
      if (modeSwitchFrameRef.current) {
        cancelAnimationFrame(modeSwitchFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (state.inputMode === visibleInputMode) {
      if (modeSwitchTimerRef.current) {
        clearTimeout(modeSwitchTimerRef.current)
        modeSwitchTimerRef.current = null
      }
      if (modeSwitchFrameRef.current) {
        cancelAnimationFrame(modeSwitchFrameRef.current)
        modeSwitchFrameRef.current = null
      }
      setIsModeFading(false)
      return
    }

    if (modeSwitchTimerRef.current) {
      clearTimeout(modeSwitchTimerRef.current)
    }
    if (modeSwitchFrameRef.current) {
      cancelAnimationFrame(modeSwitchFrameRef.current)
    }

    setIsModeFading(true)
    modeSwitchTimerRef.current = setTimeout(() => {
      setVisibleInputMode(state.inputMode)
      modeSwitchFrameRef.current = requestAnimationFrame(() => {
        setIsModeFading(false)
        modeSwitchFrameRef.current = null
      })
      modeSwitchTimerRef.current = null
    }, 140)
  }, [state.inputMode, visibleInputMode])

  if (visibleInputMode === 'manual') {
    return (
      <View
        className={classNames('reffo-create-job__content', {
          'reffo-create-job__content--fading': isModeFading,
        })}
      >
        <Textarea
          value={state.content}
          placeholder='粘贴目标岗位描述、招聘要求或 JD 文本'
          maxlength={20000}
          onInput={event => onContentChange(event.detail.value)}
          className='reffo-create-textarea reffo-create-textarea--job'
          data-testid='job-description-input'
        />
      </View>
    )
  }

  return (
    <View
      className={classNames('reffo-create-job__content', {
        'reffo-create-job__content--fading': isModeFading,
      })}
    >
      <View
        className={classNames('reffo-create-job__upload', {
          'reffo-create-job__upload--filled': hasAttachment,
          'reffo-create-job__upload--error': hasError,
        })}
        onClick={onPickAttachment}
        role='button'
        data-testid={hasError ? 'job-upload-error' : hasAttachment ? 'job-upload-preview' : 'job-upload-trigger'}
      >
        {hasAttachment && state.attachment?.previewPath ? (
          <Image src={state.attachment.previewPath} mode='aspectFit' className='reffo-create-job__preview' />
        ) : (
          <View className={classNames('reffo-create-job__upload-icon', {
            'reffo-create-job__upload-icon--error': hasError,
          })}>
            {hasError ? (
              <Text>!</Text>
            ) : (
              <Image src={UPLOAD_IMAGE_ICON} mode='aspectFit' className='reffo-create-job__upload-file-icon' />
            )}
          </View>
        )}
        <Text className='reffo-create-job__upload-title'>
          {isUploading
            ? '上传中...'
            : hasError
              ? '上传失败'
              : hasAttachment
                ? state.attachment?.name
                : '上传岗位描述截图'}
        </Text>
        <Text className='reffo-create-job__upload-subtitle'>
          {hasError
            ? state.attachmentErrorMessage || '文件读取失败，请重试'
            : hasAttachment
              ? state.attachment?.sizeLabel || state.attachment?.extension
              : '点击选择'}
        </Text>
      </View>
    </View>
  )
}
function JobDescriptionStepH5({
  state,
  onCompanyNameChange,
  onPositionNameChange,
  onContentChange,
  onInputModeChange,
  onPickAttachment,
  isExiting = false,
}: {
  state: JobDescriptionStepState
  onCompanyNameChange: CreatePageViewModel['handleJobCompanyNameChange']
  onPositionNameChange: CreatePageViewModel['handleJobPositionNameChange']
  onContentChange: CreatePageViewModel['handleJobDescriptionChange']
  onInputModeChange: CreatePageViewModel['handleJobInputModeChange']
  onPickAttachment: CreatePageViewModel['handlePickJobAttachment']
  isExiting?: boolean
}) {
  return (
    <View className='reffo-create-step reffo-create-step--job'>
      <Card
        className={classNames('reffo-create-job', {
          'reffo-create-job--exiting': isExiting,
        })}
        bordered={false}
        shadow='none'
      >
        <View className='reffo-create-job__hardware' />
        <View className='reffo-create-job__ribbon'>
          <Text>新的工牌制作中！</Text>
        </View>

        <View className='reffo-create-job__field'>
          <Text className='reffo-create-job__label'>公司（可选）</Text>
          <Input
            value={state.companyName}
            placeholder='输入公司名称'
            onInput={event => onCompanyNameChange(event.detail.value)}
            className='reffo-create-job__input'
            data-testid='job-company-input'
          />
        </View>

        <View className='reffo-create-job__field'>
          <Text className='reffo-create-job__label'>岗位名称（可选）</Text>
          <Input
            value={state.positionName}
            placeholder='输入岗位名称'
            onInput={event => onPositionNameChange(event.detail.value)}
            className='reffo-create-job__input'
            data-testid='job-position-input'
          />
        </View>

        <View className='reffo-create-job__field reffo-create-job__field--description'>
          <Text className='reffo-create-job__label'>目标岗位描述</Text>
          <View className='reffo-create-job__panel'>
            <JobUploadPanel state={state} onPickAttachment={onPickAttachment} onContentChange={onContentChange} />
            <View className='reffo-create-job__modebar'>
              <ModeTab mode='upload' active={state.inputMode === 'upload'} onClick={() => onInputModeChange('upload')} />
              <View className='reffo-create-job__mode-divider' />
              <ModeTab mode='manual' active={state.inputMode === 'manual'} onClick={() => onInputModeChange('manual')} />
            </View>
          </View>
        </View>
      </Card>
    </View>
  )
}

function GenerationOverlay({
  state,
  onCancelGeneration,
}: {
  state: NonNullable<CreatePageViewModel['generationState']>
  onCancelGeneration: CreatePageViewModel['handleCancelGeneration']
}) {
  const {tier: visualTier} = useVisualTier({benchmark: false})
  const titleReelItems = useMemo(() => {
    const items = [
      state.resumeTitle.trim() || '源简历',
      state.companyName.trim() || '目标公司',
      state.positionName.trim() || '目标岗位',
    ]

    return [...items, items[0]]
  }, [state.companyName, state.positionName, state.resumeTitle])
  const card = useMemo<HomeCardItem>(() => {
    const company = state.companyName.trim() || state.resumeTitle || 'Reffo'
    const role = state.positionName.trim() || '最佳匹配简历'

    return {
      id: `generation-${company}-${role}`,
      company,
      indexLabel: state.monogram,
      location: '智能生成中',
      role,
      dateLabel: '今天',
      score: 88,
      primaryColor: GENERATION_CARD_PALETTE.primaryColor,
      surfaceColor: GENERATION_CARD_PALETTE.surfaceColor,
      stackColor: GENERATION_CARD_PALETTE.stackColor,
      logoColor: GENERATION_CARD_PALETTE.logoColor,
      borderColor: GENERATION_CARD_PALETTE.borderColor,
      tone: GENERATION_CARD_PALETTE.tone,
      strategyBody: '',
    }
  }, [state.companyName, state.monogram, state.positionName, state.resumeTitle])

  return (
    <View className='reffo-create-generation'>
      <View className='reffo-create-generation__backdrop' />
      <View className='reffo-create-generation__content'>
        <View className='reffo-create-generation__main'>
          <View className='reffo-create-generation__card-stage reffo-home-deck-wrap--enhanced'>
            <HomeScoreCard
              card={card}
              depth={0}
              active
              visualTier={visualTier}
              variant='generating'
              className='reffo-create-generation__home-card'
            />
          </View>
          <View className='reffo-create-generation__copy'>
            <View className='reffo-create-generation__title'>
              <Text className='reffo-create-generation__title-accent'>正在分析 </Text>
              <View className='reffo-create-generation__title-reel' aria-hidden='true'>
                <View className='reffo-create-generation__title-reel-track'>
                  {titleReelItems.map((item, index) => (
                    <Text
                      key={`${item}-${index}`}
                      className='reffo-create-generation__title-main'
                    >
                      {item}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
            <Text className='reffo-create-generation__detail'>
              正在为你的目标岗位量身定做最佳匹配简历……
            </Text>
          </View>
        </View>
        <View className='reffo-create-generation__cancel' onClick={onCancelGeneration}>
          <Text>× 取消</Text>
        </View>
      </View>
    </View>
  )
}

export default function PageView({
  currentStep,
  currentStepMeta,
  resumeUploadState,
  resumeSummaryState,
  jobDescriptionState,
  generationState,
  canSaveCurrentStep,
  isSavingCurrentStep,
  primaryActionLabel,
  handlePickResumeFile,
  handleRemoveResumeFile,
  handleEditSourceResume,
  handleDeleteSourceResume,
  handleResumeMarkdownChange,
  handleJobDescriptionChange,
  handleJobCompanyNameChange,
  handleJobPositionNameChange,
  handleJobInputModeChange,
  handlePickJobAttachment,
  handlePrimaryAction,
  handleCancelGeneration,
  handleClose,
}: CreatePageViewModel) {
  const isJobStep = currentStep === 'jobDescription'
  const [pendingGenerationState, setPendingGenerationState] = useState<CreateGenerationState | null>(null)
  const [isLaunchingGeneration, setIsLaunchingGeneration] = useState(false)
  const [isReturningFromGeneration, setIsReturningFromGeneration] = useState(false)
  const [isCssFallbackLaunching, setIsCssFallbackLaunching] = useState(false)
  const [isGenerationCompleted, setIsGenerationCompleted] = useState(false)
  const launchGenerationTimerRef = useRef<number | null>(null)
  const isActionDisabled = !canSaveCurrentStep || isSavingCurrentStep || isLaunchingGeneration || isCssFallbackLaunching
  const actionLabel = currentStep === 'resumeUpload' ? '保存' : primaryActionLabel
  const visibleGenerationState = generationState || pendingGenerationState

  useEffect(() => {
    return () => {
      if (launchGenerationTimerRef.current != null) {
        window.clearTimeout(launchGenerationTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (generationState && pendingGenerationState) {
      setPendingGenerationState(null)
    }
  }, [generationState, pendingGenerationState])

  const handleActionClick = async () => {
    if (isActionDisabled || isLaunchingGeneration) {
      return
    }

    if (isJobStep) {
      const nextGenerationState = buildPendingGenerationState({
        resumeSummaryState,
        jobDescriptionState,
      })

      setIsLaunchingGeneration(true)
      setIsGenerationCompleted(false)

      const finishGeneration = (didNavigateToResult: boolean) => {
        if (didNavigateToResult) {
          setIsGenerationCompleted(true)
        }
      }

      if (canUseViewTransition()) {
        const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
          flushSync(() => {
            setPendingGenerationState(nextGenerationState)
          })
        })

        void transition?.finished.finally(() => {
          setIsLaunchingGeneration(false)
          void handlePrimaryAction().then(finishGeneration).finally(() => {
            setPendingGenerationState(null)
            setIsLaunchingGeneration(false)
          })
        })
      } else {
        setIsCssFallbackLaunching(true)
        launchGenerationTimerRef.current = window.setTimeout(() => {
          launchGenerationTimerRef.current = null
          setPendingGenerationState(nextGenerationState)
          setIsLaunchingGeneration(false)
          setIsCssFallbackLaunching(false)
          void handlePrimaryAction().then(finishGeneration).finally(() => {
            setPendingGenerationState(null)
            setIsLaunchingGeneration(false)
            setIsCssFallbackLaunching(false)
          })
        }, 260)
      }
      return
    }

    await handlePrimaryAction()
  }

  const handleGenerationCancelClick = () => {
    if (!visibleGenerationState || isReturningFromGeneration) {
      return
    }

    const clearGenerationState = () => {
      setPendingGenerationState(null)
      setIsLaunchingGeneration(false)
      setIsCssFallbackLaunching(false)
      setIsGenerationCompleted(false)
      handleCancelGeneration()
    }

    setIsReturningFromGeneration(true)

    if (canUseViewTransition()) {
      const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
        flushSync(clearGenerationState)
      })

      void transition?.finished.finally(() => {
        setIsReturningFromGeneration(false)
      })
      return
    }

    clearGenerationState()
    window.setTimeout(() => {
      setIsReturningFromGeneration(false)
    }, 360)
  }

  return (
    <View
      className={classNames('reffo-create', {
        'reffo-create--warm': isJobStep,
        'reffo-create--generation-launching': isLaunchingGeneration,
        'reffo-create--css-generation-launching': isCssFallbackLaunching,
        'reffo-create--launching-generation': isLaunchingGeneration,
        'reffo-create--returning-generation': isReturningFromGeneration,
        'reffo-create--generation-completed': isGenerationCompleted,
      })}
    >
      <CreateBackdrop variant={isJobStep ? 'warm' : 'cool'} />
      <View className='reffo-create__frame'>
        <View className='reffo-create__close' onClick={handleClose} role='button' data-testid='create-flow-close'>
          <Text>×</Text>
        </View>
        <StepHeader meta={currentStepMeta} />
        <View className='reffo-create__body'>
          {currentStep === 'resumeUpload' ? (
            <ResumeUploadStepH5
              state={resumeUploadState}
              onPickFile={handlePickResumeFile}
              onRemoveFile={handleRemoveResumeFile}
              onMarkdownChange={handleResumeMarkdownChange}
            />
          ) : null}
          {currentStep === 'resumeSummary' && resumeSummaryState ? (
            <ResumeSummaryStepH5
              state={resumeSummaryState}
              onEdit={handleEditSourceResume}
              onDelete={handleDeleteSourceResume}
            />
          ) : null}
          {currentStep === 'resumeSummary' && !resumeSummaryState ? (
            <ResumeUploadStepH5
              state={resumeUploadState}
              onPickFile={handlePickResumeFile}
              onRemoveFile={handleRemoveResumeFile}
              onMarkdownChange={handleResumeMarkdownChange}
            />
          ) : null}
          {currentStep === 'jobDescription' && !visibleGenerationState ? (
            <JobDescriptionStepH5
              state={jobDescriptionState}
              onCompanyNameChange={handleJobCompanyNameChange}
              onPositionNameChange={handleJobPositionNameChange}
              onContentChange={handleJobDescriptionChange}
              onInputModeChange={handleJobInputModeChange}
              onPickAttachment={handlePickJobAttachment}
              isExiting={isLaunchingGeneration}
            />
          ) : null}
        </View>
        <View className='reffo-create__footer'>
          <View
            className={classNames('reffo-create__primary', {
              'reffo-create__primary--warm': isJobStep,
              'reffo-create__primary--dark': currentStep === 'resumeSummary',
              'reffo-create__primary--disabled': isActionDisabled,
            })}
            onClick={handleActionClick}
            role='button'
            aria-disabled={isActionDisabled}
            data-testid='create-flow-primary-action'
          >
            {isJobStep ? (
              <View className='reffo-create__primary-spark' aria-hidden='true'>
                <Text className='reffo-create__primary-spark-main'>✦</Text>
                <Text className='reffo-create__primary-spark-small'>✦</Text>
              </View>
            ) : null}
            <Text>{isSavingCurrentStep ? '处理中...' : actionLabel}</Text>
          </View>
        </View>
      </View>
      {visibleGenerationState ? (
        <GenerationOverlay
          state={visibleGenerationState}
          onCancelGeneration={handleGenerationCancelClick}
        />
      ) : null}
    </View>
  )
}
