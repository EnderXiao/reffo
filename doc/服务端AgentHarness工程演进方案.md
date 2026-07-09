# 服务端 Agent Harness 工程演进方案

## 背景

Reffo 后端已经完成了一版 Agent 编排 Harness 化改造：`ResumeOptimizationWorkflow` 负责串联简历分析、JD 解析、匹配分析、简历生成、规则校验、可选 LLM Judge 与面试建议；`harness` 模块负责 run / step / attempt 事件、trace、evaluation 与基础记录。

这套能力已经从“裸 prompt chain”升级为“可观测 workflow”。但当前 LLM 调用仍是单次 `complete()`，`runStep` 也只有一次 attempt；校验失败后流程只返回 `partial`，不会在同一次 run 内自动分析失败原因、修复输出、局部重跑和再次评估。

因此，当前 Harness 的定位更接近“工作流观测层”，还不是完整的“Agent 运行时 Harness”。本方案目标是在现有 workflow 和事件机制基础上，补齐 Agent Loop、运行时上下文账本、恢复策略、校验驱动修复、局部重跑和后续流式输出能力。

## 本文对 Harness 的定义

这里的 Harness 指 **Agent Harness 工程**，不是单纯的日志、数据库、dashboard 或离线评测平台。

它是包在 Agent 外层的一套运行时工程框架，负责让一次 AI 任务从“单次问答”升级为“可控执行过程”：

```text
input
  ↓
context assembly
  ↓
model / tool action
  ↓
parse / normalize
  ↓
evaluate / verify
  ↓
decide next action
  ├─ accept
  ├─ retry
  ├─ repair
  ├─ revise
  ├─ fallback
  └─ return partial / fail
```

Agent Harness 的核心不是“把事件落库”，而是在单次 run 中提供这些能力：

- **上下文管理**：明确当前 step 可见哪些输入、上游产物、约束、失败原因和评估结果。
- **执行账本**：记录本次 run 中每个 step、attempt、模型调用、工具调用和中间结果，供后续决策使用。
- **动作策略**：决定什么时候 retry、repair JSON、revise 简历、fallback model、跳过非关键 step 或返回 partial。
- **质量门禁**：把 schema、规则 evaluator、LLM Judge 和业务约束接入执行循环，而不是只在最后报错。
- **局部回溯**：在同一次 run 内回到上一个可修复节点，用新上下文重新执行某个 step。
- **结果收敛**：在预算、次数和质量阈值内，产出可用结果或明确给出不可恢复原因。

持久化、长期 replay、failure sample 和 dashboard 是 Agent Harness 的外围工程能力，不是第一阶段自愈 loop 的必要条件。

## OpenClaw Harness 思路借鉴

OpenClaw 的 Harness 不是从数据库或 dashboard 出发，而是从 **运行时控制** 出发。它的核心结构可以抽象为四层：

```text
Harness Contract
  ↓
Lifecycle Wrapper
  ↓
Run Loop
  ↓
Attempt Runtime
```

对应思路：

- **Harness Contract**：定义一个可执行单次 attempt 的统一接口，例如 `supports()`、`runAttempt()`，并允许按需扩展 `classify()`、`compact()`、`reset()` 等能力。
- **Lifecycle Wrapper**：包住一次 attempt，统一做 trace、diagnostic event、上下文能力检查、错误归因和结果分类。
- **Run Loop**：外层控制 `while` 循环，维护 budget、retry 次数、fallback 状态和下一轮 prompt override。
- **Attempt Runtime**：一次 attempt 内负责准备上下文、工具、模型调用、输出收集和 attempt result 组装。

最值得 Reffo 借鉴的不是插件化复杂度，而是这条链路：

```text
attempt result
  ↓
classify / evaluate
  ↓
decide next action
  ├─ accept
  ├─ retry same step
  ├─ repair structured output
  ├─ revise final output
  ├─ fallback model
  └─ partial / fail
```

Reffo 不需要实现 OpenClaw 那么完整，但应该把“生成结果后怎么收敛”做成 Harness 主职责，而不是散落在 workflow 或 agent 内部。

## 目标

### 一期目标

- 让关键 step 支持多 attempt 执行，而不是固定一次调用。
- 让 `validate_resume` 校验失败后自动触发 `revise_resume`，基于 evaluator issues 修复简历。
- 让 JSON 结构化输出失败、schema 校验失败和 provider 瞬时错误进入统一恢复策略。
- 引入运行时上下文账本，让同一次 run 内能回溯到可修复节点并局部重跑。
- 明确 Agent Harness 和持久化观测的边界，第一阶段不依赖新增数据库表。

