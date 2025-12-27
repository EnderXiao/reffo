# Reffo 技术方案文档

## 文档版本

| 版本 | 日期 | 作者 | 说明 |
| --- | --- | --- | --- |
| v1.0 | 2025-12-14 | AI Assistant | 初版技术方案 |

---

## 1. 系统架构概述

### 1.1 架构原则
- **AI Agent 驱动**：核心业务逻辑基于 AI Agent 实现智能化决策
- **模块化设计**：前端、后端、AI 服务解耦，便于独立开发与扩展
- **数据安全优先**：端到端加密，用户数据隔离，符合隐私保护要求
- **高可用性**：支持水平扩展，异步任务处理，保证系统稳定性

### 1.2 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                       用户层（Client）                        │
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │  Web App        │  │  Mobile App     │                  │
│  │  (React/Vue)    │  │  (React Native) │                  │
│  └─────────────────┘  └─────────────────┘                  │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS/REST API
┌────────────────────────────┴────────────────────────────────┐
│                     API Gateway 层                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ 认证/授权 │ 限流 │ 路由 │ 日志 │ 监控                   │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                      应用服务层（Backend）                    │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐        │
│  │ User Service│  │Resume Service│  │ JD Service   │        │
│  └─────────────┘  └─────────────┘  └──────────────┘        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐        │
│  │ File Service│  │Match Service │  │Export Service│        │
│  └─────────────┘  └─────────────┘  └──────────────┘        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                      AI Agent 层                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ JD Parser Agent  │  │Resume Parser     │                │
│  │                  │  │Agent             │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ Resume Analyzer  │  │ Matching Agent   │                │
│  │ Agent            │  │                  │                │
│  └──────────────────┘  └──────────────────┘                │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │Resume Generator  │  │ Interview Coach  │                │
│  │Agent             │  │ Agent            │                │
│  └──────────────────┘  └──────────────────┘                │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                       LLM Provider 层                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ OpenAI API   │  │ Anthropic API│  │ 国产大模型    │      │
│  │ (GPT-4)      │  │ (Claude)     │  │ (通义/文心等) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
│                      数据存储层                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PostgreSQL   │  │ Redis Cache  │  │ OSS/S3       │      │
│  │ (用户/简历)   │  │ (会话/队列)   │  │ (文件存储)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │ Vector DB    │  │ Log/Metrics  │                        │
│  │ (Embedding)  │  │ (ELK/Prom)   │                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 技术栈选型

### 2.1 前端技术栈

| 技术 | 选型 | 说明 |
| --- | --- | --- |
| **框架** | React 18 + TypeScript | 主流生态，类型安全，社区活跃 |
| **状态管理** | Zustand / TanStack Query | 轻量状态管理 + 服务端状态缓存 |
| **UI 组件库** | Ant Design / shadcn/ui | 企业级组件库或现代化组件库 |
| **路由** | React Router v6 | 声明式路由 |
| **构建工具** | Vite | 快速开发体验 |
| **HTTP 客户端** | Axios | 拦截器、取消请求等功能完善 |
| **文件上传** | react-dropzone | 拖拽上传体验 |
| **PDF 预览** | react-pdf / pdf.js | 在线预览简历 |

### 2.2 后端技术栈

| 技术 | 选型 | 说明 |
| --- | --- | --- |
| **运行时** | Bun 1.0+ | 极速的 JavaScript/TypeScript 运行时，内置打包、测试、包管理 |
| **语言** | TypeScript 5.0+ | 类型安全，开发体验好 |
| **框架** | Elysia | 高性能 Web 框架，完整的类型推导，接近 Fastify 性能 |
| **ORM** | Drizzle ORM / Prisma | 轻量 ORM（Drizzle）或功能完整的 ORM（Prisma） |
| **数据库** | PostgreSQL 15+ | 开源关系型数据库，支持 JSON/向量扩展 |
| **缓存** | Redis 7+ / ioredis | 会话管理、任务队列、缓存 |
| **对象存储** | MinIO / AWS S3 / 阿里云 OSS | 文件存储（@aws-sdk/client-s3） |
| **任务队列** | BullMQ / Bee-Queue | 基于 Redis 的任务队列 |
| **向量数据库** | Pinecone / Weaviate / pgvector | 简历语义检索（可选） |
| **认证鉴权** | JWT (@elysiajs/jwt) + OAuth2 | Token 认证 + 第三方登录 |
| **文档解析** | pdf-parse / mammoth / tesseract.js | PDF/Word/Image 解析 |
| **验证** | @sinclair/typebox | JSON Schema 验证，与 Elysia 深度集成 |
| **日志** | pino / winston | 高性能日志库 |

