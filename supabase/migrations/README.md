# Supabase Migrations

本目录是 Reffo Supabase schema 的唯一版本化来源。应用代码依赖的表、字段、索引、RLS 和权限变更都必须以有序 SQL migration 提交到 Git，CI 再将同一组文件应用到目标 Supabase project。

## CI 同步流程

- Pull Request 涉及 `backend/**` 或 `supabase/migrations/**` 时，[Backend Quality](../../.github/workflows/backend-quality.yml) 会运行 [.github/scripts/supabase-migrate.sh](../../.github/scripts/supabase-migrate.sh) 的 `--check-only`，确认 migration 文件名有效且已被 Git 跟踪。
- `feature` 或 `feature/**` push 时，[Supabase and Render Feature Environments](../../.github/workflows/render-feature-environments.yml) 先将 pending migration 应用到 nonprod Supabase，再部署 Render Feature 服务。
- `main`、`master` 或 `v*.*.*` tag push 时，[Production Release](../../.github/workflows/release-tag.yml) 依次执行后端测试、H5 production build、production Supabase migration，全部成功后才触发 Render production deploy hook。
- migration 或部署 secret 缺失、SQL 执行失败、本地与远端 migration 历史不一致时，CI 必须失败，不允许跳过后继续部署。

## GitHub Secrets

| Secret | 使用范围 | 说明 |
| --- | --- | --- |
| `SUPABASE_NONPROD_DB_URL` | feature CI | nonprod Supabase Postgres 连接串，必须 URL encode 密码并允许 CI 执行 DDL |
| `SUPABASE_PROD_DB_URL` | production environment | prod Supabase Postgres 连接串，建议配置在受保护的 GitHub Environment 中 |
| `RENDER_DEPLOY_HOOK_URL` | production release | production Render deploy hook，仅在 migration 成功后调用 |

连接串属于密钥，只能保存在 GitHub Secrets 中，不得写入本目录、`.env` 示例、日志或 PR 描述。

## Schema 与数据边界

- Git 只保存 schema migration，不保存业务数据、用户数据、缓存内容或 Supabase 密钥。
- 当前 GitHub 仓库是公开仓库，migration 中的表名、字段、索引和 RLS 结构对访问者可见。数据库安全仍由 RLS、服务端鉴权、最小权限和密钥管理保证，不依赖 schema 保密。
- 不得在 migration 中插入真实用户、真实简历、provider key、数据库 URL 或 service role key。
- 本地开发允许 SQLite repository 自动建表，但这不能替代 Supabase CI migration。

## 新增数据表规则

1. 在本目录新增时间戳格式文件，例如 `202609210001_example_table.sql`；CI 同时兼容仓库既有 12 位和 Supabase 常用的 14 位数字前缀。
2. migration 必须可重复执行，优先使用 `if not exists`、明确约束和最小权限 grant。
3. 开启需要的 RLS，并验证 `anon`、`authenticated`、`service_role` 的权限边界。
4. 同步修改 repository、类型、测试和部署文档。
5. PR 中确认 migration 已被 Git 跟踪；合并 feature 后先由 nonprod CI 验证，再进入 production migration。
6. 破坏性变更使用 expand-contract，避免新代码部署前删除旧字段或旧索引。
