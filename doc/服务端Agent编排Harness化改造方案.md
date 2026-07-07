# 服务端 Agent 编排 Harness 化改造方案

## 背景

当前 Reffo 后端的 Agent 编排仍处在 MVP 裸调用阶段：路由层串行调用多个 Agent，每个 Agent 内部直接拼 prompt、请求 LLM API、解析 JSON 或返回 Markdown。这个实现能跑通 Demo，但距离稳定的 Context 工程仍有差距，更达不到目标中的 Harness 工程。

目标不是简单“把 prompt 写长一点”，而是让服务端具备可观测、可溯源、可恢复、可评估、可回放、可迭代的 Agent Harness。

## 当前实现现状

| 能力点 | 当前状态 | 代码位置 |
|---|---|---|
| 流程编排 | `/process` 中手写串行调用 4 个 Agent | `backend/src/routes/mvp.ts:17` |
| Agent 调用 | 每个 Agent 内部直接 new OpenAI client 并调用 chat completions | `backend/src/agents/resume-analyzer.ts:79`、`backend/src/agents/matching-agent.ts:104`、`backend/src/agents/resume-generator.ts:153`、`backend/src/agents/interview-advisor.ts:59` |
| Prompt 管理 | prompt 写在 class 方法内，和调用逻辑耦合 | `backend/src/agents/*.ts` |
| 结构化输出 | 只依赖 `response_format: json_object` 和 `JSON.parse` | `backend/src/agents/resume-analyzer.ts:82`、`backend/src/agents/matching-agent.ts:107` |
| 结果校验 | TypeScript 断言，没有运行时 schema 校验 | `backend/src/agents/resume-analyzer.ts:91`、`backend/src/agents/matching-agent.ts:116` |
| 重试机制 | 无重试、无退避、无可恢复错误分类 | `backend/src/agents/*.ts` |
| 可观测性 | 只有 `console.log`，没有 trace、span、tokens、耗时、requestId | `backend/src/routes/mvp.ts:23` |
| 溯源记录 | 不保存 prompt、输入摘要、模型、输出、版本、依赖关系 | 当前无对应表或仓储 |
| 结果判断 | 没有质量门禁、事实一致性检查、结构完整性评分 | 当前无 evaluator |
| 持久化 | 只有源简历 SQLite 表 | `backend/src/repositories/source-resume-repository.ts:19` |

## 关键问题判断

### 1. 现在不是 Harness，只是 Prompt Chain

当前 `/api/v1/mvp/process` 是典型的 prompt chain：

```text
resume_markdown
  ↓
ResumeAnalyzerAgent
  ↓
MatchingAgent
  ↓
ResumeGeneratorAgent
  ↓
InterviewAdvisorAgent
  ↓
一次性响应前端
```

它缺少 Harness 应有的运行时设施：

- 没有统一 Run / Step / Attempt 模型。
- 没有 traceId / runId / stepId。
- 没有 prompt 版本和输入快照。
- 没有输出 schema 校验和修复循环。
- 没有 evaluator 判断结果是否可用。
- 没有 retry / fallback / compensation。
- 没有可回放的完整执行记录。

### 2. 现在也达不到严格 Context 工程

Context 工程不只是“把上一阶段输出塞进下一阶段 prompt”。当前代码的问题：

- Context 没有结构化分层，例如 source facts、JD facts、matching facts、generation constraints。
- Context 没有来源标记，无法知道某条优化建议来自原简历、JD、模型推断还是用户输入。
- Context 没有压缩、筛选和冲突处理策略。
- Context 没有隐私字段策略，例如联系方式、邮箱、手机号在日志和 prompt 中如何处理。
- Context 没有版本化，无法复现同一次生成。

### 3. 最大风险是“看起来成功，实际不可用”

当前只要 LLM 返回了非空内容并能 `JSON.parse`，服务端就认为成功。这会导致：

- 结构字段缺失但仍进入下一步。
- 模型编造经历但没有检测。
- 匹配分数异常但没有校验。
- 生成简历缺少关键章节但仍返回成功。
- 某一步失败后整个流程中断，没有部分结果和恢复能力。

## Harness 工程目标

Reffo 的 Harness 层应该把每次生成流程建模成可追踪的运行单元。

