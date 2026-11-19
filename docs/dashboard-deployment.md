# 管理后台部署与权限边界

本次准备代码与部署配置，不创建生产服务、不迁移生产数据库、不合并 PR。

## 部署架构

- 看板：Render Static Site，独立域名 ops.reffo.cn，根目录 frontend/dashboard，发布 dist。
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
DASHBOARD_OWNER_USER_IDS=<auth-user-uuid>
DASHBOARD_ALLOWED_ORIGINS=https://ops.reffo.cn
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

## 发布顺序

1. 在 nonprod 应用本分支的全部缺失迁移，包括 observability、dashboard_pages、tracking_requirements、dashboard_security 和 tracking_catalog。权限表、审计表及受限 RPC 仅供 service_role；tracking_catalog 为代码内已实现的 63 个事件补齐台账，遇到同名事件保留已有描述、参数与状态。不要把本地 SQLite 当成环境间同步来源。
2. 在 Supabase Auth 准备后台账号（不在看板开放注册），写入 owner/viewer 成员记录。
3. 更新现有 API 配置并发布安全加固版本。先验证无 token=401、普通产品用户=403、viewer 写入=403、owner 可读写、禁用即时拒绝。
4. 在 Render 创建独立 Static Site。可参考 deploy/render-dashboard.yaml，手动填写公开环境值；不要直接 apply 未确认的生产配置。Node 22，pnpm 8.6.12（与现有 v6 lock 匹配），构建 frozen-lockfile + typecheck + build。
5. 产品 H5 与看板需要分别构建发布。产品 H5 使用 frontend/Taro/reffo-taro 的 build:h5:nonprod 和 API_BASE_URL=https://reffo-api-nonprod.onrender.com/api/v1；仅发布后台 API 和 dashboard 不会发布业务埋点。将产品 H5 与看板发布到同一候选提交，确认真实页面操作的 /telemetry 请求及 analytics_events 落库，避免把“台账已实现”当成事件实际发生。
6. 配置 ops 域名 HTTPS，绑定精确 Origin。以用户实际浏览器完成真实登录和跨域 PATCH/DELETE 预检验收；同一账号恢复前台只刷新内存 token，不卸载页面，服务端仍逐请求校验角色。
7. nonprod 通过后重复生产流程。公开域名前补平台边缘限流；按需要使用 Cloudflare Access/VPN 作为附加防线，不替代 API RBAC。必须防止直访 API 的 Render 域名绕过边缘规则。

Supavisor pooler 与 Supabase REST 是两条不同路径；pooler 故障不会必然阻止 REST。生产 REST/真实账号验收仍需独立完成，不要把本地 mock 验证当成生产通过。迁移可在 SQL Editor 执行，不需要先修 pooler。

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
