import {useEffect, useMemo, useRef, useState} from 'react'
import {flushSync} from 'react-dom'
import {Image, Input, Text, Textarea, View} from '@tarojs/components'
import classNames from 'classnames'
import CANCEL_ICON from '@/assets/create/cancel.svg'
import DELETE_ICON from '@/assets/create/delete.svg'
import {Card} from '@/components/Card'
import DeleteBreakCard from '@/components/business/DeleteBreakCard/index.h5'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import ResumeUploadIcon from '@/components/business/ResumeUploadIcon/index.h5'
import {useVisualTier} from '@/utils'
import JobDescriptionFormH5 from './components/JobDescriptionFormH5'
import CreatePrimaryActionH5 from './components/CreatePrimaryActionH5'
import GenerationStageH5, {buildPendingGenerationState} from './components/GenerationStageH5'
import LandingFlowHeader from './components/LandingFlowHeader.h5'
import type {CreatePageViewModel} from './usePageModel'
import type {
  CreateGenerationState,
  CreateStepMeta,
  JobDescriptionStepState,
  ResumeUploadStepState,
} from './types'
import '@/pages/index/index.h5.scss'
import './index.h5.scss'

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => {
    ready: Promise<void>
    finished: Promise<void>
  }
}

type DeletePreviewPhase = 'idle' | 'preview' | 'deleting' | 'breaking'
type DeleteCardTransitionDirection = 'enter' | 'return'

const DELETE_LOADING_MESSAGES = [
  '掰掰就拜拜',
  '把简历扔进垃圾桶吧！',
  '不当牛马了！',
  '这份简历下班了',
]

const DELETE_LAY_ANIMATION_MS = 620
const DELETE_WAIT_ANIMATION_MS = 2000
const DELETE_REQUEST_MIN_MS = DELETE_LAY_ANIMATION_MS + DELETE_WAIT_ANIMATION_MS
const DELETE_BREAK_ANIMATION_MS = 1180
const DELETE_SWIPE_RIGHT_THRESHOLD = 78
const DELETE_SWIPE_DOWN_THRESHOLD = 86
const DELETE_SWIPE_DIRECTION_RATIO = 1.16
const DELETE_GESTURE_RETURN_MS = 240

function canUseViewTransition() {
  return typeof document !== 'undefined'
    && typeof (document as DocumentWithViewTransition).startViewTransition === 'function'
}

function runDeleteCardViewTransition(
  direction: DeleteCardTransitionDirection,
  update: () => void,
) {
  if (!canUseViewTransition()) {
    update()
    return
  }

  const transitionClass = direction === 'enter'
    ? 'reffo-delete-vt-enter'
    : 'reffo-delete-vt-return'
  const root = document.documentElement

  root.classList.add(transitionClass)

  const transition = (document as DocumentWithViewTransition).startViewTransition?.(() => {
    flushSync(update)
  })

  if (!transition) {
    root.classList.remove(transitionClass)
    return
  }

  void transition.finished.finally(() => {
    root.classList.remove(transitionClass)
  })
}

function waitForDeleteMotion(duration: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, duration)
  })
}

function clampGestureValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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
          <ResumeUploadIcon status={state.status} extension={state.file?.extension} />
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
            <ResumeUploadIcon status='success' extension={fileExtension} />
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

