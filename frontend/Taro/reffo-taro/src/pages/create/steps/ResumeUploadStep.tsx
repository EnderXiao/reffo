import {Text, Textarea, View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import type {ResumeUploadStepState} from '../types'

interface ResumeUploadStepProps {
  state: ResumeUploadStepState
  onPickFile: () => Promise<void>
  onRemoveFile: () => void
  onMarkdownChange: (content: string) => void
}

function UploadCardIcon() {
  return (
    <View style={styles.documentIcon}>
      <View style={styles.documentFold} />
      <Text style={styles.uploadArrow}>↑</Text>
    </View>
  )
}

function PdfCardIcon() {
  return (
    <View style={{...styles.documentIcon, ...styles.documentIconFilled}}>
      <View style={{...styles.documentFold, ...styles.documentFoldFilled}} />
      <Text style={styles.documentBadge}>PDF</Text>
    </View>
  )
}

function ErrorCardIcon() {
  return (
    <View style={styles.documentIcon}>
      <View style={styles.documentFold} />
      <View style={styles.errorBadge}>
        <Text style={styles.errorBadgeText}>!</Text>
      </View>
    </View>
  )
}

function UploadStateCard({
  state,
  onPickFile,
  onRemoveFile,
}: Pick<ResumeUploadStepProps, 'state' | 'onPickFile' | 'onRemoveFile'>) {
  if (state.status === 'uploading') {
    return (
      <View
        style={{...styles.uploadCard, ...styles.uploadCardLarge}}
        data-testid='resume-upload-progress'
      >
        <UploadCardIcon />
        <View style={styles.progressTrack}>
          <View style={{...styles.progressFill, width: `${state.progress}%`}} />
        </View>
      </View>
    )
  }

  if (state.status === 'error') {
    return (
      <View
        style={{...styles.statusCard, ...styles.statusCardError}}
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
        style={{...styles.statusCard, ...styles.statusCardSuccess}}
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
      style={{...styles.uploadCard, ...styles.uploadCardLarge}}
      onClick={onPickFile}
      role='button'
      data-testid='resume-upload-trigger'
    >
      <UploadCardIcon />
      <Text style={styles.uploadHint}>上传文件</Text>
    </View>
  )
}

export default function ResumeUploadStep({
  state,
  onPickFile,
  onRemoveFile,
  onMarkdownChange,
}: ResumeUploadStepProps) {
  return (
    <View style={styles.step}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>上传源简历</Text>
        <UploadStateCard state={state} onPickFile={onPickFile} onRemoveFile={onRemoveFile} />
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>输入 Markdown 简历</Text>
        <View style={styles.textareaWrap}>
          <Textarea
            value={state.markdown}
            placeholder={'支持 Markdown 输入\n例如：\n# Jeremy Smith\n\n## 工作经历\n- 负责...'}
            maxlength={20000}
            onInput={event => onMarkdownChange(event.detail.value)}
            style={styles.textarea}
            data-testid='resume-markdown-input'
          />
        </View>
        <Text style={styles.editorHint}>系统会自动取最高级标题作为简历标题</Text>
      </View>

      <Text style={styles.tipText}>
        上传文件后也会同步生成一份可编辑的 Markdown 草稿，方便继续补充与修改
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  step: {
    paddingBottom: 20,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    color: '#131313',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  uploadCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#aac0df',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCardLarge: {
    minHeight: 136,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  uploadHint: {
    marginTop: 12,
    color: '#b8c5d4',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
  },
  documentIcon: {
    position: 'relative',
    width: 36,
    height: 44,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#afc1d4',
    backgroundColor: '#f7fbff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  documentIconFilled: {
    borderWidth: 0,
    backgroundColor: '#177cff',
  },
  documentFold: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 12,
    height: 12,
    backgroundColor: '#ffffff',
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#afc1d4',
  },
  documentFoldFilled: {
    borderColor: '#177cff',
    backgroundColor: '#dcecff',
  },
  uploadArrow: {
    color: '#afc1d4',
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '700',
  },
  documentBadge: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
  },
  errorBadge: {
    position: 'absolute',
    left: -6,
    bottom: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#ff4c4c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    lineHeight: 10,
    fontWeight: '700',
  },
  progressTrack: {
    width: '82%',
    height: 4,
    borderRadius: 999,
    backgroundColor: '#e0e0e0',
    overflow: 'hidden',
    marginTop: 20,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1683ff',
  },
  statusCard: {
    minHeight: 74,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statusCardSuccess: {
    borderColor: '#1677ff',
    backgroundColor: '#f7fbff',
  },
  statusCardError: {
    borderColor: '#ff6d6d',
    backgroundColor: '#ffffff',
  },
  statusContent: {
    flex: 1,
    marginLeft: 14,
    marginRight: 12,
  },
  fileName: {
    color: '#5f6f8c',
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '500',
  },
  fileSize: {
    marginTop: 5,
    color: '#7b8798',
    fontSize: 14,
    lineHeight: 18,
  },
  errorText: {
    color: '#ff4c4c',
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  removeButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    color: '#1677ff',
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '700',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#dedede',
  },
  dividerText: {
    marginHorizontal: 12,
    color: '#969696',
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  textareaWrap: {
    minHeight: 164,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#aac0df',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
  },
  textarea: {
    minHeight: 140,
    color: '#334155',
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  editorHint: {
    marginTop: 10,
    color: '#6f8097',
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  tipText: {
    color: '#b8b8b8',
    fontSize: 14,
    lineHeight: 24,
  },
})
