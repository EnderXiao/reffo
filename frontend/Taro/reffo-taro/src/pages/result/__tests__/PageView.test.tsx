import {fireEvent, render, screen, within} from '@testing-library/react'
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
  handleRetryStage: jest.fn(),
  handleOptimizedResumeChange: jest.fn(),
  canEditHistory: false,
}

describe('结果页', () => {
  test('岗位分析显示匹配差距与结构化策略，不能显示简历质量问题', () => {
    const current: ProcessResult = {
      ...result,
      analysis: {...result.analysis, weaknesses: ['本片未见姓名和教育信息']},
      matching: {...result.matching,
        weaknesses: ['旧版差距摘要'],
        weakness_details: [{id: 'G1', priority: 'high', evidence_type: 'implicit_evidence',
          weakness: '团队统筹：尚未提供任务分工与成员赋能的证据',
          jd_requirement: '统筹产品团队', evidence: '参与跨部门交付',
          impact: '现有材料支撑跨部门推进，尚不足以证明团队管理', suggestion: '保留协同角色'}],
        optimization_suggestions: ['是否有更多团队管理经历？'],
        optimization_strategy_details: [{id: 'S1', related_gap_ids: ['G1'],
          strategy_point: '用跨部门交付案例说明推进方式，保留参与边界', rationale: '对应团队协同要求',
          optimization_example: {source_path: '', source_quote: '', optimized_content: ''}}],
      },
    }
    render(<PageView {...model} result={current} />)
    expect(screen.getByText('团队统筹：尚未提供任务分工与成员赋能的证据')).toBeTruthy()
    expect(screen.getByText('用跨部门交付案例说明推进方式，保留参与边界')).toBeTruthy()
    expect(screen.queryByText('本片未见姓名和教育信息')).toBeNull()
    expect(screen.queryByText('是否有更多团队管理经历？')).toBeNull()
  })

  test('进入面试建议 tab 时正常渲染原文引用', () => {
    render(<PageView {...model} />)

    fireEvent.click(screen.getByLabelText('面试建议'))

    expect(screen.getByText('核心业务系统项目')).toBeTruthy()
    expect(screen.getAllByText('负责核心业务系统开发并按期完成上线').length).toBeGreaterThan(0)
    expect(screen.getAllByText('负责核心业务系统开发，熟悉 React').length).toBeGreaterThan(0)
  })

  test('简历生成失败后点击对应 tab 直接触发重试', () => {
    const handleRetryStage = jest.fn()
    render(
      <PageView
        {...model}
        handleRetryStage={handleRetryStage}
        progress={{...model.progress, optimized: 'failed'}}
        generationError='简历生成失败，请稍后重试'
      />,
    )

    fireEvent.click(screen.getByLabelText('重试最佳简历'))

    expect(handleRetryStage).toHaveBeenCalledWith('resume')
    expect(screen.queryByText('简历生成失败，请稍后重试')).toBeNull()
  })

  test('生成中的 tab 仍保持阻塞提示，不触发重试', () => {
    const handleRetryStage = jest.fn()
    render(
      <PageView
        {...model}
        handleRetryStage={handleRetryStage}
        progress={{...model.progress, optimized: 'generating'}}
      />,
    )

    const resumeTab = screen.getByLabelText('最佳简历')
    fireEvent.click(resumeTab)

    expect(handleRetryStage).not.toHaveBeenCalled()
    expect(within(resumeTab).getByText('步骤正在生成中')).toBeTruthy()
  })

  test('每个故事完整显示各自的讲述方案，引用独立保留', () => {
    const stories = [{
      title: '核心业务系统项目', background: '核心业务系统审批流程复杂', result: '按期完成上线',
      storytelling_approach: [
        '从审批阻塞的用户反馈切入，说明为什么要重做流程。',
        '按权限模型、审批节点、接口联调的顺序说明本人推进的工作。',
        '解释统一状态机和逐个页面修补两种方案之间的取舍。',
        '收尾时展示上线验收记录，将本人实现与团队协作区分开。',
        '面对复杂需求追问，用异常审批回退说明方案完整性。',
      ],
    }, {
      title: '移动端性能优化', background: '课程列表加载缓慢', result: '完成列表渲染优化',
      storytelling_approach: [
        '以课程列表卡顿的复现路径开场，不泛讲性能术语。',
        '结合分析工具的调用轨迹，讲清定位重复渲染的过程。',
        '比较虚拟列表与局部缓存，解释为何选用当前实现。',
        '用相同设备和数据规模下的对照记录展示优化结果。',
      ],
    }]
    const current: ProcessResult = {...result, interview: {...result.interview, story_recommendations: stories}}
    render(<PageView {...model} result={current} />)
    fireEvent.click(screen.getByLabelText('面试建议'))

    stories.forEach(story => {
      const block = screen.getByText(story.title).closest('.reffo-result__story-block') as HTMLElement
      story.storytelling_approach.forEach(point => expect(within(block).getByText(`• ${point}`)).toBeTruthy())
      const otherStory = stories.find(other => other.title !== story.title)!
      otherStory.storytelling_approach.forEach(point => expect(within(block).queryByText(`• ${point}`)).toBeNull())
      expect(within(block).getByText(/参考源简历/)).toBeTruthy()
    })
    expect(screen.queryByText(/对齐讲述重点，优先说明这段经历如何回应岗位要求/)).toBeNull()
    expect(screen.queryByText(/此故事尚未生成讲述思路/)).toBeNull()
  })

  test('历史故事缺失讲述思路时提示重新生成，不用原文引用套写方案或补齐故事', () => {
    const current: ProcessResult = {...result, interview: {...result.interview,
      story_recommendations: [{...result.interview.story_recommendations[0], storytelling_approach: []}],
    }}
    render(<PageView {...model} result={current} />)
    fireEvent.click(screen.getByLabelText('面试建议'))

    expect(screen.getByText('此故事尚未生成讲述思路，请重新生成面试建议。')).toBeTruthy()
    expect(screen.queryByText(/对齐讲述重点，优先说明这段经历如何回应岗位要求/)).toBeNull()
    expect(screen.queryByText(/回到可核验事实，避免把岗位要求包装成自己已经做过的经历/)).toBeNull()
    expect(screen.queryByText('补齐短板的备选故事')).toBeNull()
    expect(screen.getAllByText('负责核心业务系统开发并按期完成上线')).toHaveLength(1)
  })

  test('没有故事推荐时展示未生成状态', () => {
    const current: ProcessResult = {...result, interview: {...result.interview, story_recommendations: []}}
    render(<PageView {...model} result={current} />)
    fireEvent.click(screen.getByLabelText('面试建议'))

    expect(screen.getByText('尚未生成故事推荐，请重新生成面试建议。')).toBeTruthy()
    expect(screen.queryByText('讲述思路：')).toBeNull()
    expect(screen.queryByText('高匹配项目经历')).toBeNull()
  })
})
