import type {ResumeHistory, ResumeHistorySummary} from '@/types'
import type {GenerationTask} from '@/services/backgroundGeneration'
import {resolveResumeGrade} from '@/utils/score-grade'
import {
  toGenerationTaskCard,
  toHistoryCardItem,
  toHistorySummaryCardItem,
} from '../model/homeCardData'
import {resumeTextFingerprint} from '@/shared/resume-strategy'

describe('homeCardData', () => {
  const createTask = (id: string): GenerationTask => ({
    id,
    status: 'running',
    stage: 'analysis',
    background: true,
    read_at: null,
    confirmed_at: null,
    history_id: null,
    company: '同一家公司',
    position: '同一个岗位',
    location: '上海',
    score: null,
    error: null,
    created_at: '2026-09-23T12:00:00.000Z',
    updated_at: '2026-09-23T12:00:00.000Z',
  })

  test('不同生成任务即使公司岗位相同也保持不同的稳定卡片色', () => {
    const first = toGenerationTaskCard(createTask('task-1'))
    const second = toGenerationTaskCard(createTask('task-2'))
    const firstAgain = toGenerationTaskCard(createTask('task-1'))

    expect(first.primaryColor).not.toBe(second.primaryColor)
    expect(first.surfaceColor).not.toBe(second.surfaceColor)
    expect(firstAgain).toMatchObject({
      primaryColor: first.primaryColor,
      surfaceColor: first.surfaceColor,
      stackColor: first.stackColor,
    })
  })

  test('生成任务获得历史摘要后仍保留任务阶段的卡片色', () => {
    const task = createTask('task-color')
    const pendingCard = toGenerationTaskCard(task)
    const summary: ResumeHistorySummary = {
      id: 'JD-task-color',
      position: task.position,
      company: task.company,
      name: '候选人',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      qualityScore: 86,
      matchScore: 82,
      tags: [],
      location: task.location,
      strategyBody: '突出匹配经验。',
    }

    const completedCard = toGenerationTaskCard({...task, status: 'completed', history_id: summary.id}, summary)

    expect(completedCard).toMatchObject({
      primaryColor: pendingCard.primaryColor,
      surfaceColor: pendingCard.surfaceColor,
      stackColor: pendingCard.stackColor,
      logoColor: pendingCard.logoColor,
    })
  })

  test('历史摘要持久化卡片色优先于任务派生色', () => {
    const task = createTask('task-persisted-color')
    const summary: ResumeHistorySummary = {
      id: 'JD-task-persisted-color',
      position: task.position,
      company: task.company,
      name: '候选人',
      createdAt: task.created_at,
      updatedAt: task.updated_at,
      qualityScore: 86,
      matchScore: 82,
      tags: [],
      location: task.location,
      strategyBody: '突出匹配经验。',
      cardColor: '#123456',
    }

    const card = toGenerationTaskCard(task, summary)

    expect(card.primaryColor).toBe(toHistorySummaryCardItem(summary).primaryColor)
  })

  test('历史摘要卡片色格式异常时安全回退到稳定派生色', () => {
    const summary = {
      id: 'JD-broken-card-color',
      position: '产品经理',
      company: 'Reffo',
      name: '候选人',
      createdAt: '2026-09-23T12:00:00.000Z',
      updatedAt: '2026-09-23T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 84,
      tags: [],
      location: '北京',
      strategyBody: '突出产品落地经验。',
      cardColor: {value: '#123456'},
    } as unknown as ResumeHistorySummary

    expect(() => toHistorySummaryCardItem(summary)).not.toThrow()
    expect(toHistorySummaryCardItem(summary).primaryColor).toBe(
      toHistorySummaryCardItem({...summary, cardColor: undefined}).primaryColor,
    )
  })

  test('轻量摘要直接生成首页卡片，不依赖简历正文', () => {
    const summary: ResumeHistorySummary = {
      id: 'JD2026092300001',
      position: 'AI 产品经理',
      company: 'Reffo',
      name: '候选人',
      createdAt: '2026-09-23T12:00:00.000Z',
      updatedAt: '2026-09-23T12:00:00.000Z',
      qualityScore: 88,
      matchScore: 84,
      tags: ['AI'],
      location: '北京',
      strategyBody: '突出 AI 产品落地经验。',
      strategyTitle: '这份简历的重点',
    }

    const card = toHistorySummaryCardItem(summary)

    expect(card).toMatchObject({
      id: summary.id,
      company: summary.company,
      role: summary.position,
      location: summary.location,
      score: summary.matchScore,
      strategyBody: summary.strategyBody,
      strategyTitle: summary.strategyTitle,
    })
  })

  test.each([57, 0])('岗位匹配分为 %i 时，历史卡片与详情页均显示 D，不回退到简历质量分', matchScore => {
    const history: ResumeHistory = {
      id: 'JD2026070800001',
      position: '大萝卜种植手',
      company: '大萝卜',
      name: '候选人',
      createdAt: '2026-07-08T12:00:00.000Z',
      qualityScore: 72,
      matchScore,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '岗位名称：大萝卜种植手',
      optimizedContent: '# 候选人优化版',
    }

    const card = toHistoryCardItem(history)

    expect(card.score).toBe(matchScore)
    expect(resolveResumeGrade(card.score)).toBe('D')
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

  test('历史卡片优先展示创建 JD 时填写的 Base 地', () => {
    const history: ResumeHistory = {
      id: 'JD2026070900003',
      position: '前端开发工程师',
      company: '字节跳动-豆包',
      name: '候选人',
      createdAt: '2026-07-09T12:00:00.000Z',
      qualityScore: 86,
      matchScore: 80,
      tags: [],
      resumeContent: '# 候选人',
      jdContent: '公司名称：字节跳动-豆包\n岗位名称：前端开发工程师\n工作地：北京',
      optimizedContent: '# 候选人优化版',
      resultContext: {
        company: '字节跳动-豆包',
        position: '前端开发工程师',
        location: '上海',
        resumeContent: '# 候选人',
        jdContent: '公司名称：字节跳动-豆包\n岗位名称：前端开发工程师\n工作地：北京',
      },
    }

    const card = toHistoryCardItem(history)

    expect(card.location).toBe('上海')
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
    expect(card.strategyTitle).toBe('优化建议')

    const quote = '参与育苗试验并记录生长情况，尚未完成采收验证。'
    const markdown = `# 候选人\n## 项目经历\n- ${quote}`
    history.optimizedContent = markdown
    history.optimizationSuggestions = []
    history.processResult!.optimized = {
      ...history.processResult!.optimized,
      optimized_resume: markdown,
      strategy_review: {
        version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(markdown),
        items: [{strategyId: 'strategy_g1', strategy: '呈现已有育苗实践', status: 'linked',
          explanation: '可查看本次对应正文。', references: [{outputPath: 'project.p1.bullets[0]',
            location: '项目经历 · 育苗试验 · 第1段', quote}]}],
      },
    }
    const withResult = toHistoryCardItem(history)
    expect(withResult.strategyTitle).toBe('这份简历的重点')
    expect(withResult.strategyBody).toContain(quote)
    expect(withResult.strategyBody).not.toContain('优先突出')

    history.optimizedContent = '# 候选人\n已编辑后的内容'
    const afterEdit = toHistoryCardItem(history)
    expect(afterEdit.strategyTitle).toBe('优化建议')
    expect(afterEdit.strategyBody).toContain('优先突出')
    expect(afterEdit.strategyBody).not.toContain(quote)
  })
})
