# Supabase 正式迁移执行与回滚方案

本文档用于 Reffo 从非生产 Supabase 迁移到正式 Supabase 时的执行检查、备份、回滚和验收。正式环境只使用独立 Supabase project，不与非生产共库。

## 环境约定

非生产：

```text
APP_ENV=nonprod
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_ENV=nonprod
```

本地文件：`backend/.env.nonprod`。

正式：

```text
APP_ENV=prod
DATABASE_PROVIDER=supabase
AUTH_REQUIRED=true
SUPABASE_PROJECT_ENV=prod
```

本地文件：`backend/.env.prod`。正式部署平台也只注入这一套正式变量，不与非生产变量共存。

正式环境必须使用正式 project 的 `SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY`、`SUPABASE_SECRET_KEY`。`SUPABASE_SECRET_KEY` 只能注入后端服务、迁移脚本或运维终端，不能进入前端构建环境。

## 正式执行前检查

- 非生产已完成 `bunx supabase db push`。
- 非生产已完成 RLS 隔离验证。
- 非生产已完成后端 API smoke：源简历保存 / 读取 / 删除，生成历史保存 / 列表 / 详情 / 更新 / 删除。
- 正式 Supabase project 已创建，且 project ref 与非生产不同。
- 正式后端环境变量已配置，但上线前不复用非生产 key。
- 正式执行窗口已确认，避免在用户使用高峰操作 schema。
- migration 文件只来自仓库 `supabase/migrations/`，不在 SQL Editor 手写临时 SQL。

## 正式执行步骤

1. 登录 Supabase CLI：

```bash
cd /Users/mi/code/reffo
bunx supabase login
```

2. 链接正式 project：

```bash
bunx supabase link --project-ref <prod-project-ref>
```

3. 先查看待推送 migration：

```bash
bunx supabase migration list
```

4. 推送 migration：

```bash
bunx supabase db push
```

5. 执行后确认表和策略：

```bash
bunx supabase migration list
```

6. 启动正式后端，确认健康检查：

```bash
curl https://<prod-api-domain>/api/v1/mvp/health
```

7. 完成正式环境基础 smoke：

- 登录正式用户。
- 保存源简历。
- 不发起真实 AI 生成流程。
- 查看生成历史。
- 删除测试生成历史。

真实 AI 生成链路 smoke 固定在非生产环境执行，避免正式环境产生模型调用费用和测试数据。

## 备份策略

正式 migration 前必须确认至少一种可恢复方案：

- Supabase Dashboard 中正式 project 已开启可用备份或 Point-in-Time Recovery。
- 如套餐不支持 PITR，执行前导出关键表快照。
- 对 `source_resumes`、`resume_histories`、`user_files` 的导出文件存放在受控位置，不提交仓库。

建议导出命令：

```bash
bunx supabase db dump --linked --file .artifacts/supabase/prod-pre-migration.sql
```

`.artifacts/` 是本地验证产物目录，不纳入提交。

## 回滚和前滚修复

优先使用前滚修复，避免回滚造成数据丢失：

- 新增表、字段、索引失败：修正 migration 后重新执行。
- RLS 策略过严导致接口不可用：新增修复 migration 调整 policy。
- 后端代码不兼容：先回滚后端部署，数据库保持兼容结构。

只有在 migration 已破坏正式数据且无法前滚修复时，才使用备份恢复：

1. 暂停正式后端写入。
2. 使用 Supabase Dashboard 的备份恢复能力，或使用执行前导出的 SQL 快照恢复。
3. 恢复后执行只读校验。
4. 重新执行修复后的 migration。

## SQLite 导入策略

本地 SQLite 多数为开发数据，默认不导入正式。确需导入时：

1. 在正式 Supabase Auth 中创建目标用户。
2. 获取目标用户 UUID。
3. 先 dry-run：

```bash
cd backend
DRY_RUN=true \
SQLITE_DATABASE_PATH=data/reffo.sqlite \
MIGRATION_USER_ID=<target-user-id> \
bun run migrate:sqlite-to-supabase:prod
```

4. 确认数量后执行：

```bash
cd backend
DRY_RUN=false \
SQLITE_DATABASE_PATH=data/reffo.sqlite \
MIGRATION_USER_ID=<target-user-id> \
bun run migrate:sqlite-to-supabase:prod
```

5. 导入后用正式用户登录验证源简历和历史记录。

## 验收记录模板

```text
执行环境：
执行人：
执行时间：
project ref：
migration list：
备份方式：
健康检查结果：
正式环境基础 smoke 结果：
异常和处理：
```

## 当前正式迁移记录

```text
执行环境：prod
执行时间：2026-07-13
project ref：nptpliqejrfqwerhwavw
migration list：
  - 202607130001_initial_business_schema.sql：local=remote=202607130001
  - 202607130002_user_files_storage.sql：local=remote=202607130002
备份方式：
  - 正式 project 为新库，迁移前无业务表和真实用户数据。
  - 本地 supabase db dump 因 Podman/Docker 未启动失败，未生成本地 SQL dump。
  - 基于新库前提继续执行 migration。
健康检查结果：
  - prod env 启动保护校验通过。
  - 临时端口 3001 启动 prod env 后端，/api/v1/mvp/health 返回 status=ok。
数据库验证：
  - public.profiles、public.source_resumes、public.resume_histories、public.user_files REST 访问返回 200。
  - 四张 public 表 RLS 均为 true。
  - public 表 owner policy 存在，storage.objects 的 user-files owner select/insert/update/delete policy 存在。
  - storage.buckets 中 user-files 存在且 public=false。
正式环境基础 smoke 结果：
  - schema、RLS、policy、后端健康检查已通过。
  - 正式测试账号登录已通过。
  - 源简历保存、读取、删除已通过。
  - 生成历史创建、列表、详情、更新、删除已通过。
  - Storage 私有 bucket 用户态上传、下载、删除已通过。
  - 真实 AI 生成链路按当前策略不在正式环境执行；完整 AI 主链路 smoke 改在非生产环境完成。
异常和处理：
  - Storage 管理 API 使用新 SUPABASE_SECRET_KEY 查询 bucket 返回 Bucket not found，但 SQL 确认 storage.buckets row 存在。
  - 新 secret key 不是 legacy JWT，不能直接调用 Auth admin 创建用户；不切回 legacy key，后续使用真实登录用户做 smoke。
  - 正式 Auth signup 返回 200 但不返回 session/token；已改用 Dashboard 创建的正式测试账号完成登录态 smoke。
```
