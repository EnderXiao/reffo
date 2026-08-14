# Reffo TODO List

本文档沉淀当前前后端进度盘点后的缺口。状态含义：

- `todo`: 待处理。
- `doing`: 正在处理。
- `done`: 已完成基础落地，后续可继续增强。

## 当前优先级

| ID | 状态 | 优先级 | 待办 | 验收标准 |
| --- | --- | --- | --- | --- |
| 1 | done | P0 | 更新过期项目文档 | 根 README、后端 README 能反映当前 OCR、历史、Harness、自愈、Taro 主线状态。 |
| 2 | done | P0 | 修复 Taro 单测质量门禁 | Jest 可在当前本地环境运行，过期组件测试和 mock 与现有实现对齐。 |
| 3 | doing | P0 | 补生产级后端方案 | 已新增 `doc/Supabase数据库迁移方案.md` 覆盖生产数据库迁移、RLS 和多用户数据边界；仍需继续补完整用户体系、鉴权、限流、隐私和成本控制方案。 |
| 4 | done | P0 | 明确 OCR 配置缺失行为 | OCR 配置缺失时启动有提示，接口返回明确 503 和 `OCR_CONFIG_MISSING`。 |
| 5 | todo | P1 | 补 RN / 小程序真实端验证 | RN Android、小程序端至少完成一次主链路 smoke，并记录截图或验证报告。 |
| 6 | todo | P1 | H5 bundle 体积治理 | 建立 bundle 分析结果，拆分或裁剪 RN/Expo/Three 等高成本依赖。 |
| 7 | todo | P0 | 统一整体动效风格 | 首页、创建页、结果页、完成页的进出场、卡片、Toast、生成态动效有统一节奏；修复已知动效异常。 |
| 8 | todo | P0 | 已生成卡片新增编辑、删除和动效 | 首页历史卡片支持编辑和删除；操作有确认、撤销或反馈；卡片移除/更新有稳定过渡动效。 |
| 9 | done | P0 | 补上线部署方案 | 已新增 `doc/上线部署方案调研.md`，明确后端、Taro H5、环境变量、域名、HTTPS、日志、数据库、回滚和 smoke 验证流程。 |

## 最近验证基线

- 后端：`bun test ./src` 通过。
- Taro H5：`corepack pnpm@10.33.2 build:h5` 通过，仍有 Browserslist、`webpackExports`、bundle size 警告。
- Taro Jest：推荐使用 `corepack pnpm@10.33.2 exec jest --runInBand --no-watchman`，避免本地 Watchman 权限影响。

## 后续建议

下一轮建议优先处理 ID 7、8、9。它们分别影响产品质感、历史卡片可管理性和真实上线闭环。