function JobUploadPanel({
  state,
  onPickAttachment,
  onContentChange,
  readOnly = false,
}: {
  state: JobDescriptionStepState
  onPickAttachment: CreatePageViewModel['handlePickJobAttachment']
  onContentChange: CreatePageViewModel['handleJobDescriptionChange']
  readOnly?: boolean
}) {
  const isUploading = state.attachmentStatus === 'uploading'
  const hasError = state.attachmentStatus === 'error'
  const hasAttachment = state.attachmentStatus === 'success' && Boolean(state.attachment)
  const uploadProgress = Math.max(0, Math.min(100, state.attachmentProgress))
  const uploadTestId = hasError
    ? 'job-upload-error'
    : isUploading
      ? 'job-upload-loading'
      : hasAttachment
        ? 'job-upload-preview'
        : 'job-upload-trigger'

  return (
    <View className='reffo-create-job__content reffo-create-job__content--combined'>
      {!readOnly ? (
        <View
          className={classNames('reffo-create-job__upload-strip', {
            'reffo-create-job__upload-strip--filled': hasAttachment,
            'reffo-create-job__upload-strip--error': hasError,
            'reffo-create-job__upload-strip--uploading': isUploading,
          })}
          style={{'--job-upload-progress': uploadProgress / 100} as any}
          onClick={isUploading ? undefined : onPickAttachment}
          role='button'
          data-testid={uploadTestId}
        >
          <Text
            className={classNames('reffo-create-job__upload-strip-text', {
              'reffo-create-job__upload-strip-text--success': hasAttachment,
              'reffo-create-job__upload-strip-text--error': hasError,
              'reffo-create-job__upload-strip-text--uploading': isUploading,
            })}
          >
            {hasError
              ? `! ${state.attachmentErrorMessage || '上传失败，请重试'}`
              : isUploading
                ? `正在解析图片 ${Math.round(uploadProgress)}%`
              : hasAttachment
                ? '✅ 已成功上传并解析岗位描述'
                : '+ 上传岗位描述截图'}
          </Text>
        </View>
      ) : null}
      <Textarea
        value={state.content}
        placeholder='或输入岗位描述'
        maxlength={20000}
        disabled={isUploading || readOnly}
        onInput={event => {
          if (!isUploading && !readOnly) {
            onContentChange(event.detail.value)
          }
        }}
        className={classNames('reffo-create-textarea reffo-create-textarea--job', {
          'reffo-create-textarea--disabled': isUploading,
          'reffo-create-textarea--readonly': readOnly,
        })}
        data-testid='job-description-input'
      />
    </View>
  )
}
const JobDescriptionStepH5 = JobDescriptionFormH5

