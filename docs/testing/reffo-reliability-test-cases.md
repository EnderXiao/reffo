# Reffo 可靠性测试用例

> 基线分支：`feature/workflow-v5`；基线提交：`1e90476`。本文件面向可靠性测试、故障注入、发布验收和生产回归，不等同于现有单元测试清单。

## 1. 目标与范围

覆盖后端 Bun/Elysia API、V5 entry-r5 工作流、SQLite/Supabase 数据访问、Supabase Storage、Harness 观测、OCR、Taro H5 主链路，以及 RN Android/小程序的构建和验收项。重点验证数据隔离、fail-closed 交付、幂等、并发、超时、恢复、配额、成本和可诊断性。

共 **138** 条用例：P0 75 条，P1 63 条。P0 是发布阻断项；P1 是上线前应完成或有书面风险接受的项。

## 2. 证据等级

- **代码契约**：目标分支已有路由、Schema、错误码、存储或测试明确支持的行为。
- **可靠性验收**：需要通过并发、故障注入、恢复或端到端运行证明的质量要求，代码静态阅读不能替代。
- **建议验收/容量目标/安全目标**：当前实现未给出完整数值或产品决策，执行时须记录实际结果并由产品、研发或安全负责人确认阈值。
- **待产品确认**：如历史版本语义、删除范围、匿名体验边界等，不得把执行者的假设写成通过条件。

## 3. 环境矩阵

| 环境 | 用途 | 关键约束 |
|---|---|---|
| L / local | SQLite、DEV_USER_ID、H5 本地流程 | 免登录仅限 local；不使用生产密钥；可注入模型和数据库故障 |
| N / nonprod | Supabase、真实 Bearer、独立 Storage | `AUTH_REQUIRED=true`；与 prod project 环境一致；使用脱敏测试账号 |
| P / prod-like | 发布、回滚、探针、容量 | 只读/蓝绿或临时环境；不得做破坏性注入；真实模型需预算和审批 |
| H5 | Chrome/Safari/Firefox | 375/393/768/1440 视口；弱网、刷新、返回、prefers-reduced-motion |
| RN / Mini Program | 平台验收 | RN 需 adb 设备；小程序需对应构建环境；按平台适配层验证 |

## 4. API 目录

| 域 | 端点 | 鉴权 | 关注点 |
|---|---|---|---|
| 系统 | `GET /api/v1/system/public-config` | 匿名 | 公开运行配置白名单 |
| 认证 | `POST /api/v1/auth/*` | 按端点 | 注册、OTP、密码、OAuth、会话 |
| 资料 | `GET/PUT /api/v1/profile/*` | 登录 | 用户资料 |
| 源简历 | `GET/PUT/DELETE /api/v1/source-resume/*` | 登录 | 每用户单份源简历 |
| 历史 | `GET/POST/PATCH/DELETE /api/v1/resume-history/*` | 登录 | 优化历史与快照 |
| V5 单步 | `POST /api/v1/mvp/analyze\|match\|generate\|interview` | 登录；合法 Landing 例外 | 分析、匹配、生成、面试 |
| MVP 兼容 | `POST /api/v1/mvp/process` | 登录 | 多步回归入口，不是生产 H5 主链路 |
| 解析 | `GET /api/v1/parse/health; POST /api/v1/parse/resume-file\|jd-image` | 按文件来源 | OCR、Storage 下载与文件校验 |
| 观测 | `GET /api/v1/mvp/health\|dashboard\|regression-dataset` | 按部署策略 | 健康、指标与回归数据集 |
| 运行记录 | `GET /api/v1/mvp/runs/:run_id[ /replay ]; POST .../failure-samples` | 按部署策略 | Harness run 与回放 |

## 5. 模块准备与清理

| 模块 | 用例数 | 环境 | 前置条件 | 清理 | 主要源码/测试 |
|---|---:|---|---|---|---|
| 环境、配置与接口契约 | 10 | L/N；故障配置仅在隔离进程 | 按执行指南准备隔离环境；保存脱敏配置和基线 SHA；不读取或修改真实生产密钥。 | 停止本用例独立进程并恢复测试配置；删除专用临时数据库。 | backend/src/index.ts; backend/src/config/env.ts; backend/src/config/v5-release.ts; backend/src/routes/system.ts; backend/src/routes/mvp.ts |
| 账号、会话与密码安全 | 20 | N；测试邮箱/独立 Supabase；本地模拟覆盖加密边界 | 准备 A/B 两账号、未注册邮箱 U、过期会话；可截获测试邮件；认证上游可 Mock。 | 撤销测试会话；清理测试邮箱/账号与本地存储；恢复系统时钟 Mock。 | backend/src/routes/auth.ts; backend/src/auth/password-crypto.ts; backend/src/auth/request-context.ts; frontend/Taro/reffo-taro/src/services/auth.ts; frontend/Taro/reffo-taro/src/pages/auth/index.tsx; frontend/Taro/reffo-taro/src/store/sessionManager.ts |
| 主业务流程与 Landing | 16 | L/N；桌面和移动 H5 | 按指南准备 A/B 账号、R01 源简历、J01/J02 岗位；正常模型录制；允许检查 Network 和本账号数据库。 | 删除本账号测试源简历/历史；清理 Landing 待同步数据与结果会话；恢复故障 Mock。 | frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts; frontend/Taro/reffo-taro/src/pages/result/usePageModel.ts; frontend/Taro/reffo-taro/src/utils/pending-landing-data.ts; backend/src/routes/mvp.ts |
| 文件选择、OCR 与云文件 | 16 | L/N；浏览器文件选择器和 OCR Mock；真实 OCR 另计预算 | 准备 fixtures 目录文本；按指南生成 PDF/图片边界文件；A/B 私有 Storage 文件；能记录 OCR 请求次数。 | 删除本用例 Storage 对象/user_files 元数据；清理浏览器 Blob URL 和文件状态；恢复 OCR。 | frontend/Taro/reffo-taro/src/utils/resume-file-upload.ts; frontend/Taro/reffo-taro/src/services/parse.ts; backend/src/routes/parse.ts; backend/src/services/ocr/glm-ocr-provider.ts; supabase/migrations/202607130002_user_files_storage.sql |
| 资料、历史、缓存与配额 | 14 | L/N；SQLite 与独立 Supabase 测试项目分别执行 | 准备 A/B 用户、R01/R02 源简历、J01/J02 JD、H01/H02 历史；固定测试时钟并记录配额时区。 | 删除测试用户的 profile、source resume、history、quota、cache、checkpoint；不触碰其他用户数据。 | backend/src/routes/profile.ts; backend/src/routes/source-resume.ts; backend/src/routes/resume-history.ts; backend/src/services/resume-quota.ts; backend/src/repositories/v5-analysis-cache-repository.ts; backend/src/repositories/v5-checkpoint-repository.ts; supabase/migrations/202607130001_initial_business_schema.sql |
| Harness 观测、回放与回归数据 | 12 | L/N；可写临时 harness.sqlite；生产只读指标 | 准备一次成功 run、一次 provider_failure、一次 blocked_quality_validation、一次 partial/failed run；允许读取脱敏数据库表。 | 删除测试 run、step、attempt、event、artifact、evaluation、failure sample；保存所需指标快照。 | backend/src/harness; backend/src/repositories/harness-run-repository.ts; backend/src/repositories/harness-metrics.ts; backend/src/routes/mvp.ts; backend/src/repositories/database.ts |
| V5 事实安全、质量门禁与交付 | 11 | N；固定 entry-r5、DeepSeek 发布配置；模型响应使用脱敏 fixtures | 准备含数字/日期/团队归属/未来计划/跨 scope 引用/教育经历的 R01 与 J01；准备正确、缺失、冲突和不支持写作输出。 | 清理模型录制、run、artifact 和测试输出；不将真实求职者数据写入 fixtures。 | backend/src/v5/main/workflow.ts; backend/src/v5/delivery-gate.ts; backend/src/v5/evidence.ts; backend/src/v5/writing; backend/src/v5/tests/entry-workflow.test.ts; backend/src/v5/tests/delivery-gate.test.ts |
| 并发、超时、重试与恢复 | 9 | L/N；可控网络、模型、OCR、数据库故障注入 | 所有测试请求带唯一 test-run 标识；可暂停/释放 Promise、模拟 408/429/5xx/网络断开、重启服务。 | 终止注入进程；清理未完成 run、cache pending、checkpoint、队列和临时文件；核对配额未异常增加。 | backend/src/repositories/v5-analysis-cache-repository.ts; backend/src/repositories/v5-checkpoint-repository.ts; backend/src/harness/subscribers/write-queue.ts; frontend/Taro/reffo-taro/src/store/resumeWorkspaceStore.ts; frontend/Taro/reffo-taro/src/utils/retry.ts; frontend/Taro/reffo-taro/src/pages/create/usePageModel.ts |
| 安全、隐私与多租户 | 8 | N；独立 A/B 账号、日志采集、RLS 和 Storage 测试项目 | 准备可识别但虚构的 PII canary、A/B token、不同角色 key；开启访问日志和 Supabase audit。 | 删除 PII canary、token、对象和审计数据；日志脱敏后再归档；不得把测试密钥提交仓库。 | backend/src/auth; backend/src/routes; backend/src/repositories/supabase; supabase/migrations/202607130001_initial_business_schema.sql; supabase/migrations/202607130002_user_files_storage.sql |
| 性能、容量与成本 | 7 | L/N；固定模型录制或受控 Mock，真实模型压测需预算审批 | 建立基线数据集：1/10/100 页简历、10MB 文件、1/10k/100k 历史；记录 CPU、内存、DB、网络、LLM token 和成本。 | 停止压测进程；删除压测用户和数据；恢复 provider 速率限制；保存聚合指标不保存正文。 | backend/src/index.ts; backend/src/routes/mvp.ts; backend/src/services/ocr; backend/src/repositories/database.ts; frontend/Taro/reffo-taro/config/index.ts |
| 发布、回滚与运行维护 | 7 | L/N/P；蓝绿或临时环境，严禁在生产做破坏性注入 | 准备目标环境变量、迁移备份、上一版本镜像/commit、健康探针和告警接收端。 | 回滚应用和配置；保留迁移审计；关闭临时探针/告警路由；清理临时凭据。 | backend/src/deployment.test.ts; backend/src/config/env.ts; backend/src/index.ts; supabase/migrations/README.md; frontend/Taro/reffo-taro/config/index.ts |
| 跨端、可访问性与体验稳定性 | 8 | H5 Chrome/Safari/Firefox；RN Android；小程序构建环境 | 准备 375/393/768/1440 宽度、触摸/键盘、prefers-reduced-motion、低带宽和深浅色测试矩阵。 | 清理浏览器 local storage、service worker、RN bundle 和截图；不提交 .artifacts 临时产物。 | frontend/Taro/reffo-taro/src/pages; frontend/Taro/reffo-taro/src/services; frontend/Taro/reffo-taro/src/utils; frontend/Taro/reffo-taro/config/index.ts; frontend/Taro/reffo-taro/AGENTS.md |

