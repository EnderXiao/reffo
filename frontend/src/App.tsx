import { useState, useEffect } from 'react'
import './App.css'

// 类型定义
interface ResumeAnalysis {
  quality_score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  capability_summary: string
}

interface MatchAnalysis {
  match_score: number
  skill_match: {
    matched: string[]
    missing: string[]
  }
  experience_match: string
  strengths: string[]
  weaknesses: string[]
}

interface ProcessResult {
  step1_analysis: ResumeAnalysis
  step2_matching: MatchAnalysis
  step3_optimized_resume: string
}

// localStorage keys
const STORAGE_KEY_RESUME = 'reffo_resume_markdown'
const STORAGE_KEY_JD = 'reffo_jd_text'
const STORAGE_KEY_RESULT = 'reffo_last_result'

function App() {
  const [step, setStep] = useState(1)
  const [resumeMarkdown, setResumeMarkdown] = useState('')
  const [jdText, setJdText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ProcessResult | null>(null)

  // 从 localStorage 加载数据
  useEffect(() => {
    const savedResume = localStorage.getItem(STORAGE_KEY_RESUME)
    const savedJD = localStorage.getItem(STORAGE_KEY_JD)
    const savedResult = localStorage.getItem(STORAGE_KEY_RESULT)

    if (savedResume) setResumeMarkdown(savedResume)
    if (savedJD) setJdText(savedJD)
    if (savedResult) {
      try {
        setResult(JSON.parse(savedResult))
      } catch (e) {
        console.error('Failed to parse saved result:', e)
      }
    }
  }, [])

  // 保存到 localStorage
  const saveToStorage = () => {
    localStorage.setItem(STORAGE_KEY_RESUME, resumeMarkdown)
    localStorage.setItem(STORAGE_KEY_JD, jdText)
  }

  // 处理简历和 JD
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
      const response = await fetch('/api/v1/mvp/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          resume_markdown: resumeMarkdown,
          jd_text: jdText,
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.error?.message || '处理失败')
      }

      const processResult = data.data
      setResult(processResult)
      localStorage.setItem(STORAGE_KEY_RESULT, JSON.stringify(processResult))
      saveToStorage()
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
      localStorage.removeItem(STORAGE_KEY_RESUME)
      localStorage.removeItem(STORAGE_KEY_JD)
      localStorage.removeItem(STORAGE_KEY_RESULT)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Reffo MVP - AI 简历优化工具</h1>
        <p>基于 AI Agent 的智能简历优化服务</p>
      </header>

      <div className="container">
        {/* 步骤指示器 */}
        <div className="steps">
          <div className={`step ${step >= 1 ? 'active' : ''}`}>
            <span className="step-number">1</span>
            <span className="step-label">输入简历</span>
          </div>
          <div className="step-divider"></div>
          <div className={`step ${step >= 2 ? 'active' : ''}`}>
            <span className="step-number">2</span>
            <span className="step-label">输入 JD</span>
          </div>
          <div className="step-divider"></div>
          <div className={`step ${step >= 3 ? 'active' : ''}`}>
            <span className="step-number">3</span>
            <span className="step-label">查看结果</span>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="error-message">
            <strong>错误：</strong> {error}
          </div>
        )}

        {/* 步骤 1: 输入简历 */}
        {step === 1 && (
          <div className="step-content">
            <h2>步骤 1: 输入简历（Markdown 格式）</h2>
            <textarea
              className="input-textarea"
              value={resumeMarkdown}
              onChange={(e) => setResumeMarkdown(e.target.value)}
              placeholder="请输入 Markdown 格式的简历，例如：&#10;&#10;# 张三&#10;&#10;**联系方式**：186-1234-5678 | zhangsan@example.com&#10;&#10;## 工作经历&#10;&#10;### ABC公司 | 高级工程师 | 2021.03 - 至今&#10;..."
              rows={20}
            />
            <div className="button-group">
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                下一步：输入 JD
              </button>
            </div>
            <p className="hint">
              提示：简历会自动保存到浏览器本地存储，刷新页面不会丢失
            </p>
          </div>
        )}

        {/* 步骤 2: 输入 JD */}
        {step === 2 && (
          <div className="step-content">
            <h2>步骤 2: 输入岗位描述（JD）</h2>
            <textarea
              className="input-textarea"
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="请输入岗位描述，例如：&#10;&#10;岗位职责：&#10;1. 负责核心业务系统的后端开发&#10;2. 参与系统架构设计&#10;&#10;任职要求：&#10;1. 本科及以上学历&#10;2. 3年以上开发经验&#10;..."
              rows={20}
            />
            <div className="button-group">
              <button className="btn btn-secondary" onClick={() => setStep(1)}>
                上一步
              </button>
              <button
                className="btn btn-primary"
                onClick={handleProcess}
                disabled={loading}
              >
                {loading ? '处理中...' : '开始分析与优化'}
              </button>
            </div>
            {loading && (
              <div className="loading-message">
                正在处理中，这可能需要 20-35 秒，请耐心等待...
              </div>
            )}
          </div>
        )}

        {/* 步骤 3: 查看结果 */}
        {step === 3 && result && (
          <div className="step-content">
            <h2>步骤 3: 优化结果</h2>

            {/* 简历分析 */}
            <div className="result-section">
              <h3>📊 简历分析</h3>
              <div className="score">
                质量评分：<strong>{result.step1_analysis.quality_score}</strong> / 100
              </div>
              <div className="analysis-item">
                <h4>优势：</h4>
                <ul>
                  {result.step1_analysis.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
              <div className="analysis-item">
                <h4>问题：</h4>
                <ul>
                  {result.step1_analysis.weaknesses.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
              <div className="analysis-item">
                <h4>能力总结：</h4>
                <p>{result.step1_analysis.capability_summary}</p>
              </div>
            </div>

            {/* 匹配分析 */}
            <div className="result-section">
              <h3>🎯 匹配分析</h3>
              <div className="score">
                匹配度评分：<strong>{result.step2_matching.match_score}</strong> / 100
              </div>
              <div className="analysis-item">
                <h4>已匹配技能：</h4>
                <div className="tags">
                  {result.step2_matching.skill_match.matched.map((skill, i) => (
                    <span key={i} className="tag tag-success">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="analysis-item">
                <h4>缺失技能：</h4>
                <div className="tags">
                  {result.step2_matching.skill_match.missing.map((skill, i) => (
                    <span key={i} className="tag tag-warning">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
              <div className="analysis-item">
                <h4>经验匹配度：</h4>
                <p>{result.step2_matching.experience_match}</p>
              </div>
            </div>

            {/* 优化简历 */}
            <div className="result-section">
              <h3>✨ 优化后的简历</h3>
              <div className="resume-preview">
                <pre>{result.step3_optimized_resume}</pre>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  navigator.clipboard.writeText(result.step3_optimized_resume)
                  alert('简历已复制到剪贴板！')
                }}
              >
                📋 复制简历
              </button>
            </div>

            {/* 操作按钮 */}
            <div className="button-group">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>
                返回修改
              </button>
              <button className="btn btn-danger" onClick={handleReset}>
                重新开始
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="footer">
        <p>Reffo MVP v0.1.0 | 技术栈：React + TypeScript + Elysia + DeepSeek</p>
      </footer>
    </div>
  )
}

export default App
