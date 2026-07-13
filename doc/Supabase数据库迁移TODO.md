# Supabase 数据库迁移 TODO

本文档基于 `doc/Supabase数据库迁移方案.md` 拆分执行任务。目标是在保留 SQLite 本地开发能力的前提下，把生产主业务数据迁移到 Supabase Postgres，并逐步接入 Auth、RLS 和 Storage。

状态含义：

- `todo`: 待处理。
- `doing`: 正在处理。
- `done`: 已完成并通过对应验收。
- `blocked`: 被外部配置、账号、权限或方案决策阻塞。

## 迁移边界

- 第一阶段迁移主业务数据：源简历、生成历史、文件元数据。
- Harness 运行记录不进入 Supabase 主迁移，后续拆为独立 SQLite 运行时库。
- 核心业务仍走 Bun 后端 API，前端不直接读写业务表。
- Supabase Secret key 只允许用于管理脚本、迁移脚本和后台维护任务，不能进入前端环境。
- Supabase 数据库按生产边界隔离：测试/预发合并为非生产环境，正式环境独立；正式环境不能与非生产环境共库。

## 环境划分

当前采用两套 Supabase project：

| 环境 | 用途 | 建议 project | 后端环境变量来源 | 数据要求 |
| --- | --- | --- | --- | --- |
| 非生产环境 | 日常开发联调、自动化测试、上线前回归，可按需重置 | `reffo-nonprod` | 测试/预发后端部署或本地 `.env.nonprod` | 可使用脱敏样本和临时数据，允许清库重建；不能直接复用正式用户数据。 |
| 正式环境 | 真实用户数据和生产流量 | `reffo-prod` | 正式后端部署环境变量 | 开启备份、RLS、最小权限和变更审计；禁止测试脚本写入。 |

不建议正式和非生产使用同一个 Supabase project，再通过 `environment` 字段区分数据。原因是 Auth 用户、Storage、RLS、日志、备份和误操作风险都会混在一起，生产隔离不足。

## 当前优先级

