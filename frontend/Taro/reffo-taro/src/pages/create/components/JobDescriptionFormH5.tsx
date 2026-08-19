import {Input, Text, Textarea, View} from '@tarojs/components'
import classNames from 'classnames'
import {Card} from '@/components/Card'
import type {JobDescriptionStepState} from '../types'
import '../index.h5.scss'

interface JobDescriptionFormH5Props {
  state: Pick<JobDescriptionStepState, 'content' | 'companyName' | 'positionName' | 'baseLocation' | 'attachmentStatus' | 'attachmentProgress' | 'attachment' | 'attachmentErrorMessage'>
  onCompanyNameChange?: (value: string) => void
  onPositionNameChange?: (value: string) => void
  onLocationChange?: (value: string) => void
  onContentChange?: (value: string) => void
  onPickAttachment?: () => Promise<void>
  isExiting?: boolean
  isDescriptionReadOnly?: boolean
  isFormReadOnly?: boolean
}

export default function JobDescriptionFormH5({
  state,
  onCompanyNameChange,
  onPositionNameChange,
  onLocationChange,
  onContentChange,
  onPickAttachment,
  isExiting = false,
  isDescriptionReadOnly = false,
  isFormReadOnly = false,
}: JobDescriptionFormH5Props) {
  const isUploadingAttachment = state.attachmentStatus === 'uploading'
  const hasAttachment = state.attachmentStatus === 'success' && Boolean(state.attachment)
  const hasError = state.attachmentStatus === 'error'

  return (
    <View className='reffo-create-step reffo-create-step--job'>
      <Card
        className={classNames('reffo-create-job', {'reffo-create-job--exiting': isExiting})}
        bordered={false}
        shadow='none'
      >
        <View className='reffo-create-job__hardware' />
        <View className='reffo-create-job__ribbon'><Text>新的工牌制作中！</Text></View>
        <View className='reffo-create-job__field-row'>
          <View className='reffo-create-job__field reffo-create-job__field--half'>
            <Text className='reffo-create-job__label'>公司</Text>
            <Input value={state.companyName} placeholder='输入公司名称' disabled={isUploadingAttachment || isFormReadOnly} onInput={event => onCompanyNameChange?.(event.detail.value)} className='reffo-create-job__input' data-testid='job-company-input' />
          </View>
          <View className='reffo-create-job__field reffo-create-job__field--half'>
            <Text className='reffo-create-job__label'>Base</Text>
            <Input value={state.baseLocation} placeholder='输入岗位城市' disabled={isUploadingAttachment || isFormReadOnly} onInput={event => onLocationChange?.(event.detail.value)} className='reffo-create-job__input' data-testid='job-location-input' />
          </View>
        </View>
        <View className='reffo-create-job__field'>
          <Text className='reffo-create-job__label'>目标岗位名称</Text>
          <Input value={state.positionName} placeholder='输入岗位名称' disabled={isUploadingAttachment || isFormReadOnly} onInput={event => onPositionNameChange?.(event.detail.value)} className='reffo-create-job__input' data-testid='job-position-input' />
        </View>
        <View className='reffo-create-job__field reffo-create-job__field--description'>
          <Text className='reffo-create-job__label'>目标岗位描述</Text>
          <View className='reffo-create-job__panel'>
            <View className='reffo-create-job__content reffo-create-job__content--combined'>
              {onPickAttachment && !isDescriptionReadOnly && !isFormReadOnly ? (
                <View
                  className={classNames('reffo-create-job__upload-strip', {
                    'reffo-create-job__upload-strip--filled': hasAttachment,
                    'reffo-create-job__upload-strip--error': hasError,
                    'reffo-create-job__upload-strip--uploading': isUploadingAttachment,
                  })}
                  style={{'--job-upload-progress': state.attachmentProgress / 100} as any}
                  onClick={isUploadingAttachment ? undefined : onPickAttachment}
                  role='button'
                >
                  <Text className='reffo-create-job__upload-strip-text'>
                    {hasError ? `! ${state.attachmentErrorMessage || '上传失败，请重试'}` : isUploadingAttachment ? `正在解析图片 ${Math.round(state.attachmentProgress)}%` : hasAttachment ? '已成功上传并解析岗位描述' : '+ 上传岗位描述截图'}
                  </Text>
                </View>
              ) : null}
              <Textarea
                value={state.content}
                placeholder='或输入岗位描述'
                maxlength={20000}
                disabled={isUploadingAttachment || isDescriptionReadOnly || isFormReadOnly}
                onInput={event => onContentChange?.(event.detail.value)}
                className='reffo-create-textarea reffo-create-textarea--job'
                data-testid='job-description-input'
              />
            </View>
          </View>
        </View>
      </Card>
    </View>
  )
}
