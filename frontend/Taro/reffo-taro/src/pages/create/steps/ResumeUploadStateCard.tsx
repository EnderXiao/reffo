import {Text, View} from '@tarojs/components'
import {ErrorCardIcon, PdfCardIcon, UploadCardIcon} from './ResumeUploadIcons'
import {styles} from './ResumeUploadStep.styles'
import type {ResumeUploadStepState} from '../types'

interface ResumeUploadStateCardProps {
  state: ResumeUploadStepState
  onPickFile: () => Promise<void>
  onRemoveFile: () => void
}

export default function ResumeUploadStateCard({
  state,
  onPickFile,
  onRemoveFile,
}: ResumeUploadStateCardProps) {
  if (state.status === 'uploading') {
    return (
      <View
        style={[styles.uploadCard, styles.uploadCardLarge] as any}
        data-testid='resume-upload-progress'
      >
        <UploadCardIcon />
        <View style={styles.progressTrack}>
          <View style={{...(styles.progressFill as any), width: `${state.progress}%`}} />
        </View>
      </View>
    )
  }

  if (state.status === 'error') {
    return (
      <View
        style={[styles.statusCard, styles.statusCardError] as any}
        onClick={onPickFile}
        data-testid='resume-upload-error'
      >
        <ErrorCardIcon />
        <View style={styles.statusContent}>
          <Text style={styles.errorText}>{state.errorMessage || '上传失败'}</Text>
        </View>
      </View>
    )
  }

  if (state.status === 'success' && state.file) {
    const sizeLabel = state.file.sizeLabel || `${state.file.size}`

    return (
      <View
        style={[styles.statusCard, styles.statusCardSuccess] as any}
        data-testid='resume-upload-success'
      >
        <PdfCardIcon />
        <View style={styles.statusContent}>
          <Text style={styles.fileName}>{state.file.name}</Text>
          <Text style={styles.fileSize}>{sizeLabel}</Text>
        </View>
        <View
          style={styles.removeButton}
          onClick={onRemoveFile}
          role='button'
          data-testid='resume-upload-remove'
        >
          <Text style={styles.removeButtonText}>×</Text>
        </View>
      </View>
    )
  }

  return (
    <View
      style={[styles.uploadCard, styles.uploadCardLarge] as any}
      onClick={onPickFile}
      role='button'
      data-testid='resume-upload-trigger'
    >
      <UploadCardIcon />
      <Text style={styles.uploadHint}>上传文件</Text>
    </View>
  )
}