### 2.3 AI & ML 技术栈

| 技术 | 选型 | 说明 |
| --- | --- | --- |
| **LLM Provider** | DeepSeek (主力) / OpenAI GPT-4 / Claude 3 | DeepSeek 性价比高，支持多模型备用 |
| **AI SDK** | Vercel AI SDK / LangChain.js | TypeScript AI 工具链 |
| **Agent 框架** | LangGraph.js / Custom | 构建 AI Agent 工作流 |
| **Prompt 管理** | LangSmith / Custom | Prompt 版本管理与 A/B 测试 |
| **Embedding** | OpenAI Embeddings / text-embedding-3 | 文本向量化 |
| **OCR** | Tesseract.js / Cloud OCR API | 图片简历文字识别 |

### 2.4 DevOps & 基础设施

| 技术 | 选型 | 说明 |
| --- | --- | --- |
| **容器化** | Podman + Podman Compose | 开源、无守护进程、rootless 支持 |
| **编排** | Kubernetes (可选) | 生产环境 |
| **CI/CD** | GitHub Actions / GitLab CI | 自动化测试与部署 |
| **监控** | Prometheus + Grafana | 性能监控 |
| **日志** | ELK Stack (Elasticsearch + Logstash + Kibana) | 日志聚合分析 |
| **API 文档** | Elysia Swagger 插件 | 自动生成 Swagger/OpenAPI 文档 |

---

## 3. 数据库设计

### 3.1 核心数据表

#### 3.1.1 users（用户表）
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    username VARCHAR(100),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login_at TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);
```

#### 3.1.2 source_resumes（源简历表）
```sql
CREATE TABLE source_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file_name VARCHAR(255),
    file_url TEXT NOT NULL,
    file_type VARCHAR(50), -- 'pdf', 'docx', 'image'
    file_size INTEGER,
    
    -- 解析后的结构化数据
    parsed_content JSONB,
    
    -- AI 分析结果
    analysis_result JSONB, -- {quality_score, suggestions, extracted_entities}
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_source_resumes_user_id ON source_resumes(user_id);
```

#### 3.1.3 job_descriptions（目标岗位表） （可以和3.1.4合为一张表）
```sql
CREATE TABLE job_descriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- 岗位信息
    job_title VARCHAR(255),
    company_name VARCHAR(255),
    raw_content TEXT NOT NULL,
    
    -- AI 解析结果
    parsed_content JSONB, -- {requirements, responsibilities, skills, soft_skills}
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_job_descriptions_user_id ON job_descriptions(user_id);
```

#### 3.1.4 generated_resumes（生成的最佳简历表）
```sql
CREATE TABLE generated_resumes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_resume_id UUID REFERENCES source_resumes(id) ON DELETE SET NULL,
    job_description_id UUID REFERENCES job_descriptions(id) ON DELETE SET NULL,
    
    -- 生成的简历内容
    content JSONB NOT NULL,
    file_url TEXT, -- 导出后的文件链接
    
    -- 匹配度分析
    match_analysis JSONB, -- {match_score, matched_skills, gaps, suggestions}
    
    -- 面试建议
    interview_tips JSONB,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_generated_resumes_user_id ON generated_resumes(user_id);
CREATE INDEX idx_generated_resumes_created_at ON generated_resumes(created_at DESC);
```

#### 3.1.5 user_sessions（会话表）
```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
```

---

## 4. 核心模块设计

### 4.1 文件上传与解析模块

#### 4.1.1 文件上传流程
1. **前端**：用户选择文件 → 验证格式和大小 → 调用上传接口
2. **后端**：接收文件 → 上传至 OSS → 返回文件 URL
3. **异步任务**：触发文件解析任务

#### 4.1.2 文件解析 Agent

**Resume Parser Agent**

```typescript
import { OpenAI } from 'openai'
import pdf from 'pdf-parse'
import mammoth from 'mammoth'
import Tesseract from 'tesseract.js'