## 6. 测试数据目录

| ID | 名称 | 内容要求 | 用途 |
|---|---|---|---|
| R01 | 标准源简历 | 脱敏 Markdown，含数字、日期、团队归属、教育和计划状态 | P0 业务主链路/V5 事实门禁 |
| R02 | 第二份源简历 | 与 R01 有重叠但至少一项数字和职责不同 | P0 旧响应隔离/替换 |
| J01 | 标准目标 JD | 含岗位、公司、地点、硬技能、软技能和未满足要求 | P0 匹配/生成 |
| J02 | 第二目标 JD | 不同岗位和 scope，避免错误复用匹配上下文 | P0 历史隔离/复用 |
| R-FACT | 事实风险集 | 金额、百分比、数量、单位、日期区间、归属和 planned 状态 | P0 V5 交付门禁 |
| R-NEG | 负面前提集 | JD 要求简历不存在的经历、客户、行业或技术 | P0 不编造/面试边界 |
| F-PDF | PDF 文件集 | 单页、多页、双栏、中英文、空白、损坏、密码 PDF | P0/P1 OCR |
| F-IMG | 图片文件集 | PNG/JPG/JPEG、旋转、模糊、空白和 10MB 边界 | P0/P1 OCR |
| F-TEXT | 文本文件集 | MD/TXT、UTF-8 BOM、CRLF、中文、emoji、乱码 | P1 本地读取 |
| AUTH-A/B | 双账号集 | A/B token、过期 token、刷新 token、未验证邮箱 | P0 多租户/认证 |
| ERR-UP | 上游故障集 | 401、408、429、500、503、DNS、TLS、超时和迟到响应 | P0/P1 故障注入 |
| DB-OLD | 旧数据库集 | 旧版 process_runs/业务表及新增列迁移前备份 | P0 迁移/回滚 |

## 7. 用例明细

执行步骤中的箭头已展开为顺序步骤。每条用例都应记录实际响应、run_id、数据库/指标证据或截图链接，不能只填“接口返回 200”。

### ENV 环境、配置与接口契约

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-ENV-001 | P0 | 本地免登录环境可启动 | APP_ENV=local、SQLite、AUTH_REQUIRED=false；R01 | 1. 使用隔离配置启动服务<br>2. 请求 public-config、mvp/health 和源简历查询 | 公开配置 authRequired=false；health 返回 status、generation、dependencies；业务使用 DEV_USER_ID；无真实 Supabase 鉴权请求 | 代码契约 | API/集成 | 未执行 | 执行时填写 |
| RF-ENV-002 | P0 | 非本地环境禁止关闭鉴权 | nonprod/prod × AUTH_REQUIRED=false；nonprod × sqlite | 1. 分别使用错误组合启动独立进程<br>2. 记录退出码及监听端口 | 启动失败且无可用业务监听；错误指向配置项；不静默降为免登录或 SQLite | 代码契约 | 集成 | 未执行 | 执行时填写 |
| RF-ENV-003 | P0 | 生产与 Supabase 项目环境一致 | prod+SUPABASE_PROJECT_ENV=nonprod；prod+DEV_USER_ID；缺必需 Supabase 配置 | 1. 分别启动错误组合<br>2. 核对日志脱敏与端口 | 各组合启动失败；不连接错误项目；真实值不出现在报告中 | 代码契约 | 集成 | 未执行 | 执行时填写 |
| RF-ENV-004 | P0 | 固定发布模型与显式 thinking 模式 | 非 Flash 模型、错误 endpoint、inherit；enabled/disabled 合法组合 | 1. 逐一启动错误配置<br>2. 启动合法组合并读 health.generation | 错误模型/endpoint/非显式模式被拒绝；合法模式可用；profile=entry-r5，writer_v1；不能照旧 README 断言必须 disabled | 代码契约 | API/集成 | 未执行 | 执行时填写 |
| RF-ENV-005 | P1 | 缺 LLM Key 与缺 OCR Key 分别处理 | 空 OPENAI_API_KEY；仅空 GLM_OCR_API_KEY/GLM_API_KEY | 1. 分别启动<br>2. 对仅 OCR 缺失环境请求 parse/health 和 resume-file | LLM Key 缺失阻止启动；OCR 缺失仅警告，parse/health configured=false，解析返回 503/OCR_CONFIG_MISSING；其他业务仍可用 | 代码契约 | API/集成 | 未执行 | 执行时填写 |
| RF-ENV-006 | P1 | 公开配置字段白名单 | N；有效与缺失公开配置 | 1. 匿名请求 system/public-config、parse/health、mvp/health<br>2. 扫描响应和日志 | public-config 只含公开配置；Publishable Key 可公开；不得含 Secret Key、LLM/OCR Key、私钥或用户正文；health 不按 ApiResponse.data 解包 | 代码契约+安全目标 | API | 未执行 | 执行时填写 |
| RF-ENV-007 | P1 | 参数校验与不存在路由 | 缺字段/null/类型错/畸形 JSON/未知路径 | 1. 在完整 bootstrap 应用发请求<br>2. 比较 HTTP 与错误封装 | Schema 违规为 400/VALIDATION_ERROR；未知路径 404/NOT_FOUND；畸形 JSON 记录实际映射并要求可理解 4xx（待验收）；不把裸路由默认 422 当应用契约 | 代码契约+建议验收 | API | 未执行 | 执行时填写 |
| RF-ENV-008 | P1 | CORS 白名单与预检 | 允许来源、非允许来源；带 Authorization 的 OPTIONS | 1. 从两类 Origin 发预检及请求<br>2. 检查 Access-Control-* | 允许来源可用所需方法和头；非允许来源不可由浏览器跨域读取；CORS 不能代替服务端鉴权；prod 的通配配置单列风险 | 代码契约+安全目标 | 浏览器/API | 未执行 | 执行时填写 |
| RF-ENV-009 | P1 | 配置数值边界 | PORT=0；负保留天数；非法时区；OCR_TIMEOUT_MS=0 | 1. 单独修改每个值启动<br>2. 查询健康与错误信息 | 已校验的端口/保留参数/时区拒绝启动；OCR 非法值在配置健康中标不可用；记录未覆盖参数，不能声称所有非法值均已拦截 | 代码契约 | 集成 | 未执行 | 执行时填写 |
| RF-ENV-010 | P1 | 依赖降级不能由顶层 ok 掩盖 | 缓存表缺失；Harness 数据库不可用 | 1. 注入单依赖故障<br>2. 查询 health 全体字段<br>3. 调用受影响业务 | 缓存 health 为 degraded 且含 V5_ANALYSIS_CACHE_UNAVAILABLE；监控同时解析 dependencies；顶层 status=ok 不能作为所有功能健康的依据 | 代码契约+运维目标 | 故障注入 | 未执行 | 执行时填写 |

