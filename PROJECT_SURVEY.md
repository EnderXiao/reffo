# Reffo 项目调研纪要

调研时间：2026-03-07  
调研方式：基于本地仓库的静态代码阅读与结构梳理，**未包含真实启动、接口联调与运行态验证**。

## 1. 调研结论摘要

- `Reffo` 的产品目标是做一个基于 AI Agent 的智能简历优化工具，核心价值是“一岗一简历”。
- 当前仓库里同时存在 **产品愿景文档**、**可运行 MVP 实现**、**继续演进中的多端客户端** 三个层次。
- 现阶段最清晰、最完整的业务主线是：
  `Markdown 简历输入 -> 简历分析 -> JD 匹配 -> 优化后简历生成`。
- 这条主线当前主要由 `backend/` 与 `frontend/Web/` 承担。
- `frontend/Taro/reffo-taro/` 已经具备更完整的产品化结构，但与当前后端接口的数据契约存在明显漂移，不能简单视为已完全打通。

## 2. 仓库结构认知

```text
reffo/
├── backend/                    # Bun + Elysia 后端，MVP 主服务
├── frontend/Web/              # React + Vite 的 Web MVP
├── frontend/Taro/reffo-taro/  # Taro 多端客户端（产品化方向）
├── .kiro/specs/               # PRD、技术设计、MVP 需求文档
└── README.md                  # 根说明文档
```

### 2.1 各目录定位

| 目录 | 当前定位 | 说明 |
| --- | --- | --- |
| `backend/` | 已成形的 MVP 后端 | 提供 `/process`、`/analyze`、`/health` 等接口，串联 3 个 AI Agent |
| `frontend/Web/` | 最短可验证链路 | 单页 Web MVP，直接对接当前后端接口 |
| `frontend/Taro/reffo-taro/` | 下一阶段客户端雏形 | 页面、状态管理、历史记录、API Client 已搭好，但与后端返回结构未完全对齐 |
| `.kiro/specs/reffo/` | 产品与技术愿景 | 描述长期目标、模块设计、数据库、安全、部署等 |
| `.kiro/specs/mvp/` | MVP 范围定义 | 明确当前优先跑通的仅是“输入简历/JD/输出优化简历” |

## 3. 产品与需求层认知

### 3.1 产品定位

根据 `/.kiro/specs/reffo/requirements.md`：

- 产品名称：`Reffo`
- 核心定位：基于 AI Agent 架构，为用户生成针对目标岗位的最佳简历
- 核心用户：社招职场人士为主，应届生为辅

### 3.2 当前 MVP 范围

根据 `/.kiro/specs/mvp/requirement.md`，当前 MVP 明确收敛为：

1. 输入 Markdown 格式简历
2. Agent 1 分析简历并输出分析结果
3. 输入 JD
4. Agent 2 分析简历与 JD 的匹配度
5. Agent 3 基于匹配结果重排并优化简历
6. 页面展示优化后的 Markdown 简历

当前有意忽略的功能：

- 登录
- 数据库
- 页面美观度
- 更复杂的文件上传与解析链路

## 4. 技术架构认知

### 4.1 愿景架构 vs 当前实现

技术方案文档 `/.kiro/specs/reffo/technical-design.md` 描绘的是完整平台架构：

- Client（Web / Mobile）
- API Gateway
- 应用服务层
- AI Agent 层
- LLM Provider 层
- 数据存储层

但**当前代码实现是一个缩小版 MVP**，特点如下：

- 没有数据库
- 没有认证鉴权
- 没有任务队列
- 没有文件上传解析服务
- 没有真正的 Agent 编排框架
- 只有同步请求式的 3 段 AI 调用

所以更准确地说，当前项目不是“完整平台”，而是“围绕核心价值路径搭出的 MVP 骨架”。

### 4.2 当前实际系统图

```text
Web MVP / Taro Client
        |
        v
 Elysia Backend (`backend/`)
        |
        v
ResumeAnalyzerAgent
        -> MatchingAgent
        -> ResumeGeneratorAgent
        |
        v
OpenAI SDK 兼容接口（默认 DeepSeek）
```

## 5. 后端认知

### 5.1 技术栈

- 运行时：`Bun`
- 服务框架：`Elysia`
- 语言：`TypeScript`
- AI SDK：`openai`
- 接口文档：`@elysiajs/swagger`
- CORS：`@elysiajs/cors`

