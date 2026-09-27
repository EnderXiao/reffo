import {useEffect, useRef, useState} from 'react'
import {Text, Textarea, View} from '@tarojs/components'
import classNames from 'classnames'
import ResumeUploadIcon from '@/components/business/ResumeUploadIcon/index.h5'
import type {ResumeUploadStepState} from '../types'

export interface ResumeUploadStepH5Props {
  state: ResumeUploadStepState
  onPickFile: () => Promise<void> | void
  onRemoveFile: () => void
  onMarkdownChange: (value: string) => void
}

function getInputValue(event: {detail?: {value?: string}; target?: unknown}) {
  const targetValue = (event.target as {value?: string} | null)?.value
  return event.detail?.value ?? targetValue ?? ''
}

export default function ResumeUploadStepH5({
  state,
  onPickFile,
  onRemoveFile,
  onMarkdownChange,
}: ResumeUploadStepH5Props) {
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
              <Text className='reffo-create-upload__meta'>{state.file.sizeLabel || state.file.extension}</Text>
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
          onInput={event => onMarkdownChange(getInputValue(event))}
          className='reffo-create-textarea reffo-create-textarea--resume'
          data-testid='resume-markdown-input'
        />
      </View>

      <Text className='reffo-create-tip'>您提供的信息越详细，Reffo 就越能为您生成一份与目标职位高度契合的简历</Text>
    </View>
  )
}
