# V5 entry r5 生产发布记录与操作手册

日期：2026-09-08。

## 发布决策与当前状态

产品负责人已在本任务中认可当前质量并授权推进生产发布。本轮执行发布工程，不继续以扩大质量评测作为发布决策前提；未完成的统计验证不伪装为已通过。

**当前状态：本地发布准备与验证完成，尚未提交/推送、创建 release tag 或触发生产部署。** 实际 Render 服务名称/ID、生产访问 origin、部署 hook 对应服务尚待确认。不能只凭仓库中存在 hook 变量就推定目标，也不能把 CI 已触发等同于服务已部署。

工作分支：`private/reffo-hsl`。工作区包含此前多轮 V5 修改和未跟踪的实现文件；发布提交必须涵盖相关依赖，经 diff 审核后走 PR，不能只提交提示词文件或直接给旧 HEAD 打 tag。`.artifacts/`、环境文件、密钥与构建产物不纳入提交。

## 版本与配置

- 发布配置：`entry-r5`。
- Writer：`5.2.0-p06c-entry-writer-r5`。
- 正文协议：`entry-writing-v1`。
- 排版：`entry-layout-v2`。
- 组合：`writer_v1 + job-targeted-v1 + entry-writing-v1`。
- 正式调用入口：`POST /api/v1/mvp/process` → `ResumeOptimizationWorkflow` → 由服务端发布开关选择 V5 组合。Taro `resumeApi.processResume` 使用此入口。
- P09/P12 不接入正式生成，Writer 仍单次调用、不进行模型互审循环。

在确认的生产服务中设置以下非敏感配置；保留原有生产密钥、数据库、存储和鉴权配置，不复制 `.env.nonprod`：

```dotenv
V5_RELEASE_PROFILE=entry-r5
AI_MODEL=deepseek-v4-flash
OPENAI_BASE_URL=https://api.deepseek.com
DEEPSEEK_THINKING_MODE=disabled
DEEPSEEK_P01_THINKING_MODE=disabled
```

已有生产环境还必须保持 `APP_ENV=prod`、`AUTH_REQUIRED=true`、`DATABASE_PROVIDER=supabase`、`SUPABASE_PROJECT_ENV=prod`。不改配额、数据库结构或用户数据。启动验证会拒绝 entry-r5 的模型/思考配置漂移及提示词版本错配。

默认 `V5_RELEASE_PROFILE=legacy-dsl`，防止“仅部署代码”意外切换所有用户。只有配置完成并重启/部署后的新实例才使用 entry-r5，不能宣称环境设置对在途请求无影响。

`release_status=preproduction_candidate` 保留为原有统计可靠性标签，未伪造黄金集全面通过；部署是否启用由 health 的 `generation.profile` 决定。产品批准上线、实例实际启用、统计可靠性是三个不同状态。

## 本轮验证

| 项目 | 结果 |
| --- | --- |
| 后端单测 | 1,005 通过，0 失败，79 个文件 |
| TypeScript | `bunx --no-install tsc --noEmit` 通过 |
| diff 空白检查 | 通过 |
| Taro 简历服务/JD 解析兼容单测 | 25 通过，2 个套件 |
| H5 生产构建 | `build:h5:prod` 通过；存在既有 Browserslist、webpackExports、bundle size 警告 |
| 正式适配层生产模式 | entry-r5 配置与 legacy-dsl 回滚选择测试通过 |
| r5 非生产真实 Writer 冒烟 | 首次响应直接 `succeeded / deliver`，无事后补丁复验、无再次调用 |
| 线上 health / 线上业务冒烟 | 未执行：生产目标未确认 |

真实测试使用授权 Case3：前 16 个既有上游响应逐条核对请求后复用；第 17 步向 DeepSeek 新发起一次 r5 Writer 调用。不是 P01 到 Writer 全部重新外呼的冷启动测试。

- 新增 API 调用：1。
- 输入 13,300、输出 2,332 Token，总计 **15,632 Token**。
- Writer 响应约 13.3 秒；正常停止，输出未截断。
- 结果 1,518 个汉字、23 条列表、两个项目；五段工作任职正文条数依次 4 / 1 / 2 / 1 / 1。
- 最终代码校验错误为 0；选材遗漏、段落目标、摘要软长度等质量警告保留，不改写成无问题。
- 私有记录：`.artifacts/v5-entry-r5-release-20260908-pwQdAz/`，含原始请求、响应、调用使用量、`result.json` 与 `resume.md`。

## 发布顺序

1. 确认目标 Render 后端服务、生产 origin、部署源分支，以及 `RENDER_DEPLOY_HOOK_URL` 对应的是该服务。只记录服务标识，不输出 hook 密钥。
2. 审核本分支完整变更，排除本地私有产物；按仓库协作规则提交中文 Conventional Commit 和 PR。PR 需要指定触发用户的 GitHub assignee/reviewer，尚未确认时不猜账号。
3. PR 运行新增 `Backend Quality`（类型检查、后端测试）；发布流水线另执行后端类型检查、测试和 H5 生产构建。合入 `main` 后才创建版本 tag；版本号按实际仓库发布序列确认，不给未含本轮代码的旧提交打 tag。
4. 先记录上一部署的 commit 和非敏感配置、妥善保存原模型配置供回滚。部署代码与环境配置必须对应本次版本。可以先保持 legacy-dsl 部署代码，再切换完整 entry-r5 配置，避免半套模式组合。
5. 等待 Render 确认新部署完成。现有 tag 流水线只负责触发 hook，不表示远端部署完成；缺失 hook 现在会显式失败，不再假成功。
6. 执行只读核对脚本：在 backend 目录运行 `bun scripts/check-v5-production-release.ts <确认后的生产 HTTPS origin> entry-r5`。它只 GET `/api/v1/mvp/health`，验证 prod、profile、Writer、排版、模型及思考模式，不生成简历、不消耗配额。
7. 在明确的发布测试账号上做一次正式 `/process` 业务冒烟，确认鉴权、配额扣减、历史持久化、要求解析及最终 Markdown 展示。不得擅自选普通真实用户账号或给所有用户发起测试。
8. 检查首批实际请求的成功/失败、空正文、最长段落、调用次数和 Token、延迟及持久化错误；这是发布观察，不要求候选人的岗位匹配分变高。确认部署与业务验证后才将本记录状态改为“已上线”。

## 回滚

- 配置回滚：设置 `V5_RELEASE_PROFILE=legacy-dsl`，按备份恢复旧模型/思考配置，重新部署/重启。该开关同时退出 JD 定向和 entry Writer，不留下半套组合。
- 代码回滚：若是启动或兼容性问题，部署上一个已知稳定 commit；不要通过覆盖远端历史回滚。
- 验证：运行只读核对脚本，第二个参数使用 `legacy-dsl`；确认正式接口恢复后，保留失败 run 的诊断供后续排查。不删除用户简历或历史数据。
- 优先回滚情形：启动失败、鉴权/配额或持久化异常、连续生成硬失败、已确认事实归属错误、重点经历再次空白或严重失去结构、调用/延迟异常放大。

本轮没有修改生产环境、生产数据库、发布密钥或远端分支；回滚开关和流程已经实现，但尚未在目标生产服务上演练。