关键文件：

- `backend/src/index.ts`
- `backend/src/routes/mvp.ts`
- `backend/src/agents/*.ts`
- `backend/src/types/index.ts`
- `backend/src/config/env.ts`

### 5.2 启动逻辑

后端入口在 `backend/src/index.ts`，启动顺序清晰：

1. 校验环境变量
2. 创建 Elysia 应用
3. 注册 Swagger
4. 注册 CORS
5. 设置全局错误处理
6. 注册根路由与 MVP 路由
7. 监听 `HOST:PORT`

### 5.3 核心接口

所有 MVP 接口都在 `backend/src/routes/mvp.ts`：

- `POST /api/v1/mvp/process`
  - 完整流程：简历分析 -> 匹配分析 -> 简历生成
- `POST /api/v1/mvp/analyze`
  - 仅分析简历
- `GET /api/v1/mvp/health`
  - 健康检查

### 5.4 三个 Agent 的职责划分

#### 1) `ResumeAnalyzerAgent`

文件：`backend/src/agents/resume-analyzer.ts`

职责：

- 读取 Markdown 简历文本
- 让大模型提取结构化简历信息
- 输出质量评分、优劣势、建议、能力总结

输出核心结构：

- `quality_score`
- `strengths`
- `weaknesses`
- `suggestions`
- `capability_summary`
- `structured_resume`

#### 2) `MatchingAgent`

文件：`backend/src/agents/matching-agent.ts`

职责：

- 解析 JD 文本
- 基于结构化简历分析岗位匹配度
- 输出硬性要求匹配、技能匹配、经验匹配等

输出核心结构：

- `match_score`
- `hard_requirements_match`
- `skill_match.matched`
- `skill_match.missing`
- `experience_match`
- `soft_skills_match`
- `strengths`
- `weaknesses`
- `jd_structure`

#### 3) `ResumeGeneratorAgent`

文件：`backend/src/agents/resume-generator.ts`

职责：

- 结合原始简历结构、JD 结构和匹配分析
- 生成新的 Markdown 简历
- 强调真实性、针对性、量化表达和结构清晰

输出：

- 纯 Markdown 文本 `step3_optimized_resume`

### 5.5 对 Agent 设计的判断

当前这 3 个 Agent 更接近“**Prompt 驱动的职责切分**”，而不是“带工具链、状态机、记忆、自治决策能力”的重型 Agent 系统。

这类设计的优点：

- MVP 实现快
- 调试路径短
- 业务边界清晰

这类设计的局限：

- 强依赖 Prompt 输出稳定性
- 缺少严格 schema 校验与兜底转换
- 一旦模型输出漂移，前后端都容易受到影响

## 6. Web MVP 认知

### 6.1 技术栈

- `React 18`
- `TypeScript`
- `Vite`
- 纯 CSS

关键文件：

- `frontend/Web/src/App.tsx`
- `frontend/Web/src/main.tsx`
- `frontend/Web/vite.config.ts`

### 6.2 页面形态

Web MVP 几乎都集中在一个页面组件 `frontend/Web/src/App.tsx` 中：

- Step 1：输入简历
- Step 2：输入 JD
- Step 3：展示结果

页面状态完全在组件内维护：

- `step`
- `resumeMarkdown`
- `jdText`
- `loading`
- `error`
- `result`

### 6.3 与后端的连接方式

- 请求地址：`/api/v1/mvp/process`
- 代理配置：`frontend/Web/vite.config.ts`
- 本地开发时代理到：`http://localhost:3000`

### 6.4 存储策略

Web MVP 没有接数据库，而是使用 `localStorage` 保存：

- 简历内容
- JD 内容
- 最后一次处理结果

这与 MVP 范围定义是吻合的。

### 6.5 对 Web MVP 的判断

Web MVP 的特点是：

- 足够简单
- 与当前后端契合度高
- 是最适合继续验证后端主流程的前端入口

如果后续要优先做“跑通、调通、验通”，建议优先围绕 `frontend/Web/` 而不是 Taro 端展开。

## 7. Taro 多端客户端认知

### 7.1 当前结构成熟度

`frontend/Taro/reffo-taro/` 已经不是简单 demo，而是具备较强产品化意图：

