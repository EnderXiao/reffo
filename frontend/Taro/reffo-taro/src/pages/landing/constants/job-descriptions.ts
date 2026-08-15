export interface LandingJobDescription {
  id: 'custom' | 'software' | 'product' | 'data' | 'design' | 'operations'
  title: string
  company: string
  location: string
  experience: string
  salary: string
  summary: string
  responsibilities: string[]
  accent: string
}

export const LANDING_JOB_DESCRIPTIONS: LandingJobDescription[] = [
  {
    id: 'custom',
    title: '自定义岗位描述',
    company: '粘贴目标公司的岗位信息',
    location: '不限地点',
    experience: '按岗位要求',
    salary: '面议',
    summary: '使用真实岗位描述，reffo 会从职责、能力和业务场景中提取最值得匹配的简历重点。',
    responsibilities: [
      '粘贴完整的岗位职责与任职要求',
      '保留技能、经验年限和业务关键词',
      '根据目标岗位重新组织简历表达',
    ],
    accent: '#63a9ee',
  },
  {
    id: 'software',
    title: '软件工程师',
    company: 'reffo 科技',
    location: '上海 · 可远程',
    experience: '1-3 年',
    salary: '25-40K',
    summary: '负责面向用户的 Web 产品与基础服务开发，与产品、设计和算法团队共同交付稳定、易用的智能应用。',
    responsibilities: [
      '使用 React 与 TypeScript 交付核心产品功能',
      '建设可维护的组件、测试与工程化流程',
      '关注性能、可访问性与跨端体验一致性',
    ],
    accent: '#f4bf16',
  },
  {
    id: 'product',
    title: '互联网产品经理',
    company: 'reffo 科技',
    location: '北京 · 上海',
    experience: '3-5 年',
    salary: '30-45K',
    summary: '负责 AI 求职产品的需求洞察、方案设计和效果验证，推动复杂能力形成清晰、可信赖的用户体验。',
    responsibilities: [
      '从用户研究与数据中识别关键机会',
      '定义产品方案、优先级和验收标准',
      '协调设计、研发与算法团队持续迭代',
    ],
    accent: '#ad63ee',
  },
  {
    id: 'data',
    title: '数据分析师',
    company: '云帆数据',
    location: '杭州 · 深圳',
    experience: '2-4 年',
    salary: '25-38K',
    summary: '通过业务数据建模、指标体系和专题分析发现增长机会，为产品与经营决策提供清晰可靠的依据。',
    responsibilities: [
      '搭建核心业务指标与数据看板',
      '使用 SQL 与 Python 完成专题分析',
      '与业务团队共同推动分析结论落地',
    ],
    accent: '#25a88a',
  },
  {
    id: 'design',
    title: 'UX 设计师',
    company: '青屿设计',
    location: '上海 · 杭州',
    experience: '3-5 年',
    salary: '28-42K',
    summary: '负责复杂数字产品的体验策略、交互设计与设计验证，把业务目标转化为清晰一致的用户体验。',
    responsibilities: [
      '梳理核心流程并产出交互方案',
      '维护设计系统与跨端体验规范',
      '结合研究与数据持续验证设计效果',
    ],
    accent: '#e36b89',
  },
  {
    id: 'operations',
    title: '用户运营经理',
    company: '星河互动',
    location: '北京 · 广州',
    experience: '3-5 年',
    salary: '22-35K',
    summary: '围绕用户生命周期策划精细化运营方案，通过内容、活动和用户分层提升活跃、留存与转化。',
    responsibilities: [
      '设计用户分层与生命周期策略',
      '策划活动并跟踪关键转化指标',
      '沉淀可复用的运营机制和内容体系',
    ],
    accent: '#eb7d3c',
  },
]
