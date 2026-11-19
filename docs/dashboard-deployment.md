# 管理后台部署与权限边界

本文记录已授权完成的生产看板/埋点补齐与后续运维边界；不是自动执行脚本。

## 部署架构

- 看板：独立 Render Static Site，当前 https://reffo-dashboard-prod.onrender.com；自定义域名尚未绑定。根目录 frontend/dashboard，发布 dist。
- API：复用现有 Bun/Elysia API。API 地址使用实际已配置的 HTTPS origin；示例 api.reffo.cn 不代表已配置该域名。
- 数据：各环境自己的 Supabase Auth 与数据库；nonprod 和 prod 不共用凭据或 owner 名单。
- MCP：仅本地 stdio，经后台 API 访问；不持有 service_role、不直连数据库、不提供远程监听。

## 认证与授权

Supabase Auth 验证身份，dashboard_members 按 Auth 用户 UUID 授权。看板无注册入口，主产品注册不会获得后台权限。即使 APP_ENV=local 且 AUTH_REQUIRED=false，后台仍必须带有效 Bearer token。

| 角色 | 列表和脱敏详情 | 新增/修改台账 | 新建页面/图表、删除图表 |
| --- | --- | --- | --- |
| viewer | 允许 | 拒绝 | 拒绝 |
| owner | 允许 | 允许 | 允许 |

每次请求重新核验身份和成员状态；不信任前端 role、自报 user ID 或 user_metadata。无 token/过期返回 401，普通产品账号/禁用成员返回 403，权限服务失败返回 503 并拒绝访问。

浏览器会话仅保存在内存，自动刷新；刷新页面后重新登录。退出/401 会清理 token、取消尚未完成的请求并卸载看板。不要把 access token 放入 URL、日志、localStorage 或共享文档。

DASHBOARD_OWNER_USER_IDS 是初始化 owner 的逗号分隔 UUID 名单。成员表无此用户时才生效，已有 disabled/viewer 记录优先。初始化完成后可移除名单，仅用 SQL Editor 或运维迁移管理成员；本期不开放成员管理 API。

初始化成员示例（替换占位 UUID，使用已存在的 Auth 账号；不要复制真实 UUID/密码到文档）：

```sql
insert into public.dashboard_members(user_id, role, status)
values ('<auth-user-uuid>', 'owner', 'active')
on conflict (user_id) do update set role='owner', status='active', updated_at=now();

-- 只读成员用 viewer；撤销访问设 disabled。引导 owner 也会被显式禁用覆盖。
update public.dashboard_members set status='disabled', updated_at=now() where user_id='<auth-user-uuid>';
```

## 环境配置

后端环境（在现有 API 服务设置）：

```dotenv
APP_ENV=prod
DATABASE_PROVIDER=supabase
AUTH_REQUIRED=true
SUPABASE_PROJECT_ENV=prod
DASHBOARD_OWNER_USER_IDS=
DASHBOARD_ALLOWED_ORIGINS=https://reffo-dashboard-prod.onrender.com
# CORS_ORIGIN 继续保留主产品精确来源；后台 origin 会单独合并
```

看板构建时配置（Vite 公开值；改动后需要重新构建）：

```dotenv
VITE_API_BASE_URL=https://<existing-api-host>
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_<public-key>
```

VITE_API_BASE_URL 只填 origin，不含 /api/v1；远端必须 HTTPS，本地只允许 loopback HTTP。key 只用 publishable，禁止 service_role、sb_secret、数据库连接串或 MCP token。React Bits 的源码已安装，生产构建不需要 REACTBITS_LICENSE_KEY；它只在本地 shadcn 安装时使用，不得加 VITE_ 前缀。

后端 CORS 对主产品保留原来源，同时加入后台来源；后台 guard 还会单独检查 Origin。CORS 不替代身份认证，无 Origin 的 CLI/MCP 仍必须带 token。代理/IP 白名单不作为唯一权限依据。

## 发布现状（2026-11-19）

PR #59 已合并到 main，应用提交为 0c93aa9c5b4a8e60a40b1f0fbbbfff901f68e4dc。生产 API 和产品 H5 由 Render main 自动部署；生产管理看板单独创建，同样运行该提交。