| ID | 状态 | 优先级 | 待办 | 依赖 | 验收标准 |
| --- | --- | --- | --- | --- | --- |
| SB-0 | done | P0 | 确认 Supabase 环境划分 | Supabase project | 已明确非生产、正式两套 Supabase project；正式环境与非生产环境物理隔离。 |
| SB-1 | done | P0 | 收集两套环境项目信息 | SB-0 | 非生产、正式的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY` 已分别写入本地 ignored env 文件；Secret key 只保存于对应后端环境或本地安全环境。 |
| SB-2 | done | P0 | 规划环境变量命名和注入方式 | SB-1 | 后端使用同一组变量名，由部署环境注入不同值；禁止在代码中硬编码 `nonprod/prod` key。 |
| SB-3 | done | P0 | 建立 `supabase/migrations` 目录 | SB-1 | 仓库中存在可版本化的 Supabase SQL migration 文件，能记录建表、索引和 RLS 变更。 |
| SB-4 | done | P0 | 编写主业务表建表 migration | SB-3 | 创建 `profiles`、`source_resumes`、`resume_histories`、`user_files`，字段与技术方案一致；JSON 文本列迁为 `jsonb`。 |
| SB-5 | done | P0 | 编写索引和约束 migration | SB-4 | `source_resumes` 保持 `unique(user_id)`；历史表按 `user_id + created_at/updated_at` 建索引；所有用户数据表带 `user_id`。 |
| SB-6 | done | P0 | 编写 RLS migration | SB-4 | 四张用户相关表开启 RLS，并添加 `auth.uid()` 只能访问本人数据的策略。 |
| SB-7 | done | P0 | 在非生产环境执行并验证 schema | SB-4, SB-5, SB-6 | migration 在非生产 Supabase 成功执行；测试用户 A 无法读取用户 B 数据。 |
| SB-8 | done | P0 | 非生产环境主链路回归 | SB-7 | 非生产环境完成登录、保存源简历、生成简历、查看历史、删除历史 smoke，再允许准备正式执行。 |
| SB-9 | done | P0 | 正式环境 migration 执行预案 | SB-8 | 正式执行前有备份、执行窗口、回滚或前滚修复预案；不直接用未验证 SQL 操作正式库。 |
| SB-10 | done | P0 | 后端新增 Supabase 环境变量 | SB-1, SB-2 | `backend/src/config/env.ts` 和 `backend/.env.example` 支持 `APP_ENV`、`DATABASE_PROVIDER`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`、`SUPABASE_PROJECT_ENV`。 |
| SB-11 | done | P0 | 引入 Supabase client 封装 | SB-10 | 新增请求级 Supabase client 工厂；普通用户路径可带 Bearer token，让 RLS 生效。 |
| SB-12 | done | P0 | 拆分 SQLite repository 实现 | 无 | 现有源简历、生成历史 repository 保持 SQLite 实现不变，并纳入 provider 切换结构。 |
| SB-13 | done | P0 | 新增 Supabase source resume repository | SB-11 | `source-resume` 可按 `userId` 保存、更新、读取当前源简历；不泄漏其他用户数据。 |
| SB-14 | done | P0 | 新增 Supabase resume history repository | SB-11 | `resume-history` 可按 `userId` 创建、列表、详情、更新、删除；JSON 字段正确读写。 |
| SB-15 | done | P0 | 增加 repository provider 切换 | SB-12, SB-13, SB-14 | `DATABASE_PROVIDER=sqlite` 走原实现；`DATABASE_PROVIDER=supabase` 走 Supabase 实现；未知 provider 启动失败并给出明确错误。 |
| SB-16 | done | P0 | 新增请求级用户上下文 | SB-11 | 后端能从 `Authorization: Bearer <token>` 校验用户并得到 `userId`；无 token 时按配置返回 401 或使用本地 dev user。 |
| SB-17 | done | P0 | 增加环境保护检查 | SB-10, SB-16 | `APP_ENV=prod` 时禁止 `AUTH_REQUIRED=false`、禁止连接非生产 project、禁止使用本地 dev user。 |
| SB-18 | done | P0 | 改造源简历路由 | SB-13, SB-16 | `source-resume` 路由所有读写都显式传入 `userId`；SQLite fallback 测试仍通过。 |
| SB-19 | done | P0 | 改造生成历史路由 | SB-14, SB-16 | `resume-history` 路由所有读写都显式传入 `userId`；列表、详情、删除不会跨用户。 |
| SB-20 | done | P1 | 增加 SQLite 到 Supabase 迁移脚本 | SB-13, SB-14 | 新增 `backend/scripts/migrate-sqlite-to-supabase.ts`，可从 `backend/data/reffo.sqlite` 导入到指定 `MIGRATION_USER_ID`。 |
| SB-21 | done | P0 | 补后端单测和集成测试 | SB-15, SB-18, SB-19 | SQLite provider 现有测试通过；Supabase repository 至少覆盖字段映射、用户过滤、JSONB 读写和错误路径。 |
| SB-22 | done | P0 | 前端接入 Supabase Auth 登录态 | SB-16 | 前端可登录并拿到 access token；核心业务请求继续走后端 API。 |
| SB-23 | done | P0 | 前端 API 请求注入 Bearer token | SB-22 | `source-resume`、生成流程、历史相关请求都能携带 token；无登录态时有明确处理。 |
| SB-24 | done | P0 | 多用户隔离端到端验证 | SB-18, SB-19, SB-23 | 用户 A 和用户 B 分别创建源简历和历史后，互相无法通过接口读取、更新或删除。 |
| SB-25 | done | P1 | 准备非生产和正式部署配置 | SB-10, SB-15, SB-17 | 非生产、正式后端已分别使用 `.env.nonprod` / `.env.prod` 注入对应 Supabase project 环境变量；正式环境设置 `APP_ENV=prod`、`DATABASE_PROVIDER=supabase`、`AUTH_REQUIRED=true`、`SUPABASE_PROJECT_ENV=prod`。 |
| SB-26 | blocked | P1 | 上线前 smoke 验证 | SB-24, SB-25 | 正式 migration 已执行；migration list、表访问、RLS/policy、Storage bucket SQL row、prod 后端健康检查、正式账号登录、源简历保存/读取/删除、历史创建/列表/详情/更新/删除、Storage 上传/下载/删除均已通过。真实 AI 生成链路未执行，待确认可产生模型调用费用后继续。 |
| SB-27 | done | P2 | 迁移文件上传到 Supabase Storage | SB-22 | PDF / JD 图片写入各环境私有 bucket；后端按用户权限读取文件并调用 OCR；删除策略明确。已完成私有 bucket migration、前端登录态上传、后端 token 读取、`user_files` 记录和 storage 分支单测。 |
| SB-28 | done | P2 | Harness 拆到独立 SQLite 运行时库 | 无 | Harness 表不再混用主业务 SQLite；支持 `HARNESS_DATABASE_PATH`、保留天数和最大 run 数。 |
| SB-29 | done | P2 | 增加数据库备份、回滚和清理说明 | SB-9, SB-25 | 文档说明非生产和正式各自备份策略、migration 回滚或前滚修复方案、SQLite 导入脚本回滚方式。 |

