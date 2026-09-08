# V5 工作流默认化与插件化 TODO

> **历史实施记录（部分状态已过期）**：本文保留 2026-09-01 的任务轨迹，其中 P09/P11、P08 修复次数和安全回退交付描述不再是当前行为。当前生产链路以 [`backend/src/v5/README.md`](../backend/src/v5/README.md) 为准。

状态：`pending` / `in_progress` / `done` / `blocked`

更新规则：每完成一个子项，立即更新本文件状态、验证命令和日期。未完成项不得标记为 `done`。

## 目标

- 完整简历优化流程只保留 V5。
- 不提供 V4 fallback、shadow 或请求级版本切换。
- V5 Workflow 拆为“主流程编排器 + 即插即用 Plugin”。
- Prompt 使用独立 Markdown/JSON 文件维护，支持版本、替换、审计和问题定位。
- 保持旧 MVP 响应结构兼容，失败时安全回退或明确失败。

## 总体进度

- [x] `T0` 建立本 TODO 清单（2026-09-01）
- [x] `T1` 完整流程收敛为 V5-only（2026-09-01）
- [x] `T2` Workflow Plugin 化（2026-09-01）
- [x] `T3` Prompt 外置化（2026-09-01）
- [ ] `T4` 测试、观测、文档和发布切换（awaiting_cr）
- [ ] `T5` V5 目录结构重组（awaiting_cr）
- [ ] `T6` README 与插件清单同步（awaiting_cr）

---

## T1. 完整流程收敛为 V5-only

状态：`done`（2026-09-01；用户确认继续，按要求不提交）

- [x] `/api/v1/mvp/process` 固定执行 V5。（2026-09-01）
- [x] 移除 `RESUME_AGENT_MODE`、V4 fallback 和 shadow 配置。（2026-09-01）
- [x] 移除请求级 `agent_version` 和旧 `prompt_variant` 选择。（2026-09-01）
- [x] 移除完整流程中的 V4 Agent 编排、自愈和版本分支代码。（2026-09-01）
- [x] 保留 V5 输入失败、Provider 失败、Schema/事实门禁失败语义。（2026-09-01；T2 再细化插件错误码）
- [x] V5 失败直接返回明确错误，不执行其他版本。（2026-09-01）
- [x] 响应中的实际版本固定为 `5.0.0`。（2026-09-01）
- [x] 保持 `step1_analysis`、`step2_matching`、`step3_optimized_resume`、`step4_interview_suggestions` 兼容。（2026-09-01）
- [x] 更新 `.env.example`、backend README、V5 README 和发布回滚说明。（2026-09-01）
- [x] 增加 V5-only 委托和 V5 阻断错误透传测试。（2026-09-01）

验收：完整流程只进入 V5；V5 失败直接返回明确错误；无 V4、shadow 或版本选择入口；旧客户端步骤字段不变。

验证：

```bash
cd backend
bunx tsc --noEmit
bun test ./src/workflows/resume-optimization-workflow.test.ts
bun test ./src/v5/tests/workflow.test.ts
```

验证记录（2026-09-01）：

- `bunx tsc --noEmit`：通过。
- `bun test ./src/routes/mvp-auth.test.ts ./src/workflows/resume-optimization-workflow.test.ts ./src/v5/tests/workflow.test.ts ./src/v5/tests/ab-compatibility.test.ts ./src/v5/tests/stage-runner.test.ts`：17 个测试通过，0 失败。
- 清理既有 TypeScript 阻断：移除 `stage-runner.test.ts` 中 Bun matcher 不支持的两个 `toMatchObject<T>` 类型参数，无运行时行为变化。
- 当前门禁：已通过用户 CR。当前分支只做测试，暂不提交、不合入 `main`。

---

## T2. Workflow Plugin 化

状态：`done`（2026-09-01；T2.1、T2.2 已通过用户 CR）

### T2.1 Plugin 接口

- [x] 定义 `V5WorkflowPlugin` 接口：插件 ID、版本、阶段、输入依赖、输出类型、执行函数、超时和可选性。（2026-09-01）
- [x] 定义插件生命周期：`beforeRun`、`run`、`validate`、`afterRun`、`onError`。（2026-09-01）
- [x] 定义插件上下文：run context、event bus、AbortSignal、Provider、共享 Artifact、配置和 manifest。（2026-09-01）
- [x] 定义插件结果和错误协议，统一映射到 `ResumeAgentState` 与 API 错误码。（2026-09-01）
- [x] 定义插件注册表：按阶段查找、显式版本替换、依赖检查、重复 ID 检查。（2026-09-01）
- [x] 定义插件执行策略：必选插件失败阻断；可选插件失败记录 partial，不阻断主结果。（2026-09-01）

