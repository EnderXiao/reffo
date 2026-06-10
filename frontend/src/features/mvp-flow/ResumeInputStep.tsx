import { Button, Textarea } from '../../components'
import { RESUME_PLACEHOLDER } from './constants'

interface ResumeInputStepProps {
  resumeMarkdown: string
  onResumeChange: (value: string) => void
  onNext: () => void
}

export function ResumeInputStep({
  resumeMarkdown,
  onResumeChange,
  onNext,
}: ResumeInputStepProps) {
  return (
    <section className="step-content">
      <h2>步骤 1: 输入简历（Markdown 格式）</h2>
      <Textarea
        value={resumeMarkdown}
        onChange={(event) => onResumeChange(event.target.value)}
        placeholder={RESUME_PLACEHOLDER}
      />
      <div className="button-group">
        <Button variant="primary" onClick={onNext}>
          下一步：输入 JD
        </Button>
      </div>
      <p className="hint">提示：简历会自动保存到浏览器本地存储，刷新页面不会丢失</p>
    </section>
  )
}
