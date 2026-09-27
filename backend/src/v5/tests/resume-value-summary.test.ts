import {expect, test} from 'bun:test'
import {buildResumeValueSummary, normalizeStrategyReview, resumeTextFingerprint, type ResumeStrategyReference,
  type ResumeStrategyReview} from '../../../../shared/resume-strategy'

const first = '完成问答原型并通过内部评审，尚未上线。'
const second = '协同运营完成三轮迭代；完成率由 60% 到 72%，为团队结果。'
const third = '访谈 12 名店长，整理需求和验收清单。'
const markdown = `# 示例候选人\n邮箱：private@example.test\n\n## 工作经历\n### 示例公司｜产品经理｜2022–2025\n- ${first}\n- ${second}\n- ${third}`

function reviewFor(references: ResumeStrategyReference[], content = markdown): ResumeStrategyReview {
  return {version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(content), items: [{
    strategyId: 'strategy_gap1', strategy: '说明实际交付阶段与本人分工', status: 'linked',
    explanation: '本次对应正文如下，可对照查看具体表达。', references,
  }]}
}

function reference(quote: string, index = 0): ResumeStrategyReference {
  return {outputPath: `experience.scope_1.bullets[${index}]`, location: `工作经历 · 示例公司 · 第${index + 1}段`, quote}
}

test('highlights use two unique whole business paragraphs and retain every limitation', () => {
  const review = reviewFor([reference(`- ${first}`), reference(first), reference(second, 1), reference(third, 2)])
  expect(buildResumeValueSummary({markdown, review, advice: ['补充更多结果。']})).toEqual({
    title: '这份简历的重点',
    body: `工作经历 · 示例公司 · 第1段：${first}\n\n工作经历 · 示例公司 · 第2段：${second}`,
  })
})

test('identity, timeline, header and summary references cannot become homepage highlights', () => {
  const review = reviewFor([
    {...reference('邮箱：private@example.test'), outputPath: 'identity.contact.email'},
    {...reference('### 示例公司｜产品经理｜2022–2025'), outputPath: 'experience.scope_1.header'},
    {...reference('2022–2025'), outputPath: 'timeline.scope_1.period'},
    {...reference(first), outputPath: 'summary.statement'},
    reference('# 示例候选人'),
  ])
  const summary = buildResumeValueSummary({markdown, review, advice: ['说明本人分工。']})
  expect(summary).toEqual({title: '优化建议', body: '说明本人分工。'})
  expect(summary.body).not.toContain('private@')
})

test('partial quotes and invented references do not conceal the original advice', () => {
  const review = reviewFor([reference('完成问答原型并通过内部评审'), reference('已经正式上线。')])
  expect(buildResumeValueSummary({markdown, review, advice: ['保留原型阶段边界。']})).toEqual({
    title: '优化建议', body: '保留原型阶段边界。',
  })
})

test('stale review falls back to actual advice even when its quote still exists', () => {
  const review = reviewFor([reference(first)])
  expect(buildResumeValueSummary({markdown: `${markdown}\n\n新增技能。`, review, advice: ['核对更新后的表述。']}))
    .toEqual({title: '优化建议', body: '核对更新后的表述。'})
})

test('only linked reviews qualify; unavailable material and empty advice stay explicit', () => {
  const review = reviewFor([reference(first)])
  review.items[0].status = 'needs_material'
  expect(buildResumeValueSummary({markdown, review})).toEqual({title: '优化建议', body: '暂无可展示的优化建议。'})
  expect(buildResumeValueSummary({markdown, advice: ['', '  ', null, ' 保留限定词。 ', '保留限定词。', '说明实际分工。', '第三条。']}))
    .toEqual({title: '优化建议', body: '保留限定词。\n\n说明实际分工。'})
})

test('business references support complete plain-text paragraphs without making completion claims', () => {
  const content = `## 项目经历\n${first}`
  const review = reviewFor([{...reference(first), outputPath: 'project.scope_2.bullets[0]'}], content)
  expect(buildResumeValueSummary({markdown: content, review}).body).toBe(`工作经历 · 示例公司 · 第1段：${first}`)
})

test('legacy history without markdown falls back safely even with a malformed review', () => {
  const missingMarkdown = undefined as unknown as string
  const review = reviewFor([reference(first)])
  expect(normalizeStrategyReview(review, missingMarkdown)).toBeUndefined()
  expect(buildResumeValueSummary({markdown: missingMarkdown, review, advice: ['保留真实阶段。']}))
    .toEqual({title: '优化建议', body: '保留真实阶段。'})
  expect(buildResumeValueSummary({markdown: null as unknown as string, review: {version: 'resume-strategy-v1'}}))
    .toEqual({title: '优化建议', body: '暂无可展示的优化建议。'})
})