T2.1 验证记录（2026-09-01）：

- `bun test ./src/v5/tests/registry.test.ts`：9 个测试通过，0 失败。
- `bun test ./src/v5`：102 个测试通过，0 失败。
- `bunx tsc --noEmit`：通过。
- 当前门禁：用户 CR 已通过；按要求不提交、不合入 `main`。

### T2.2 主流程编排器

- [x] 把 `workflow.ts` 阶段调度接入轻量 Plugin registry，保留初始化、状态迁移、预算、V5 内部安全回退和最终响应。（2026-09-01）
- [x] 将 P01/P02/P03/P04/P05/P06-P08/P09/P10/P11/响应阶段接入插件边界，主流程不改变阶段 Prompt 内容。（2026-09-01）
- [x] 支持固定阶段顺序和条件阶段：P04、P11、P12；P01/P02 并行执行。（2026-09-01）
- [x] 支持通过 `pluginOverrides` 替换单个内置阶段，不修改主流程。（2026-09-01）
- [x] 支持可选插件禁用；禁用状态写入 Plugin manifest。（2026-09-01）
- [x] 支持新增注册插件并声明依赖；依赖完成后才能执行。（2026-09-01）
- [x] 保持 P08 修复预算、P09 阻断事实门禁和 source-preserving fallback 行为。（2026-09-01）

T2.2 验证记录（2026-09-01）：

- `bun test ./src/v5/tests/workflow.test.ts ./src/v5/tests/registry.test.ts`：18 个测试通过，0 失败。
- `bun test ./src/v5`：102 个测试通过，0 失败。
- `bunx tsc --noEmit`：通过。
- 当前门禁：等待用户 CR；按要求不提交、不合入 `main`。

### T2.3 内置插件拆分

- [ ] `canonical-source` / 输入规范化插件。
- [ ] `resume-extraction`：P01/P01R、分块、合并、缓存和证据构建。
- [ ] `job-extraction`：P02/P02R、需求原子化。
- [ ] `matching`：P03/P03R、服务端匹配分。
- [ ] `adaptive-policy`：确定性策略和 P04 裁决。
- [ ] `resume-planning`：P05/P05R、计划门禁。
- [ ] `artifact-generation`：P06/P07/P08、Artifact 门禁和修复。
- [ ] `fact-judge`：P09 阻断式事实审查。
- [ ] `interview-preparation`：P10/P10R。
- [ ] `quality-judge`：P11 非阻断质量审查。
- [ ] `response-compatibility`：V5 结果转旧 MVP 响应。

验收：主流程只负责编排；任一阶段插件可独立测试、替换和禁用；插件失败状态、重试和审计行为稳定。

验证：

```bash
cd backend
bunx tsc --noEmit
bun test ./src/v5
```

---

## T3. Prompt 外置化

状态：`done`（2026-09-01；用户确认继续）

### T3.1 文件格式和目录

- [x] 建立 `backend/src/v5/prompts/` 目录。（2026-09-01）
- [x] 每个阶段使用独立 Markdown：P01-P12。（2026-09-01）
- [x] 修复 Prompt 独立维护：P01R、P02R、P03R、P05R、P10R。（2026-09-01）
- [x] Prompt 元数据集中在 `manifest.json`，正文与动态业务数据分离。（2026-09-01）
- [x] 使用 JSON manifest 维护组件版本和机器解析信息。（2026-09-01）

### T3.2 Prompt Registry 和编译

- [x] 实现 Prompt registry：按 ID/版本加载 Markdown 和 manifest。（2026-09-01）
- [x] 校验文件存在、版本格式和 manifest components。（2026-09-01）
- [x] 保持动态 envelope、STRICT_OUTPUT_JSON_SCHEMA、输入不可信边界注入。（2026-09-01）
- [x] Prompt 编译器从 registry 读取内容，不再维护大段正文。（2026-09-01）
- [x] 计算 Prompt 文件 hash 和编译后 hash，写入 prompt manifest。（2026-09-01）
- [x] Prompt 文件读取失败时 fail closed，不静默使用未知版本。（2026-09-01）
- [x] 通过 manifest 保留组件版本，支持 V5 问题复盘和 A/B 对比。（2026-09-01）
- [x] 更新 Prompt 单测，覆盖加载、版本、hash 和 Schema 映射。（2026-09-01）

### T3.3 清理和迁移

- [x] 将当前 `backend/src/v5/prompts.ts` 内容迁移到 Markdown 文件。（2026-09-01）
- [x] 删除重复 Prompt 常量，保留兼容导出和 registry 加载层。（2026-09-01）
- [x] 更新 `prompt-compiler.ts`、Prompt manifest；P12 继续读取 registry 版本。（2026-09-01）
- [x] Prompt 修改规则沉淀到本 TODO 与 registry manifest。（2026-09-01）

