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
})