interface ParsedResume {
  raw_text: string
  structured: ResumeStructure
  entities: ExtractedEntities
}

class ResumeParserAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ 
      apiKey,
      baseURL // DeepSeek API 兼容 OpenAI SDK
    })
  }

  async parse(fileUrl: string, fileType: string): Promise<ParsedResume> {
    // 1. 下载文件
    const fileContent = await this.downloadFile(fileUrl)
    
    // 2. 根据类型解析
    let text: string
    if (fileType === 'pdf') {
      text = await this.parsePdf(fileContent)
    } else if (fileType === 'docx') {
      text = await this.parseDocx(fileContent)
    } else if (fileType === 'image') {
      text = await this.ocrImage(fileContent)
    } else {
      throw new Error(`Unsupported file type: ${fileType}`)
    }
    
    // 3. LLM 结构化提取
    const structuredData = await this.llmExtract(text)
    
    return {
      raw_text: text,
      structured: structuredData,
      entities: this.extractEntities(structuredData)
    }
  }
  
  private async llmExtract(text: string): Promise<ResumeStructure> {
    const prompt = `你是一位专业的人力资源专家。请从以下简历文本中提取结构化信息：

简历内容：
${text}

请提取以下信息（JSON 格式）：
1. 个人信息：姓名、联系方式、当前职位
2. 教育背景：学校、专业、学历、时间
3. 工作经历：公司、职位、时间、职责、成就
4. 项目经验：项目名称、角色、技术栈、成果
5. 技能列表：硬技能、软技能`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat', // DeepSeek 主力模型
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
  
  private async parsePdf(buffer: Buffer): Promise<string> {
    const data = await pdf(buffer)
    return data.text
  }
  
  private async parseDocx(buffer: Buffer): Promise<string> {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  }
  
  private async ocrImage(buffer: Buffer): Promise<string> {
    const { data } = await Tesseract.recognize(buffer, 'chi_sim+eng')
    return data.text
  }
}
```

**Resume Analyzer Agent**

```typescript
import { OpenAI } from 'openai'

interface ResumeAnalysis {
  quality_score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  capability_summary: string
}

class ResumeAnalyzerAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async analyze(parsedResume: ResumeStructure): Promise<ResumeAnalysis> {
    const prompt = `你是一位资深的人力资源专家。请对以下简历进行全面分析：

简历数据：
${JSON.stringify(parsedResume, null, 2)}

请提供：
1. 质量评分（0-100）
2. 优点列表
3. 问题列表（结构、内容、表达等方面）
4. 具体优化建议
5. 能力模型总结

返回 JSON 格式。`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
}
```

### 4.2 JD 解析模块

**JD Parser Agent**

```typescript
import { OpenAI } from 'openai'

interface JDStructure {
  basic_info: {
    title: string
    company: string
    location: string
  }
  hard_requirements: {
    education: string
    experience_years: string
    required_skills: string[]
  }
  responsibilities: string[]
  tasks: string[]
  soft_skills: string[]
  nice_to_have: string[]
}

class JDParserAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async parse(jdText: string): Promise<JDStructure> {
    const prompt = `你是一位招聘专家。请分析以下岗位描述（JD），提取关键信息：

JD 内容：
${jdText}

请提取（JSON 格式）：
1. 岗位基本信息：职位名称、公司、工作地点
2. 硬性要求：学历、工作年限、必备技能
3. 岗位职责：主要工作内容
4. 岗位任务：具体任务列表
5. 软技能与文化特质：期望的软实力
6. 加分项：优先考虑的条件`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
}
```

### 4.3 简历匹配与生成模块

**Matching Agent**

```typescript
import { OpenAI } from 'openai'

interface MatchAnalysis {
  match_score: number
  hard_requirements_match: Record<string, boolean>
  skill_match: {
    matched: string[]
    missing: string[]
  }
  experience_match: string
  soft_skills_match: string
  strengths: string[]
  weaknesses: string[]
}

class MatchingAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async match(resume: ResumeStructure, jd: JDStructure): Promise<MatchAnalysis> {
    const prompt = `你是一位招聘匹配专家。请分析候选人简历与目标岗位的匹配情况：

候选人简历：
${JSON.stringify(resume, null, 2)}

目标岗位要求：
${JSON.stringify(jd, null, 2)}

请提供：
1. 总体匹配度评分（0-100）
2. 硬性要求匹配情况（逐项分析）
3. 技能匹配度（已具备 vs 缺失）
4. 经验匹配度
5. 软技能匹配度
6. 优势点（候选人的亮点）
7. 劣势点（需要改进的地方）

返回 JSON 格式。`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
}
```

**Resume Generator Agent**

```typescript
import { OpenAI } from 'openai'

class ResumeGeneratorAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async generate(
    sourceResume: ResumeStructure,
    jd: JDStructure,
    matchAnalysis: MatchAnalysis
  ): Promise<ResumeStructure> {
    const prompt = `你是一位专业的简历撰写专家。请基于候选人的源简历和目标岗位要求，
生成一份高度匹配、专业化、数据驱动的定制化简历。

源简历：
${JSON.stringify(sourceResume, null, 2)}

目标岗位：
${JSON.stringify(jd, null, 2)}

匹配分析：
${JSON.stringify(matchAnalysis, null, 2)}

要求：
1. 保留所有真实信息，绝不杜撰
2. 调整工作经历和项目经验的描述，突出与目标岗位相关的技能和成果
3. 使用量化数据（百分比、数字、规模等）
4. 采用 STAR 原则（情境、任务、行动、结果）
5. 关键词匹配（融入 JD 中的关键词）
6. 优化技能部分，突出匹配技能

返回完整的简历内容（JSON 格式，结构与源简历一致）。`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
}
```

**Interview Coach Agent**

```typescript
import { OpenAI } from 'openai'

interface InterviewTips {
  resume_questions: string[]
  behavioral_questions: Array<{
    question: string
    star_example: string
  }>
  technical_questions: string[]
  best_cases: string[]
  reverse_questions: string[]
}

class InterviewCoachAgent {
  private client: OpenAI

  constructor(apiKey: string, baseURL: string = 'https://api.deepseek.com') {
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async generateTips(
    generatedResume: ResumeStructure,
    jd: JDStructure
  ): Promise<InterviewTips> {
    const prompt = `你是一位资深的面试教练。请基于候选人的最终简历和目标岗位，
提供针对性的面试准备建议。

最终简历：
${JSON.stringify(generatedResume, null, 2)}

目标岗位：
${JSON.stringify(jd, null, 2)}

请提供：
1. 简历追问预测（面试官可能针对简历提出的问题）
2. 行为问题准备（STAR 案例准备）
3. 技术问题准备（针对岗位要求的技术栈）
4. 匹配的最佳案例（从简历中选择最能体现匹配度的案例）
5. 合理的反问问题（体现对岗位的理解）

返回 JSON 格式。`
    
    const response = await this.client.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' }
    })
    
