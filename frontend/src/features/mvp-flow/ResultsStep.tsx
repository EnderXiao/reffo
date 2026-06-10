import { Button, ResultSection, ScoreCard, TagList } from '../../components'
import type { ProcessResult } from '../../types/mvp'

interface ResultsStepProps {
  result: ProcessResult
  onBack: () => void
  onCopyResume: () => void
  onReset: () => void
}

export function ResultsStep({ result, onBack, onCopyResume, onReset }: ResultsStepProps) {
  return (
    <section className="step-content">
      <h2>步骤 3: 优化结果</h2>

      <ResultSection title="📊 简历分析">
        <ScoreCard label="质量评分" score={result.step1_analysis.quality_score} />
        <AnalysisList title="优势：" items={result.step1_analysis.strengths} />
        <AnalysisList title="问题：" items={result.step1_analysis.weaknesses} />
        <AnalysisText title="能力总结：" text={result.step1_analysis.capability_summary} />
      </ResultSection>

      <ResultSection title="🎯 匹配分析">
        <ScoreCard label="匹配度评分" score={result.step2_matching.match_score} />
        <AnalysisTags title="已匹配技能：" items={result.step2_matching.skill_match.matched} variant="success" />
        <AnalysisTags title="缺失技能：" items={result.step2_matching.skill_match.missing} variant="warning" />
        <AnalysisText title="经验匹配度：" text={result.step2_matching.experience_match} />
      </ResultSection>

      <ResultSection title="✨ 优化后的简历">
        <div className="resume-preview">
          <pre>{result.step3_optimized_resume}</pre>
        </div>
        <Button onClick={onCopyResume}>📋 复制简历</Button>
      </ResultSection>

      <div className="button-group">
        <Button onClick={onBack}>返回修改</Button>
        <Button variant="danger" onClick={onReset}>
          重新开始
        </Button>
      </div>
    </section>
  )
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="analysis-item">
      <h4>{title}</h4>
      <ul>
        {items.map((item, index) => (
          <li key={`${item}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function AnalysisText({ title, text }: { title: string; text: string }) {
  return (
    <div className="analysis-item">
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  )
}

function AnalysisTags({
  title,
  items,
  variant,
}: {
  title: string
  items: string[]
  variant: 'success' | 'warning'
}) {
  return (
    <div className="analysis-item">
      <h4>{title}</h4>
      <TagList items={items} variant={variant} />
    </div>
  )
}
