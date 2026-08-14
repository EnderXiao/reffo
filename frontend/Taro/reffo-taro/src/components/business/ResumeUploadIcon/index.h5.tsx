import {Image, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import PDF_FILE_ICON from '@/assets/create/pdf-file.svg'
import UPLOAD_ERROR_ICON from '@/assets/create/upload-error.svg'
import UPLOAD_FILE_ICON from '@/assets/create/upload-file.svg'
import './index.h5.scss'

export type ResumeUploadIconStatus = 'idle' | 'uploading' | 'success' | 'error'

interface ResumeUploadIconProps {
  status: ResumeUploadIconStatus
  extension?: string
  className?: string
}

export default function ResumeUploadIcon({
  status,
  extension,
  className,
}: ResumeUploadIconProps) {
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
        className={classNames(
          'reffo-resume-upload-icon__asset',
          'reffo-create-upload__asset-icon',
          {
            'reffo-resume-upload-icon__asset--pdf': isPdf,
            'reffo-create-upload__asset-icon--pdf': isPdf,
          },
          className,
        )}
      />
    )
  }

  return (
    <View
      className={classNames(
        'reffo-resume-upload-icon',
        'reffo-create-upload__icon',
        {
          'reffo-resume-upload-icon--success': isSuccess,
          'reffo-create-upload__icon--success': isSuccess,
          'reffo-resume-upload-icon--error': isError,
          'reffo-create-upload__icon--error': isError,
        },
        className,
      )}
    >
      <View className='reffo-resume-upload-icon__file reffo-create-upload__file'>
        {isSuccess ? (
          <Text className='reffo-resume-upload-icon__file-type reffo-create-upload__file-type'>
            {extensionLabel?.slice(0, 3) || 'FILE'}
          </Text>
        ) : (
          <Text className='reffo-resume-upload-icon__arrow reffo-create-upload__arrow'>↑</Text>
        )}
      </View>
      {isError ? (
        <View className='reffo-resume-upload-icon__error-badge reffo-create-upload__error-badge'>
          <Text>!</Text>
        </View>
      ) : null}
    </View>
  )
}