### AUTH 账号、会话与密码安全

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-AUTH-001 | P0 | 注册、验证及首次资料创建 | U；8 位及以上密码；合法注册 OTP | 1. 注册<br>2. 验证 signup OTP<br>3. 请求 profile/ 两次 | 验证前不伪造已登录；验证后 session 可访问业务；资料仅一条，头像稳定；验证码长度与冷却取后端返回 | 代码契约 | E2E/API | 未执行 | 执行时填写 |
| RF-AUTH-002 | P0 | 邮箱密码登录 | A；大小写邮箱并带首尾空格 | 1. 获取 crypto-key<br>2. 用客户端加密登录<br>3. 刷新页面查询 A 的源简历 | 邮箱规范为 trim+小写；登录响应可恢复会话；请求中无明文密码；返回且只返回 A 的业务数据 | 代码契约 | E2E/API | 未执行 | 执行时填写 |
| RF-AUTH-003 | P1 | 登录错误映射 | 错误密码；未验证邮箱；认证上游 invalid_credentials/email_not_confirmed | 1. 提交对应登录请求<br>2. 检查 UI、HTTP 与错误码 | 返回 AUTH_INVALID_CREDENTIALS 或 AUTH_EMAIL_NOT_CONFIRMED；非笼统内部错误；不写入 session | 代码契约 | API/UI | 未执行 | 执行时填写 |
| RF-AUTH-004 | P1 | 邮箱及密码输入边界 | 邮箱空/非法/320、321 字符；密码 7/8 位；注册确认密码不一致 | 1. 逐项输入提交<br>2. 记录网络请求<br>3. 绕过前端测 API | UI 密码不足 8 位拦截；Schema 邮箱上限 320；后端解密密码读取范围为 1..1024，不能据 UI 推定 API 最少 8；注册强度还须验 Supabase 策略 | 代码契约+配置验收 | 边界/API/UI | 未执行 | 执行时填写 |
| RF-AUTH-005 | P0 | 验证码登录不创建未知账号 | A/U；email-otp/send 与 verify | 1. 对 A 请求 OTP 并验证<br>2. 对 U 请求<br>3. 检查上游用户数 | A 正常登录；代理发送 create_user=false；U 不被自动注册；错误提示符合上游映射 | 代码契约 | API/集成 | 未执行 | 执行时填写 |
| RF-AUTH-006 | P1 | 验证码错误、过期与类型串用 | 错码、过期码、已用码；email/signup/recovery 相互替用 | 1. 各类 verify 请求错误值<br>2. 同码再用<br>3. 检查 session | 错误/过期映射 AUTH_OTP_INVALID/AUTH_OTP_EXPIRED（依上游码）；类型串用及重复使用不得产生有效会话；不得直接进入重置完成态 | 代码契约+安全目标 | API | 未执行 | 执行时填写 |
| RF-AUTH-007 | P1 | 验证码重发与限流 | AUTH_OTP_LENGTH=6/8；resend_after_seconds=60；上游 429 | 1. 连点发送/重发<br>2. 切换页面再返回<br>3. 注入 429 | 位数与冷却随配置；UI 不并发滥发；429→AUTH_RATE_LIMITED；客户端倒计时不代替上游限流 | 代码契约+建议验收 | UI/API | 未执行 | 执行时填写 |
| RF-AUTH-008 | P0 | 忘记密码完整链路 | A；合法 recovery OTP；新密码 | 1. password-reset/request<br>2. verify<br>3. 加密 password-update<br>4. 新旧密码登录 | 先验证再更新；旧密码不可再登录，新密码可登录；恢复 token 不被误存为普通长期会话；日志不含密码 | 代码契约+安全目标 | E2E | 未执行 | 执行时填写 |
| RF-AUTH-009 | P0 | 未授权或过期 token 更新密码 | 缺 access_token/过期 token/B token 与 A 邮箱 | 1. 构造加密更新载荷<br>2. 校验实际被修改用户 | 缺/过期 token 拒绝；只允许 token 所属账号；不能靠更换邮箱更新 A 密码 | 代码契约 | API | 未执行 | 执行时填写 |
| RF-AUTH-010 | P0 | 密码端点拒绝明文 | sign-in/sign-up/password-update；明文 JSON | 1. 直接发 email/password<br>2. 监听认证上游调用 | 完整应用拒绝 Schema 或加密校验；上游调用数为 0；不回显明文 | 代码契约 | API | 未执行 | 执行时填写 |
| RF-AUTH-011 | P0 | 加密载荷防篡改 | 改 key_id、version、iv、ciphertext、encrypted_key 任一项 | 1. 复制合法信封<br>2. 单字段修改后提交 | 返回 400 的加密校验错误；上游不收到密码；合法原文不进入错误日志 | 代码契约 | API/单元 | 未执行 | 执行时填写 |
| RF-AUTH-012 | P0 | 加密时间窗与单实例重放 | 时间偏移 ±119999/±120001ms；相同 nonce | 1. Mock 时钟分别提交<br>2. 同实例再次发已成功信封 | 超过 2 分钟拒绝；时间边界内仍需完整加密校验；同实例重复 nonce 拒绝；不把 5 分钟 nonce TTL 当载荷时间窗 | 代码契约 | 单元/API | 未执行 | 执行时填写 |
| RF-AUTH-013 | P1 | 多实例密钥与 nonce 重放 | 两实例同稳定私钥；两实例临时私钥 | 1. A 获取公钥、B 接收密文<br>2. 同信封先后发 A/B<br>3. 重启 A 后再发 | 稳定密钥跨实例解密可用；临时密钥跨实例失败需可恢复；nonce 当前进程内存保存，多实例防重放是待验证风险，安全目标为全局拒绝重复 | 静态风险+建议验收 | 集成/安全 | 未执行 | 执行时填写 |
| RF-AUTH-014 | P0 | Bearer 鉴权边界 | 无头/Basic/空 Bearer/过期或伪造 token | 1. 请求 source-resume、history、profile 和受保护 mvp<br>2. 计数下游调用 | 无头 AUTH_REQUIRED；格式错 INVALID_AUTHORIZATION_HEADER；无效 token INVALID_ACCESS_TOKEN；均不执行业务/LLM | 代码契约 | API | 未执行 | 执行时填写 |
| RF-AUTH-015 | P1 | 登录态提前刷新 | expiresAt 距当前 31s/30s/已过期；有效 refreshToken | 1. 恢复页面会话<br>2. 观察 refresh 次数和后续 Authorization | 到期前 30s 内触发刷新；有效会话延续；新 token 持久化；同页面并发恢复不混用新旧 token | 代码契约+并发目标 | 集成/UI | 未执行 | 执行时填写 |
| RF-AUTH-016 | P1 | 会话刷新失败 | refresh 401/网络断开/无效 refreshToken | 1. 恢复即将过期会话并注入失败<br>2. 查看 API token 和页面 | 当前实现清理过期会话并回到未登录；不继续使用失效 token；输入/账号私有数据不得串给后续账号 | 代码契约 | UI/API | 未执行 | 执行时填写 |
| RF-AUTH-017 | P0 | 退出登录完整清理 | A 的源简历、历史、latest result 已加载 | 1. 退出<br>2. 检查内存 store/持久 key/API token<br>3. 登录 B | A 会话和账号数据清除；B 页面不闪现 A 数据；当前退出是本地清理，不宣称服务端 token 已撤销 | 代码契约+安全目标 | E2E | 未执行 | 执行时填写 |
| RF-AUTH-018 | P0 | 退出时在途请求不污染下一账号 | A 发慢查询/生成请求，随后退出登录 B | 1. 暂停 A 响应<br>2. 切换 B<br>3. 释放 A 响应 | A 的迟到结果不落入 B store、历史或缓存；若污染，按 S1 数据隔离缺陷处理 | 可靠性验收 | 故障注入/E2E | 未执行 | 执行时填写 |
| RF-AUTH-019 | P1 | OAuth provider 与回调校验 | github/google/apple；非法 provider；javascript:、畸形 URL、外部 HTTPS | 1. 调 oauth-url<br>2. 测支持 provider 回调成功/取消<br>3. 测非允许域 | 协议错 400/AUTH_INVALID_REDIRECT；未知 provider Schema 拒绝；域名限制依 Supabase allowlist 验证；取消不伪造 session；记录已启用 provider | 代码契约+部署验收 | API/E2E | 未执行 | 执行时填写 |
| RF-AUTH-020 | P1 | 本地与云环境会话隔离 | 浏览器含 nonprod token 后连接 L；再回 N | 1. L 恢复会话并请求<br>2. 切换 N<br>3. 检查存储迁移 | L 免登录请求不携带残留云 token；N 使用对应存储 key；旧 key 迁移不跨环境串号；格式错误 Authorization 在解析阶段仍可能拒绝 | 代码契约 | 集成/UI | 未执行 | 执行时填写 |