```text
ProcessRun
  ├─ StepRun: parse_resume
  │   ├─ Attempt 1
  │   └─ Evaluations
  ├─ StepRun: analyze_resume
  │   ├─ Attempt 1
  │   ├─ Attempt 2（可选重试）
  │   └─ Evaluations
  ├─ StepRun: parse_jd
  ├─ StepRun: match_resume_to_jd
  ├─ StepRun: generate_resume
  ├─ StepRun: validate_resume
  └─ StepRun: generate_interview_advice
```

每个 step 都应该有：

- 输入：结构化输入、输入摘要、敏感字段策略。
- Prompt：模板版本、变量、最终 prompt 摘要或加密存储。
- Model Call：provider、model、temperature、response format、tokens、耗时。
- 输出：原始输出、解析后输出、schema 校验结果。
- 评估：规则检查、LLM judge、事实一致性、质量评分。
- 失败处理：重试、修复 prompt、fallback、人工可恢复错误。

## 推荐架构

### 总体分层

```text
routes
  只负责请求校验、认证、响应格式

application / workflows
  负责编排 ProcessRun 和 StepRun

harness
  负责 trace、attempt、retry、schema validate、evaluation、provenance

agents
  只保留任务定义：prompt template、input schema、output schema、model policy

providers
  封装 DeepSeek / GLM-OCR / 后续 Qwen / Kimi 等外部服务

repositories
  保存 runs、steps、attempts、artifacts、evaluations
```

### 推荐目录结构

```text
backend/src/
├── workflows/
│   └── resume-optimization-workflow.ts
├── harness/
│   ├── runner.ts
│   ├── step.ts
│   ├── retry.ts
│   ├── trace.ts
│   ├── artifact.ts
│   ├── evaluator.ts
│   └── schemas.ts
├── providers/
│   ├── llm-provider.ts
│   ├── deepseek-provider.ts
│   └── glm-ocr-provider.ts
├── agents/
│   ├── resume-analyzer.agent.ts
│   ├── jd-parser.agent.ts
│   ├── matching.agent.ts
│   ├── resume-generator.agent.ts
│   └── interview-advisor.agent.ts
├── repositories/
│   ├── process-run-repository.ts
│   ├── step-run-repository.ts
│   └── artifact-repository.ts
└── routes/
    ├── parse.ts
    └── mvp.ts
```

## 核心数据模型

### ProcessRun

```ts
interface ProcessRun {
  id: string
  userId?: string
  workflowName: 'resume_optimization'
  workflowVersion: string
  status: 'running' | 'succeeded' | 'failed' | 'partial'
  inputDigest: string
  startedAt: string
  finishedAt?: string
  errorCode?: string
  errorMessage?: string
}
```

### StepRun

```ts
interface StepRun {
  id: string
  runId: string
  stepName:
    | 'parse_resume'
    | 'analyze_resume'
    | 'parse_jd'
    | 'match_resume_to_jd'
    | 'generate_resume'
    | 'validate_resume'
    | 'generate_interview_advice'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
  inputArtifactId?: string
  outputArtifactId?: string
  startedAt?: string
  finishedAt?: string
}
```

### Attempt

```ts
interface StepAttempt {
  id: string
  stepRunId: string
  attemptNumber: number
  provider: 'deepseek' | 'glm-ocr'
  model: string
  promptVersion?: string
  temperature?: number
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
  status: 'succeeded' | 'failed'
  errorCode?: string
  errorMessage?: string
}
```

### Artifact

```ts
interface Artifact {
  id: string
  runId: string
  stepRunId?: string
  type:
    | 'source_resume'
    | 'parsed_resume'
    | 'jd_text'
    | 'parsed_jd'
    | 'resume_analysis'
    | 'match_analysis'
    | 'optimized_resume'
    | 'evaluation_report'
  contentType: 'text/markdown' | 'application/json' | 'text/plain'
  contentDigest: string
  storageRef: string
  redactionPolicy: 'none' | 'pii_redacted' | 'encrypted'
  createdAt: string
}
```

### Evaluation

```ts
interface StepEvaluation {
  id: string
  stepRunId: string
  evaluatorName: string
  evaluatorVersion: string
  passed: boolean
  score?: number
  issues: Array<{
    severity: 'info' | 'warning' | 'error'
    code: string
    message: string
    path?: string
  }>
}
```