## 第一轮执行范围

第一轮建议只覆盖 M0-M2，不碰 Storage 和 Harness 拆库：

1. 完成 SB-0 到 SB-3，先确认非生产、正式两套 Supabase 环境和 migration 管理方式。
2. 完成 SB-4 到 SB-9，先在非生产验证 schema、索引、RLS 和主链路，再准备正式执行预案。
3. 完成 SB-10 到 SB-19，让后端能通过 `DATABASE_PROVIDER` 在 SQLite 和 Supabase 间切换。
4. 完成 SB-21 的最小测试，确保 SQLite fallback 不被破坏。
5. 只在需要导入现有本地数据时执行 SB-20。

## 第二轮执行范围

第二轮接入 Supabase Auth 和前端 token：

1. 完成 SB-22 和 SB-23。
2. 完成 SB-24 的多用户隔离验证。
3. 完成 SB-25 和 SB-26，准备非生产/正式部署配置和上线 smoke。

## 第三轮执行范围

第三轮处理非阻塞生产增强：

1. SB-27：把文件上传迁到 Supabase Storage，减少 base64 大请求。
2. SB-28：把 Harness 拆到独立 SQLite 运行时库，并设置保留策略。
3. SB-29：补备份、回滚和数据清理说明。

## 验证命令建议

后端本地验证：

```bash
cd backend
bun test ./src
```

Taro H5 最小回归：

```bash
cd frontend/Taro/reffo-taro
source ~/.nvm/nvm.sh && nvm use 22
corepack pnpm@10.33.2 build:h5
```

Supabase provider 验证需要真实 Supabase 环境变量：

```bash
cd backend
bun run dev:nonprod
```

`.env.nonprod` 需要包含：

```bash
APP_ENV=nonprod
DATABASE_PROVIDER=supabase
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_PROJECT_ENV=nonprod
```

## 当前阻塞项

截至当前迁移进度，代码侧和数据库 schema 侧已完成；剩余阻塞是正式用户态 smoke：

- `SB-26`: 正式测试账号登录和非 AI 主链路 smoke 已通过；真实 AI 生成链路未执行，待确认可产生模型调用费用后继续。

## 风险检查

- 普通用户请求不能使用 Supabase Secret key 绕过 RLS。
- repository 查询必须显式带 `userId`，不能只依赖 RLS。
- 前端构建环境不能出现 `SUPABASE_SECRET_KEY`。
- 非生产、正式必须使用各自的 Supabase URL 和 key，禁止跨环境复用。
- 正式环境必须有启动保护，避免误连非生产库或启用本地 dev user。
- `resume_histories` 的 JSON 字段写入 Supabase 时必须保持对象/数组结构，不要二次字符串化。
- SQLite fallback 必须保留，避免本地开发和测试依赖真实 Supabase。
- 本地 `backend/data/reffo.sqlite` 多为开发数据，默认不迁入生产；需要迁移时必须指定目标用户。