### FLOW 主业务流程与 Landing

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-FLOW-001 | P0 | 首次创建并保存回首页 | A 无源简历/历史；R01+J01 | 1. 上传并确认源简历<br>2. 输入 JD 开始生成<br>3. 等待面试完成并保存<br>4. 完成页回首页、刷新、开卡 | 调用 analyze→match→generate→interview 单步序列；各阶段依赖正确；保存一条可还原快照；首页卡片对应同一公司/岗位/正文；生产 H5 不调用 process | 代码契约+端到端验收 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-002 | P0 | 复用源简历生成第二岗位 | 已有 R01 和 J01 历史；J02 | 1. 首页创建<br>2. 复用 R01 输入 J02<br>3. 完成保存<br>4. 分别打开两卡 | 两份历史 JD 和成品互不污染；源简历保持 R01；分析可命中缓存；按 J02 重新匹配，不复用 J01 匹配上下文 | 端到端验收 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-003 | P0 | 未完成时禁止保存和完成 | match/generate/interview 分别延迟 | 1. 每阶段尝试保存/完成<br>2. 释放响应<br>3. 再保存 | 当前 UI 以 interview=done 作为保存门槛；未完成提示生成中，不能生成成功历史/跳完成页；完成后才可保存 | 代码契约 | UI/集成 | 未执行 | 执行时填写 |
| RF-FLOW-004 | P0 | 各阶段失败的局部恢复 | 依次注入分析/匹配/生成/面试失败 | 1. 启动生成<br>2. 在指定阶段失败<br>3. 点击可用重试<br>4. 查看网络调用 | 错误定位到阶段；已成功正文保留；匹配/生成/面试按未完成阶段续作；分析失败返回可重新分析入口；失败面试不能冒充完成；记录保存被阻塞影响 | 代码契约+恢复验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FLOW-005 | P0 | 快速连点生成/保存/完成 | 一次成功输入；10 次快速点击 | 1. 连点各操作<br>2. 等待全部响应<br>3. 查 provider 次数、history 数和路由栈 | 一次用户动作只形成一套有效流程/一条历史/一次导航；若并发重复记录或模型调用，按可靠性缺陷登记；不能仅凭按钮禁用判定 | 可靠性验收 | 并发/UI | 未执行 | 执行时填写 |
| RF-FLOW-006 | P0 | 取消生成后迟到响应 | 在 analyze/match/generate 分别暂停响应 | 1. 点击取消或回首页<br>2. 开始新 R02/J02 流程<br>3. 释放旧响应 | 旧响应不能覆盖新流程/store/session；UI 退出 loading；前端取消不等于服务端终止，记录 provider 继续执行和配额实际消耗 | 可靠性验收 | 故障注入/E2E | 未执行 | 执行时填写 |
| RF-FLOW-007 | P1 | 刷新、返回和深链恢复 | 创建页每一步；结果页完整/部分 session；无 session | 1. 分别刷新和浏览器前进后退<br>2. 直接打开结果 URL<br>3. 检查续作 | 有合法 session 可正确还原阶段；已完成阶段不重复调用；无上下文给可用返回入口，无无限 loading/白屏；过期检查点须提示重新分析 | 代码契约+恢复验收 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-008 | P1 | 历史元信息编辑 | 已保存历史 H1 | 1. 开卡进入编辑<br>2. 修改公司/岗位/工作地<br>3. 保存并刷新 | 仅更新元信息；不重新上传 JD 或触发生成；原 source/JD/正文保留；首页和详情元信息一致 | 代码契约 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-009 | P1 | 优化正文人工编辑与再保存 | H1 有 strategy_review；删除被引用句并改正文 | 1. 编辑成品<br>2. 返回/刷新<br>3. 再保存<br>4. 查快照/摘要 | 正文和 session 一致；旧引用不作为新正文证据；编辑后 saved=false；新建版本还是更新原 ID 当前需产品确认，用例记录实际 ID，禁止覆盖错卡或无提示丢稿 | 代码契约+待确认 | UI/数据库 | 未执行 | 执行时填写 |
| RF-FLOW-010 | P1 | JD 文本与附件切换 | J01；解析成功图片和解析失败图片 | 1. 手动输入<br>2. 切到附件<br>3. 切回手动<br>4. 提交 | 展示内容与实际发出的 JD 一致；解析失败附件不得算可生成输入；只有公司/岗位字段时不能绕过有效 JD 校验；输入 1..9 字时给明确校验错误 | 业务验收 | UI/API | 未执行 | 执行时填写 |
| RF-FLOW-011 | P0 | Landing 预设体验 | 匿名新浏览器；预设简历+合法预设 JD | 1. 进入引导选择简历和岗位<br>2. 生成至结果<br>3. 保存 | 白名单请求携带 landing=true 和对应 preset_jd_id；无需登录可体验；不向认证历史接口偷写；结果保存到待同步存储 | 代码契约 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-012 | P0 | Landing 自定义 JD 边界 | 匿名选择自定义 JD；合法/缺失 preset id | 1. 不登录走自定义流程<br>2. 截获 match/generate 请求<br>3. 登录后重试 | 匿名 match/generate/interview 仅合法 preset 白名单放行；任意 jd_text+landing=true 不自动放行；UI 能正确引导登录，不能永久 loading | 代码契约+UI 验收 | E2E/API | 未执行 | 执行时填写 |
| RF-FLOW-013 | P1 | Landing 上传本人简历 | 匿名上传 R01.pdf、R01.md；有效预设 JD | 1. 上传预览<br>2. 生成<br>3. 退出并重新进入 | PDF guest 只允许 inline base64；MD/TXT 本地读取；显示本人数据而非预设残留；不存在云 Storage 路径匿名读能力 | 代码契约 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-014 | P0 | 登录后同步与拒绝同步 | 本地待同步源简历/两历史；A 无云数据 | 1. 登录 A<br>2. 分别测试同意/拒绝源简历及历史同步<br>3. 刷新 | 仅用户同意的数据上传；拒绝不上传；当前实现完成处理后清待同步 key；记录拒绝即删除本地待同步材料的产品语义；不静默跨账号上传 | 代码契约+隐私验收 | E2E | 未执行 | 执行时填写 |
| RF-FLOW-015 | P0 | 同步冲突、部分失败与幂等 | A 已有云源简历/同 history ID/同 preset；第 2 条写失败 | 1. 触发同步<br>2. 失败后刷新重试<br>3. 比较云记录和待同步 key | 不覆盖已有云源简历；按 history ID/preset 去重的当前行为可观察；部分失败不丢待同步剩余项；重复同步不生多份；同 preset 不同简历被去重的语义待确认 | 代码契约+可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FLOW-016 | P1 | 分享及无结果页降级 | 分享 API 不支持；缺 result/historyId | 1. 点分享<br>2. 直接打开空完成/结果页 | 不支持时提示“分享功能暂不可用”；无崩溃或假成功；不把当前分享菜单当作 PDF 导出功能验收；空结果能返回主流程 | 代码契约 | UI | 未执行 | 执行时填写 |

### FILE 文件选择、OCR 与云文件

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-FILE-001 | P0 | PDF 正常解析与事实保留 | 单页/多页、双栏 PDF；中英文 R01 | 1. 上传 PDF<br>2. 对照已知文字顺序和字段<br>3. 保存预览 | 返回 markdown 或 rawText、warnings、usage/run_id（有则核对）；日期、数字、归属无静默丢失；多栏顺序可理解；OCR 不自动等同事实校验通过 | 业务验收 | OCR/人工 | 未执行 | 执行时填写 |
| RF-FILE-002 | P0 | JD 图片支持格式 | 同一 J01 的 PNG/JPG/JPEG | 1. 逐个上传<br>2. 核对 structured.jdText/公司/岗位/地点<br>3. 进入匹配 | 三种扩展和匹配 MIME 可用；原文和结构化内容一致；不凭 OCR 猜出材料没有的公司或岗位 | 代码契约+业务验收 | OCR/UI | 未执行 | 执行时填写 |
| RF-FILE-003 | P1 | MD/TXT 本地读取 | R01.md、R01.txt；中文/emoji/CRLF/BOM | 1. 选择各文件<br>2. 观察请求<br>3. 对照预览 | MD/TXT 直接读取，无 OCR 外呼；trim 后非空；乱码不能悄悄通过；特殊符号与数字保留 | 代码契约 | UI/网络 | 未执行 | 执行时填写 |
| RF-FILE-004 | P1 | DOC/DOCX 与其他不支持格式 | doc/docx/rtf/zip/heic/webp | 1. 选择文件<br>2. 等待处理<br>3. 换有效 PDF | 当前 DOC/DOCX 可选择但明确提示另存 PDF/MD/TXT；其他格式拒绝；不显示成功或发送伪 PDF 给 OCR；错误后可恢复 | 代码契约 | UI/API | 未执行 | 执行时填写 |
| RF-FILE-005 | P0 | 文件大小真实字节边界 | 0、1、10MiB−1、10MiB、10MiB+1；OCR_MAX_FILE_SIZE_MB=10 | 1. UI 和绕过 UI 各发一组<br>2. 计 provider 外呼 | >10MiB 拒绝；恰好 10MiB 通过大小门禁但仍须合法内容；0 字节无可用结果；后端按解码/下载后的 buffer 长度校验，不能信 size_bytes | 代码契约 | 边界/API | 未执行 | 执行时填写 |
| RF-FILE-006 | P0 | 扩展、MIME 和文件内容不一致 | PDF 名称+image/png；PNG 名称+PDF MIME；PDF 名称/MIME+垃圾字节 | 1. POST 两解析端点<br>2. 检查错误和外呼 | 扩展/MIME 不允许时 400/OCR_UNSUPPORTED_FILE；当前代码无魔数识别保证，垃圾文件必须安全失败不崩溃；记录是否被送上游作为风险 | 代码契约+安全验收 | API | 未执行 | 执行时填写 |
| RF-FILE-007 | P1 | Base64 与文件来源字段 | 纯 base64/data URL；无内容；非法编码；同时 content_base64/storage_path | 1. 逐项请求<br>2. 查文件来源/解析字节 | 无内容 OCR_FILE_MISSING；合法两种编码可解码；同时存在按 storage_path 优先；非法编码不得假成功，记录 Buffer 宽松解码实际行为 | 代码契约+建议验收 | API | 未执行 | 执行时填写 |
| RF-FILE-008 | P1 | 文件名边界与取消选择 | 中文、空格、超长、多个点、大写扩展；取消选择 | 1. 分别选择文件<br>2. 取消<br>3. 再选择 | 文件名不会变成路径/脚本；扩展按小写判断；取消不报解析失败、不清已确认有效数据；UI 长名称不遮挡操作 | 代码契约+UI 验收 | UI | 未执行 | 执行时填写 |
| RF-FILE-009 | P0 | 替换文件时响应竞态 | 先上传慢 PDF A，再选择快 PDF B | 1. 暂停 A<br>2. 完成 B<br>3. 释放 A | 最终文件名、内容、进度均为 B；旧 A 响应不覆盖；卸载页面后不回写状态；待用对象资源释放 | 可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FILE-010 | P0 | 私有云上传链路 | A 有效 token；R01.pdf；user-files 私有 bucket | 1. 上传<br>2. 后端 storage_path 解析<br>3. 核对请求凭据和元数据 | 路径首段是 A.id；后端以用户 token 下载；写 user_files.user_id=A；不使用 Secret Key 给浏览器；对象默认不可匿名读取 | 代码契约 | 集成/安全 | 未执行 | 执行时填写 |
| RF-FILE-011 | P0 | Storage 跨账号越权 | A 对象路径；B token；无 token；伪 bucket/../路径 | 1. B/匿名直接下载及请求解析<br>2. 检查对象/元数据 | 不得读到 A 内容；RLS 和后端鉴权共同阻止；无越权元数据写入；storage_path 不形成任意外部 URL 请求 | 安全验收 | API/安全 | 未执行 | 执行时填写 |
| RF-FILE-012 | P1 | 上传、元数据及 OCR 部分失败 | 对象上传成功后：下载失败/user_files 写失败/OCR 失败 | 1. 逐段注入失败<br>2. 点击重试<br>3. 比对对象和元数据数 | 错误指向真实阶段；输入可重试；不假成功；重复对象/元数据及孤儿对象应有明确清理方案，当前实现是否具备需验证 | 可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FILE-013 | P1 | OCR 空输出、低清和复杂文档 | 空白扫描、密码 PDF、损坏 PDF、旋转/模糊图片 | 1. 每个文件解析<br>2. 查看 warnings/错误<br>3. 换有效文件 | 空输出 OCR_EMPTY_OUTPUT；不可读有可理解错误；不得生成空白成功简历；低清内容要求人工复核且不编造字段 | 代码契约+业务验收 | OCR/人工 | 未执行 | 执行时填写 |
| RF-FILE-014 | P1 | OCR 超时与多层重试 | provider 延迟 59/61/149/151/181s；默认 OCR_TIMEOUT=150s | 1. 分别解析 JD 图片与 PDF<br>2. 记录客户端/后端结束与 provider 次数 | 图片客户端 60s、PDF 180s、后端 150s 的差异被识别；超时显示可重试，迟到结果不污染；记录图片可能在后端未结束时自动重试的成本风险 | 静态风险+可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FILE-015 | P1 | OCR 鉴权、限流、TLS 故障 | 上游 401/429/500；无效 CA；缺 Key | 1. 注入上游状态或 CA 验证失败<br>2. 检查错误/日志/重试次数 | 保留可诊断 OCR 码，不泄漏 Key；缺 Key 503；证书故障不能通过禁用 TLS 验证绕过；重试有上限 | 代码契约+安全验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-FILE-016 | P0 | 匿名解析边界 | landing=true/false；resume-file inline vs storage；jd-image inline | 1. 匿名逐组合请求<br>2. 检查是否下载/外呼 | 仅 landing=true+简历 inline+无 storage_path 可匿名；JD 图片/云对象不开放；伪造 landing 不放宽其他端点 | 代码契约 | API | 未执行 | 执行时填写 |

