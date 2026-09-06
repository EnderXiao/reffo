# Render Feature 分支环境

## 目标

- `main`、`nonprod`、`prod` 保持现有 Render Service，不被 feature 分支覆盖。
- 每个 `feature` / `feature/*` 分支创建独立 Render Web Service。
- feature 分支 push 后自动部署对应 commit。
- PR 合并后自动删除对应 Render Service。
- feature 分支禁止普通成员直接 push；只有仓库 owner 可绕过保护直接 push，其他成员必须走 PR。

## GitHub Secrets

配置以下 Secrets：

- `RENDER_API_KEY`：Render API key。
- `RENDER_OWNER_ID`：Render workspace ID，不是 GitHub owner ID。
- `RENDER_FEATURE_ENV_VARS_JSON`：feature 环境变量 JSON 数组。至少包含后端启动所需变量，例如 `APP_ENV=nonprod`、Supabase nonprod 配置、AI/OCR 配置、`PORT=3000`、`HOST=0.0.0.0`。

`RENDER_FEATURE_ENV_VARS_JSON` 示例结构：

```json
[
  {"key":"APP_ENV","value":"nonprod"},
  {"key":"DATABASE_PROVIDER","value":"supabase"},
  {"key":"SUPABASE_PROJECT_ENV","value":"nonprod"},
  {"key":"SUPABASE_URL","value":"..."},
  {"key":"SUPABASE_SECRET_KEY","value":"..."}
]
```

不要把真实 key 写进仓库文件；JSON 整体放 GitHub Secret。

不要配置 `PORT` 或 `HOST`：Render Web Service 会注入 `PORT`，应用默认监听 `0.0.0.0`。自动化脚本也会过滤这两个变量，避免本地端口覆盖 Render 端口。

## 自动化行为

`.github/workflows/render-feature-environments.yml`：

- push 到 `feature` 或 `feature/**`：按分支名和短 hash 查找 Service，不存在则创建，存在则更新分支并部署当前 commit。
- PR 合并后：删除对应 Service。
- Service 名称格式：`reffo-feature-<branch-slug>-<branch-hash>`。
- 每个 Service 使用 `backend/Containerfile`，健康检查 `/api/v1/mvp/health`。
- Render `autoDeploy` 关闭，由 GitHub Actions 显式部署 commit，避免重复部署。

## 设置 feature 分支保护

GitHub API token 当前未在本地登录，不能代替仓库管理员执行远程规则变更。完成 GitHub 登录后执行：

```bash
GH_TOKEN=<repo-admin-token> \
GITHUB_OWNER=EnderXiao \
GITHUB_REPO=reffo \
bash .github/scripts/configure-feature-branch-ruleset.sh
```

规则覆盖：

- `feature` 和 `feature/*`。
- owner 可绕过规则直接 push。
- 其他成员必须通过 PR。
- PR 至少 1 个批准。
- 禁止删除和 force push。

脚本可重复执行：同名 ruleset 已存在时更新，不重复创建。

当前仓库为 GitHub 私有仓库，账号计划返回 `Upgrade to GitHub Pro or make this repository public to enable this feature` 时，GitHub 不开放 Rulesets 和经典 Branch Protection API。此时需要升级 GitHub Pro、迁移到支持规则的组织计划，或将仓库改为公开后再执行上述脚本；仅靠 GitHub Actions 无法伪造服务端分支保护。

## 注意

- 同一 feature 分支每次 push 会更新同一个 Service；不同 feature 分支互不覆盖。
- PR 关闭但未合并时当前 workflow 不删除环境，避免误删仍需调试的分支环境。需要关闭即删除时，可去掉 `merged == true` 条件。
- Render Service 数量和计算资源按分支增长；长期不用的分支应删除或关闭 PR。