T3 验证记录（2026-09-01）：

- `bun test ./src/v5/tests/prompt-schema.test.ts`：2 个测试通过，0 失败。
- `bun test ./src/v5`：102 个测试通过，0 失败。
- `bunx tsc --noEmit`：通过。
- 当前门禁：等待用户 CR；按要求不提交、不合入 `main`。

验收：修改单个 Prompt 文件即可替换对应阶段文本；无需改 TypeScript；manifest 能定位文件版本和 hash；非法文件不能进入模型调用。

验证：

```bash
cd backend
bunx tsc --noEmit
bun test ./src/v5/tests/prompt-schema.test.ts
bun test ./src/prompts
```

---

## T4. 测试、观测、文档和发布切换

状态：`in_progress`（全量回归和文档收口已完成，等待用户 CR；真实 Provider/黄金集仍待发布前执行）

- [x] 增加 Plugin contract tests：注册、依赖、顺序、替换、禁用、超时、取消和错误映射。（2026-09-01）
- [x] 增加端到端 workflow tests：V5-only、可选插件失败、P09 阻断、P11 非阻断。（2026-09-01）
- [ ] 验证 Provider 原生 JSON Schema 和 `json_object + server Zod` 两种模式。
- [ ] 验证 Prompt manifest 包含插件版本、Prompt 文件版本、Schema/Validator/策略/评分版本。
- [ ] 验证 Harness dashboard 能区分 V5 主流程、V5 内部安全回退和插件失败。
- [ ] 验证真实 Provider 前先完成离线测试，再做单案例 canary。
- [x] 更新 `backend/src/v5/README.md`、`backend/README.md` 和根 README。（2026-09-01）
- [x] 更新 `docs/v5-llm-调用流程升级清单.md`，同步新主流程和插件边界。（2026-09-01）
- [ ] 更新合规文档中的模型调用、Provider fallback 和数据流描述。
- [x] 执行全量验证：`bunx tsc --noEmit`、`bun test ./src/v5`、`bun test ./src`。（2026-09-01）
- [ ] 记录风险：V5 模型调用成本、P95 延迟、内部安全回退比例、Prompt 版本漂移。
- [ ] 发布前设置 `release_status` 目标和回滚负责人。
- [ ] 完成测试分支验证；未经用户新指令，不提交、不合入 `main`。

验收：V5-only 稳定运行，插件和 Prompt 可独立演进，指标可观测；当前结果只保留在测试分支。

---

## 每项完成记录模板

```text
项目：T?.?
状态：done
完成日期：YYYY-MM-DD
改动文件：
验证命令：
验证结果：
风险/后续：
```

## 当前变更记录

| 日期 | 项目 | 状态 | 说明 |
|---|---|---|---|
| 2026-09-01 | T0 | done | 建立 V5 默认化、Plugin 化、Prompt 外置化执行清单 |
| 2026-09-01 | T1 | in_progress | 按 CR 移除 V4 fallback 和版本选择，V5-only 定向回归完成，等待 CR |
| 2026-09-01 | T1 | done | 用户确认继续；不提交、不合入 main，开始 T2.1 |
| 2026-09-01 | T2.1 | in_progress | Plugin contract 与 registry 已实现；V5 全量 102 tests、TypeScript 检查通过，等待用户 CR |
| 2026-09-01 | T2.1 | done | 用户确认继续；开始 T2.2 主流程和内置 Plugin 迁移 |
| 2026-09-01 | T2.2 | in_progress | 主流程接入内置 Plugin registry，V5 全量回归通过，等待用户 CR |
| 2026-09-01 | T2.2 | done | 用户确认继续；开始 T3 Prompt 外置化 |
| 2026-09-01 | T3 | in_progress | Markdown/JSON Prompt registry 完成，V5 全量回归通过，等待用户 CR |
| 2026-09-01 | T3 | done | 用户确认继续；开始 T4 全量回归与文档收口 |
| 2026-09-01 | T4 | in_progress | `bun test ./src` 182 通过、TypeScript 和 diff check 通过；真实 Provider/黄金集待发布前验证，等待用户 CR |
| 2026-09-01 | T4 | done | 用户确认继续；代码侧全量回归和文档收口通过，进入目录结构重组 |
| 2026-09-01 | T5 | in_progress | 主流程移入 `v5/main`，测试移入 `v5/tests`，等待结构回归 |
| 2026-09-01 | T5 | awaiting_cr | V5 主流程、插件、Prompt、测试目录边界完成；182 全量测试通过，等待用户 CR |
| 2026-09-01 | T6 | awaiting_cr | README、V5 README、升级清单已同步；11 个内置插件职责已列出，等待用户 CR |