### 非目标

- 不在一期引入 Redis、Kafka、Temporal、LangGraph 等外部编排依赖。
- 不把所有 Agent 改成复杂工具调用模式，先解决 Reffo 当前简历优化链路的稳定性。
- 不把长期 replay、failure sample 数据集、dashboard 作为一期必做项。
- 不默认保存完整原始简历、JD、prompt 和模型输出；如果后续要持久化，必须先通过脱敏、摘要或加密存储策略。
- 不把流式输出作为第一优先级。流式主要改善前端体验和 token 级 trace，不是自愈能力的前置条件。

## 当前能力盘点

| 能力 | 当前状态 | 判断 |
|---|---|---|
| Workflow 编排 | `ResumeOptimizationWorkflow` 串行执行多个 step | 已具备基础编排 |
| Run / Step / Attempt | 有数据模型和事件，但每个 step 固定 attempt 1 | 需要扩展多 attempt |
| Provider 调用 | `LlmProvider.complete()` 单次返回完整结果 | 可继续保留，后续补 stream |
| JSON 修复 | 部分 Agent 在 `parseJsonOutput` 中支持 repair prompt | 只覆盖结构修复，不覆盖业务质量修复 |
| 规则评估 | `evaluateMarkdownResume` 检查章节、长度、占位符等 | 可作为修复 Loop 的触发器 |
| LLM Judge | 可选异步执行，不阻塞主链路 | 可升级为质量门禁或辅助诊断 |
| 运行时上下文 | 上游 step 结果通过局部变量传递 | 缺少统一 runtime state 和中间产物账本 |
| 局部回溯 | 校验失败后直接 partial | 缺少同一次 run 内的 revise / re-evaluate loop |
| 持久化记录 | 主要保存 digest、summary、evaluation | 可作为观测增强，但不是一期自愈前提 |

## 核心判断

Harness 的价值不取决于是否流式，而取决于它是否能把一次 AI 任务变成可控、可恢复、可回溯、可评估、可收敛的工程单元。

当前最关键的缺口有三个：

1. **没有 Agent Loop**：校验失败后只记录错误，不会反思、修复或再次执行。
2. **没有运行时上下文账本**：每个 step 的输入、输出、失败原因、评估结果没有统一沉淀到本次 run 的决策上下文中。
3. **没有可恢复策略抽象**：provider 错误、JSON 解析失败、schema 失败、业务质量失败都被混在普通异常里。

## 持久化边界

自愈型 Harness 不要求所有能力都落库。需要区分两类状态：

| 状态类型 | 生命周期 | 是否必须落库 | 说明 |
|---|---|---|---|
| Run Runtime State | 单次请求内 | 否 | 当前 run 的上下文、step 输出、attempt 记录、evaluation、recovery plan 可以全部保存在内存中 |
| Durable Trace State | 请求结束后 | 可选 | 用于 dashboard、审计、线上排障、跨进程 replay、失败样本回归 |

一期核心目标是让一次 run 在运行时完成“生成 → 校验 → 诊断 → 修复 → 再校验”的闭环，因此完全可以先用内存态完成，不需要新增数据库表。

只有当系统需要支持以下能力时，才需要持久化扩展：

- 请求结束后继续查看完整 run 诊断信息。
- 服务重启后仍能回放历史失败样本。
- 将失败样本沉淀为长期回归数据集。
- 多实例部署下跨进程追踪异步 LLM Judge 或后台 replay。
- 面向产品、运营或质量看板统计长期质量趋势。

因此，本方案后文的持久化扩展属于“可选增强”，不是 `revise_resume` 自愈闭环的前置条件。

## 目标架构

### 总体链路

```text
HTTP Route
  ↓
Workflow Runner
  ↓
Harness Contract
  ↓
Lifecycle Wrapper
  ↓
Run Loop Controller
  ↓
Attempt Runtime
  ↓
Result Classifier / Evaluator
  ↓
Decision Policy
  ↓
Runtime Run State + Event Bus
  ↓
Optional Persistence Adapter
```

### 自愈型执行模型

