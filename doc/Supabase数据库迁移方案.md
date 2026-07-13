# Reffo Supabase 数据库迁移方案

调研日期：2026-07-10

## 结论

建议把生产数据库从本地 SQLite 迁移到 Supabase Postgres，但不要一次性重写所有后端。推荐路线：

1. 保留 SQLite 作为本地开发和测试 fallback。
2. 新增 `DATABASE_PROVIDER=sqlite|supabase`，生产环境使用 Supabase。
3. 第一阶段只迁移用户可见数据：源简历、生成历史卡片。
4. 第二阶段接入 Supabase Auth 和 Row Level Security，形成多用户隔离。
5. 第三阶段把文件上传从 base64 请求迁到 Supabase Storage。
6. Harness 运行记录默认继续保留 SQLite，作为后端内部运行时 trace；除非进入多实例或需要统一观测平台，否则不纳入 Supabase 第一阶段迁移。

Supabase 官方说明每个项目都有完整 Postgres 数据库，而不是 Postgres 抽象层；Auth、Storage、Realtime、Edge Functions 都建立在这个数据库之上。它也支持 RLS、备份、SQL Editor、迁移和连接池，适合个人开发者把 Reffo 从本地 MVP 推到轻量生产。

## 为什么现在该迁

当前 SQLite 方案适合本地 MVP，但上线后会遇到这些问题：

- 数据文件在容器本地，需要挂载 Volume，限制单实例和迁移便利性。
- 没有用户维度，当前 `source_resumes` 和 `resume_histories` 都是全局数据。
- 生成卡片编辑、删除、跨设备同步需要稳定的云端数据库。
- 简历和 JD 属于敏感数据，需要用户隔离、权限控制、备份和审计。
- 后续如果做登录、套餐、用量限制、文件存储，SQLite 会把复杂度推回给我们自己。

Supabase Postgres 更适合承担：

- 用户资料。
- 源简历记录。
- 一岗一简历生成历史。
- 生成卡片编辑 / 删除。
- 文件元数据。
- 用量、配额、计费状态。
- 后续向量检索和模板库。

AI Agent 编排、OCR、成本控制、Prompt Harness 仍放在现有 Bun 后端，不建议直接下放到前端或数据库函数。Harness 数据属于运行时观测数据，不等同于用户业务数据，默认继续使用 SQLite。

## 当前 SQLite 数据盘点

### 用户可见数据

`source_resumes`

- 当前语义：全局只保存一份最新源简历。
- 迁移后语义：每个用户保存一份或多份源简历；第一阶段保持“每用户一份当前源简历”。

`resume_histories`

- 当前语义：全局生成历史列表，支持新增、更新、删除、清空。
- 迁移后语义：每个用户只能访问自己的生成历史。

### 后端内部数据

Harness 相关表：

- `process_runs`
- `step_runs`
- `step_attempts`
- `harness_events`
- `artifacts`
- `evaluations`
- `failure_samples`

这些数据用于调试、回归、评估和运行观测。它们不是用户主流程数据，也不承担用户跨设备同步、权限隔离或计费依据。默认继续使用 SQLite，并与产品数据拆开管理。

## 推荐目标架构

```text
Taro H5 / RN / 小程序
  |
  | Supabase Auth 登录，拿 access token
  v
Bun / Elysia API
  |
  | Authorization: Bearer <supabase_access_token>
  | 校验用户身份，执行业务逻辑、AI Agent、OCR
  v
Supabase Postgres
  |
  | user_id 隔离 + RLS
  v
用户源简历 / 生成历史 / 文件元数据

Supabase Storage
  |
  v
简历 PDF / JD 图片 / 导出文件
```

核心原则：

- 前端可以使用 Supabase Auth 登录。
- 核心业务写入仍走我们自己的后端 API。
- 后端收到用户 token 后，只操作该用户的数据。
- 生产环境不要把 Supabase Secret key 暴露给前端。
- RLS 作为最后一道防线，但后端代码也要显式按 `user_id` 查询。

## 数据模型设计

