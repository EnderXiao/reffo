import { describe, expect, test } from 'bun:test'
import { parseInterviewSuggestions } from '@/schemas/interview-suggestions'

describe('interview suggestion schema normalization', () => {
  test('normalizes common model aliases without changing business content', () => {
    const parsed = parseInterviewSuggestions({
      interview_questions: [{ question: '请介绍用户调研经历' }],
      stories: [{
        experience: '企业客户需求管理',
        situation: '负责访谈和需求分析',
        outcome: ['推动方案上线', '不补充未知数字'],
      }],
      questions_to_ask: [{ content: '这个岗位的成功标准是什么？' }],
    })

    expect(parsed.questions).toEqual(['请介绍用户调研经历'])
    expect(parsed.story_recommendations).toEqual([{
      title: '企业客户需求管理',
      background: '负责访谈和需求分析',
      result: '推动方案上线；不补充未知数字',
    }])
    expect(parsed.follow_up_questions).toEqual(['这个岗位的成功标准是什么？'])
  })
})