```text
generate_resume attempt 1
  ↓
validate_resume
  ├─ passed → continue
  └─ failed → build recovery plan
        ↓
      revise_resume attempt 1
        ↓
      validate_resume
        ├─ passed → continue
        └─ failed → revise_resume attempt 2
              ↓
            validate_resume
              ├─ passed → continue
              └─ failed → workflow.partial + runtime failure report
```

## 模块设计

### 0. Harness Contract

先定义 Reffo 自己的最小 Harness 合约。它不需要像 OpenClaw 一样支持多插件、多 runtime，但要把“跑一次 attempt”和“分类结果”从业务 workflow 中抽出来。

```ts
interface AgentHarness<TInput, TOutput> {
  id: string
  label: string
  supports(input: TInput): boolean
  runAttempt(input: HarnessAttemptInput<TInput>): Promise<HarnessAttemptResult<TOutput>>
  classify?(result: HarnessAttemptResult<TOutput>, state: RunRuntimeState): HarnessResultClassification
}
```

第一版可以只有一个内置 harness：`reffo-resume-optimization`。未来如果要接不同 agent runtime、不同模型策略或不同业务链路，再扩展多个 harness。

合约边界：

- `runAttempt` 只负责一次动作，不负责无限重试。
- `classify` 只做结果分类，不直接修改上下文。
- retry / repair / revise / fallback 由外层 `RunLoopController` 决策。
- workflow 只负责把 HTTP 输入转成 harness input，并把 harness output 转成 API response。

### 1. Harness Attempt Result

OpenClaw 的关键做法是所有 attempt 都返回足够丰富的结构化结果，让外层 loop 能做决策。Reffo 也应该避免“成功直接返回值、失败直接 throw”这两极模式。

```ts
interface HarnessAttemptResult<TOutput> {
  stepName: string
  attemptNumber: number
  status: 'succeeded' | 'failed' | 'skipped'
  output?: TOutput
  rawOutput?: string
  parsedOutput?: unknown
  provider?: string
  model?: string
  usage?: {
    inputTokens?: number
    outputTokens?: number
    latencyMs?: number
  }
  error?: HarnessAttemptError
  evaluation?: EvaluationResult
  sideEffect?: {
    deterministic: boolean
    description?: string
  }
}

interface HarnessAttemptError {
  code: string
  category: HarnessErrorCategory
  message: string
  retryable: boolean
  repairable: boolean
}
```

设计重点：

- JSON parse / schema validation 失败也返回 attempt result，外层才能决定 repair 还是 retry。
- 质量门禁失败不是普通异常，而是 `category: 'quality_gate'` 的 attempt result。
- attempt result 中保留 `evaluation`，修复 step 可以直接拿 issues 生成 revision prompt。
- 如果某个 step 产生外部副作用，后续就不能盲目重跑；Reffo 当前主要是 LLM 生成，副作用较少，但结构上应预留。

### 2. Run Runtime State

单次 run 内部需要一个内存态上下文，承载自愈 loop 的所有中间状态。它不要求落库，随请求生命周期结束而释放。

```ts
interface RunRuntimeState {
  runContext: RunContext
  steps: StepRunSnapshot[]
  attempts: AttemptRuntimeSnapshot[]
  artifacts: Map<string, unknown>
  evaluations: EvaluationResult[]
  recoveryPlans: RecoveryPlan[]
  recoverySummary: RecoverySummary[]
  latestOutputs: {
    resumeAnalysis?: ResumeAnalysis
    jd?: JobDescription
    matchAnalysis?: MatchAnalysis
    optimizedResume?: string
    interviewSuggestions?: InterviewSuggestions
  }
}
```

运行时状态的职责：

- 给后续 step 提供上游输出，不依赖数据库读取。
- 给 recovery planner 提供当前失败原因、evaluation issues 和上一版输出。
- 给接口响应组装 `step_statuses`、`recoverable_errors`、`recovery_summary`。
- 通过 event bus 旁路发布事件；是否持久化由 subscriber 决定。
- 请求结束后默认释放；只有后置扩展需要跨请求 replay 或 failure sample 时，才考虑额外保存。

### 3. Run Loop Controller

Run Loop Controller 是 Harness 的核心，它不直接写 prompt，也不直接调用模型，而是负责控制一次 run 如何推进和收敛。