### DATA 资料、历史、缓存与配额

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-DATA-001 | P0 | Profile 首次创建与幂等更新 | A；display_name/avatar_url 合法、空值与重复提交 | 1. 首次读取 profile<br>2. 更新资料<br>3. 重复相同更新<br>4. 刷新读取 | 首次返回稳定默认值；更新只影响 A；重复提交不生成重复 profile 或错误时间戳；字段长度和 URL 校验可诊断 | 代码契约+可靠性验收 | API/集成 | 未执行 | 执行时填写 |
| RF-DATA-002 | P0 | 源简历单例与替换 | A 的 R01；再次提交 R02；并发两个更新 | 1. 创建 R01<br>2. 查询<br>3. 替换为 R02<br>4. 并发保存 R03/R04 | 每个用户至多一条 source resume；最终版本满足定义的 last-write 规则；不会出现多条或跨用户记录；Storage 元数据与正文一致 | 代码契约+可靠性验收 | API/并发 | 未执行 | 执行时填写 |
| RF-DATA-003 | P0 | 历史保存快照完整性 | H01 含正文/JD/评分/建议/进度/颜色 | 1. 保存 H01<br>2. 列表查询<br>3. 详情查询<br>4. 重启后再查 | 字段不丢失、不被 JSON 类型改变；列表和详情使用同一 id；重启后仍可还原完整结果；同 id 更新行为符合接口约定 | 代码契约 | API/数据库 | 未执行 | 执行时填写 |
| RF-DATA-004 | P1 | 历史元信息更新原子性 | H01；合法更新与中途数据库失败 | 1. 更新 position/company/name<br>2. 注入单字段失败<br>3. 重新读取 | 成功时所有元信息一致；失败不产生半更新；正文、JD、optimized_content、process_result 不被覆盖；错误可重试 | 可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-DATA-005 | P0 | A/B 资料隔离 | A/B 各有 source resume、history、profile | 1. A 查询全部资源<br>2. 用 B token 访问 A id<br>3. 交换请求路径与 body | B/匿名不能读、改、删 A 数据；错误不泄漏 A 的存在、标题或正文；SQLite DEV_USER_ID 也不可伪造 user_id | 代码契约+安全目标 | 安全/API | 未执行 | 执行时填写 |
| RF-DATA-006 | P0 | 配额正常消费与查询 | N；daily limit=3；A 当日 0/1/2/3 次 | 1. 查询 quota<br>2. 成功分析 miss<br>3. 再查询<br>4. 达到上限后请求 | 查询返回 limit/used/remaining；只有分析缓存 miss/disabled 消费一次；达到上限返回 429/RESUME_DAILY_LIMIT_REACHED 和 limit/used；命中缓存不重复消费 | 代码契约 | API/集成 | 未执行 | 执行时填写 |
| RF-DATA-007 | P0 | 配额原子并发边界 | limit=3；同一 A 并发 10 个分析 miss | 1. 同时发 10 个请求<br>2. 等待所有结果<br>3. 查询 quota 和 provider 次数 | 成功数不超过 3；used_count 不超过 limit；失败/拒绝请求不把计数写成负数或重复计数；每个成功 miss 与消费记录可对账 | 可靠性验收 | 并发/数据库 | 未执行 | 执行时填写 |
| RF-DATA-008 | P1 | 配额日期与时区切换 | Asia/Shanghai；UTC 跨日 23:59:59/00:00:01；自定义合法时区 | 1. Mock 时间跨本地日界<br>2. 分别请求 quota/分析<br>3. 对比 quota_date | 按 RESUME_QUOTA_TIME_ZONE 切日，不按机器本地时区；新日从 0 计；非法时区在启动时拒绝或明确降级 | 代码契约+建议验收 | 边界/API | 未执行 | 执行时填写 |
| RF-DATA-009 | P0 | 缓存命中、过期和 owner 隔离 | 同 resume fingerprint；A/B；TTL 前后 | 1. A 首次分析<br>2. A 重复分析<br>3. B 使用相同正文<br>4. 时间推进 24h 后再请求 | A 首次 miss、第二次 hit；B 不命中 A；过期后重新计算并消费配额；hit_count 只按成功读取递增且不影响 payload | 代码契约 | API/数据库 | 未执行 | 执行时填写 |
| RF-DATA-010 | P0 | 缓存租约并发合并 | 同 owner/fingerprint；10 个并发 miss；lease=150s | 1. 同时发分析<br>2. 记录 claim/compute/provider 次数<br>3. 释放响应 | 同实例返回 coalesced；分布式场景最多一个有效 lease 执行 compute；其他请求等待 ready；不重复消耗模型调用或配额 | 代码契约+可靠性验收 | 并发 | 未执行 | 执行时填写 |
| RF-DATA-011 | P1 | 缓存租约过期接管 | 首请求持有 lease 后宕机；模拟 lease 过期 | 1. 创建 pending<br>2. 等待过期<br>3. 第二实例 claim<br>4. 第一实例迟到 complete | 第二实例可安全接管；迟到旧 token 不能覆盖 ready；不会产生双份可见 payload；失败记录可清理 | 代码契约+可靠性验收 | 故障注入/数据库 | 未执行 | 执行时填写 |
| RF-DATA-012 | P0 | 检查点 owner、指纹与 TTL | A 的合法 _v5_context；B token、篡改 token、24h 后 token | 1. A analyze 获取句柄<br>2. B/A 错 owner 调 match<br>3. 修改 1 字符<br>4. 过期后继续 | 仅 A 的原句柄和同 fingerprint 可继续；错误统一为 409/V5_CHECKPOINT_UNAVAILABLE；前端不拿到原文；过期行可清理 | 代码契约 | API/安全 | 未执行 | 执行时填写 |
| RF-DATA-013 | P1 | SQLite 与 Supabase 数据访问等价 | 同一组 R01/H01/配额/缓存数据 | 1. 在两 provider 执行相同 CRUD<br>2. 对比响应、错误、排序、更新语义 | 公开 API 行为等价；差异仅限部署实现并记录；RLS/服务角色路径不改变业务隔离；迁移缺表时失败可诊断 | 建议验收 | 集成/数据库 | 未执行 | 执行时填写 |
| RF-DATA-014 | P1 | 数据库迁移与旧数据兼容 | 旧版 process_runs/业务表；新增列/索引迁移 | 1. 备份数据库<br>2. 执行迁移一次<br>3. 重复执行<br>4. 读取旧记录 | 迁移幂等；旧数据保留；新列默认值可被 Harness 读取；失败可回滚或恢复备份；schema_versions 可追踪版本 | 代码契约+运维目标 | 迁移 | 未执行 | 执行时填写 |