    return JSON.parse(response.choices[0].message.content!)
  }
}
```

### 4.4 简历导出模块

支持导出格式：
- **PDF**：使用 Puppeteer / Playwright 生成
- **Word**：使用 docx 库生成
- **Markdown**：直接转换

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import puppeteer from 'puppeteer'

type ExportFormat = 'pdf' | 'docx' | 'markdown'

class ResumeExporter {
  private s3Client: S3Client
  
  constructor(s3Config: { region: string; credentials: any }) {
    this.s3Client = new S3Client(s3Config)
  }

  async export(resumeData: ResumeStructure, format: ExportFormat): Promise<string> {
    let fileBuffer: Buffer
    let contentType: string
    
    switch (format) {
      case 'pdf':
        fileBuffer = await this.generatePdf(resumeData)
        contentType = 'application/pdf'
        break
      case 'docx':
        fileBuffer = await this.generateDocx(resumeData)
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        break
      case 'markdown':
        fileBuffer = Buffer.from(this.generateMarkdown(resumeData))
        contentType = 'text/markdown'
        break
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
    
    // 上传到 S3/OSS
    const fileUrl = await this.uploadToOss(fileBuffer, contentType, format)
    return fileUrl
  }
  
  private async generatePdf(data: ResumeStructure): Promise<Buffer> {
    // 使用 Puppeteer 生成 PDF
    const browser = await puppeteer.launch()
    const page = await browser.newPage()
    const html = this.generateHtml(data)
    await page.setContent(html)
    const pdfBuffer = await page.pdf({ format: 'A4' })
    await browser.close()
    return Buffer.from(pdfBuffer)
  }
  
  private async generateDocx(data: ResumeStructure): Promise<Buffer> {
    // 使用 docx 库生成 Word
    const doc = new Document({
      sections: [{
        children: [
          new Paragraph({
            children: [new TextRun({ text: data.personal_info.name, bold: true, size: 32 })]
          }),
          // ... 更多内容
        ]
      }]
    })
    return await Packer.toBuffer(doc)
  }
  
  private generateMarkdown(data: ResumeStructure): string {
    return `# ${data.personal_info.name}\n\n## 教育背景\n...`
  }
  
  private async uploadToOss(
    buffer: Buffer, 
    contentType: string, 
    format: ExportFormat
  ): Promise<string> {
    const key = `resumes/${Date.now()}.${format}`
    await this.s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      Body: buffer,
      ContentType: contentType
    }))
    return `https://${process.env.S3_BUCKET}.s3.amazonaws.com/${key}`
  }
}
```

### 4.5 Elysia API 路由示例

```typescript
import { Elysia, t } from 'elysia'
import { jwt } from '@elysiajs/jwt'
import { swagger } from '@elysiajs/swagger'

// 创建主应用
const app = new Elysia()
  .use(swagger())
  .use(
    jwt({
      name: 'jwt',
      secret: process.env.JWT_SECRET!
    })
  )

// 用户认证路由
const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
  .post('/register', async ({ body }) => {
    // 注册逻辑
    return { success: true, user: body }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 8 }),
      username: t.String()
    })
  })
  .post('/login', async ({ body, jwt, setCookie }) => {
    // 登录逻辑
    const token = await jwt.sign({ userId: 'user-id', email: body.email })
    return { success: true, token }
  }, {
    body: t.Object({
      email: t.String({ format: 'email' }),
      password: t.String()
    })
  })

// 简历管理路由
const resumeRoutes = new Elysia({ prefix: '/api/v1/resumes' })
  .post('/upload', async ({ body }) => {
    // 上传简历
    const file = body.file
    // 处理文件上传...
    return { success: true, resume_id: 'resume-uuid' }
  }, {
    body: t.Object({
      file: t.File()
    })
  })
  .get('/', async ({ query }) => {
    // 获取简历列表
    return { resumes: [] }
  })
  .get('/:resume_id', async ({ params }) => {
    // 获取单个简历
    return { resume_id: params.resume_id }
  })
  .delete('/:resume_id', async ({ params }) => {
    // 删除简历
    return { success: true }
  })

// JD 管理路由
const jobRoutes = new Elysia({ prefix: '/api/v1/jobs' })
  .post('/parse', async ({ body }) => {
    const jdParser = new JDParserAgent(process.env.OPENAI_API_KEY!)
    const parsed = await jdParser.parse(body.jd_text)
    return { success: true, parsed_jd: parsed }
  }, {
    body: t.Object({
      jd_text: t.String()
    })
  })