```ts
interface RunLoopController {
  run(input: WorkflowInput): Promise<WorkflowOutput>
  runAttempt<TResult>(step: StepDefinition<TResult>): Promise<HarnessAttemptResult<TResult>>
  classify<TResult>(result: HarnessAttemptResult<TResult>): HarnessResultClassification
  decide(classification: HarnessResultClassification, state: RunRuntimeState): HarnessDecision
  applyDecision(decision: HarnessDecision, state: RunRuntimeState): Promise<void>
}
```

推荐分类和决策模型：

```ts
type HarnessResultClassification =
  | 'ok'
  | 'provider_transient_error'
  | 'provider_permanent_error'
  | 'structured_output_invalid'
  | 'quality_gate_failed'
  | 'non_critical_step_failed'

type HarnessDecision =
  | { action: 'accept' }
  | { action: 'retry_same_step'; reason: string }
  | { action: 'repair_json'; reason: string }
  | { action: 'revise_output'; reason: string; revisionStep: 'revise_resume' }
  | { action: 'fallback_model'; reason: string }
  | { action: 'return_partial'; reason: string }
  | { action: 'fail'; reason: string }
```

推荐的 loop 形态：

```text
while budget remains:
  attempt = runAttempt(nextStep)
  runtimeState.record(attempt)
  classification = classify(attempt)
  decision = decide(classification, runtimeState)

  if decision.accept:
    advance to next step
  if decision.retry_same_step:
    run same step again with same or adjusted context
  if decision.repair_json:
    run repair attempt and re-classify
  if decision.revise_output:
    run revision step and re-evaluate
  if decision.return_partial or fail:
    stop
```

第一版不用做成完全通用的 `while`。可以在 `ResumeOptimizationWorkflow` 中显式编码固定 loop，但要保留上面的分类和决策概念：

```text
analyze_resume
parse_jd
match_resume_to_jd
generate_resume
validate_resume
  └─ failed → revise_resume → validate_resume，最多 2 次
generate_interview_advice
```

后续如果 Agent 需要更多工具调用、动态决策或多轮推理，再把固定 loop 抽象成通用 controller。

### 4. Step Runner 增强

当前 `runStep` 固定创建 `attemptNumber = 1`。建议改造成只负责 step 生命周期和 attempt 记录的轻量 runner。它不应该把所有异常直接抛给 workflow，而应该尽量产出 `HarnessAttemptResult`。

```ts
export interface StepRetryPolicy {
  maxAttempts: number
  retryableErrorCodes?: string[]
  backoffMs?: number | ((attemptNumber: number) => number)
}

export interface RunStepInput<TResult> {
  runContext: RunContext
  eventBus?: HarnessEventBus
  stepName: string
  timeoutMs?: number
  retryPolicy?: StepRetryPolicy
  execute: (context: StepExecutionContext) => Promise<TResult>
  classifyError?: (error: unknown) => HarnessAttemptError
}
```

执行语义：

- 每次 attempt 创建新的 `attemptId`，但复用同一个 `stepRunId`。
- 每次 attempt 发布 `attempt.started`、`attempt.succeeded` 或 `attempt.failed`。
- 中间 attempt 失败不直接终止 workflow，由 `RunLoopController` 判断是否继续。
- 最后一次失败才标记 `step.failed`；可恢复失败可以标记 `step.partial` 或进入 revision step。
- `StepRunError` 仅用于不可恢复的基础设施错误，例如 runner 内部错误、abort、无法构造上下文。

推荐默认策略：

| Step | maxAttempts | 策略 |
|---|---:|---|
| `analyze_resume` | 2 | provider 错误、JSON 解析失败、schema 失败可重试或 repair |
| `parse_jd` | 2 | 同上 |
| `match_resume_to_jd` | 2 | 同上 |
| `generate_resume` | 1 | 先生成一次，质量问题交给 `revise_resume` |
| `validate_resume` | 1 | 纯规则评估，不重试 |
| `revise_resume` | 2 | 基于 issues 修复简历 |
| `generate_interview_advice` | 1 | 可恢复失败，不阻塞主链路 |
| `llm_judge_resume` | 1 | 异步执行，失败只记录 |

### 5. 错误分类和恢复计划

新增统一错误类型，避免所有错误都落为 `STEP_FAILED`。

```ts
export type HarnessErrorCategory =
  | 'provider_transient'
  | 'provider_permanent'
  | 'json_parse'
  | 'schema_validation'
  | 'quality_gate'
  | 'timeout'
  | 'unknown'

export interface HarnessRecoverableError {
  code: string
  category: HarnessErrorCategory
  message: string
  retryable: boolean
  repairable: boolean
  details?: Record<string, unknown>
}
```