### 1. 用户资料

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 2. 源简历

第一阶段保持“每用户一份当前源简历”。

```sql
create table public.source_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  resume_markdown text not null,
  source_type text not null check (source_type in ('manual', 'file')),
  original_file_name text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create index idx_source_resumes_user_updated_at
on public.source_resumes(user_id, updated_at desc);
```

说明：

- `unique(user_id)` 保持当前“只保留最新源简历”的行为。
- 如果后续要支持多份源简历，删除这个唯一约束即可。
- `storage_path` 预留给 Supabase Storage 文件路径。

### 3. 生成历史

```sql
create table public.resume_histories (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  position text not null,
  company text not null,
  name text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now(),
  quality_score integer not null,
  match_score integer not null,
  tags jsonb not null default '[]'::jsonb,
  resume_content text not null,
  jd_content text not null,
  optimized_content text not null,
  optimization_suggestions jsonb,
  changes_summary jsonb,
  process_result jsonb,
  result_context jsonb,
  progress jsonb,
  card_color text,
  card_pattern text
);

create index idx_resume_histories_user_created_at
on public.resume_histories(user_id, created_at desc);

create index idx_resume_histories_user_updated_at
on public.resume_histories(user_id, updated_at desc);
```

说明：

- `id` 暂时沿用当前 `JD2026071000001` 这类字符串，减少前端改动。
- JSON 字段从 SQLite 的 `*_json` 文本列迁为 Postgres `jsonb`。
- 所有查询必须带 `user_id`。

### 4. 文件元数据

```sql
create table public.user_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  purpose text not null check (purpose in ('resume', 'jobDescription', 'export')),
  bucket text not null,
  storage_path text not null,
  original_file_name text not null,
  mime_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);

create index idx_user_files_user_created_at
on public.user_files(user_id, created_at desc);
```

### 5. Harness 运行记录

Harness 运行记录不建议进入 Supabase 第一阶段迁移。推荐继续使用 SQLite，但从原产品数据 SQLite 中拆出独立运行时数据库：

```text
/app/data/harness.sqlite
```

建议新增配置：

```text
HARNESS_DATABASE_PROVIDER=sqlite
HARNESS_DATABASE_PATH=/app/data/harness.sqlite
HARNESS_RETENTION_DAYS=7
HARNESS_MAX_RUNS=1000
```

保留 SQLite 的原因：

- Harness 是后端内部 trace，不是用户主业务状态。
- 单实例 MVP 下 SQLite 足够稳定，查询和回放都简单。
- 不需要用户跨设备访问，也不需要前端直接查询。
- 迁移到 Supabase 会显著扩大改造范围，但短期产品收益有限。
- 保留 SQLite 能让 Supabase 迁移聚焦源简历、生成历史和文件元数据。

生产部署要求：

- 如果后端部署在 Railway / Render，应挂载持久化 Volume 到 `/app/data`。
- 如果后端部署在无持久化磁盘的平台，Harness 数据只能作为临时 trace，不应依赖其长期保留。
- Harness SQLite 不应和生产业务数据库混用同一个文件。

保留策略：

- 默认保留最近 7 天或最近 1000 次 run。
- failed / partial run 可转成 failure sample 后长期保留。
- 定期清理 `harness_events`、`artifacts` 等体积较大的表。

未来如果进入多实例部署，或需要跨实例统一 Dashboard，再考虑迁移 Harness 到 Postgres / 日志平台。届时建议给 `process_runs` 增加：

```sql
user_id uuid references auth.users(id) on delete set null
```

并将事件 payload 中可能包含隐私内容的字段继续保持摘要化或脱敏。

## RLS 策略

Supabase Auth 使用 JWT，配合 RLS 可以按行控制用户访问。用户表应开启 RLS：

```sql
alter table public.profiles enable row level security;
alter table public.source_resumes enable row level security;
alter table public.resume_histories enable row level security;
alter table public.user_files enable row level security;
```

基础策略：