- 页面拆分：首页 / 创建页 / 结果页
- 组件拆分：按钮、卡片、业务组件
- 状态管理：`Zustand`
- API Client：带请求适配器、重试、错误封装
- 本地历史记录：Store + Storage
- 测试文件：多个 `__tests__`

关键页面：

- `src/pages/index/index.tsx`
- `src/pages/create/index.tsx`
- `src/pages/result/index.tsx`

### 7.2 当前业务流

Taro 端大致设计为：

1. 首页查看历史 / 进入创建页
2. 创建页输入简历与 JD
3. 调用 `resumeApi.processResume()`
4. 结果写入本地历史记录
5. 跳转结果页展示

### 7.3 Taro 端的现实状态判断

虽然结构完整，但它当前更像“**先按未来产品模型设计了前端类型和页面**”，而不是已经严格按现有后端接口打通。

主要原因是：**前后端数据结构不一致**。

## 8. 关键数据契约认知

### 8.1 后端类型

后端主类型定义在 `backend/src/types/index.ts`。

其中匹配分析结果 `MatchAnalysis` 的关键结构是：

```ts
{
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
  jd_structure: JDStructure
}
```

### 8.2 Taro 端类型

Taro 端类型定义在 `frontend/Taro/reffo-taro/src/types/index.ts`。

其中 `MatchingResult` 结构是：

```ts
{
  match_score: number
  hard_requirements_match: HardRequirement[]
  skill_match: {
    matched_skills: string[]
    missing_skills: string[]
    match_percentage: number
  }
  experience_match: {
    years_required: number
    years_actual: number
    relevant_experience: string[]
    match_percentage: number
  }
  optimization_suggestions: string[]
}
```

### 8.3 漂移点总结

当前至少存在以下不一致：

| 维度 | 后端 | Taro | 影响 |
| --- | --- | --- | --- |
| 硬性要求匹配 | `Record<string, boolean>` | `HardRequirement[]` | 结果页与业务逻辑需转换 |
| 技能匹配字段名 | `matched/missing` | `matched_skills/missing_skills` | 直接读取会报错或为空 |
| 经验匹配 | `string` | 结构化对象 | 结果展示模型不一致 |
| 优化建议 | 后端无 `optimization_suggestions` | Taro 强依赖该字段 | `changes_summary` 拼装逻辑存在风险 |
| 结果总结构 | `step1/step2/step3` | `analysis/matching/optimized` | Taro 通过手动转换补齐 |

### 8.4 结论

如果后续要推进 Taro 端联调，必须先统一：

- 后端接口 schema
- 前端类型定义
- 历史记录存储结构
- 结果页展示字段

否则会持续出现“页面结构很完整，但数据一接就碎”的情况。

## 9. 环境与运行认知

### 9.1 环境要求

- 根目录 `.nvmrc` 指向 Node：`22.19.0`
- 后端运行时：`Bun`
- Web 端目前有 `pnpm-lock.yaml`，但 README 里也写了 `bun install`

可以看出当前项目在运行时与包管理器上存在一定混用：

- Node 22
- Bun
- pnpm

### 9.2 AI 配置

后端环境变量位于：`backend/.env.example`

关键配置：

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `AI_MODEL`
- `PORT`
- `HOST`
- `CORS_ORIGIN`

默认模型配置偏向 DeepSeek：

- `OPENAI_BASE_URL=https://api.deepseek.com`
- `AI_MODEL=deepseek-chat`

### 9.3 文档与实际的轻微偏差

根 README 的一键启动说明写的是：

```bash
cd frontend
bun install
bun run dev
```

但从实际目录看，真正的 Web 项目在：

- `frontend/Web/`

因此这部分文档后续建议修正。

## 10. 当前项目的强项

- **主业务链路聚焦明确**：先把最核心的简历优化路径跑起来
- **后端边界干净**：3 个 Agent 职责清楚，路由简单
- **Web MVP 够轻**：便于验证 prompt、接口、交互闭环
- **Taro 端扩展性不错**：已有 store、api、history、tests 等基础设施
- **需求文档充分**：长期目标和短期 MVP 的界线较清晰

## 11. 当前项目的主要风险与问题

### 11.1 第一类：接口契约风险

这是当前最重要的问题。

表现：

- 后端返回结构与 Taro 前端类型不一致
- 某些字段名只存在于一侧实现
- 页面与工具函数依赖了并不存在的字段