### HARNESS Harness 观测、回放与回归数据

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-HARNESS-001 | P0 | 成功 run 的层级记录完整 | 正常 V5 entry-r5 流程 | 1. 执行 analyze→match→generate→interview<br>2. 查询 run<br>3. 校验数据库层级 | process_run、每个 step_run、attempt、事件、artifact、evaluation 均可关联；workflow_version/profile/release_status/decision 一致；run_id 在响应和持久化相同 | 代码契约 | API/数据库 | 未执行 | 执行时填写 |
| RF-HARNESS-002 | P0 | 失败 run 状态和错误可诊断 | provider 503、schema invalid、质量门禁阻断 | 1. 分别触发失败<br>2. 查响应 error<br>3. 查 run 与 failure sample | HTTP 状态、稳定 error code、agent_state、issue_codes、retryable、run_id 相互一致；失败不被标为 succeeded/deliver；日志不含正文和密钥 | 代码契约 | 故障注入/API | 未执行 | 执行时填写 |
| RF-HARNESS-003 | P0 | 事件顺序与 attempt 物理调用计数 | 带 repair attempt、并行 P01 chunk、重复 prompt | 1. 采集 provider.requested/responded、evaluation、artifact 事件<br>2. 汇总 metrics | 事件时间和 step 顺序可解释；物理 provider 调用不因相同 prompt 被错误合并；token、latency、repair、physicalAttempts 不重复或漏计 | 代码契约 | 数据库/指标 | 未执行 | 执行时填写 |
| RF-HARNESS-004 | P1 | 写队列宕机与重启恢复 | 持久化写队列有未刷事件时进程重启 | 1. 暂停数据库写入<br>2. 触发事件<br>3. 重启服务<br>4. 恢复写入 | 已确认事件最终落库或进入可告警死信；不乱序、不重复主键冲突；run 业务结果与观测状态差异可发现 | 可靠性验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-HARNESS-005 | P0 | run 查询最小暴露 | 含 PII 的原始简历/JD/prompt artifact | 1. GET run<br>2. GET replay<br>3. 检查响应、日志和导出 | run/replay 只返回事件摘要、哈希、状态和必要指标；不返回完整简历/JD/prompt 原文、token、Authorization 或密钥；failure sample 同样脱敏 | 代码契约+安全目标 | API/安全 | 未执行 | 执行时填写 |
| RF-HARNESS-006 | P1 | 不存在 run 与恶意 run_id | 空、超长、SQL 特殊字符、其他用户 run_id | 1. 查询 runs/:run_id、replay、failure-samples<br>2. 比较状态和日志 | 统一 404/RUN_NOT_FOUND；不执行任意 SQL；不泄漏其他 run 的存在或内容；reason 长度和字符集有边界 | 代码契约 | API/安全 | 未执行 | 执行时填写 |
| RF-HARNESS-007 | P0 | Replay 可重复且不触发模型 | 已成功和失败 run；缺失/乱序事件 | 1. 调 replay<br>2. 记录 provider 调用<br>3. 重复 replay | 返回稳定事件摘要/聚合；不发起 LLM/OCR；重复读取无副作用；损坏事件给出可诊断错误或降级，不崩溃 | 代码契约+可靠性验收 | API/集成 | 未执行 | 执行时填写 |
| RF-HARNESS-008 | P0 | Failure sample 幂等回流 | 失败 run；相同 reason 连续提交 2 次；成功 run 提交 | 1. POST failure-samples<br>2. 重复提交<br>3. 查询 regression-dataset | 同一 run 至多一个 sample 或明确版本行为；失败 run 可回流；成功 run 的规则符合接口定义；数据集包含必要摘要与 reason | 代码契约 | API/数据库 | 未执行 | 执行时填写 |
| RF-HARNESS-009 | P1 | 回归数据集 limit 与状态过滤 | limit 缺省/0/1/20/负数/超大；mixed run 状态 | 1. GET regression-dataset?limit=…<br>2. 对比样本数量、排序和字段 | 默认 20；limit 不导致全表无界读取；只含 failed/partial 设计范围；排序稳定；非法值返回 4xx 或采用记录明确的截断策略 | 代码契约+建议验收 | API/性能 | 未执行 | 执行时填写 |
| RF-HARNESS-010 | P0 | Dashboard 指标聚合准确 | 多 run、多 step、多 attempt、repair、evaluation | 1. 预置已知计数<br>2. GET dashboard<br>3. 手工 SQL 对账 | run/step/attempt/repair/token/latency/cost/failure sample 数与数据库一致；并行事件不双计；delivery gate 指标可解释；空库返回零而非 NaN | 代码契约 | API/指标 | 未执行 | 执行时填写 |
| RF-HARNESS-011 | P1 | Harness 保留与级联清理 | 过期 process_runs 及关联表；仍在运行 run | 1. 执行清理任务<br>2. 查询各表外键<br>3. 再查 active run | 只清理超过保留期且非 active 记录；step/attempt/event/artifact/evaluation/sample 无孤儿；删除失败告警且可重试 | 代码契约+运维目标 | 数据库 | 未执行 | 执行时填写 |
| RF-HARNESS-012 | P1 | SQLite 多进程锁与连接所有权 | 两个服务进程共享 HARNESS_DATABASE_PATH | 1. 并发启动/写 run<br>2. 停止一进程<br>3. 另一进程继续写 | 只有一个 owner 或明确拒绝；不破坏数据库；锁文件清理；健康状态反映不可用而非假 ok | 代码契约 | 故障注入 | 未执行 | 执行时填写 |

### V5 V5 事实安全、质量门禁与交付

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-V5-001 | P0 | 数字、日期与单位保真 | R01 含金额、百分比、数量、时间区间、单位 | 1. 分析并生成<br>2. 抽取成品 claims<br>3. 与 source 对账 | 数字等价或有明确限定；单位/小数/正负/日期顺序不变；无法证明的数字不写成确定事实；门禁阻断冲突 | 代码契约+业务安全 | 模型回归/人工 | 未执行 | 执行时填写 |
| RF-V5-002 | P0 | 团队归属与职责边界 | 同一项目有个人/团队/客户归属；J01 要求不同 scope | 1. 生成<br>2. 检查每段 evidence/citation<br>3. 检查 unsupported claims | 不得把团队成果改为个人成果；跨 scope 证据不复用；无法归属时使用限定表述或阻断交付 | 代码契约+业务安全 | 模型回归 | 未执行 | 执行时填写 |
| RF-V5-003 | P0 | 未来计划与已完成事实区分 | R01 含 planned/ongoing/targeted 项；目标 JD 强调已落地 | 1. 生成<br>2. 比对时间状态词<br>3. 检查门禁 | 计划不写成已完成；时间状态保持；不存在当前任职/项目的编造；违反时交付被阻断 | 代码契约 | 模型回归 | 未执行 | 执行时填写 |
| RF-V5-004 | P0 | 负面前提与不存在经历 | J01 询问 R01 没有的行业/技术/项目 | 1. 运行 matching/writer/interview<br>2. 搜索新事实 | 只能明确标记缺口或建议补充；不编造经历、客户、指标；面试问题不得假定不存在事实已发生 | 代码契约 | 模型回归 | 未执行 | 执行时填写 |
| RF-V5-005 | P0 | 支持写作范围与安全 fallback | 输入触发 unsupported writing 或 provider partial output | 1. 触发阻断<br>2. 检查 API/UI/result/history/artifact | 内部可保存诊断和 fallback；用户不得收到不完整或低可信简历；错误含 run_id、retryable 和恢复建议；不把 fallback 标记为 deliver | 代码契约 | 故障注入/E2E | 未执行 | 执行时填写 |
| RF-V5-006 | P0 | 交付门禁 fail-closed | 逐一注入 ENTRY_SET_INVALID、事实冲突、引用缺失、结构不完整 | 1. 执行 generate<br>2. 观察 HTTP、run、history 和页面 | 任一高风险 issue 阻断交付；不创建成功历史；门禁决策、issue code、agent_state 一致；只有通过才进入 interview/保存 | 代码契约 | API/数据库 | 未执行 | 执行时填写 |
| RF-V5-007 | P1 | 修复次数和评估预算有界 | 连续 schema invalid、P01R/P03R 多次触发、token 预算耗尽 | 1. 注入连续失败<br>2. 统计 provider attempts/tokens<br>3. 等待终止 | repair 和 LLM judge 次数不超过配置预算；耗尽后稳定失败并给恢复建议；无无限重试、递归或配额泄漏 | 代码契约+容量目标 | 故障注入/指标 | 未执行 | 执行时填写 |
| RF-V5-008 | P0 | 服务端产物与 interview 输入一致 | 合法 analysis/matching/optimized_resume；篡改正文/旧 checkpoint | 1. generate 成功<br>2. 修改 optimized_resume 一字符调用 interview<br>3. 用原文再调用 | 篡改或与服务端产物不一致被拒；原文可生成面试建议；interview 不接受任意前端伪造 resume；run 记录引用同一 artifact | 代码契约 | API/安全 | 未执行 | 执行时填写 |
| RF-V5-009 | P1 | 输出语言与 Markdown 结构 | zh-CN/en-US；emoji、表格、空段落、超长标题 | 1. 分别生成<br>2. 解析 Markdown<br>3. 渲染 H5 结果页 | 语言偏好遵循可支持范围；标题/项目/教育/技能结构稳定；非法 language 给 4xx 或明确默认；渲染不丢文字、不注入 HTML | 代码契约+UI 验收 | API/UI | 未执行 | 执行时填写 |
| RF-V5-010 | P1 | 证据、引用与摘要可追溯 | 含多个 source excerpt、strategy、timeline artifact | 1. 查询 generate/interview 结果<br>2. 追踪 citation/source id<br>3. replay run | 每个高风险 claim 可追溯到 source；摘要不创造新事实；artifact provenance、planOrigin、artifactOrigin 合法；脱敏后仍可 debug | 代码契约 | 模型回归/数据库 | 未执行 | 执行时填写 |
| RF-V5-011 | P1 | Prompt 发布资产一致性 | manifest、prompt hash、profile entry-r5、writer_v1 | 1. 启动服务<br>2. 读取 health.generation<br>3. 查 run metadata | 运行时 prompt 版本/hash 与发布配置一致；缺 manifest 或 hash 不静默使用旧 prompt；回滚后可识别版本差异 | 代码契约+部署验收 | 集成 | 未执行 | 执行时填写 |