新增 `RecoveryPlanner`：

```ts
export interface RecoveryPlan {
  action: 'retry_same_step' | 'repair_json' | 'revise_output' | 'fallback_model' | 'return_partial' | 'fail'
  reason: string
  maxAttempts?: number
  nextStepName?: string
}
```

恢复规则第一版可以写死在代码里，不需要配置中心：

- `provider_transient`：重试同 step，必要时 fallback model。
- `json_parse`：优先 `repair_json`，失败后重试同 step。
- `schema_validation`：优先 `repair_json`，失败后重试同 step。
- `quality_gate`：触发 `revise_output`，不要简单重跑原始生成。
- `timeout`：关键 step 失败；非关键 step 可 partial。
- `provider_permanent`：不重试，直接 fail 或 partial。

### 6. 简历修复 Step：`revise_resume`

新增 `ResumeRevisionAgent`，只负责根据 evaluator issues 修复已生成简历，不重新生成整份简历。

输入：

```ts
interface ResumeRevisionInput {
  sourceResume: ResumeStructure
  jd: JobDescription
  matchAnalysis: MatchAnalysis
  previousResume: string
  evaluation: EvaluationResult
  revisionAttempt: number
}
```

输出：

```ts
interface ResumeRevisionResult {
  revisedResume: string
  fixedIssueCodes: string[]
  changeSummary: string[]
}
```

Prompt 约束：

- 只修复 evaluator 指出的失败点。
- 不新增源简历不存在的公司、项目、学历、时间和量化结果。
- 保留上一版简历中已经正确且贴合 JD 的内容。
- 对 `PLACEHOLDER_TEXT_FOUND` 必须移除模板占位文本。
- 对 `MISSING_EXPERIENCE_SECTION`、`MISSING_SKILL_SECTION` 必须补齐章节，但只能基于源简历事实。
- 输出 Markdown 简历正文，不输出解释。

Workflow 集成方式：

```text
generate_resume
  ↓
validate_resume
  ├─ passed
  └─ failed
      ↓
    revise_resume
      ↓
    validate_resume
```

`revise_resume` 成功后，最终返回的 `step3_optimized_resume` 应该是修复后的简历，同时在 `step_statuses` 里保留原始生成、校验、修复、二次校验的 step 轨迹。

### 7. Evaluator 分层

当前规则 evaluator 可以保留，但需要分层，便于不同失败类型触发不同恢复动作。

```text
Evaluator
  ├─ structure rules
  │   ├─ length
  │   ├─ required sections
  │   └─ placeholder text
  ├─ source faithfulness rules
  │   ├─ company coverage
  │   ├─ skill coverage
  │   └─ unsupported claims
  ├─ JD relevance rules
  │   ├─ required skills coverage
  │   └─ core responsibility coverage
  └─ LLM judge
      ├─ hallucination risk
      ├─ delivery readiness
      └─ seniority tone
```

建议先把 issue 增加 `recoverability` 字段：

```ts
interface EvaluationIssue {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  path?: string
  recoverability?: 'auto_fixable' | 'needs_user_input' | 'non_blocking'
}
```

第一版规则：

- `RESUME_TOO_SHORT`：`auto_fixable`
- `MISSING_EXPERIENCE_SECTION`：`auto_fixable`
- `MISSING_SKILL_SECTION`：`auto_fixable`
- `PLACEHOLDER_TEXT_FOUND`：`auto_fixable`
- `SOURCE_COMPANY_NOT_REFERENCED`：`non_blocking` 或 `auto_fixable`，先保持 warning。
- `SOURCE_SKILLS_NOT_REFERENCED`：`non_blocking` 或 `auto_fixable`，先保持 warning。

### 8. 运行时回溯与局部重跑

Agent Harness 的第一优先级不是跨请求 replay，而是同一次 run 内的局部回溯和重新执行。

运行时回溯依赖 `RunRuntimeState`，不依赖数据库：

```text
latestOutputs.optimizedResume
  ↓
evaluateMarkdownResume
  ↓
quality_gate failed
  ↓
RecoveryPlanner 读取 evaluation issues + 上下文账本
  ↓
revise_resume 生成候选新版本
  ↓
替换 latestOutputs.optimizedResume
  ↓
重新执行 validate_resume
```

局部重跑规则：

