import { describe, expect, test } from 'bun:test'
import { evaluateMarkdownResume } from '@/harness/evaluators/markdown-resume-evaluator'
import type { ResumeStructure } from '@/types'

const sourceResume: ResumeStructure = {
  personal_info: { name: '李四' },
  education: [],
  experience: [],
  projects: [
    {
      name: 'Web 管理后台',
      role: '前端开发',
      tech_stack: ['React', 'TypeScript'],
      description: '负责核心业务页面开发和组件抽象。',
      achievements: ['沉淀通用组件，提升页面交付效率。'],
    },
  ],
  skills: { hard_skills: ['React', 'TypeScript'] },
}

const baseMarkdown = `# 李四

## 专业技能

- React、TypeScript、前端工程化
- 熟悉组件化开发、状态管理和接口联调

## 教育背景

本科，计算机相关专业。持续关注 Web 前端性能、可维护性和工程效率，能够结合业务目标拆解页面模块，并在开发过程中维护清晰的组件边界和交互状态。`

describe('markdown resume evaluator', () => {
  test('accepts project internship and practice sections as experience evidence', () => {
    for (const sectionTitle of ['项目经历', '项目经验', '实习经历', '实习经验', '实践经历', '实践经验']) {
      const evaluation = evaluateMarkdownResume(`${baseMarkdown}\n\n## ${sectionTitle}\n\n### Web 管理后台｜前端开发\n\n基于 React 和 TypeScript 完成核心业务页面开发，负责组件抽象、接口联调和交互状态维护。通过沉淀通用组件减少重复开发，并结合业务流程优化页面可读性和维护性。`, sourceResume)

      expect(evaluation.issues.some((issue) => issue.code === 'MISSING_EXPERIENCE_SECTION')).toBe(false)
    }
  })

  test('reports missing experience section when no recognized section exists', () => {
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}\n\n## 自我评价\n\n具备良好的学习能力、沟通能力和工程意识，能够在复杂需求中保持清晰拆解，并基于已有项目事实持续优化简历表达。`, sourceResume)

    expect(evaluation.issues.some((issue) => issue.code === 'MISSING_EXPERIENCE_SECTION')).toBe(true)
  })

  test('rejects work and project headings that contain only metadata', () => {
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 实习经历

### 示例公司｜前端开发

2023-至今

## 项目经历

### Web 管理后台

角色：前端开发`, sourceResume)

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EMPTY_WORK_ENTRY', severity: 'error' }),
      expect.objectContaining({ code: 'EMPTY_PROJECT_ENTRY', severity: 'error' }),
    ]))
    expect(evaluation.passed).toBe(false)
  })

  test('applies empty-entry checks to project aliases and unlabeled tech stacks', () => {
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 核心项目经历

### Web 管理后台

React / TypeScript`, sourceResume)

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EMPTY_PROJECT_ENTRY', severity: 'error' }),
    ]))
    expect(evaluation.issues.some((issue) => issue.code === 'MISSING_EXPERIENCE_SECTION')).toBe(false)

    const headinglessEvaluation = evaluateMarkdownResume(`${baseMarkdown}

## 核心项目经历

React / TypeScript`, sourceResume)
    expect(headinglessEvaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EMPTY_PROJECT_ENTRY', severity: 'error' }),
    ]))
  })

  test('does not let skill bullets hide insufficient work and project evidence', () => {
    const richSource: ResumeStructure = {
      ...sourceResume,
      experience: [{
        company: '示例公司',
        position: '前端开发',
        time_range: '2022-2024',
        responsibilities: ['负责页面开发', '负责组件抽象', '参与接口联调'],
        achievements: ['提升交付效率', '减少重复开发', '优化页面性能'],
      }],
    }
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 工作经历

### 示例公司｜前端开发

- 负责页面开发。

## 专业技能

- React
- TypeScript
- 状态管理
- 性能优化`, richSource)

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'INSUFFICIENT_BUSINESS_EVIDENCE', severity: 'warning' }),
    ]))
  })

  test('accepts substantive bullet and paragraph entries', () => {
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 项目经历

### Web 管理后台｜前端开发

- 负责核心业务页面开发和组件抽象。

### 工程效率优化

沉淀通用组件，减少重复开发并提升页面交付效率。`, sourceResume)

    expect(evaluation.issues.some((issue) => issue.code === 'EMPTY_PROJECT_ENTRY')).toBe(false)
    expect(evaluation.issues.some((issue) => issue.code === 'INSUFFICIENT_BUSINESS_EVIDENCE')).toBe(false)
  })

  test('accepts a compact timeline when all source business claims are ineligible', () => {
    const riskySource: ResumeStructure = {
      ...sourceResume,
      experience: [{
        company: '示例公司',
        position: '前端开发',
        time_range: '2023-至今',
        responsibilities: ['核心职责需核验'],
        achievements: ['交付结果存在口径冲突'],
      }],
      projects: [],
    }
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 其他经历

示例公司｜前端开发｜2023-至今`, riskySource)

    expect(evaluation.issues.some((issue) => issue.code === 'MISSING_EXPERIENCE_SECTION')).toBe(false)
    expect(evaluation.issues.some((issue) => issue.code === 'INSUFFICIENT_BUSINESS_EVIDENCE')).toBe(false)
  })

  test('rejects an empty compact timeline section', () => {
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 其他经历`, {
      ...sourceResume,
      experience: [{
        company: '示例公司',
        position: '前端开发',
        time_range: '2023-至今',
        responsibilities: [],
        achievements: [],
      }],
    })

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EMPTY_WORK_ENTRY', severity: 'error' }),
    ]))
  })

  test('requires every source work item to remain visible in the career timeline', () => {
    const timelineSource: ResumeStructure = {
      ...sourceResume,
      experience: [{
        company: '甲公司',
        position: '产品经理',
        time_range: '2021-2023',
        responsibilities: ['负责产品方案'],
        achievements: [],
      }, {
        company: '乙公司',
        position: '高级产品经理',
        time_range: '2023-至今',
        responsibilities: ['负责用户研究'],
        achievements: [],
      }],
    }
    const evaluation = evaluateMarkdownResume(`${baseMarkdown}

## 工作经历

### 乙公司｜高级产品经理｜2023 - 至今

- 负责用户研究。`, timelineSource)

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_TIMELINE_ENTRY', path: '甲公司', severity: 'error' }),
    ]))
  })
})