### REL 并发、超时、重试与恢复

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-REL-001 | P0 | 同一操作幂等与重复点击 | 生成/保存/同步按钮快速点击 10 次 | 1. 快速连点<br>2. 释放所有响应<br>3. 对账 provider、run、history、导航 | 用户意图只产生一套有效业务结果；幂等键或前端状态防止重复写入；重复响应不会覆盖新状态；失败可再次操作 | 可靠性验收 | 并发/E2E | 未执行 | 执行时填写 |
| RF-REL-002 | P0 | 分析请求并发合并 | 同 owner/fingerprint 20 并发；不同正文 20 并发 | 1. 同时发请求<br>2. 统计 cache claim/compute/LLM<br>3. 对比结果 | 相同输入合并；不同 fingerprint 独立；结果不可交叉；quota 消费与 miss 数可解释；失败不会卡住后续请求 | 代码契约+容量目标 | 并发 | 未执行 | 执行时填写 |
| RF-REL-003 | P0 | 旧响应与新流程隔离 | R01 请求延迟；用户改为 R02/J02 并重新生成 | 1. 暂停 R01 analyze/match/generate<br>2. 启动 R02<br>3. 释放 R01 | 旧响应不写入新 run、store、session、history 或页面；页面显示 R02；服务端旧 run 状态仍可诊断 | 可靠性验收 | 故障注入/E2E | 未执行 | 执行时填写 |
| RF-REL-004 | P0 | 网络超时与有限重试 | 请求延迟 59/61/149/151/181s；重试 0/1/2 次 | 1. 逐级注入 timeout/408<br>2. 观察客户端和服务端次数<br>3. 恢复网络 | 重试次数有上限和退避；超时显示可重试；不会把迟到成功写成另一个 run；总 provider 成本可对账 | 代码契约+容量目标 | 故障注入 | 未执行 | 执行时填写 |
| RF-REL-005 | P1 | 429 Retry-After 与限流退避 | 上游 429，含/不含 Retry-After；连续 429 | 1. 注入响应<br>2. 记录时间间隔和请求数<br>3. 等待终止 | 尊重合理 Retry-After；无 header 使用有限退避；连续失败最终可诊断；不忙等、不无限请求、不绕过配额 | 建议验收 | 故障注入 | 未执行 | 执行时填写 |
| RF-REL-006 | P0 | 进程重启中途恢复 | 在 analyze/match/generate/interview 各阶段 kill/restart 服务 | 1. 暂停阶段<br>2. 重启<br>3. 用原句柄/会话续作或重新开始 | 已持久化 checkpoint 可续作；不可续作时提示重新分析而非白屏；不会重复写成功历史或丢失已完成 artifact；pending cache 可接管 | 可靠性验收 | 故障注入/E2E | 未执行 | 执行时填写 |
| RF-REL-007 | P1 | 数据库锁与 busy timeout | SQLite 持有写锁；Supabase REST 503 | 1. 触发业务写入<br>2. 注入锁/503<br>3. 释放故障<br>4. 重试 | 返回可诊断 5xx/503 或有限重试；不死锁、不损坏；健康显示依赖降级；恢复后业务可继续 | 代码契约+运维目标 | 故障注入 | 未执行 | 执行时填写 |
| RF-REL-008 | P0 | 前后端取消与迟到结果 | 取消 analyze/match/generate/interview 请求；服务端仍在执行 | 1. 点击取消/离开页面<br>2. 新建流程<br>3. 释放旧响应 | UI loading 和 Abort 状态清理；迟到响应不落库到新上下文；服务端成本、配额和 run 状态真实记录；取消不冒充失败成功 | 可靠性验收 | E2E | 未执行 | 执行时填写 |
| RF-REL-009 | P1 | 系统时钟跳变 | 时钟前后跳 2 分钟、24 小时、回拨；TTL/配额/OTP 同时运行 | 1. Mock Date.now<br>2. 执行 cache/checkpoint/quota/OTP<br>3. 恢复时钟 | 时间窗判断不接受明显过期数据；回拨不延长已过期租约；日期键和日志可解释；真实系统使用 NTP/时钟告警 | 建议验收 | 故障注入 | 未执行 | 执行时填写 |

### SEC 安全、隐私与多租户

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-SEC-001 | P0 | 日志与错误脱敏 | 密码、Authorization、refresh token、API key、简历/JD canary | 1. 触发成功、校验失败、上游 401/500、异常堆栈<br>2. 扫描应用/代理/数据库日志 | 日志不出现密码、完整 token、密钥、完整正文或可还原 PII；只保留 error code、run_id、hash、长度和阶段；异常序列化不泄密 | 安全目标 | 安全/日志 | 未执行 | 执行时填写 |
| RF-SEC-002 | P0 | 公开配置与健康接口最小化 | 匿名请求 public-config、parse/health、mvp/health | 1. 请求接口<br>2. 与 env/日志字段逐一比对 | 只暴露允许的 publishable/configuration 字段；不暴露 secret、内部路径、数据库连接、模型 key、用户数据；依赖故障不回显上游响应 | 代码契约+安全目标 | API | 未执行 | 执行时填写 |
| RF-SEC-003 | P0 | RLS 四表全量隔离 | profiles/source_resumes/resume_histories/user_files；A/B/anon/service role | 1. 用 A/B/anon 执行 select/insert/update/delete<br>2. 用 service role 做后台操作<br>3. 查审计 | 用户只能访问自身行；伪造 user_id、primary key、path 不越权；service role 仅服务端使用并不进入客户端；删除级联符合产品语义 | 代码契约 | 安全/数据库 | 未执行 | 执行时填写 |
| RF-SEC-004 | P0 | Storage 路径穿越与任意对象 | ../、%2F、伪 bucket、绝对 URL、A 路径+B token | 1. 上传/解析/下载各发恶意路径<br>2. 检查实际请求 URL 和对象 | 只访问固定 user-files bucket 与 user_id 首段；拒绝穿越、外部 URL、跨用户路径；不向 OCR 发送未授权内容；对象默认私有 | 安全目标 | 安全/API | 未执行 | 执行时填写 |
| RF-SEC-005 | P0 | SQL/JSON/Markdown 注入 | 字段含引号、SQL、JSON 原型污染键、HTML/script | 1. 写入 profile/history/JD/简历<br>2. 查询、导出、渲染、replay | 查询参数化；JSON 解析失败可诊断；H5 不执行脚本、不注入 DOM；Markdown 渲染按安全策略处理；原文可保留而不改执行语义 | 安全目标 | 安全/E2E | 未执行 | 执行时填写 |
| RF-SEC-006 | P1 | Token 生命周期与撤销边界 | 过期 access、刷新 token、退出后旧 token、并发刷新 | 1. 分别访问受保护端点<br>2. logout<br>3. 重放旧 token | 过期/格式错 token 拒绝；退出至少清理客户端会话；服务端撤销语义按认证供应商记录；并发刷新不泄漏新 token 给错误账号 | 代码契约+建议验收 | API/E2E | 未执行 | 执行时填写 |
| RF-SEC-007 | P1 | CSRF/CORS 与浏览器凭据 | 允许/不允许 Origin；带 Authorization；Cookie/Storage 不同模式 | 1. 预检、实际请求、跨站表单请求<br>2. 检查响应头和状态 | 跨域策略只允许配置白名单；不依赖 CORS 替代鉴权；不使用宽泛通配导致凭据暴露；错误 Origin 无可读业务响应 | 安全目标 | 浏览器/API | 未执行 | 执行时填写 |
| RF-SEC-008 | P1 | 数据删除与保留期限 | 删除 source/history/file；过期 checkpoint/cache/harness | 1. 执行用户删除/清理<br>2. 查业务表、Storage、日志和索引 | 声明范围内数据可删除且无孤儿；缓存/检查点不继续可读；Harness 保留策略不把正文长期保存；删除失败可重试并告警 | 建议验收 | 数据库/安全 | 未执行 | 执行时填写 |

### PERF 性能、容量与成本

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-PERF-001 | P0 | 健康与公开配置延迟 | 冷启动/热请求；并发 1/10/50 | 1. 连续请求 health/public-config<br>2. 记录 P50/P95/P99、错误率、资源 | 验收阈值由发布环境给出；健康不依赖昂贵 LLM；P99 超阈值或错误率升高阻断发布并保留诊断 | 建议验收 | 性能 | 未执行 | 执行时填写 |
| RF-PERF-002 | P0 | 缓存命中性能与成本 | 同输入 100 次；TTL 内命中 | 1. 首次 miss<br>2. 并发命中<br>3. 对比 provider/token/配额 | 命中请求不调用模型、不消费配额；P95 远低于 miss；hit_count 与成本指标可对账；缓存故障退化不会使请求无限等待 | 代码契约+容量目标 | 性能/指标 | 未执行 | 执行时填写 |
| RF-PERF-003 | P0 | 未命中分析容量 | 1/5/20/50 并发不同 fingerprint；模型限流阈值 | 1. 分批压测<br>2. 记录成功率、排队、token、DB 写入<br>3. 检查配额 | 达到容量后有界排队或明确 429/503；不丢 run/event；配额和模型调用不超预算；恢复后可继续服务 | 建议验收 | 性能 | 未执行 | 执行时填写 |
| RF-PERF-004 | P1 | OCR 大文件与内存峰值 | 1MB/5MB/10MB PDF、图片；并发 1/10 | 1. 上传解析<br>2. 记录端到端时延、内存、临时文件<br>3. 失败重试 | 不超过文件限制；内存/临时文件可回收；超时和大文件错误稳定；不会把 base64 多次复制造成进程 OOM | 建议验收 | 性能/OCR | 未执行 | 执行时填写 |
| RF-PERF-005 | P1 | 历史列表和 Dashboard 大数据量 | 1k/10k/100k history/run | 1. 请求列表/dashboard/dataset<br>2. 观察查询计划和返回大小 | 分页/limit 有界；索引命中；响应不返回完整正文；P95 和内存阈值满足容量目标；空/坏数据不拖垮聚合 | 建议验收 | 性能/数据库 | 未执行 | 执行时填写 |
| RF-PERF-006 | P1 | 端到端模型成本预算 | 完整 entry-r5 成功、repair、失败样本各 30 次 | 1. 运行录制/受控真实调用<br>2. 对账 attempt、token、physical calls、费用 | 单 run 成本和失败重试上限符合预算；相同 prompt 不错误合并；未交付失败也记录实际消耗；预算超限触发告警/门禁 | 代码契约+容量目标 | 指标 | 未执行 | 执行时填写 |
| RF-PERF-007 | P1 | 前端包体与首屏性能 | H5 production build；低端移动 CPU/网络 | 1. 构建<br>2. 记录 JS/CSS 体积、首屏、交互可用时间<br>3. 运行主流程 | 包体和首屏阈值由产品给出；失败不因 source map/调试代码泄露；加载中、错误、离线状态不白屏 | 建议验收 | 浏览器/性能 | 未执行 | 执行时填写 |