- **结构化输出失败**：同一 step 内执行 `repair_json` 或 retry attempt。
- **provider 瞬时失败**：同一 step 内 retry 或 fallback model。
- **生成质量失败**：不要简单重跑 `generate_resume`，而是执行 `revise_resume`。
- **非关键 step 失败**：记录 recoverable error，主链路返回 partial 或降级结果。
- **超过预算**：停止 loop，返回 runtime failure report。

运行时回溯需要保留的不是完整历史数据库记录，而是本次 run 的决策材料：

- 当前 step 输入。
- 上一个可接受输出。
- 当前失败输出。
- evaluator issues。
- recovery plan。
- attempt budget。
- token / timeout budget。

### 9. 外围回归资产（后置扩展）

当运行时 Harness 稳定后，再考虑把失败样本沉淀为长期回归资产。这个能力属于外围工程，不是 Agent Loop 的前置条件。

后置扩展可以包括：

- 保存脱敏 run snapshot，支持服务重启后的历史样本重跑。
- 扩展 failure sample，记录 failure step、issue codes 和 expected behavior。
- 提供 `bun run test:harness-regression`，用历史失败样本验证新策略。
- 提供长期 dashboard，观察不同 prompt / evaluator / model policy 的质量趋势。

是否实现这部分，取决于是否要做跨请求质量工程，而不是单次 run 是否能自愈。

### 10. Provider Stream 扩展

流式不是一期核心，但接口设计可以提前留扩展点。

```ts
export interface LlmProvider {
  complete(input: ChatCompletionInput): Promise<ChatCompletionResult>
  stream?(input: ChatCompletionInput): AsyncIterable<ChatCompletionChunk>
}

export interface ChatCompletionChunk {
  provider: string
  model: string
  delta: string
  index: number
  finishReason?: string | null
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}
```

新增事件类型：

```ts
type HarnessEventType =
  | 'provider.stream.started'
  | 'provider.stream.delta'
  | 'provider.stream.completed'
```

落地建议：

- 先只对 `generate_resume` 支持 stream，因为它最影响前端等待体验。
- `provider.stream.delta` 默认不持久化每个 token，只持久化 chunk 计数、首 token 延迟、总耗时和最终 digest。
- 前端需要 SSE 或 fetch stream 时，再新增 `/process/stream`，不要改破现有 `/process`。

## API 设计

### 1. 完整流程请求

现有接口保持兼容：

```http
POST /api/v1/mvp/process
```

新增可选参数：

```ts
interface ProcessRequest {
  resume_markdown: string
  jd_text: string
  prompt_variant?: 'v1' | 'v2'
  enable_llm_judge?: boolean
  harness_policy?: {
    enable_auto_revise?: boolean
    max_revision_attempts?: number
    max_step_attempts?: number
    workflow_timeout_ms?: number
  }
}
```

默认值：

- `enable_auto_revise: true`
- `max_revision_attempts: 2`
- `max_step_attempts` 按 step 默认策略决定。

### 2. 响应结构

现有 `MvpProcessResponse` 增加可选字段：

```ts
interface MvpProcessResponse {
  run_id: string
  workflow_status: 'succeeded' | 'failed' | 'partial'
  step_statuses: StepRunSnapshot[]
  recoverable_errors?: RecoverableError[]
  recovery_summary?: RecoverySummary[]
  step1_analysis: ResumeAnalysis
  step2_matching: MatchAnalysis
  step3_optimized_resume: string
  step4_interview_suggestions?: InterviewSuggestions
}
```

`recovery_summary` 示例：

```json
[
  {
    "triggerStep": "validate_resume",
    "action": "revise_output",
    "issueCodes": ["PLACEHOLDER_TEXT_FOUND"],
    "result": "succeeded",
    "attempts": 1
  }
]
```

### 3. 后置 Replay 接口

跨请求 replay 不是一期 Agent Harness 的必要能力。如果后续要把运行时失败样本沉淀为长期质量资产，再增加接口。

```http
POST /api/v1/mvp/runs/:run_id/replay
```

请求：

```ts
interface ReplayRunRequest {
  mode?: 'same_policy' | 'latest_policy'
  prompt_variant?: 'v1' | 'v2'
  dry_run?: boolean
}
```

语义：

- `same_policy`：尽量使用原 run 的 workflow version、prompt variant、model policy。
- `latest_policy`：使用当前代码和当前默认策略执行。
- `dry_run`：只构造执行计划，不调用 LLM。

## 持久化扩展建议

