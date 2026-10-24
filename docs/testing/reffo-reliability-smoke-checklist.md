# Reffo 发布前冒烟测试清单

基线：`feature/workflow-v5` / `1e90476`。按顺序执行；任一 P0 失败即停止发布。

| ID | 领域 | 步骤 | 通过标准 | 状态 | 证据 |
|---|---|---|---|---|---|
| SMK-01 | 启动与配置 | 隔离配置启动服务；请求 `/api/v1/mvp/health` 和 `/api/v1/system/public-config` | health 可用且 generation/dependencies 存在；公开配置无 secret | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-02 | 鉴权边界 | 无 Authorization 请求受保护 profile/source-resume/mvp/analyze | 返回稳定鉴权错误且无下游调用 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-03 | 本地登录 | local 环境使用 DEV_USER_ID 读取 profile、source resume | 只返回当前 DEV_USER_ID 数据 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-04 | 分析 | 使用 R01 调 `/mvp/analyze` | 成功返回 `_v5_context`/harness 元数据；首次为 miss 或 disabled | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-05 | 缓存 | 重复 R01 分析一次 | 返回 hit/coalesced；不新增模型调用或配额消费 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-06 | 单步衔接 | 将 analyze 上下文透传到 match→generate→interview | 四步成功且 run/step 状态可查询 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-07 | 质量门禁 | 使用 R-NEG 或篡改 optimized_resume | 阻断交付，不写成功历史，返回 run_id 与恢复建议 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-08 | Landing | 匿名预设 JD 走 analyze→match→generate→interview | 只允许白名单 preset；不写认证历史 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-09 | 文件 | 上传合法 PDF 与 PNG/JPG/JPEG；再测超 10MB | 合法格式可解析；超限拒绝且不外呼 OCR | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-10 | 资料持久化 | 保存 source resume 和一条 history，重启后读取 | 正文、JD、optimized_content 和元数据完整 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-11 | Harness | 查询 run、replay、dashboard、regression-dataset | 结构完整、回放不触发模型、不暴露正文 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-12 | 配额 | nonprod 用户查询 quota 并执行一次 miss | used 增加一次；达到上限返回 429 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-13 | 退出与隔离 | A 在途请求后退出，登录 B 并释放旧响应 | 旧响应不污染 B；B 看不到 A 数据 | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-14 | H5 构建 | 执行 `corepack pnpm@10.33.2 build:h5` | 构建成功；只记录既有 warning，不提交 dist | 未执行 | 执行时填写 run_id/截图/日志 |
| SMK-15 | 回滚准备 | 验证迁移备份、上一版本 health 和恢复步骤 | 恢复演练记录可复用，未改变生产数据 | 未执行 | 执行时填写 run_id/截图/日志 |

执行环境：local 用 SQLite/DEV_USER_ID；nonprod 用独立 Supabase 和脱敏账号；真实模型和 OCR 只在批准环境执行。

冒烟完成后再执行完整 Excel 用例集，并运行 `git diff --check`。