// 匹配与生成路由
const matchRoutes = new Elysia({ prefix: '/api/v1/matches' })
  .post('/generate', async ({ body }) => {
    // 1. 获取源简历和 JD
    // const sourceResume = await getResume(body.source_resume_id)
    // const jd = await getJob(body.job_id)
    
    // 2. 匹配分析
    const matcher = new MatchingAgent(process.env.OPENAI_API_KEY!)
    // const matchAnalysis = await matcher.match(sourceResume, jd)
    
    // 3. 生成最佳简历
    const generator = new ResumeGeneratorAgent(process.env.OPENAI_API_KEY!)
    // const generatedResume = await generator.generate(sourceResume, jd, matchAnalysis)
    
    // 4. 生成面试建议
    const coach = new InterviewCoachAgent(process.env.OPENAI_API_KEY!)
    // const interviewTips = await coach.generateTips(generatedResume, jd)
    
    return {
      success: true,
      match_id: 'match-uuid',
      // match_score: matchAnalysis.match_score,
      // generated_resume: generatedResume,
      // match_analysis: matchAnalysis
    }
  }, {
    body: t.Object({
      source_resume_id: t.String({ format: 'uuid' }),
      job_id: t.String({ format: 'uuid' })
    })
  })
  .get('/:match_id', async ({ params }) => {
    return { match_id: params.match_id }
  })
  .post('/:match_id/export', async ({ params, body }) => {
    const exporter = new ResumeExporter({ region: 'us-east-1', credentials: {} })
    // const resume = await getGeneratedResume(params.match_id)
    // const fileUrl = await exporter.export(resume, body.format)
    return { success: true, file_url: 'https://...' }
  }, {
    body: t.Object({
      format: t.Union([t.Literal('pdf'), t.Literal('docx'), t.Literal('markdown')])
    })
  })

// 组装所有路由
app
  .use(authRoutes)
  .use(resumeRoutes)
  .use(jobRoutes)
  .use(matchRoutes)
  .listen(3000)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)
```

---

## 5. API 设计

### 5.1 API 端点规划

#### 5.1.1 用户认证
- `POST /api/v1/auth/register` - 用户注册
- `POST /api/v1/auth/login` - 用户登录
- `POST /api/v1/auth/logout` - 用户登出
- `GET /api/v1/auth/me` - 获取当前用户信息

#### 5.1.2 源简历管理
- `POST /api/v1/resumes/upload` - 上传源简历
- `GET /api/v1/resumes` - 获取用户的源简历列表
- `GET /api/v1/resumes/{resume_id}` - 获取单个源简历详情
- `DELETE /api/v1/resumes/{resume_id}` - 删除源简历
- `GET /api/v1/resumes/{resume_id}/analysis` - 获取简历分析结果

#### 5.1.3 岗位描述管理
- `POST /api/v1/jobs/parse` - 上传并解析 JD
- `GET /api/v1/jobs` - 获取用户的 JD 列表
- `GET /api/v1/jobs/{job_id}` - 获取单个 JD 详情

#### 5.1.4 最佳简历生成
- `POST /api/v1/matches/generate` - 生成最佳简历
  - Body: `{ "source_resume_id": "uuid", "job_id": "uuid" }`
- `GET /api/v1/matches/{match_id}` - 获取生成的简历详情
- `GET /api/v1/matches` - 获取历史生成记录
- `POST /api/v1/matches/{match_id}/export` - 导出简历
  - Body: `{ "format": "pdf" | "docx" | "markdown" }`

#### 5.1.5 面试建议
- `GET /api/v1/matches/{match_id}/interview-tips` - 获取面试建议

### 5.2 API 示例

**生成最佳简历接口**

```json
POST /api/v1/matches/generate

Request:
{
  "source_resume_id": "123e4567-e89b-12d3-a456-426614174000",
  "job_id": "123e4567-e89b-12d3-a456-426614174001"
}

