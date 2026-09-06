# 版本 Tag 发布流程

Render 不再由 main 普通 commit 自动发布。发布必须从 main 创建并推送 `vX.Y.Z` tag：

```bash
git switch main
git pull --ff-only
git tag -a v1.0.0 -m "首个公开版本"
git push origin v1.0.0
```

`.github/workflows/release-tag.yml` 会校验 tag 提交属于 main，读取 tag 名作为版本号、读取 annotated tag 完整描述作为版本描述，执行后端测试和 H5 构建。构建成功后使用 GitHub Actions secret `RENDER_DEPLOY_HOOK_URL` 触发 Render Deploy Hook。Render 构建同一提交时也会从指向 `HEAD` 的版本 tag 读取元数据；本地无 tag 时降级为 `V1.0.0`。

Render 服务需要关闭 main 普通 commit 自动部署，或将其改为仅预览环境。正式环境保留 Deploy Hook 和 Render 手动回滚入口。没有配置 Deploy Hook 时，CI 仍执行构建和测试，但不会触发线上发布。
