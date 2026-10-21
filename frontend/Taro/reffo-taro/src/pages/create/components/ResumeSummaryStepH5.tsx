import {Image, Text, View} from '@tarojs/components'
import CANCEL_ICON from '@/assets/create/cancel.svg'
import ResumeUploadIcon from '@/components/business/ResumeUploadIcon/index.h5'
import type {ResumeSummaryStepState} from '../types'

export interface ResumeSummaryStepH5Props {
  state: ResumeSummaryStepState
  onEdit: () => void
  onDelete: () => Promise<void>
}

export default function ResumeSummaryStepH5({
  state,
  onEdit,
  onDelete,
}: ResumeSummaryStepH5Props) {
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