## 每个 Step 应增加的判断

| Step | 当前行为 | 应增加的 Harness 能力 |
|---|---|---|
| parse_resume | 当前前端只读文本，PDF 计划接 GLM-OCR | 文件类型校验、OCR trace、解析质量检查、文本长度检查 |
| analyze_resume | LLM 返回 JSON 后直接 parse | schema 校验、字段完整性评分、经历事实提取、敏感字段标记 |
| parse_jd | 当前由 matching prompt 顺带解析 | 独立 JD parser，输出 JD facts，避免 matching step 一次做太多事 |
| match_resume_to_jd | LLM 同时解析 JD 和匹配 | 只消费结构化 ResumeFacts + JDFacts，输出可解释匹配矩阵 |
| generate_resume | 直接返回 Markdown | 章节完整性检查、事实一致性检查、JD 覆盖率检查、禁编造检查 |
| validate_resume | 当前没有 | 新增规则 evaluator + 可选 LLM judge |
| generate_interview_advice | LLM 返回 JSON 后直接 parse | schema 校验、建议必须引用优化简历片段 |

## 重试与修复策略

### 可重试错误

- 网络超时。
- 429 / 限流。
- 5xx provider 错误。
- JSON 解析失败。
- schema 校验失败但原始输出可用于修复。
- 输出缺少非关键字段。

### 不应重试错误

- API Key 错误。
- 文件类型不支持。
- 输入过短或明显无效。
- 用户取消请求。
- OCR 供应商明确返回不可解析文件。

### 推荐 retry policy

```ts
interface RetryPolicy {
  maxAttempts: 3
  baseDelayMs: 500
  maxDelayMs: 5000
  backoff: 'exponential'
  jitter: true
}
```

### 输出修复循环

```text
LLM 输出
  ↓
JSON.parse 失败 / schema 失败
  ↓
repair prompt：只修复格式，不重新推理业务内容
  ↓
再次 schema validate
  ↓
仍失败则标记 step failed，并保留原始输出 artifact
```

## 结果评估建议

### 规则评估

先做便宜稳定的规则 evaluator：

- `quality_score` 必须在 0–100。
- `match_score` 必须在 0–100。
- `structured_resume.experience` 至少 1 条。
- `structured_resume.skills.hard_skills` 不应为空。
- 优化简历必须包含工作经历和技能清单。
- 优化简历不应包含模板占位词，例如 `XXX`、`公司名称`、`职位名称`。
- 优化简历中的公司、学校、项目名应来自源简历，除非标记为“建议补充”。

### LLM Judge 评估

在规则评估通过后，再用更贵的 LLM judge 判断：

- 是否忠于源简历，没有编造经历。
- 是否覆盖 JD 核心要求。
- 是否比源简历更清晰、更量化。
- 是否存在夸大或风险表达。
- 是否适合直接投递。

### 质量门禁

```text
规则检查失败：直接阻断或进入修复
LLM judge 低于阈值：返回 partial，并提示用户需手动确认
全部通过：返回 succeeded
```

## 可观测性最小闭环

第一阶段不一定要直接接 OpenTelemetry，可以先做本地 trace 表和结构化日志。

每次请求至少记录：

- `runId`
- `requestId`
- `stepName`
- `attemptNumber`
- `provider`
- `model`
- `latencyMs`
- `inputTokens`
- `outputTokens`
- `status`
- `errorCode`
- `inputDigest`
- `outputDigest`

日志不要输出完整简历、完整 JD、手机号、邮箱、API Key。

## Prompt 与上下文治理

### Prompt 版本化

不要继续把大 prompt 写在方法内部。建议拆为：

```text
backend/src/prompts/
├── resume-analyzer.v1.ts
├── jd-parser.v1.ts
├── matching.v1.ts
├── resume-generator.v1.ts
└── interview-advisor.v1.ts
```

每个 prompt 暴露：

```ts
export const prompt = {
  name: 'resume-analyzer',
  version: 'v1',
  render(input) {},
  inputSchema,
  outputSchema,
}
```

### Context 分层

推荐把上下文拆成 facts，而不是直接互相传整段模型输出：

