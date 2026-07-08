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
  以进程内事件总线为核心，负责 trace、attempt、retry、schema validate、evaluation、provenance

agents
  只保留任务定义：prompt template、input schema、output schema、model policy

providers
  封装 DeepSeek / GLM-OCR / 后续 Qwen / Kimi 等外部服务

repositories
  保存 runs、steps、attempts、artifacts、evaluations
```

### Harness 事件总线设计

Harness 层建议做成事件总线，但第一版不要直接上外部 MQ。推荐先实现**强类型、进程内、同步优先**的 domain event bus，让 workflow 和 step runner 只发布事件，trace、持久化、日志、evaluation、指标统计通过 subscriber 消费事件。

这样做的好处：

- workflow 主链路不需要直接耦合日志、数据库、指标和 evaluator。
- 每个 step 的生命周期天然可观测，后续接 OpenTelemetry、队列或 dashboard 时只需要新增 subscriber。
- retry、repair、partial result、失败恢复都可以通过事件序列复盘。
- 测试时可以用 fake event bus 捕获事件，断言编排行为而不是依赖真实 LLM。

第一版事件总线边界：

- 使用 in-process event bus，不引入 Redis、Kafka、RabbitMQ 等外部依赖。
- 同步发布关键状态事件，避免异步 subscriber 把主流程成功/失败语义变复杂。
- subscriber 失败不能吞掉 step 失败，但持久化 subscriber 失败应让 run 进入可诊断错误状态。
- 事件 payload 默认只带摘要、digest、artifactId、错误码，不带完整简历、完整 JD、API Key 或完整 prompt。
- 事件命名和 payload 必须版本化，避免后续 replay 或 dashboard 读取历史事件时失真。

推荐事件流：

```text
workflow.started
  step.started
    attempt.started
    provider.requested
    provider.responded
    output.parsed
    output.validated
    evaluation.completed
    attempt.succeeded / attempt.failed
  step.succeeded / step.failed / step.partial
workflow.succeeded / workflow.failed / workflow.partial
```

事件总线不替代业务返回值。workflow 仍然用显式 return 组合最终响应，event bus 只负责旁路记录、观察、评估和可回放材料。

### 推荐目录结构

```text
backend/src/
├── workflows/
│   └── resume-optimization-workflow.ts
├── harness/
│   ├── runner.ts
│   ├── step.ts
│   ├── event-bus.ts
│   ├── events.ts
│   ├── subscribers/
│   │   ├── trace-subscriber.ts
│   │   ├── persistence-subscriber.ts
│   │   └── log-subscriber.ts
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
  providerRequestId?: string
  finishReason?: string
  inputTokens?: number
  outputTokens?: number
  latencyMs: number
  rawOutputDigest?: string
  parsedOutputDigest?: string
  isRepairAttempt?: boolean
  retryReason?: string
  status: 'succeeded' | 'failed'
  errorCode?: string
  errorMessage?: string
}
```

### HarnessEvent

```ts
type HarnessEventType =
  | 'workflow.started'
  | 'workflow.succeeded'
  | 'workflow.failed'
  | 'workflow.partial'
  | 'step.started'
  | 'step.succeeded'
  | 'step.failed'
  | 'step.partial'
  | 'attempt.started'
  | 'attempt.succeeded'
  | 'attempt.failed'
  | 'provider.requested'
  | 'provider.responded'
  | 'output.parsed'
  | 'output.validated'
  | 'evaluation.completed'

