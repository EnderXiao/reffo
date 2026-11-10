import {buildResumeValueSummary, resumeTextFingerprint, strategyResultExcerpts,
  type ResumeStrategyReview} from '../resume-strategy'

const pending = '完善任务流程，并具体完成【待完善：本人设计；如原型设计/规则梳理，仅选实际做过的项】。'
const completed = '完成原型并通过内部评审，尚未上线。'

function reviewFor(markdown: string, quotes: string[]): ResumeStrategyReview {
  return {
    version: 'resume-strategy-v1',
    resumeFingerprint: resumeTextFingerprint(markdown),
    items: [{
      strategyId: 'S1', strategy: '说明本人交付', status: 'linked', explanation: '对应正文如下。',
      references: quotes.map((quote, index) => ({
        outputPath: `experience.scope_1.bullets[${index}]`, location: '工作经历 · 示例公司', quote,
      })),
    }],
  }
}

describe('待完善正文的摘要边界', () => {
  test('整段跳过含待完善标记的引用，仍展示真实完整原句和限定', () => {
    const markdown = `## 工作经历\n- ${pending}\n- ${completed}`
    const review = reviewFor(markdown, [pending, completed])

    expect(strategyResultExcerpts(review, markdown)).toEqual([`工作经历 · 示例公司：${completed}`])
    expect(buildResumeValueSummary({markdown, review, advice: ['补充本人贡献。']})).toEqual({
      title: '这份简历的重点', body: `工作经历 · 示例公司：${completed}`,
    })
  })

  test('没有完整可用正文时使用既有建议，不把括号删除后拼成摘要', () => {
    const markdown = `## 工作经历\n- ${pending}`
    const review = reviewFor(markdown, [pending])

    expect(strategyResultExcerpts(review, markdown)).toEqual([])
    expect(buildResumeValueSummary({markdown, review, advice: ['说明实际完成的设计。']})).toEqual({
      title: '优化建议', body: '说明实际完成的设计。',
    })
  })

  test('跳过的引用不占两条摘要预算，保留其后的完整业务段落', () => {
    const third = '访谈店长，整理业务规则与验收清单。'
    const markdown = `## 工作经历\n- ${pending}\n- ${completed}\n- ${third}`
    const review = reviewFor(markdown, [pending, completed, third])

    expect(strategyResultExcerpts(review, markdown)).toEqual([
      `工作经历 · 示例公司：${completed}`, `工作经历 · 示例公司：${third}`,
    ])
    expect(buildResumeValueSummary({markdown, review}).body).toBe(
      `工作经历 · 示例公司：${completed}\n\n工作经历 · 示例公司：${third}`,
    )
  })

  test('填词后旧策略核验继续失效，不将新内容自动视为已核验', () => {
    const markdown = `## 工作经历\n- ${pending}\n- ${completed}`
    const review = reviewFor(markdown, [pending, completed])
    const edited = markdown.replace(/【待完善[^】]+】/u, '原型设计')

    expect(strategyResultExcerpts(review, edited)).toEqual([])
    expect(buildResumeValueSummary({markdown: edited, review, advice: ['核对本人贡献。']})).toEqual({
      title: '优化建议', body: '核对本人贡献。',
    })
  })
})
