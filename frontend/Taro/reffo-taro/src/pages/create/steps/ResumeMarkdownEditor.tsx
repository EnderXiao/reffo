import {Text, Textarea, View} from '@tarojs/components'
import {styles} from './ResumeUploadStep.styles'

interface ResumeMarkdownEditorProps {
  value: string
  onChange: (content: string) => void
}

export default function ResumeMarkdownEditor({value, onChange}: ResumeMarkdownEditorProps) {
  return (
    <>
      <View style={styles.textareaWrap}>
        <Textarea
          value={value}
          placeholder={'支持 Markdown 输入\n例如：\n# Jeremy Smith\n\n## 工作经历\n- 负责...'}
          maxlength={20000}
          onInput={event => onChange(event.detail.value)}
          style={styles.textarea}
          data-testid='resume-markdown-input'
        />
      </View>
      <Text style={styles.editorHint}>系统会自动取最高级标题作为简历标题</Text>
    </>
  )
}
