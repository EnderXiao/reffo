import {createHistoryFromResult} from '../history-helper'
import type {ProcessResult} from '@/types'

describe('history-helper', () => {
  const processResult: ProcessResult = {
    analysis: {
      quality_score: 82,
      strengths: ['表达清晰'],
      weaknesses: ['缺少量化结果'],
      suggestions: ['补充业务指标'],
      capability_summary: '候选人具备产品策略和跨团队协作经验。',
      structured_resume: {
        personal_info: {name: 'Jeremy Smith'},
        education: [],
        experience: [],
        projects: [],
        skills: {hard_skills: ['React'], soft_skills: ['沟通']},
      },
    },
    matching: {
      match_score: 91,
      hard_requirements_match: [],
      skill_match: {
        matched_skills: ['React', 'TypeScript', '增长策略'],
        missing_skills: ['A/B Test'],
        match_percentage: 91,
      },
      experience_match: {
        years_required: 3,
        years_actual: 5,
        relevant_experience: ['增长产品'],
        match_percentage: 88,
      },
      optimization_suggestions: ['突出增长指标'],
    },
    optimized: {
      optimized_resume: '# Jeremy Smith\n\n优化后的简历',
      changes_summary: ['强化了增长指标'],
      improvement_score: 16,
    },
    interview: {
      questions: ['请介绍一次增长实验。'],
      story_recommendations: [
        {
          title: '增长项目',
          background: '介绍项目背景',
          result: '强调量化结果',
        },
      ],
    },
  }

  test('创建历史记录时保留完整结果和上下文', () => {
    const jdContent = '公司名称：小米\n岗位名称：产品经理\n工作地：北京\n岗位职责：负责增长'
    const history = createHistoryFromResult(
      processResult,
      '# Jeremy Smith',
      jdContent,
    )

    expect(history.id).toBe('')
    expect(history.processResult).toEqual(processResult)
    expect(history.resultContext).toEqual({
      company: '小米',
      position: '产品经理',
      location: '北京',
      resumeContent: '# Jeremy Smith',
      jdContent,
    })
    expect(history.progress).toEqual({
      analysis: 'done',
      matching: 'done',
      optimized: 'done',
      interview: 'done',
    })
    expect(history.optimizationSuggestions).toEqual(['突出增长指标'])
    expect(history.changesSummary).toEqual(['强化了增长指标'])
  })
})
