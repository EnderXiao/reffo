import { Button, Textarea } from '../../components'
import { JD_PLACEHOLDER } from './constants'

interface JdInputStepProps {
  jdText: string
  loading: boolean
  onJdChange: (value: string) => void
  onPrevious: () => void
  onProcess: () => void
}

export function JdInputStep({
  jdText,
  loading,
  onJdChange,
  onPrevious,
  onProcess,
}: JdInputStepProps) {
  return (
    <section className="step-content">
      <h2>步骤 2: 输入岗位描述（JD）</h2>
      <Textarea
        value={jdText}
        onChange={(event) => onJdChange(event.target.value)}
        placeholder={JD_PLACEHOLDER}
      />
      <div className="button-group">
        <Button onClick={onPrevious}>上一步</Button>
        <Button variant="primary" onClick={onProcess} disabled={loading}>
          {loading ? '处理中...' : '开始分析与优化'}
        </Button>
      </div>
      {loading && <div className="loading-message">正在处理中，这可能需要 20-35 秒，请耐心等待...</div>}
    </section>
  )
}
