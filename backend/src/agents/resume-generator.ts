import OpenAI from 'openai'
import { env } from '@/config/env'
import type { ResumeStructure, JDStructure, MatchAnalysis } from '@/types'

/**
 * Resume Generator Agent
 * 负责根据匹配分析结果重新编排和优化简历，输出 Markdown 格式
 */
export class ResumeGeneratorAgent {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL,
    })
  }

  /**
   * 生成优化后的简历
   * @param sourceResume 原始结构化简历
   * @param jd 目标岗位结构化数据
   * @param matchAnalysis 匹配分析结果
   * @returns Markdown 格式的优化简历
   */
  async generate(
    sourceResume: ResumeStructure,
    jd: JDStructure,
    matchAnalysis: MatchAnalysis
  ): Promise<string> {
    const prompt = `你是一位专业的简历撰写专家。请基于候选人的源简历、目标岗位要求和匹配分析，生成一份高度匹配、专业化、数据驱动的优化简历。

源简历（结构化数据）：
\`\`\`json
${JSON.stringify(sourceResume, null, 2)}
\`\`\`

目标岗位（结构化数据）：
\`\`\`json
${JSON.stringify(jd, null, 2)}
\`\`\`

匹配分析结果：
\`\`\`json
${JSON.stringify(matchAnalysis, null, 2)}
\`\`\`

请完成简历优化，输出 Markdown 格式的简历文本：

**优化原则：**

1. **真实性第一**：
   - 绝对不杜撰任何虚假信息
   - 所有内容必须基于源简历
   - 只调整表述方式和展现顺序

2. **针对性优化**：
   - 突出与目标岗位最匹配的经验和技能
   - 调整工作经历和项目的排列顺序，把最相关的放在前面
   - 在描述中自然融入 JD 关键词（但不生硬堆砌）

3. **量化与具体化**：
   - 为成果添加或强调量化数据（如：提升XX%、处理XX量级、服务XX用户）
   - 使用 STAR 原则（情境、任务、行动、结果）优化描述
   - 用具体技术栈、工具、方法论替代模糊表述

4. **结构优化**：
   - 保持清晰的 Markdown 格式
   - 使用合理的层级结构（# 一级标题、## 二级标题、### 三级标题）
   - 使用列表展示技能和成就

5. **技能突出**：
   - 将匹配度高的技能放在前面
   - 对于 JD 重点要求的技能，在经历中体现使用场景
   - 软技能通过案例体现，而非简单罗列

6. **格式规范**：
   - 个人信息简洁清晰
   - 工作经历按时间倒序
   - 每段经历包含：公司、职位、时间、职责与成就
   - 教育背景、技能清单完整

**输出要求：**
- 直接输出 Markdown 格式的简历文本，不要包含任何解释、注释或额外说明
- 不要使用代码块包裹简历内容
- 确保格式规范、可读性强

**Markdown 简历模板示例：**

# 姓名

**联系方式**：手机 | 邮箱 | 地点

**当前职位**：职位名称

---

## 工作经历

### 公司名称 | 职位名称 | 时间范围

**职责与成就：**

- 负责XXX系统的架构设计与开发，使用 Java/Spring Boot 构建微服务架构，服务日均请求量 1000万+，系统可用性达 99.99%
- 优化数据库查询性能，通过索引优化和 SQL 重构，查询响应时间从 2s 降低至 200ms，提升 90%
- 带领 5 人团队完成 XXX 项目，按时交付并获得客户好评，项目为公司带来 500 万元营收

### 公司名称 | 职位名称 | 时间范围

...

---

## 项目经验

### 项目名称 | 角色 | 时间

**项目描述**：简要描述项目背景和目标

**技术栈**：Java, Spring Cloud, MySQL, Redis, Kubernetes

**主要工作与成果**：

- 成果1：使用 XXX 技术实现了 XXX 功能，带来 XXX 效果
- 成果2：优化了 XXX 模块，性能提升 XX%

---

## 教育背景

### 学校名称 | 专业 | 学历 | 时间

- 获得 XXX 奖学金
- 参与 XXX 项目/竞赛

---

## 技能清单

**编程语言**：Java, Python, JavaScript

**框架与工具**：Spring Boot, React, Docker, Kubernetes

**数据库**：MySQL, Redis, MongoDB

**软技能**：团队协作、问题解决、项目管理

---

现在请根据以上原则和模板，生成优化后的简历：`

    try {
      const response = await this.client.chat.completions.create({
        model: env.AI_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('AI 返回内容为空')
      }

      return content.trim()
    } catch (error) {
      console.error('Resume generation failed:', error)
      throw new Error(`简历生成失败: ${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
}