本章节不是一期必做项。`revise_resume` 自愈闭环、step 多 attempt、运行时 recovery summary 都可以先通过内存态 `RunRuntimeState` 实现。

建议按以下原则决定是否落库：

- **只服务单次 run 决策的状态不落库**：例如当前 attempt 输出、当前 evaluator issues、当前 recovery plan、修复后的候选简历。
- **服务请求结束后诊断的摘要可落库**：例如 step 状态、attempt 状态、错误分类、recovery action、evaluation issue codes。
- **服务跨请求 replay 的输入快照谨慎落库**：必须有脱敏、加密或本地开发开关。
- **服务长期回归的数据再结构化落库**：例如 failure sample、expected behavior、历史 issue codes。

如果只做最小自愈版本，可以跳过本章节所有持久化扩展。

### step_attempts

当需要长期统计多 attempt、错误分类和恢复动作时，建议补充：

```sql
ALTER TABLE step_attempts ADD COLUMN error_category TEXT;
ALTER TABLE step_attempts ADD COLUMN recovery_action TEXT;
ALTER TABLE step_attempts ADD COLUMN parent_attempt_id TEXT;
```

### evaluations

当需要区分阻塞型质量门禁和非阻塞评估时，建议补充：

```sql
ALTER TABLE evaluations ADD COLUMN gate_name TEXT;
ALTER TABLE evaluations ADD COLUMN blocking INTEGER NOT NULL DEFAULT 0;
```

### failure_samples

当需要把失败样本变成长期回归数据集时，建议补充或新建 v2 表：

```sql
ALTER TABLE failure_samples ADD COLUMN failure_step_name TEXT;
ALTER TABLE failure_samples ADD COLUMN failure_code TEXT;
ALTER TABLE failure_samples ADD COLUMN issue_codes_json TEXT;
ALTER TABLE failure_samples ADD COLUMN snapshot_id TEXT;
ALTER TABLE failure_samples ADD COLUMN expected_behavior TEXT;
```

### run_snapshots

当需要跨请求、跨进程或服务重启后的可执行 replay 时，再新增表保存脱敏快照：

```sql
CREATE TABLE IF NOT EXISTS run_snapshots (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  storage_ref TEXT,
  redaction_policy TEXT NOT NULL,
  encryption_key_ref TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES process_runs(id)
);
```

## 事件扩展

一期新增运行时 recovery 事件：

```ts
type HarnessEventType =
  | 'recovery.planned'
  | 'recovery.started'
  | 'recovery.succeeded'
  | 'recovery.failed'
```

如果后续实现跨请求 replay 或 snapshot，再扩展 `replay.started`、`replay.succeeded`、`replay.failed`、`snapshot.created` 等事件。

事件 payload 原则：

- 只记录 `issueCodes`、`errorCode`、`errorCategory`、`action`、`digest`、`artifactId`。
- 不直接记录完整简历、完整 JD、完整 prompt 或完整模型输出。
- recovery 事件要能串起原始失败 attempt 和修复 attempt。

## 实施计划

### 阶段一：Harness 合约和 Attempt Result

- 新增最小 `AgentHarness` 合约，先只提供内置 `reffo-resume-optimization`。
- 新增 `HarnessAttemptResult`、`HarnessAttemptError`、`HarnessResultClassification`、`HarnessDecision` 类型。
- 新增内存态 `RunRuntimeState`，承载单次 run 的 step、attempt、artifact、evaluation 和 recovery summary。
- 改造 `runStep`，让可恢复失败尽量产出 attempt result，而不是直接抛异常。
- 增加 `HarnessRecoverableError` 和错误分类函数。
- 补充单测覆盖 attempt result、错误分类和事件顺序。

验收标准：

- provider 错误、JSON 解析失败、schema 失败、质量门禁失败都能被分类为结构化 attempt result。
- 单次 run 的 attempt 数、失败原因、classification 和 decision 可以通过接口响应或事件在运行时查看。
- 原有 `/process` 响应保持兼容。

### 阶段二：Decision Loop 和 `revise_resume` 闭环

- 新增 `ResumeRevisionAgent`。
- 新增 `revise_resume` step。
- `validate_resume` 失败后产出 `quality_gate_failed` classification。
- `RunLoopController` 将 `quality_gate_failed` 转成 `revise_output` decision，最多执行 2 次。
- `recovery_summary` 返回给前端和调用方。
- 规则 evaluator issue 增加 recoverability。