影响：

- Taro 结果页可能无法稳定展示真实后端数据
- 历史记录生成逻辑可能基于错误字段运行
- 后续联调成本会继续抬高

### 11.2 第二类：文档与目录偏差

表现：

- 根 README 的前端启动路径不准确
- 顶层说明把前端写成单一目录，但实际存在 `Web` 与 `Taro` 两套实现

影响：

- 新加入的人会先被目录结构误导

### 11.3 第三类：技术栈混用

表现：

- Node / Bun / pnpm 并存
- 不同子项目对运行方式的假设不同

影响：

- 环境初始化容易出现“能装不能跑”或“文档说法不一致”

### 11.4 第四类：AI 输出稳定性风险

表现：

- 后端主要依赖 Prompt + `JSON.parse()`
- 目前未见更强的 schema 校验、字段补齐、容错转换层

影响：

- 模型输出只要有轻微漂移，就可能造成接口不稳定

## 12. 现阶段建议的认知模型

为了便于团队后续讨论，建议统一使用下面这套认知：

### 12.1 关于项目阶段

不要把当前项目理解为“完整产品已完成”，而应理解为：

- **愿景已定义**
- **MVP 主链路已初步落地**
- **多端产品化仍在演进中**

### 12.2 关于协作重心

如果目标是“尽快验证功能正确性”，优先级建议为：

1. 先稳定 `backend/`
2. 再稳定 `frontend/Web/`
3. 最后统一 `frontend/Taro/reffo-taro/` 的类型与交互契约

### 12.3 关于后续开发策略

建议把后续工作拆成两条主线：

- **主线 A：MVP 可用性**
  - 跑通后端
  - 跑通 Web
  - 修文档
  - 加最小必要验证

- **主线 B：产品化演进**
  - 统一后端 schema
  - 适配 Taro 类型
  - 再逐步补登录、存储、上传、导出等能力

## 13. 建议的下一步动作

按投入产出比排序，我建议后续优先做这几件事：

1. **修正 README 启动说明**
   - 明确 `frontend/Web/` 才是当前 Web MVP 入口

2. **补一份“启动与联调说明”文档**
   - 明确后端、Web、Taro 分别怎么跑
   - 明确谁是当前主验证链路

3. **统一后端与 Taro 的数据契约**
   - 先确定以后端 schema 为准，还是以前端展示模型为准
   - 增加一层显式转换，不要靠页面临时拼装

4. **给后端 AI 输出增加更强校验**
   - 至少在接口层补容错与字段标准化

5. **实际跑一次本地闭环**
   - 启动 `backend`
   - 启动 `frontend/Web`
   - 用样例简历和 JD 验证整条链路

## 14. 本文档适用范围

本文适合用于：

- 新成员快速了解仓库
- 开发前统一当前项目阶段认知
- 讨论“先修哪里、后做哪里”时作为上下文参考

本文暂不覆盖：

- 真实运行结果
- 性能数据
- 线上部署状态
- AI 效果评估报告

## 15. 关键文件索引

### 产品与设计

- `README.md`
- `.kiro/specs/reffo/requirements.md`
- `.kiro/specs/reffo/technical-design.md`
- `.kiro/specs/mvp/requirement.md`

### 后端

- `backend/src/index.ts`
- `backend/src/routes/mvp.ts`
- `backend/src/agents/resume-analyzer.ts`
- `backend/src/agents/matching-agent.ts`
- `backend/src/agents/resume-generator.ts`
- `backend/src/types/index.ts`
- `backend/src/config/env.ts`
- `backend/src/test.ts`

### Web MVP

- `frontend/Web/src/App.tsx`
- `frontend/Web/src/main.tsx`
- `frontend/Web/vite.config.ts`

### Taro 客户端

- `frontend/Taro/reffo-taro/src/app.config.ts`
- `frontend/Taro/reffo-taro/src/pages/index/index.tsx`
- `frontend/Taro/reffo-taro/src/pages/create/index.tsx`
- `frontend/Taro/reffo-taro/src/pages/result/index.tsx`
- `frontend/Taro/reffo-taro/src/services/api.ts`
- `frontend/Taro/reffo-taro/src/services/resume.ts`
- `frontend/Taro/reffo-taro/src/types/index.ts`
- `frontend/Taro/reffo-taro/src/utils/history-helper.ts`

