import {Text, View} from '@tarojs/components'
import ResumeMarkdownEditor from './ResumeMarkdownEditor'
import ResumeUploadStateCard from './ResumeUploadStateCard'
import {styles} from './ResumeUploadStep.styles'
import type {ResumeUploadStepState} from '../types'

interface ResumeUploadStepProps {
  state: ResumeUploadStepState
  onPickFile: () => Promise<void>
  onRemoveFile: () => void
  onMarkdownChange: (content: string) => void
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
        <ResumeUploadStateCard
          state={state}
          onPickFile={onPickFile}
          onRemoveFile={onRemoveFile}
        />
      </View>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>OR</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>输入 Markdown 简历</Text>
        <ResumeMarkdownEditor value={state.markdown} onChange={onMarkdownChange} />
      </View>

      <Text style={styles.tipText}>
        上传文件后也会同步生成一份可编辑的 Markdown 草稿，方便继续补充与修改
      </Text>
    </View>
  )
}