function DeleteResumeOverlay({
  card,
  phase,
  onCommitDelete,
  onClose,
  onReturnToEdit,
}: {
  card: HomeCardItem | null
  phase: Exclude<DeletePreviewPhase, 'idle'>
  onCommitDelete: () => Promise<void>
  onClose: () => void
  onReturnToEdit: () => void
}) {
  const {tier: visualTier} = useVisualTier({benchmark: false})
  const touchStartRef = useRef<{x: number; y: number} | null>(null)
  const gestureReturnTimerRef = useRef<number | null>(null)
  const isDeleting = phase === 'deleting'
  const isBreaking = phase === 'breaking'
  const isProcessing = isDeleting || isBreaking
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0)
  const [dragFeedback, setDragFeedback] = useState({
    x: 0,
    y: 0,
    progressX: 0,
    progressY: 0,
    isActive: false,
  })

  useEffect(() => {
    return () => {
      if (gestureReturnTimerRef.current != null) {
        window.clearTimeout(gestureReturnTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isDeleting) {
      setLoadingMessageIndex(0)
      return undefined
    }

    const timer = window.setInterval(() => {
      setLoadingMessageIndex(index => (index + 1) % DELETE_LOADING_MESSAGES.length)
    }, 920)

    return () => {
      window.clearInterval(timer)
    }
  }, [isDeleting])

  const resetDragFeedback = () => {
    setDragFeedback(previous => previous.isActive || previous.x || previous.y || previous.progressX || previous.progressY
      ? {
          x: 0,
          y: 0,
          progressX: 0,
          progressY: 0,
          isActive: false,
        }
      : previous)
  }

  const scheduleGestureAction = (action: 'return' | 'delete') => {
    if (gestureReturnTimerRef.current != null) {
      return
    }

    gestureReturnTimerRef.current = window.setTimeout(() => {
      gestureReturnTimerRef.current = null

      if (action === 'return') {
        onReturnToEdit()
        return
      }

      void onCommitDelete()
    }, DELETE_GESTURE_RETURN_MS)
  }

  const handleTouchStart = (event: any) => {
    if (isProcessing || gestureReturnTimerRef.current != null) {
      touchStartRef.current = null
      resetDragFeedback()
      return
    }

    const touch = event.touches[0] ?? event.changedTouches[0]
    touchStartRef.current = touch
      ? {
          x: touch.clientX,
          y: touch.clientY,
        }
      : null
    setDragFeedback({
      x: 0,
      y: 0,
      progressX: 0,
      progressY: 0,
      isActive: true,
    })
  }

  const handleTouchMove = (event: any) => {
    if (phase !== 'preview') {
      return
    }

    const start = touchStartRef.current
    const touch = event.touches[0] ?? event.changedTouches[0]

    if (!start || !touch) {
      return
    }

    const deltaX = Math.max(0, touch.clientX - start.x)
    const deltaY = Math.max(0, touch.clientY - start.y)
    const isHorizontal = deltaX > deltaY * DELETE_SWIPE_DIRECTION_RATIO
    const isVertical = deltaY > deltaX * DELETE_SWIPE_DIRECTION_RATIO
    const dampedX = isHorizontal ? clampGestureValue(deltaX * 0.72, 0, 92) : 0
    const dampedY = isVertical ? clampGestureValue(deltaY * 0.58, 0, 94) : 0

    setDragFeedback({
      x: dampedX,
      y: dampedY,
      progressX: isHorizontal ? clampGestureValue(deltaX / DELETE_SWIPE_RIGHT_THRESHOLD, 0, 1) : 0,
      progressY: isVertical ? clampGestureValue(deltaY / DELETE_SWIPE_DOWN_THRESHOLD, 0, 1) : 0,
      isActive: true,
    })
  }

  const handleTouchEnd = (event: any) => {
    if (phase !== 'preview') {
      return
    }

    const start = touchStartRef.current
    const touch = event.changedTouches[0]
    touchStartRef.current = null
    resetDragFeedback()

    if (!start || !touch) {
      return
    }

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const absoluteDeltaX = Math.abs(deltaX)
    const absoluteDeltaY = Math.abs(deltaY)

    if (deltaX >= DELETE_SWIPE_RIGHT_THRESHOLD && absoluteDeltaX > absoluteDeltaY * DELETE_SWIPE_DIRECTION_RATIO) {
      scheduleGestureAction('return')
      return
    }

    if (deltaY < DELETE_SWIPE_DOWN_THRESHOLD || absoluteDeltaY < absoluteDeltaX * DELETE_SWIPE_DIRECTION_RATIO) {
      return
    }

    scheduleGestureAction('delete')
  }

  const handleFooterClick = () => {
    if (phase !== 'preview') {
      return
    }

    void onCommitDelete()
  }

  const handleReturnClick = () => {
    if (phase !== 'preview') {
      return
    }

    onReturnToEdit()
  }

  if (!card) {
    return null
  }

  const dragStyle = {
    '--delete-drag-x': `${dragFeedback.x}px`,
    '--delete-drag-y': `${dragFeedback.y}px`,
    '--delete-drag-progress-x': dragFeedback.progressX,
    '--delete-drag-progress-y': dragFeedback.progressY,
  } as any

  return (
    <View
      className={classNames('reffo-create-delete', {
        'reffo-create-delete--deleting': isDeleting,
        'reffo-create-delete--breaking': isBreaking,
        'reffo-create-delete--dragging': dragFeedback.isActive,
      })}
      style={dragStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        touchStartRef.current = null
        resetDragFeedback()
      }}
    >
      <View className='reffo-create-delete__backdrop' />
      <View className='reffo-create-delete__content'>
        <View className='reffo-create-delete__close' onClick={onClose} role='button' aria-label='关闭编辑简历'>
          <Text>×</Text>
        </View>
        <DeleteBreakCard
          card={card}
          phase={phase === 'preview' ? 'idle' : phase}
          visualTier={visualTier}
          className='reffo-create-delete__card-stage reffo-home-deck-wrap--enhanced'
          cardClassName='reffo-create-delete__home-card'
          pieceCardClassName='reffo-create-delete__home-card--piece'
          style={dragStyle}
          front={(
            <View className='reffo-create-delete__front-card'>
              <View className='reffo-create-job__hardware' />
              <View className='reffo-create-job__ribbon'>
                <Text>申请信息</Text>
              </View>
              <View className='reffo-create-delete__front-field'>
                <Text className='reffo-create-delete__front-label'>公司</Text>
                <Text className='reffo-create-delete__front-value'>{card.company}</Text>
              </View>
              <View className='reffo-create-delete__front-field'>
                <Text className='reffo-create-delete__front-label'>岗位</Text>
                <Text className='reffo-create-delete__front-value'>{card.role}</Text>
              </View>
              <View className='reffo-create-delete__front-field'>
                <Text className='reffo-create-delete__front-label'>工作地</Text>
                <Text className='reffo-create-delete__front-value'>{card.location}</Text>
              </View>
            </View>
          )}
        />

        <View className='reffo-create-delete__copy'>
          <View className='reffo-create-delete__title'>
            <Text className='reffo-create-delete__title-accent'>删除</Text>
            <Text className='reffo-create-delete__title-main'>这份简历</Text>
          </View>
          <Text className='reffo-create-delete__description'>
            删除后首页将不再显示这张岗位简历卡片
          </Text>
        </View>

        <View
          className='reffo-create-delete__footer'
          onClick={handleFooterClick}
          role='button'
          aria-disabled={phase !== 'preview'}
        >
          {!isProcessing ? (
            <Text className='reffo-create-delete__footer-arrow'>↓</Text>
          ) : null}
          <Text className='reffo-create-delete__footer-text'>
            {isBreaking ? '拜拜' : isProcessing ? DELETE_LOADING_MESSAGES[loadingMessageIndex] : '下滑删除'}
          </Text>
          {!isProcessing ? (
            <Text className='reffo-create-delete__footer-arrow'>↓</Text>
          ) : null}
        </View>
        <View
          className='reffo-create-delete__cancel-hint'
          onClick={handleReturnClick}
          role='button'
          aria-disabled={phase !== 'preview'}
          aria-label='返回编辑简历'
        >
          <Text className='reffo-create-delete__cancel-text'>右滑返回</Text>
          <Text className='reffo-create-delete__cancel-arrow'>→</Text>
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
  isHistoryEditMode,
  editingHistoryCard,
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
  handleJobLocationChange,
  handlePickJobAttachment,
  handlePrimaryAction,
  handleDeleteHistoryResume,
  handleReturnHome,
  handleCancelGeneration,
  handleClose,
  isLandingFlow,
  handleLandingSkip,
}: CreatePageViewModel) {
  const isJobStep = currentStep === 'jobDescription'
  const [pendingGenerationState, setPendingGenerationState] = useState<CreateGenerationState | null>(null)
  const [deletePreviewPhase, setDeletePreviewPhase] = useState<DeletePreviewPhase>('idle')
  const [deletePreviewCard, setDeletePreviewCard] = useState<HomeCardItem | null>(null)
  const [isLaunchingGeneration, setIsLaunchingGeneration] = useState(false)
  const [isReturningFromGeneration, setIsReturningFromGeneration] = useState(false)
  const [isCssFallbackLaunching, setIsCssFallbackLaunching] = useState(false)
  const [isGenerationCompleted, setIsGenerationCompleted] = useState(false)
  const launchGenerationTimerRef = useRef<number | null>(null)
  const deleteBreakTimerRef = useRef<number | null>(null)
  const isDeletePreviewActive = deletePreviewPhase !== 'idle'
  const isActionDisabled =
    !canSaveCurrentStep ||
    isSavingCurrentStep ||
    isLaunchingGeneration ||
    isCssFallbackLaunching ||
    isDeletePreviewActive
  const actionLabel = currentStep === 'resumeUpload' ? '保存' : primaryActionLabel
  const visibleGenerationState = generationState || pendingGenerationState

  useEffect(() => {
    return () => {
      if (launchGenerationTimerRef.current != null) {
        window.clearTimeout(launchGenerationTimerRef.current)
      }
      if (deleteBreakTimerRef.current != null) {
        window.clearTimeout(deleteBreakTimerRef.current)
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

    if (isJobStep && !isHistoryEditMode) {
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

  const handleDeleteClick = () => {
    if (!isHistoryEditMode || isSavingCurrentStep || isDeletePreviewActive || !editingHistoryCard) {
      return
    }

    runDeleteCardViewTransition('enter', () => {
      setDeletePreviewCard(editingHistoryCard)
      setDeletePreviewPhase('preview')
    })
  }

  const handleReturnToEdit = () => {
    if (deletePreviewPhase !== 'preview') {
      return
    }

    runDeleteCardViewTransition('return', () => {
      setDeletePreviewPhase('idle')
      setDeletePreviewCard(null)
    })
  }

  const handleCommitDelete = async () => {
    if (deletePreviewPhase !== 'preview') {
      return
    }

    setDeletePreviewPhase('deleting')
    const [isDeleted] = await Promise.all([
      handleDeleteHistoryResume(),
      waitForDeleteMotion(DELETE_REQUEST_MIN_MS),
    ])

    if (!isDeleted) {
      setDeletePreviewPhase('preview')
      return
    }

    setDeletePreviewPhase('breaking')
    deleteBreakTimerRef.current = window.setTimeout(() => {
      deleteBreakTimerRef.current = null
      void handleReturnHome()
    }, DELETE_BREAK_ANIMATION_MS)
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
        'reffo-create--history-edit': isHistoryEditMode,
        'reffo-create--delete-preview': isDeletePreviewActive,
        'reffo-create--landing-flow': isLandingFlow,
      })}
    >
      <CreateBackdrop variant={isJobStep ? 'warm' : 'cool'} />
      <View className='reffo-create__frame'>
        {!isLandingFlow ? <View className='reffo-create__close' onClick={handleClose} role='button' data-testid='create-flow-close'>
          <Text>×</Text>
        </View> : null}
        {isLandingFlow ? (
          <LandingFlowHeader onBack={handleClose} onSkip={handleLandingSkip} progressStep={2} />
        ) : null}
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
              onLocationChange={handleJobLocationChange}
              onContentChange={handleJobDescriptionChange}
              onPickAttachment={handlePickJobAttachment}
              isExiting={isLaunchingGeneration}
              isDescriptionReadOnly={isHistoryEditMode}
            />
          ) : null}
        </View>
        <View
          className={classNames('reffo-create__footer', {
            'reffo-create__footer--edit': isHistoryEditMode && isJobStep,
          })}
        >
          {isJobStep ? <CreatePrimaryActionH5 label={actionLabel} disabled={isActionDisabled} loading={isSavingCurrentStep} onClick={handleActionClick} /> : (
            <View className={classNames('reffo-create__primary', {'reffo-create__primary--dark': currentStep === 'resumeSummary', 'reffo-create__primary--disabled': isActionDisabled})} onClick={handleActionClick} role='button' aria-disabled={isActionDisabled} data-testid='create-flow-primary-action'>
              <Text>{isSavingCurrentStep ? '处理中...' : actionLabel}</Text>
            </View>
          )}
          {isHistoryEditMode && isJobStep ? (
            <View
              className={classNames('reffo-create__delete-action', {
                'reffo-create__delete-action--disabled': isSavingCurrentStep || isDeletePreviewActive,
              })}
              onClick={handleDeleteClick}
              role='button'
              aria-disabled={isSavingCurrentStep || isDeletePreviewActive}
              data-testid='create-flow-delete-history'
            >
              <Image className='reffo-create__delete-icon' src={DELETE_ICON} mode='aspectFit' />
              <Text>删除简历</Text>
            </View>
          ) : null}
        </View>
      </View>
      {visibleGenerationState ? (
        <GenerationStageH5
          state={visibleGenerationState}
          onCancelGeneration={handleGenerationCancelClick}
          isLandingFlow={isLandingFlow}
          onLandingBack={handleClose}
          onLandingSkip={handleLandingSkip}
        />
      ) : null}
      {isDeletePreviewActive ? (
        <DeleteResumeOverlay
          card={deletePreviewCard || editingHistoryCard}
          phase={deletePreviewPhase}
          onCommitDelete={handleCommitDelete}
          onClose={handleClose}
          onReturnToEdit={handleReturnToEdit}
        />
      ) : null}
    </View>
  )
}
