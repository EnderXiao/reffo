import { useEffect, useState } from 'react'
import { processResume } from '../../api/mvp'
import { ErrorMessage, StepIndicator } from '../../components'
import {
  clearMvpStoredState,
  loadMvpStoredState,
  saveMvpInputs,
  saveMvpResult,
} from '../../lib/storage/mvpStorage'
import type { ProcessResult } from '../../types/mvp'
import '../../components/components.css'
import './MvpFlow.css'
import { MVP_STEPS } from './constants'
import { JdInputStep } from './JdInputStep'
import { ResultsStep } from './ResultsStep'
import { ResumeInputStep } from './ResumeInputStep'

export function MvpFlow() {
  const [step, setStep] = useState(1)
  const [resumeMarkdown, setResumeMarkdown] = useState('')
  const [jdText, setJdText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProcessResult | null>(null)

  useEffect(() => {
    const storedState = loadMvpStoredState()

    setResumeMarkdown(storedState.resumeMarkdown)
    setJdText(storedState.jdText)
    setResult(storedState.result)
  }, [])

  const handleProcess = async () => {
    if (!resumeMarkdown.trim()) {
      setError('请输入简历内容')
      return
    }

    if (!jdText.trim()) {
      setError('请输入岗位描述')
      return
    }

    setLoading(true)
    setError('')

    try {
      const processResult = await processResume({
        resume_markdown: resumeMarkdown,
        jd_text: jdText,
      })

      setResult(processResult)
      saveMvpResult(processResult)
      saveMvpInputs(resumeMarkdown, jdText)
      setStep(3)
    } catch (err) {
      console.error('Process failed:', err)
      setError(err instanceof Error ? err.message : '处理失败，请检查网络连接')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    if (window.confirm('确定要重新开始吗？这将清除所有数据。')) {
      setStep(1)
      setResumeMarkdown('')
      setJdText('')
      setResult(null)
      setError('')
      clearMvpStoredState()
    }
  }

  const handleCopyResume = () => {
    if (!result) {
      return
    }

    void navigator.clipboard.writeText(result.step3_optimized_resume)
    alert('简历已复制到剪贴板！')
  }

  return (
    <>
      <StepIndicator currentStep={step} steps={MVP_STEPS} />

      {error && <ErrorMessage message={error} />}

      {step === 1 && (
        <ResumeInputStep
          resumeMarkdown={resumeMarkdown}
          onResumeChange={setResumeMarkdown}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <JdInputStep
          jdText={jdText}
          loading={loading}
          onJdChange={setJdText}
          onPrevious={() => setStep(1)}
          onProcess={handleProcess}
        />
      )}

      {step === 3 && result && (
        <ResultsStep
          result={result}
          onBack={() => setStep(2)}
          onCopyResume={handleCopyResume}
          onReset={handleReset}
        />
      )}
    </>
  )
}