```sql
create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

create policy "source_resumes_own"
on public.source_resumes for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "resume_histories_own"
on public.resume_histories for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "user_files_own"
on public.user_files for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

注意：

- 如果后端使用 Supabase Secret key，会绕过普通用户 RLS 语义。因此生产代码应避免把 Secret key 用在普通用户数据路径上。
- 推荐后端请求级创建 Supabase client，带上用户 `Authorization` token，让 RLS 生效。
- 只在管理脚本、迁移脚本、后台维护任务里使用 Secret key。

## 后端改造方案

### 1. 新增环境变量

```text
DATABASE_PROVIDER=sqlite

SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
SUPABASE_PROJECT_ENV=
```

生产：

```text
DATABASE_PROVIDER=supabase
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<publishable key>
SUPABASE_SECRET_KEY=<server-only secret key>
SUPABASE_PROJECT_ENV=prod
```

### 2. 引入 Supabase client

建议新增：

```text
backend/src/repositories/supabase/client.ts
backend/src/repositories/supabase/source-resume-repository.ts
backend/src/repositories/supabase/resume-history-repository.ts
backend/src/repositories/sqlite/source-resume-repository.ts
backend/src/repositories/sqlite/resume-history-repository.ts
```

或者更小步：

```text
backend/src/repositories/source-resume-repository.sqlite.ts
backend/src/repositories/source-resume-repository.supabase.ts
backend/src/repositories/source-resume-repository.ts
```

`source-resume-repository.ts` 只负责按 `DATABASE_PROVIDER` 导出实现。

### 3. 请求级用户上下文

新增认证 helper：

```text
backend/src/auth/supabase-auth.ts
```

职责：

- 从 `Authorization` 读取 Bearer token。
- 用 Supabase Auth 校验 token。
- 返回 `userId` 和请求级 Supabase client。
- 本地开发可通过 `AUTH_REQUIRED=false` 使用固定 dev user，但生产必须开启。

接口层改造：

- `source-resume` 路由必须拿到 `userId`。
- `resume-history` 路由必须拿到 `userId`。
- repository 方法签名增加 `userId`。

示例：

```ts
sourceResumeRepository.save(userId, body)
sourceResumeRepository.getLatest(userId)
resumeHistoryRepository.list(userId)
resumeHistoryRepository.findById(userId, id)
resumeHistoryRepository.delete(userId, id)
```

### 4. SQLite fallback

测试和本地开发先继续走 SQLite：

```text
DATABASE_PROVIDER=sqlite
```

生产走：

```text
DATABASE_PROVIDER=supabase
```

这样可以避免一次迁移破坏现有 468 个 Taro 测试和后端测试，也方便开发者离线跑本地链路。

## 前端改造方案

### 第一阶段：仍走后端 API

Taro 前端暂时不直接读写 Supabase 表，只做两件事：

1. 接入登录。
2. 请求后端时带上 Supabase access token。

请求头：

```text
Authorization: Bearer <supabase_access_token>
```

现有 `ApiClient.setAuthToken()` 已经具备注入 Bearer token 的能力，可以复用。

### 第二阶段：文件上传迁移到 Storage

当前 OCR 接口使用 base64：

```text
content_base64
```

这对 Vercel / Serverless 和大文件都不友好。迁移后改成：

1. 前端请求后端创建上传凭证或上传路径。
2. 前端上传 PDF / 图片到 Supabase Storage。
3. 后端收到 `storage_path`。
4. 后端读取文件内容并调用 OCR。
5. OCR 结果写入 Postgres。

建议 bucket：

```text
resume-files
jd-images
exports
```

路径规范：

```text
users/{user_id}/resumes/{file_id}.pdf
users/{user_id}/jd-images/{file_id}.png
users/{user_id}/exports/{history_id}.pdf
```

## 迁移里程碑

### M0：准备 Supabase 项目

验收：

- 创建 Supabase project。
- 确认项目 URL、Publishable key、Secret key。
- 本地安装或配置 Supabase CLI。
- 建立 `supabase/migrations` 目录。

### M1：建表和 RLS

验收：

- 创建 `profiles`、`source_resumes`、`resume_histories`、`user_files`。
- 开启 RLS。
- 本地或 Supabase SQL Editor 执行迁移。
- 用测试用户验证不能读取其他用户数据。

### M2：后端支持 Supabase provider

验收：

- 新增 `DATABASE_PROVIDER=supabase`。
- `source-resume` 接口可写入 / 查询 Supabase。
- `resume-history` 接口可写入 / 查询 / 更新 / 删除 Supabase。
- SQLite 测试仍可跑。

### M3：接入 Supabase Auth

验收：

- 前端可登录。
- 前端请求后端时带 Bearer token。
- 后端无 token 返回 401。
- 用户 A 看不到用户 B 的源简历和历史记录。

### M4：迁移文件到 Supabase Storage

验收：

- 简历 PDF / JD 图片不再通过 base64 大请求传给后端。
- 文件写入私有 bucket。
- 后端可按用户权限读取文件并调用 OCR。
- 删除历史时可按策略清理关联文件或保留审计。

### M5：Harness SQLite 运行时化

验收：

- Harness 表不进入 Supabase 主迁移。
- Harness 数据写入独立 `harness.sqlite`。
- Railway / Render 部署时 `/app/data` 有持久化 Volume。
- 建立 run 保留策略，避免 SQLite 无限增长。
- Dashboard 继续从 Harness SQLite 查询。
- 事件 payload 保持脱敏。

## 数据迁移策略

当前 SQLite 多数是本地开发数据，不一定需要导入生产。如果需要迁移：

1. 创建一个迁移目标用户。
2. 从 `backend/data/reffo.sqlite` 读取 `source_resumes` 和 `resume_histories`。
3. 插入 Supabase 时补充 `user_id`。
4. JSON 文本列转换为 `jsonb`。
5. 校验条数和关键字段。

建议新增脚本：

```text
backend/scripts/migrate-sqlite-to-supabase.ts
```

输入：

```text
SQLITE_DATABASE_PATH=backend/data/reffo.sqlite
SUPABASE_URL=
SUPABASE_SECRET_KEY=
MIGRATION_USER_ID=
```

## 风险和取舍

### 不建议前端直接操作业务表

Supabase 允许前端直接访问数据库，但 Reffo 的核心流程涉及：

- 简历隐私。
- AI 调用成本。
- OCR 调用成本。
- Prompt 和 Harness 内部逻辑。
- 失败恢复和质量门禁。

所以核心业务仍应走 Bun 后端。前端直连 Supabase 只适合 Auth、Storage 上传或低风险只读配置。

### Secret key 使用边界

`SUPABASE_SECRET_KEY` 只能放在后端环境变量里。不要进入 Taro、Vercel 前端构建环境或日志。

### RLS 和后端过滤都要做

不要只依赖其中一个。repository 查询仍必须显式带 `user_id`，RLS 是兜底。

### JSONB 字段先保留

`process_result`、`result_context`、`progress` 目前结构变化较快，先用 `jsonb` 比强拆多表更稳。等产品稳定后再拆出高频查询字段。

## 推荐执行顺序

1. 先做 M1 建表和 RLS。
2. 再做 M2 repository provider 切换。
3. 再做 M3 Auth 接入。
4. 然后上线 H5 + 后端 + Supabase。
5. 最后做 M4 Storage 和 M5 Harness SQLite 运行时化。

第一轮实际代码改动建议控制在：

- 后端新增 Supabase 配置。
- 后端新增 Supabase repository 实现。
- 路由层增加用户上下文。
- 前端只加登录态 token 注入。
- 不改 AI Agent 和 OCR 编排。

## 官方资料

- Supabase Database：https://supabase.com/docs/guides/database/overview
- Supabase Auth：https://supabase.com/docs/guides/auth
- Supabase Row Level Security：https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage：https://supabase.com/docs/guides/storage
- Supabase Database Migrations：https://supabase.com/docs/guides/deployment/database-migrations
- Supabase Postgres 连接方式：https://supabase.com/docs/guides/database/connecting-to-postgres
