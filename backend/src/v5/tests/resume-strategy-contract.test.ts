import {expect, test} from 'bun:test'
import {currentStrategyReview, normalizeStrategyReview, resumeTextFingerprint, strategyResultExcerpts,
  type ResumeStrategyReview} from '../../../../shared/resume-strategy'

const markdown = '# 示例\n\n## 项目\n完成原型并通过内部评审，尚未上线。'
const review: ResumeStrategyReview = {
  version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(markdown),
  items: [{strategyId: 'strategy_g1', strategy: '说明原型的实际交付阶段', status: 'linked',
    explanation: '相关材料对应到以下正文，可核对具体表述。',
    references: [{outputPath: 'project.example.bullets[0]', location: '项目 / 原型设计',
      quote: '完成原型并通过内部评审，尚未上线。'}]}],
}

test('result excerpts retain complete limitations and never repeat the original advice', () => {
  expect(strategyResultExcerpts(review, markdown)).toEqual(['项目 / 原型设计：完成原型并通过内部评审，尚未上线。'])
  expect(strategyResultExcerpts(review, markdown).join('')).not.toContain(review.items[0].strategy)
})

test('manual edits invalidate the entire generation explanation even when one quoted paragraph remains', () => {
  const edited = `${markdown}\n另有工作经历。`
  expect(currentStrategyReview(review, edited)).toBeUndefined()
  expect(strategyResultExcerpts(review, edited)).toEqual([])
  expect(currentStrategyReview(review, markdown)).toEqual(review)
})

test('unlocatable or malformed references cannot become delivery claims', () => {
  const invalid = structuredClone(review)
  invalid.items[0].references[0].quote = '已上线，业务增长翻倍。'
  const normalized = normalizeStrategyReview(invalid, markdown)
  expect(normalized?.items[0].status).toBe('not_located')
  expect(normalized?.items[0].references).toEqual([])
  expect(strategyResultExcerpts(invalid, markdown)).toEqual([])
  expect(normalizeStrategyReview({version: 'resume-strategy-v1', items: [null]}, markdown)).toBeUndefined()
  expect(currentStrategyReview({...review, items: [null]} as unknown as ResumeStrategyReview, markdown)?.items).toEqual([])
})

test('material requests and unselected actions remain advice, even with a coincidentally matching quote', () => {
  const pending = structuredClone(review)
  pending.items[0].status = 'needs_material'
  expect(strategyResultExcerpts(pending, markdown)).toEqual([])
  expect(strategyResultExcerpts(undefined, markdown)).toEqual([])
})
