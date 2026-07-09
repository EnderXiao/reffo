import type {ResumeHistory} from '@/types'
import {toHistoryCardItem} from '../model/homeCardData'

describe('homeCardData', () => {
  test('历史卡片评级使用简历质量分而不是岗位匹配分', () => {
    const history: ResumeHistory = {
      id: 'JD2026070800001',
      position: '大萝卜种植手',
      company: '大萝卜',
      name: '候选人',
      createdAt: '2026-07-08T12:00:00.000Z',
      qualityScore: 58,
      matchScore: 72,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '岗位名称：大萝卜种植手',
      optimizedContent: '# 候选人优化版',
    }

    const card = toHistoryCardItem(history)

    expect(card.score).toBe(58)
  })

  test('历史卡片右侧刻度使用公司中文拼音首字母', () => {
    const history: ResumeHistory = {
      id: 'JD2026070900001',
      position: 'AI 创新产品经理',
      company: '芒果 TV',
      name: '候选人',
      createdAt: '2026-07-09T12:00:00.000Z',
      qualityScore: 91,
      matchScore: 88,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '岗位名称：AI 创新产品经理',
      optimizedContent: '# 候选人优化版',
    }

    const card = toHistoryCardItem(history)

    expect(card.indexLabel).toBe('M')
  })

  test('历史卡片不会因公司名后缀英文错误命中刻度字母', () => {
    const history: ResumeHistory = {
      id: 'JD2026070900002',
      position: '增长产品经理',
      company: '携程旅行网',
      name: '候选人',
      createdAt: '2026-07-09T12:00:00.000Z',
      qualityScore: 86,
      matchScore: 80,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '岗位名称：增长产品经理',
      optimizedContent: '# 候选人优化版',
    }

    const card = toHistoryCardItem(history)

    expect(card.indexLabel).toBe('X')
  })

  test('历史卡片优化策略优先展示后端返回的建议', () => {
    const history: ResumeHistory = {
      id: 'JD2026070800002',
      position: '大萝卜种植手',
      company: '大萝卜特殊种植有限公司',
      name: '候选人',
      createdAt: '2026-07-08T12:00:00.000Z',
      qualityScore: 58,
      matchScore: 72,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '岗位名称：大萝卜种植手',
      optimizedContent: '# 候选人优化版',
      processResult: {
        analysis: {
          quality_score: 58,
          strengths: [],
          weaknesses: [],
          suggestions: ['补充种植项目中的量化产出。'],
          capability_summary: '',
          structured_resume: {
            personal_info: {name: '候选人'},
            education: [],
            experience: [],
            projects: [],
            skills: {hard_skills: [], soft_skills: []},
          },
        },
        matching: {
          match_score: 72,
          hard_requirements_match: [],
          skill_match: {
            matched_skills: [],
            missing_skills: [],
            match_percentage: 72,
          },
          experience_match: {
            years_required: 1,
            years_actual: 0,
            relevant_experience: [],
            match_percentage: 40,
          },
          optimization_suggestions: [
            '优先突出大萝卜特殊种植有限公司相关经验。',
            '补充育苗、施肥、采收环节的具体成果。',
          ],
        },
        optimized: {
          optimized_resume: '# 候选人优化版',
          changes_summary: ['调整了项目顺序。'],
          improvement_score: 8,
        },
        interview: {
          questions: [],
          story_recommendations: [],
        },
      },
    }

    const card = toHistoryCardItem(history)

    expect(card.strategyBody).toBe('优先突出大萝卜特殊种植有限公司相关经验。\n\n补充育苗、施肥、采收环节的具体成果。')
    expect(card.strategyBody).not.toContain('弱化泛化职责描述')
  })
})