### DEPLOY 发布、回滚与运行维护

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-DEPLOY-001 | P0 | 启动配置阻断与无半启动 | 缺 LLM key、错误 prod/nonprod、SQLite nonlocal、错误模型 | 1. 启动独立实例<br>2. 检查进程、端口、日志和 health | 非法配置在监听业务前失败；不会启动成免登录/错误数据库；错误信息指向配置但不泄密；旧实例不被误杀 | 代码契约 | 部署 | 未执行 | 执行时填写 |
| RF-DEPLOY-002 | P0 | 迁移前备份与幂等 | 空库、旧库、重复 migration、部分失败 | 1. 备份<br>2. 执行迁移<br>3. 重复执行<br>4. 校验表/索引/RLS | 迁移可重复；数据和权限不丢；失败能恢复备份；应用版本与 schema 版本兼容矩阵可追踪 | 运维目标 | 迁移 | 未执行 | 执行时填写 |
| RF-DEPLOY-003 | P0 | 健康探针与依赖降级 | DB/cache/OCR/LLM 分别不可用；服务本体正常 | 1. 逐个断开依赖<br>2. 请求 health 和业务端点<br>3. 恢复依赖 | health 同时显示顶层和 dependencies；不可用依赖不被顶层 ok 掩盖；不影响无关公开接口；恢复后状态回升 | 代码契约+运维目标 | 部署/API | 未执行 | 执行时填写 |
| RF-DEPLOY-004 | P1 | 优雅关闭与在途请求 | SIGTERM/SIGINT；有在途模型、OCR、数据库写入 | 1. 发送停止信号<br>2. 等待 grace period<br>3. 检查 run/队列/端口 | 新请求停止接收；在途工作完成或标为可恢复失败；队列 flush/锁释放；无截断 JSON 或半写记录 | 建议验收 | 部署/故障注入 | 未执行 | 执行时填写 |
| RF-DEPLOY-005 | P0 | 版本回滚与 V5 兼容 | 新旧版本交替；旧 prompt/新 schema；新 run/旧 checkpoint | 1. 新版本写数据<br>2. 回滚上一版本<br>3. 续作和查询 | 旧版本不会误读新字段；不可兼容时显式拒绝并提示重新开始；历史可读；回滚不降低鉴权或 RLS | 建议验收 | 部署/E2E | 未执行 | 执行时填写 |
| RF-DEPLOY-006 | P1 | 告警、日志轮转和敏感信息 | 连续 5xx、配额耗尽、cache degraded、queue backlog | 1. 注入异常<br>2. 检查告警去重、阈值、恢复通知和日志轮转 | P0 故障触发告警；恢复后清除/降级；告警含 run_id/code 不含 PII/key；日志大小可控且保留策略明确 | 建议验收 | 运维 | 未执行 | 执行时填写 |
| RF-DEPLOY-007 | P1 | 依赖供应商异常与降级 | Supabase/DeepSeek/GLM OCR DNS/TLS/429/5xx | 1. 逐项注入<br>2. 执行业务<br>3. 恢复并重试 | 错误可归类、有限重试；不自动切换到未批准模型或关闭 TLS；可用功能保持；用户得到可行动提示 | 代码契约+安全目标 | 故障注入 | 未执行 | 执行时填写 |

### XPLAT 跨端、可访问性与体验稳定性

| ID | 级别 | 用例 | 数据 | 步骤 | 预期 | 依据 | 方法 | 状态 | 实际结果/缺陷 |
|---|---|---|---|---|---|---|---|---|---|
| RF-XPLAT-001 | P0 | H5 主流程多视口稳定 | 375、393、768、1440；首页/创建/结果/完成 | 1. 运行登录和 Landing 主流程<br>2. 截图/测量布局<br>3. 刷新与返回 | 无横向滚动、遮挡、文字溢出或白屏；卡片尺寸/间距稳定；移动安全区和桌面最大宽度符合设计基线 | 设计/可靠性验收 | 浏览器/视觉 | 未执行 | 执行时填写 |
| RF-XPLAT-002 | P1 | H5 浏览器兼容 | Chrome、Safari、Firefox 最近稳定版；文件上传、Abort、Storage | 1. 执行上传/OCR/生成/保存<br>2. 对比网络和渲染 | 核心流程行为一致；不支持能力有降级提示；Blob URL、AbortController、crypto 等失败可诊断；不丢正文 | 建议验收 | 浏览器/E2E | 未执行 | 执行时填写 |
| RF-XPLAT-003 | P1 | RN Android 启动与主链路 | 仓库可用 adb 设备；debug/release bundle | 1. 构建 RN<br>2. 安装启动<br>3. 登录/创建/结果<br>4. 旋转/后台恢复 | 启动无红屏；导航、请求、存储、返回键稳定；后台恢复不重复生成；平台差异有适配而非 H5 DOM 泄漏 | 代码契约+平台验收 | RN 真机 | 未执行 | 执行时填写 |
| RF-XPLAT-004 | P1 | 小程序构建与 API 适配 | 目标小程序构建；文件选择/登录/结果 | 1. 构建<br>2. 运行 smoke<br>3. 检查平台 API 和包体 | 构建通过；不直接调用浏览器 DOM/localStorage；文件和导航使用平台适配；不支持功能有明确降级 | 建议验收 | 小程序 | 未执行 | 执行时填写 |
| RF-XPLAT-005 | P1 | 键盘、焦点与读屏顺序 | 登录、上传、JD、生成、结果弹窗 | 1. 仅键盘操作<br>2. Tab 顺序<br>3. 读屏检查 role/label/live region | 所有核心操作可到达/触发；焦点不丢失；错误和 loading 可感知；图标按钮有可理解 label；对比度满足产品无障碍标准 | 建议验收 | 可访问性 | 未执行 | 执行时填写 |
| RF-XPLAT-006 | P1 | 减少动效与低视觉等级 | prefers-reduced-motion；visualTier basic/enhanced/premium | 1. 切换系统偏好/URL/localStorage tier<br>2. 运行卡片/加载/结果动画 | 减少动效时无强制昂贵动画；低等级仍保留信息和操作；高等级失败有 CSS 降级；动画不改变业务状态和布局尺寸 | 代码契约 | 浏览器/视觉 | 未执行 | 执行时填写 |
| RF-XPLAT-007 | P1 | 离线、弱网与恢复体验 | 断网、慢 3G、网络切换、页面后台 | 1. 在每阶段断网/恢复<br>2. 观察状态<br>3. 重试或返回 | 显示可行动错误而非无限 loading；网络恢复不重复提交；本地草稿按隐私规则保留/清理；恢复后上下文一致 | 可靠性验收 | 浏览器/E2E | 未执行 | 执行时填写 |
| RF-XPLAT-008 | P1 | 中英文与长文本布局 | zh-CN/en-US；超长公司/岗位/错误/建议；emoji | 1. 切换语言/注入长文本<br>2. 检查按钮、卡片、弹窗、结果页 | 文本换行/截断有规则；不溢出或覆盖后续内容；日期/数字格式一致；错误码不直接暴露给普通用户 | 建议验收 | UI/视觉 | 未执行 | 执行时填写 |

## 8. 发布判定与执行规则

1. 所有 P0 必须通过；P0 失败、数据越权、事实编造、未授权匿名访问、重复扣配额、run 观测丢失或无法恢复时阻断发布。
2. P1 可以带风险上线，但必须有负责人、影响范围、临时缓解、修复版本和回归日期；“未执行”不计为通过。
3. 对标有“建议验收/容量目标/安全目标/待产品确认”的用例，执行记录必须同时写下实际观测值和阈值决策来源。
4. 任何失败都要保留最小证据：请求时间、环境、脱敏输入标识、HTTP 状态、稳定错误码、run_id、step/attempt、日志 trace、数据库计数和恢复结果。
5. 真实简历、JD、邮箱、token、API key、原始 OCR 文件和生产日志不得进入仓库、Excel、截图或回归数据集。

## 9. 现有代码测试建议命令

```bash
cd backend && bunx tsc --noEmit && bun test ./src
cd frontend/Taro/reffo-taro && corepack pnpm@10.33.2 test
cd frontend/Taro/reffo-taro && corepack pnpm@10.33.2 build:h5
```

上述命令验证实现回归；它们不能替代本文件中的跨进程、真实 Supabase RLS、OCR 供应商、容量、浏览器视觉和发布回滚测试。