| 组件 | 地址或目标 | 已核实状态 |
| --- | --- | --- |
| 产品 H5 | https://reffo.cn | 原生 sendBeacon 上报 view_landing，API 200，并按浏览器 session 核实生产入库 |
| API | https://reffo-api-prod.onrender.com | APP_ENV=prod、Supabase 生产项目、AUTH_REQUIRED=true；health 和 analysisCache 均 ok |
| Dashboard | https://reffo-dashboard-prod.onrender.com | HTTPS 可用，main@0c93aa9；只持有公开 publishable key |
| 数据库 | nptpliqejrfqwerhwavw | 看板表、4 个受限 RPC、RLS 与 63 项台账已验证 |
| 管理员 | 生产 Supabase Auth 中已指定邮箱对应账号 | dashboard_members active owner；生产 UUID 单独核实，不复用 nonprod UUID |

尚未配置自定义后台域名 ops.reffo.cn；当前使用 Render HTTPS 域名。生产 owner 的密码未读取或重置。真实生产 Auth 验收使用一次性 owner/viewer/普通用户：owner 可新增/修改台账，viewer 写 API 返回403，普通账号无后台权限；临时用户、成员与精确测试需求均已删除。

### 本次迁移恢复记录

1. GitHub run 44484320726 的 production migration 在 PgClient 连接失败处停止，后续 Render hook 跳过；但 Render autoDeploy 独立完成应用发布。因此该 workflow 的失败不等于应用未上线。
2. 首先通过独立生产工作目录应用了看板/埋点 6 个迁移对象，并验证实际 schema/RLS；没有更改仓库的 nonprod 链接。
3. 一次路径错误导致另外 8 个简历/缓存迁移 SQL 未执行，却错误地被 repair 标为 applied。该操作错误已纠正：仅将这 8 个实际缺失版本恢复 reverted，官方 dry-run 确认仅这 8 条，再由官方 db push --include-all 真正执行成功并自动登记。
4. 恢复后逐表、列、触发器、函数最新定义和有效 ACL 验收通过；25 个原有版本对应实际结构；追加下述前向修复后共26条，官方dry-run返回Remote database is up to date。不能将 repair 标记本身当成 SQL 执行证据。
5. 生产 API 原服务端 Supabase key 不匹配生产项目，REST 返回401 Invalid API key。验证正确生产 key 可读取 owner 后，只更新 SUPABASE_SECRET_KEY，并保留其他环境值；analysisCache 由 degraded 恢复 ok。密钥未写入代码或前端。
6. 恢复时发现旧缓存撤销函数存在 text/uuid 比较错误42883，以及同源多阶段撤销重复命中21000。新增前向迁移 202611190003_cache_owner_text_and_revocation_dedup.sql，只修正两函数四处比较及撤销去重，不修改旧迁移。隔离 PostgreSQL 已复现旧错误并验证历史/源删除、导出撤销、跨用户和 guest 保留，测试写入全部回滚。该增量迁移已提交 cff2a34，先后应用 nonprod 和 production。最终 production 共26条migration，真实结构与权限验收通过，官方dry-run无待执行项。应用仍保持main@0c93aa9，无需因仅替换数据库函数重复发布应用。

### 今后发布的硬性边界

- 不重跑已完成的应用发布。任何迁移必须确认 production project ref、history 和真实 schema 三者一致；DB URL 与 secret 不允许从 nonprod 回退，也不输出到日志。
- 当前 release-tag.yml 仍允许 SUPABASE_PROD_DB_URL 缺失时回退 SUPABASE_NONPROD_DB_URL，是待修的流水线风险；本次没有更改或重跑该 workflow。后续生产 migration 前必须改为缺专用 URL 即失败，并验证连接。
- Render production API/Web 保持原来的 autoDeploy 设置。main 合并会绕过 GitHub migration 步骤独立触发部署；若要求严格先库后应用，应通过单独 PR 完善发布门，不把此次数据库恢复混同为该门已经实现。
- 产品 H5 和 dashboard 分别构建。已实现台账不代表事件已发生；必须在目标环境验证产品页面真实操作、sendBeacon 请求与 analytics_events 同 session 落库。
- 仅应用缺项，不删除业务数据、不复制 SQLite 测试库、不修改用户密码；应用回滚与数据库回滚分别判断。

### Nonprod 参考

Nonprod 使用独立项目 dinvspaogeakqspmjdxm、独立 owner 与密钥；API、产品 H5、dashboard 三个服务已部署1a4859d并验收。本仓库默认 linked 项目仍是 nonprod；所有 production CLI 操作使用独立临时工作目录和显式项目验证。

### 验收范围与保留事项