interface HarnessEvent<TPayload = Record<string, unknown>> {
  id: string
  type: HarnessEventType
  version: 1
  runId: string
  stepRunId?: string
  attemptId?: string
  occurredAt: string
  payload: TPayload
}
```

事件表可以作为 replay 的最小事实来源，但第一版不要求所有业务 artifact 都从事件重建；业务状态仍以 `process_runs`、`step_runs`、`step_attempts` 为准。

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

第一版 artifact 存储策略要保守：默认只保存 `contentDigest`、摘要、字段级 redaction 后的 JSON 或 markdown 片段；完整源简历、完整 JD、完整 prompt、完整 raw output 只能通过本地 debug 开关或加密存储开启。

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
- provider 返回空内容或 finish reason 异常。
- 连接中断、DNS、TLS 等传输层错误。

### 可修复输出错误

- JSON 解析失败。
- schema 校验失败但原始输出可用于修复。
- 输出缺少非关键字段。

这类错误不建议直接重新推理业务内容，而应进入 output repair loop：只修复格式、字段名、缺失的可推断结构，不重新生成新的业务判断，避免同一个 attempt 失败后得到语义不同的分析结果。

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

建议区分两类策略：

- `transportRetry`: 只处理网络、限流、5xx、空响应等 provider/传输错误。
- `outputRepair`: 只处理 JSON parse、schema validate、非关键字段缺失等输出格式错误。

两者都应通过事件总线发布 `attempt.failed`、`attempt.started`、`output.validated` 等事件，并在 `StepAttempt.retryReason` / `StepAttempt.isRepairAttempt` 中留下原因。

### 超时与取消

每个 workflow 和 step 都应该支持 `AbortSignal`：

- workflow 级 timeout 控制整次 `/process` 最长执行时间。
- step 级 timeout 控制单个 provider 调用和 evaluator 调用。
- 用户取消请求时，后续 step 不再启动，当前 step 尽量中断 provider 请求。
- 取消类错误记录为 `cancelled` 或特定 `errorCode`，不要和 provider failure 混在一起。

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
- `workflowVersion`
- `promptVersion`
- `latencyMs`
- `inputTokens`
- `outputTokens`
- `finishReason`
- `status`
- `errorCode`
- `retryReason`
- `repairCount`
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

运行时 schema 建议放在 `backend/src/schemas/`，再从 schema 推导 TypeScript 类型，避免 `backend/src/types/` 的 interface 和运行时校验规则双写后漂移。

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

## API 兼容与第一版边界

Harness 化第一版必须保持现有 MVP API 兼容，尤其是 `/api/v1/mvp/process` 当前返回给前端的：

- `step1_analysis`
- `step2_matching`
- `step3_optimized_resume`
- `step4_interview_suggestions`

第一版只建议在 `data` 中追加：

- `run_id`
- `workflow_status`
- `step_statuses`

不要第一版就把响应改成纯 run 查询模型。这样前端可以继续按现有逻辑验证产品，同时服务端逐步沉淀 Harness 运行时能力。

第一版目标应收敛为：

- 路由瘦身：把流程编排迁移到 `ResumeOptimizationWorkflow`。
- 调用统一：所有 Agent 通过 provider 调用模型。
- 事件可观测：通过 in-process event bus 记录 run / step / attempt 生命周期。
- 输出可校验：对 JSON 输出做 schema validate 和 repair。
- 结果可追踪：返回 `run_id`，并保存 step 状态和摘要级 artifact。

## 分阶段实施路线

### 第 0 阶段：基础设施收口

- [x] 新增 `backend/src/repositories/database.ts`，统一 SQLite 连接和建表入口。
- [x] 增加轻量 schema version 或 migration 机制，避免后续表结构演进失控。
- [x] 新增结构化 logger，默认只输出摘要、digest、状态和错误码。
- [x] 为请求生成 `requestId`，并贯穿 workflow、event bus、provider 调用。

### 第 1 阶段：Provider 与 Workflow 收口

- [x] 新增 `LlmProvider`，统一 DeepSeek 调用。
- [x] 所有 Agent 不再直接 new OpenAI client。
- [x] 把 `/process` 中的串行逻辑迁移到 `ResumeOptimizationWorkflow`。
- [x] 保持现有 API 响应兼容，只追加 `run_id`、`workflow_status`、`step_statuses`。
- [x] 增加 requestId / runId / stepName。
- [x] 记录耗时、模型、tokens、错误码。
- [x] 增加 workflow timeout、step timeout 和取消语义。

### 第 2 阶段：事件总线与运行时可观测

- [x] 新增 `backend/src/harness/event-bus.ts` 和 `backend/src/harness/events.ts`。
- [x] `runStep` 发布 workflow / step / attempt / provider / output / evaluation 生命周期事件。
- [x] 新增 `trace-subscriber`，生成本地 trace 结构。
- [x] 新增 `log-subscriber`，输出结构化日志。
- [x] 新增 fake event bus，用于 workflow 单测断言事件序列。

### 第 3 阶段：Schema 与 Output Repair

- [x] 引入运行时 schema 校验，优先考虑 `zod`。
- [x] 为 `ResumeAnalysis` 增加 schema，并从 schema 推导类型。
- [x] 为 `MatchAnalysis` 增加 schema，并从 schema 推导类型。
- [x] 为 `InterviewSuggestions` 增加 schema，并从 schema 推导类型。
- [x] 增加 JSON parse error / schema error 分类。
- [x] 增加 output repair loop，并区分 `transportRetry` 和 `outputRepair`。
- [x] 为 Markdown 简历增加第一版规则 evaluator。

### 第 4 阶段：运行时持久化

- [x] 新增 `process_runs` 表。
- [x] 新增 `step_runs` 表。
- [x] 新增 `step_attempts` 表。
- [x] 新增 `harness_events` 表，用于保存事件流和后续 replay。
- [x] 新增 `artifacts` 表。
- [x] 新增 `evaluations` 表。
- [x] 新增 `persistence-subscriber`，从事件总线消费事件并写入 SQLite。
- [x] 默认只保存 digest、摘要和 redacted artifact。
- [x] 支持按 `runId` 查询执行状态与历史结果。

### 第 5 阶段：Workflow 能力增强

- [x] 拆出独立 `parse_jd` step。
- [x] 增加 `validate_resume` step。
- [x] 支持 partial result 和可恢复失败。
- [x] 支持 provider fallback。
- [x] 支持 LLM judge 作为可选异步 evaluator，不默认阻塞主链路。

### 第 6 阶段：Harness 工程增强

- [x] 支持 prompt A/B 版本。
- [x] 支持 replay 某一次 run。
- [x] 支持基于历史 run 的 regression dataset。
- [x] 支持质量指标 dashboard。
- [x] 支持线上失败样本回流到测试集。

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

- [x] 新增 `backend/src/repositories/database.ts`，统一 SQLite 连接、建表和 schema version。
- [x] 新增 `backend/src/workflows/resume-optimization-workflow.ts`，承接 `/process` 编排逻辑。
- [x] 新增 `backend/src/providers/deepseek-provider.ts`，集中 LLM 调用。
- [x] 新增 `backend/src/providers/llm-provider.ts`，定义 `ChatModelProvider` / `StructuredOutputProvider` 接口。
- [x] 新增 `backend/src/harness/event-bus.ts` 和 `backend/src/harness/events.ts`，实现强类型进程内事件总线。
- [x] 新增 `backend/src/harness/run-context.ts`，生成 `requestId`、`runId`、`stepId`。
- [x] 新增 `backend/src/harness/run-step.ts`，包装 step 执行、耗时、错误、事件发布和超时取消。
- [x] 新增 `backend/src/harness/json-output.ts`，封装 JSON parse、schema validate、repair 入口。
- [x] 新增 `backend/src/schemas/`，为 `ResumeAnalysis`、`MatchAnalysis`、`InterviewSuggestions` 提供 zod schema。
- [x] 新增第一版 `trace-subscriber` 和 `log-subscriber`，先实现本地可观测闭环。
- [x] 新增 SQLite 表保存 run / step / attempt / event，artifact 默认只保存 digest 和摘要。
- [x] 改造 `ResumeAnalyzerAgent` 使用 provider 和 schema。
- [x] 改造 `MatchingAgent` 使用 provider 和 schema。
- [x] 改造 `ResumeGeneratorAgent` 增加 Markdown evaluator。
- [x] `/api/v1/mvp/process` 保持现有响应字段，同时追加 `run_id`、`workflow_status`、`step_statuses`。

## 重要提醒

- 本地 `backend/.env` 包含真实 API Key，虽然已被 `.gitignore` 忽略，但不要在日志、文档、commit 或错误输出中泄露。
- Harness 持久化要默认保存摘要和 digest，不要默认明文保存完整简历；如果需要保存完整 artifact，应设计加密或可配置开关。
- 事件总线 payload 默认不携带完整 prompt、完整简历、完整 JD、完整 raw output；需要 debug 时必须显式开启本地开关。
- 第一版不要引入外部 MQ 或后台 worker，先用进程内 event bus 验证事件模型和 subscriber 边界。
- 现有 MVP API 响应必须保持兼容，避免 Harness 改造阻断前端验证。
- 简历生成的第一优先级不是“更像 AI 写得好”，而是“可追溯、不编造、可验证、可回放”。