Response:
{
  "status": "success",
  "data": {
    "match_id": "123e4567-e89b-12d3-a456-426614174002",
    "match_score": 85,
    "generated_resume": {
      "personal_info": { ... },
      "education": [ ... ],
      "experience": [ ... ],
      "skills": [ ... ]
    },
    "match_analysis": {
      "strengths": [ ... ],
      "gaps": [ ... ],
      "suggestions": [ ... ]
    }
  }
}
```

---

## 6. 安全与隐私

### 6.1 数据加密
- **传输加密**：HTTPS/TLS 1.3
- **存储加密**：
  - 敏感字段（如个人信息）使用 AES-256 加密
  - 密码使用 bcrypt 加密存储
  - 文件存储使用 OSS 服务端加密

### 6.2 数据隔离
- 每个用户的数据严格隔离
- 使用 Row-Level Security (RLS) 实现数据库级别的隔离
- AI 训练数据与用户数据完全分离

### 6.3 权限控制
- JWT Token 认证
- RBAC 角色权限控制
- API 访问限流

### 6.4 隐私保护
- 用户数据仅用于个人专属服务
- 不用于训练公开模型
- 支持用户数据导出与删除

---

## 7. 性能优化

### 7.1 缓存策略
- **Redis 缓存**：
  - 用户会话
  - 热点数据（高频访问的简历、JD）
  - LLM 响应缓存（相同输入缓存结果）

### 7.2 异步处理
- 文件解析异步化
- AI 生成任务异步化
- 导出任务异步化

### 7.3 并发控制
- 使用 Celery 任务队列
- 限流防止滥用
- 连接池复用

---

## 8. 部署方案

### 8.1 本地开发环境

使用 Podman Compose：
```bash
podman-compose up -d
```

`podman-compose.yml` 或 `docker-compose.yml` 示例（Podman 兼容 Docker Compose 语法）：
```yaml
version: '3.8'
services:
  postgres:
    image: docker.io/library/postgres:15
    environment:
      POSTGRES_DB: reffo
      POSTGRES_USER: reffo
      POSTGRES_PASSWORD: reffo
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: docker.io/library/redis:7
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
  
  minio:
    image: docker.io/minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
  
  backend:
    build: 
      context: ./backend
      dockerfile: Containerfile  # Podman 推荐使用 Containerfile
    environment:
      DATABASE_URL: postgresql://reffo:reffo@postgres:5432/reffo
      REDIS_URL: redis://redis:6379
      DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY}
      DEEPSEEK_BASE_URL: https://api.deepseek.com
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
      - minio
  
  frontend:
    build:
      context: ./frontend
      dockerfile: Containerfile
    ports:
      - "5173:5173"  # Vite 默认端口
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

**Containerfile 示例（backend）：**
```dockerfile
# 使用 Bun 官方镜像
FROM docker.io/oven/bun:1

WORKDIR /app

# 复制依赖文件
COPY package.json bun.lockb ./

# 安装依赖
RUN bun install --frozen-lockfile

# 复制源代码
COPY . .

# 暴露端口
EXPOSE 3000

# 启动应用
CMD ["bun", "run", "src/index.ts"]
```

**Podman 优势：**
- 开源：完全开源，无供应商锁定
- Rootless：支持非 root 用户运行容器，更安全
- 无守护进程：不需要常驻后台服务
- 兼容性：Podman 命令与 Docker 兼容，可以 `alias docker=podman`

### 8.2 生产环境
- **容器化**：Podman + Kubernetes
- **CI/CD**：GitHub Actions 自动化部署
- **监控**：Prometheus + Grafana
- **日志**：ELK Stack

---

## 9. 开发计划（MVP）

### Phase 1: 核心功能（2-3 周）
- [ ] 用户认证系统
- [ ] 源简历上传与解析
- [ ] JD 上传与解析
- [ ] 简历匹配与生成

### Phase 2: 用户体验优化（1-2 周）
- [ ] 前端页面完善
- [ ] 历史记录管理
- [ ] 简历导出功能

### Phase 3: 增值功能（1-2 周）
- [ ] 面试建议生成
- [ ] 简历质量评估
- [ ] 多模型支持

### Phase 4: 生产就绪（1 周）
- [ ] 性能优化
- [ ] 监控与日志
- [ ] 安全加固
- [ ] 文档完善

---

## 10. 待讨论事项

1. **LLM 模型选型**：DeepSeek 为主，是否需要 OpenAI/Claude 作为备用？
2. **Agent 框架**：LangGraph vs AutoGen vs 自研？
3. **部署方式**：云服务商选择（AWS / 阿里云 / 腾讯云）？
4. **定价策略**：免费额度 + 付费套餐？
5. **数据埋点**：需要追踪哪些用户行为？

---

## 11. 附录

### 11.1 参考资料
- Elysia 官方文档：https://elysiajs.com/
- Bun 官方文档：https://bun.sh/docs
- DeepSeek API 文档：https://platform.deepseek.com/api-docs/
- Podman 官方文档：https://podman.io/docs
- PostgreSQL 官方文档：https://www.postgresql.org/docs/

### 11.2 相关项目
- ResumeParser: https://github.com/OmkarPathak/pyresparser
- ResumeBuilder: https://github.com/saadpasta/resumebuilder

---

**文档结束**
