import {fireEvent, render, screen} from '@testing-library/react'
import type {ProcessResult} from '@/types'
import PageView from '../PageView.h5'
import type {ResultPageViewModel} from '../usePageModel'

const result: ProcessResult = {
  analysis: {
    quality_score: 88,
    strengths: ['负责核心业务系统开发'],
    weaknesses: [],
    suggestions: [],
    capability_summary: '具备前端工程能力',
    structured_resume: {
      personal_info: {name: '测试用户'},
      education: [],
      experience: [],
      projects: [],
      skills: {hard_skills: ['React'], soft_skills: []},
    },
  },
  matching: {
    match_score: 90,
    hard_requirements_match: [],
    skill_match: {
      matched_skills: ['React'],
      missing_skills: [],
      match_percentage: 90,
    },
    experience_match: {
      years_required: 0,
      years_actual: 0,
      relevant_experience: [],
      match_percentage: 90,
    },
    optimization_suggestions: [],
  },
  optimized: {
    optimized_resume: '# 测试用户',
    changes_summary: ['突出核心业务系统经验'],
    improvement_score: 5,
  },
  interview: {
    questions: ['请介绍核心业务系统项目。'],
    story_recommendations: [{
      title: '核心业务系统项目',
      background: '负责核心业务系统开发',
      result: '按期完成上线',
      storytelling_approach: ['说明职责和结果'],
    }],
    follow_up_questions: ['团队当前重点是什么？'],
  },
}

const model: ResultPageViewModel = {
  result,
  resumeContent: '负责核心业务系统开发并按期完成上线',
  jdContent: '负责核心业务系统开发，熟悉 React',
  companyName: '测试公司',
  positionName: '前端工程师',
  loading: false,
  saved: false,
  isCompleting: false,
  progress: {
    analysis: 'done',
    matching: 'done',
    optimized: 'done',
    interview: 'done',
  },
  progressPercent: 100,
  generationError: null,
  enteredFromCard: false,
  enteredFromLanding: false,
  returnCard: null,
  handleSave: jest.fn(),
  handleComplete: jest.fn(),
  handleShare: jest.fn(),
  handleBackHome: jest.fn(),
  handleEditHistory: jest.fn(),
  handlePendingStage: jest.fn(),
  handleOptimizedResumeChange: jest.fn(),
  canEditHistory: false,
}

describe('结果页', () => {
  test('进入面试建议 tab 时正常渲染原文引用', () => {
    render(<PageView {...model} />)

    fireEvent.click(screen.getByLabelText('面试建议'))

    expect(screen.getByText('核心业务系统项目')).toBeTruthy()
    expect(screen.getAllByText('负责核心业务系统开发并按期完成上线').length).toBeGreaterThan(0)
    expect(screen.getAllByText('负责核心业务系统开发，熟悉 React').length).toBeGreaterThan(0)
  })
})