```text
SourceResumeFacts
JDFacts
MatchFacts
GenerationConstraints
UserPreferences
ProvenanceMap
```

### Provenance Map

每个关键结论都应该能追溯来源：

```ts
interface ProvenanceItem {
  claim: string
  sourceType: 'resume' | 'jd' | 'user' | 'llm_inference'
  sourceArtifactId: string
  quote?: string
  confidence: number
}
```

这对于防止简历编造非常关键。

## 分阶段实施路线

### 第 1 阶段：LLM 调用包装层

- [ ] 新增 `LlmProvider`，统一 DeepSeek 调用。
- [ ] 所有 Agent 不再直接 new OpenAI client。
- [ ] 增加 requestId / runId / stepName。
- [ ] 记录耗时、模型、tokens、错误码。
- [ ] 增加 retry policy。
- [ ] 增加 JSON parse error 分类。

### 第 2 阶段：运行时持久化

- [ ] 新增 `process_runs` 表。
- [ ] 新增 `step_runs` 表。
- [ ] 新增 `step_attempts` 表。
- [ ] 新增 `artifacts` 表。
- [ ] 新增 `evaluations` 表。
- [ ] `/process` 响应中返回 `runId` 和 step 状态。

### 第 3 阶段：Schema 与 Evaluator

- [ ] 引入运行时 schema 校验，优先考虑 `zod`。
- [ ] 为 `ResumeAnalysis` 增加 schema。
- [ ] 为 `MatchAnalysis` 增加 schema。
- [ ] 为 `InterviewSuggestions` 增加 schema。
- [ ] 为 Markdown 简历增加规则 evaluator。
- [ ] 增加 output repair loop。

### 第 4 阶段：Workflow 化

- [ ] 把 `/process` 中的串行逻辑迁移到 `ResumeOptimizationWorkflow`。
- [ ] 拆出独立 `parse_jd` step。
- [ ] 增加 `validate_resume` step。
- [ ] 支持 partial result 和可恢复失败。
- [ ] 支持按 `runId` 查询执行状态与历史结果。

### 第 5 阶段：Harness 工程增强

- [ ] 支持 prompt A/B 版本。
- [ ] 支持 provider fallback。
- [ ] 支持 replay 某一次 run。
- [ ] 支持基于历史 run 的 regression dataset。
- [ ] 支持质量指标 dashboard。
- [ ] 支持线上失败样本回流到测试集。

## 和 GLM-OCR 的关系

GLM-OCR 不应作为孤立接口接入，而应作为 Harness 的一个 provider：

```text
parse_resume step
  provider: glm-ocr
  input: PDF
  output: ParsedResumeArtifact

parse_jd step
  provider: glm-ocr
  input: image
  output: ParsedJDArtifact
```

这样 OCR 的耗时、成本、失败率、输出质量都可以进入同一套 trace 和 evaluation 体系。

## 最小可执行 TODO

建议先做一版不重构过度的最小 Harness：

- [ ] 新增 `backend/src/providers/deepseek-provider.ts`，集中 LLM 调用。
- [ ] 新增 `backend/src/harness/run-context.ts`，生成 `runId`、`stepId`。
- [ ] 新增 `backend/src/harness/run-step.ts`，包装 step 执行、耗时、错误、重试。
- [ ] 新增 `backend/src/harness/json-output.ts`，封装 JSON parse、schema validate、repair 入口。
- [ ] 新增 SQLite 表保存 run / step / attempt。
- [ ] 改造 `ResumeAnalyzerAgent` 使用 provider 和 schema。
- [ ] 改造 `MatchingAgent` 使用 provider 和 schema。
- [ ] 改造 `ResumeGeneratorAgent` 增加 Markdown evaluator。
- [ ] `/api/v1/mvp/process` 返回 `runId`。

## 重要提醒

- 本地 `backend/.env` 包含真实 API Key，虽然已被 `.gitignore` 忽略，但不要在日志、文档、commit 或错误输出中泄露。
- Harness 持久化要默认保存摘要和 digest，不要默认明文保存完整简历；如果需要保存完整 artifact，应设计加密或可配置开关。
- 简历生成的第一优先级不是“更像 AI 写得好”，而是“可追溯、不编造、可验证、可回放”。