- 已用真实生产 Auth 临时账号完成 owner/viewer/普通账号验收：owner可新增/修改，viewer直接写403，普通账号无后台权限；账号、成员、精确测试需求均已清理，真实owner保留，密码未改。
- 生产落地页会话 d15854d6-e7b9-41fa-bd50-08da05533c86 的 view_landing 已验证原生sendBeacon、API200和数据库入库；这是验收访问，不代表真实用户增长。
- 未运行有付费模型调用的完整简历生成。删除修复的有数据执行回归在隔离PostgreSQL完成；生产只核验实际函数定义、权限、history和现有行数，未在真实业务数据上试删。
- schema/history与API原配置恢复快照已保存于部署机权限0600的受限临时路径。含敏感配置的备份不进Git、PR或共享文档；临时目录不是长期备份，需后续归档到受控运维存储。
- 旧GitHub发布run仍为failure，本次没有重跑它。生产DB URL连接问题、production URL fallback风险与Render autoDeploy发布门仍未修复，不能据本次手工恢复声称CI自动发布已恢复。

## 查询与服务保护

- 列表每页最多 100，offset 最多 10000；深分页请缩小条件。时间最多 90 天，topN 最多 8，字段、数据源、图表类型使用白名单，禁止任意 SQL/任意 PostgREST filter。
- 异常列表不返回 error_stack/context；点击详情后才查询，返回前脱敏并限制长度。埋点属性同时脱敏、限制深度和体积。不要上报密码、token、简历/JD 原文或分享凭据。
- 趋势/分组由数据库受限 RPC 执行（声明 statement_timeout=3s；是否由目标 PostgREST 按函数装载需 nonprod 验证，不能仅靠函数内 SET 承诺取消长 SQL），API Supabase 请求 5s，Auth 请求 5s。聚合最多 4 个并发，15s 内存缓存，避免拉回最近 1000 条冒充全量统计。
- 单用户每分钟：列表 60、聚合 10、详情 30、台账写 20、其他写 30；429 带 Retry-After:60。认证有进程级 admission 600/min 和最多16并发，限流 map 有上限。
- 限流/缓存是单实例内存，重启会重置，多实例不共享。扩容前在网关统一限流或引入共享计数；当前上限是额外保护，不是跨集群承诺。
- 后台 JSON 体积最多 32KiB，数据库响应最多 1MiB，脱敏上下文最多32KiB；未知写字段被拒绝。后台鉴权、查询与审计不记录 bearer 或请求体。
- 写操作和详情读取业务执行前持久化 attempt 审计，失败则503且不执行；完成后补 succeeded。完成日志失败会输出固定结构日志；attempt 仍可追溯。

## MCP 使用

```dotenv
DASHBOARD_API_BASE_URL=https://<existing-api-host>
DASHBOARD_ACCESS_TOKEN=<supabase-access-token>
```

在后台专用的 viewer/owner 账号下签发短期 Supabase access token（到期重新提供），通过本地进程环境注入；不要给 Agent service_role。工具经 API 统一校验、限流、脱敏和审计。viewer 只查数据/需求，owner 才能改台账或低代码配置。未来远程 MCP 另行设计 OAuth/作用域/可撤销凭证，当前无远程传输。

台账 implemented 仅表示代码已实现，历史界面“已上线”不证明生产发布；应结合部署版本和真实上报验证，不能由 markImplemented 自行推断已发布。已实现代码事件目录在 backend/catalog/tracking-events.json；202611190001_tracking_catalog.sql 补齐缺失目录，不覆盖用户手工维护内容。修改事件调用或参数时同步目录并新增增量 migration（不要修改已执行的迁移），运行 bun run check:tracking；CI 会校验。生产仍需迁移和产品 H5 发布，不会复制本地数据库。

## 验证和回滚

```bash
cd backend
bun run test:dashboard:security
bun test src/mcp/server.test.ts
bunx tsc --noEmit
# dashboard 使用 Node22 + 已有 pnpm8
cd ../frontend/dashboard
pnpm test
pnpm typecheck
pnpm build
```

隔离安全测试仅 stub Auth HTTP，执行真实 Elysia 与 SQLite；迁移另用隔离 PostgreSQL 引擎执行过 RLS/RPC。发布验收仍要真实 Supabase 凭据与目标 HTTPS origin。

先在 Render 回滚静态看板或暂时撤下域名；API 回滚时保留鉴权边界，不能退回公开未鉴权版本。新增表可保留，避免破坏审计记录。紧急撤权将成员 disabled，并移除引导 owner；不要通过放开 CORS 或把 service_role 放浏览器临时救场。