验收标准：

- 占位符、缺章节、内容过短等失败可以自动修复。
- 多次修复失败后返回 `partial`，并保留原始失败和修复失败原因。
- 修复后的最终简历仍通过 `evaluateMarkdownResume`。

### 阶段三：运行时 Harness 稳定性完善

这一阶段仍以单次 run 的稳定收敛为主，不要求持久化扩展。

- 细化不同错误类别的 recovery policy。
- provider transient 错误支持重试和 fallback model。
- JSON parse / schema validation 失败继续复用现有 repair 能力，但事件中标记 `recovery_action = repair_json`。
- 增加 token budget、attempt budget、workflow timeout 的统一预算控制。
- 增加关键 step 的单元测试和 fake provider 测试。
- 增加运行时 recovery summary 的结构化断言。

验收标准：

- provider transient、JSON repair、quality revise 三类恢复路径都有测试覆盖。
- 任意 loop 都能在预算内收敛为 succeeded、partial 或 failed。
- 不依赖数据库即可完成一次 run 的诊断和修复决策。

### 后置阶段：跨请求 Replay 和失败样本回归

当需要把运行时失败沉淀为长期质量资产时，再考虑这一阶段。

- 新增 run snapshot 存储策略。
- 扩展 failure sample 字段。
- 新增 `POST /runs/:run_id/replay`。
- 增加 `bun run test:harness-regression`，读取失败样本执行回归。

### 阶段四：流式输出和前端体验

- `LlmProvider` 增加可选 `stream()`。
- `DeepSeekProvider` 实现 stream。
- 新增 `/process/stream` SSE 接口。
- 首期只流式输出 `generate_resume` 的文本生成进度。

验收标准：

- 非流式 `/process` 不受影响。
- 流式接口能返回 runId、step 状态和最终完整结果。
- token delta 不逐条持久化，只记录聚合指标和最终 digest。

## 风险和取舍

### 隐私风险

运行时 Agent Loop 不需要保存输入快照。只有后续做跨请求 replay 时才会引入简历隐私风险，届时应默认只在本地开发或明确开启配置时保存，并提供脱敏策略。

### 成本风险

自愈 loop 会增加 LLM 调用次数。需要限制每个 run 的最大 attempt、最大 revision 次数和总 workflow timeout。

### 过度修复风险

`revise_resume` 可能为了通过规则而改变事实。修复 prompt 必须强调只基于源简历事实，并由 LLM Judge 或事实一致性规则兜底。

### 事件膨胀风险

流式 token 级事件如果全部入库会导致 SQLite 快速膨胀。第一版不持久化 token delta，只持久化聚合指标。

### 兼容风险

现有前端依赖 `step1_analysis`、`step2_matching`、`step3_optimized_resume`、`step4_interview_suggestions`。所有新增字段必须可选，避免破坏前端。

## 推荐优先级

1. **先做 Attempt Result 和分类**：把“成功返回 / 失败抛错”改成可决策的结构化结果。
2. **再做 `revise_resume` 决策闭环**：直接解决“校验出问题只报错”的核心痛点。
3. **然后做多 attempt、预算和测试**：确保 loop 能稳定收敛，不会无限修复或过度调用。
4. **最后按需做 stream、fallback 和跨请求 replay**：stream 改善体验，replay 服务长期质量资产。

## 最小可行版本

如果希望快速落地，最小版本只需要做以下改动：

- 新增 `ResumeRevisionAgent`。
- 新增最小 `HarnessAttemptResult` 和 `HarnessDecision` 类型，不必先做完整插件化 `AgentHarness`。
- 在 `ResumeOptimizationWorkflow` 中把 `validate_resume` 失败从直接 `partial` 改为：`revise_resume → validate_resume`，最多 2 次。
- 将 `validate_resume` 失败记录为 `quality_gate_failed → revise_output` 的运行时 decision。
- 在 `MvpProcessResponse` 增加 `recovery_summary`。
- 在事件中增加 `recovery.planned`、`recovery.succeeded`、`recovery.failed`。
- 使用内存态保存本次 run 的中间状态和修复过程，不新增数据库表。
- 暂不改 provider stream，暂不做跨请求 replay，暂不沉淀长期 failure sample。

这个版本可以在不大改现有 Harness 架构的前提下，把系统从“观测型 Harness”推进到“具备第一个自愈闭环的 Agent Harness”。
