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
| `SUPABASE_NONPROD_DB_URL` | feature CI | 当前 feature 与 production 暂共用该 Supabase project；必须 URL encode 密码并允许 CI 执行 DDL |
| `SUPABASE_PROD_DB_URL` | production environment | prod Supabase Postgres 连接串，优先使用；未配置时 production workflow 会兼容回退到 `SUPABASE_NONPROD_DB_URL` |
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

## 2026-11-12 简历联动与交付升级

先部署可读取旧稿及 `resume-completion-v3` 的 reader，再开放新版 writer。按版本顺序应用以下迁移，不跳过中间版本：

| 顺序 | 迁移 | 作用 |
| --- | --- | --- |
| 1 | `202611120001_resume_exports.sql` | 私有短期PDF快照、文件、租约和历史删除撤销触发器；仅服务端可读写 |
| 2 | `202611120002_resume_commits_reviews.sql` | `commit_resume_history` 原子CAS、幂等确认、review outbox与claim/finish RPC；`match_score`允许NULL，未知匹配分不再写成0 |
| 3 | `202611120003_provider_calls.sql` | 物理provider调用的追加事件和过期索引；缺失usage保留NULL |
| 4 | `202611120004_resume_stage_cache.sql` | owner隔离、分阶段指纹、24小时artifact缓存及删除撤销 |
| 5 | `202611120005_stage_leases_source_delete.sql` | 跨进程stage lease；`delete_resume_source`将源记录删除与瞬态缓存/检查点/导出撤销置于同一事务 |
| 6 | `202611120006_ocr_delivery_diagnostics.sql` | 源简历OCR `parse_id`关联与不可变PDF快照六类门禁；新增列可空，旧记录继续可读 |
| 7 | `202611130007_stage_revocation_epochs.sql` | 撤销事件生成独立epoch，claim绑定当前epoch，store按租约与epoch共同CAS；允许撤销后使用完整源输入重新计算，禁止旧任务复活 |

SQLite在对应repository初始化时执行等价增量迁移；旧 `match_score NOT NULL` 表会在事务中重建，保留已有行、索引和触发器。源记录增加owner后将历史本地行归属开发账户，新增OCR列保持可空。SQLite验证不代表Supabase RPC已经运行成功。

阶段缓存使用005既有claim/store RPC：新调用申请30秒租约，每10秒按owner、token和未过期条件续租；最长合并等待1秒，竞争或存储结果不确定时返回可重试409并保留检查点。请求协调预算205秒，实际workflow只获得剩余预算；丢失租约或预算到期会取消下游模型调用，已丢租的worker不能发布结果或删除新worker的租约。续租使用service_role对锁表的条件PATCH，无需新增RPC。

当前本地实施只完成SQL、REST契约及SQLite等价事务验证，未连接真实远程数据库执行上述迁移，也未进行生产部署。发布时需通过既有CI在目标环境验证权限、CAS冲突、删除事务回滚和租约竞争，确认后再启用writer。

007不会删除撤销记录或恢复旧缓存。撤销表新增/更新时间由数据库触发器生成新的不透明epoch，并清空对应缓存、失效现有租约；新claim在同一数据库事务绑定最新epoch。store要求owner、token、source、有效期限和epoch全部匹配。升级前未绑定epoch的租约不能发布，需要重新claim。Supabase的claim、撤销与store按同一owner/source advisory lock串行化，避免使用应用与数据库时间比较判定撤销前后；无租约旧版store RPC的service_role执行权限同时关闭。上述SQL仍需由远端迁移验证。

回滚优先关闭新版writer或恢复前一个writer版本，保留新增表、可空列及能够读取v3的reader。不得把已保存的v3文档重写为旧协议，不得把NULL分数补成0，也不得移除review/claim谱系或恢复已撤销的短期文件。需要回退应用时继续支持当前稿恢复、保存和安全草稿下载；确认无新旧客户端使用后，才另行设计数据迁移。

## 2026-11-13 填写文档 v4 升级

`202611130008_completion_upgrade_cas.sql` 为既有 `commit_resume_history` RPC 增加可选的完整旧 `processResult` CAS 条件，不新增数据列，不批量改写历史记录。服务端对单条拥有者历史执行 v4 升级时携带此条件，防止覆盖没有改变文档 revision 或 updated_at 的并发后台复核。既有普通保存请求不携带该字段时继续沿用原 CAS 协议。

云端启用 v4 历史升级前必须应用 008；本地 SQLite 已在升级事务中对旧 process_result 做等价校验。SQLite 实测和 Supabase REST/RPC mock 不代表远端 PostgreSQL 已执行迁移。回滚时保留 v4 读取、保存、导出能力和该 RPC 条件，不能把已经升级的文档降级覆盖。
