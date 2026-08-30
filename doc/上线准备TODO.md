# Reffo 上线准备 TODO

用途：逐项确认正式上线前的配置、代码、数据、部署和回归工作。

状态约定：

- `[ ]` 未确认
- `[-]` 进行中或存在阻塞
- `[x]` 已确认完成

## P0：上线阻塞项

### 生产密钥与环境变量

- [ ] 轮换生产 Supabase Publishable Key、Secret Key
- [ ] 轮换生产 AI/OCR API Key
- [ ] 确认生产 `SUPABASE_SECRET_KEY` 使用正式 secret key，不是 publishable key
- [ ] 生成并安全保存稳定的 `AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY`
- [ ] 将稳定私钥配置到所有生产实例，禁止使用临时密钥
- [ ] 配置正式 `CORS_ORIGIN`，只允许正式前端域名
- [ ] 确认 `APP_ENV=prod`、`DATABASE_PROVIDER=supabase`、`AUTH_REQUIRED=true`
- [ ] 确认 `SUPABASE_PROJECT_ENV=prod`
- [ ] 确认正式 Supabase URL、Storage bucket、AI/OCR endpoint
- [ ] 确认生产环境不配置 `DEV_USER_ID`
- [ ] 确认所有生产密钥未进入 Git、前端 bundle、日志或错误响应

### Supabase 数据库与存储

- [ ] 核对正式项目当前 migration 状态
- [ ] 执行并验证 `202608170001_auth_email_status`
- [ ] 执行并验证 `202608180001_profile_insert_policy`
- [ ] 核对四条业务表及索引是否存在
- [ ] 核对 RLS policy：用户只能访问自己的 profile、source resume、resume history、user files
- [ ] 核对 `user-files` bucket 为私有 bucket
- [ ] 核对 Storage 上传、读取、删除 policy
- [ ] 确认生产数据库备份、恢复点和回滚方案
- [ ] 如需迁移已有数据，先在 nonprod 完成迁移演练和数量校验

### 邮箱认证

- [ ] 配置正式 SMTP
- [ ] 配置注册验证码模板
- [ ] 配置邮箱登录验证码模板
- [ ] 配置重置密码验证码模板
- [ ] 配置修改邮箱模板
- [ ] 配置邀请用户模板
- [ ] 配置二次验证模板
- [ ] 确认模板使用 `{{ .Token }}`，不使用 `{{ .ConfirmationURL }}` 代替验证码
- [ ] 确认 Supabase OTP 位数为 6 位
- [ ] 确认 OTP 重发间隔与后端配置一致
- [ ] 验证注册、登录、重发、错误验证码、过期验证码流程
- [ ] 验证密码登录、密码修改、密码重置流程

### OAuth 与域名

- [ ] 配置 GitHub OAuth 正式 Client ID、Secret
- [ ] 配置 Google OAuth 正式 Client ID、Secret
- [ ] 配置 Apple OAuth 正式 Service ID、Key、Team ID
- [ ] 配置 Supabase Site URL
- [ ] 配置正式前端 OAuth Redirect URLs
- [ ] 验证 OAuth 回调、刷新页面恢复会话、退出登录

## P1：发布前代码与服务

### 后端

- [ ] 生产缺少加密私钥时阻止启动，不只打印 warning
- [ ] 生产关闭或保护 Swagger 文档
- [ ] 确认全局异常不会泄漏密钥、密码、简历原文或 Supabase 响应
- [ ] 确认 C 端错误码和用户提示映射完整
- [ ] 确认限流、请求体大小、上传文件类型和大小限制
- [ ] 确认请求超时、AI 重试、OCR 重试和并发限制
- [ ] 确认健康检查、就绪检查和依赖检查接口
- [ ] 配置 HTTPS 反向代理
- [ ] 配置进程守护、自动重启和优雅退出
- [ ] 配置结构化日志、错误告警和日志保留周期
- [ ] 配置部署回滚方案

### 前端

- [ ] 提交 OTP 位数调整和 Supabase 邮件模板文件
- [ ] 检查生产 H5 bundle 中不存在 local、nonprod API 地址
- [ ] 确认未登录 Landing：预设 JD、简历上传、分析、结果流程可用
- [ ] 确认登录后首页：头像、源简历、历史简历加载正确
- [ ] 确认本地 Landing 数据同步到远端及拒绝同步逻辑
- [ ] 确认退出登录清理会话和用户数据，不恢复旧用户缓存
- [ ] 确认邮箱验证码位数、倒计时、重发状态由接口配置驱动
- [ ] 确认正式域名刷新、深链接和路由回退配置

## P1：验证与发布门禁

- [ ] 后端全量单元测试通过
- [ ] 前端全量测试通过
- [ ] `build:h5:prod` 通过
- [ ] 生产配置启动检查通过
- [ ] 生产后端 `/api/v1/mvp/health` 返回正常
- [ ] 验证 `system/public-config` 不返回敏感配置
- [ ] 验证游客 Landing 全链路
- [ ] 验证邮箱注册全链路
- [ ] 验证邮箱 OTP 登录全链路
- [ ] 验证 OAuth 登录全链路
- [ ] 验证源简历上传、解析、保存、读取、删除
- [ ] 验证历史简历生成、读取、更新、删除
- [ ] 验证异常网络、401、403、429、5xx 提示
- [ ] 验证移动端 393px、430px 和桌面宽屏
- [ ] 若首发包含 RN/小程序，完成真实设备回归
- [ ] 完成上线前备份和回滚演练

## P2：首发后优化

- [ ] 优化 H5 bundle 体积和首屏加载时间
- [ ] 补齐 RN/小程序发布签名、商店配置和自动构建
- [ ] 增加产品埋点、转化漏斗和认证失败监控
- [ ] 增加 AI/OCR 用量、成本和异常告警
- [ ] 建立数据库 migration 发布流程
- [ ] 建立正式、nonprod、local 配置校验脚本
- [ ] 建立定期密钥轮换和权限审计流程

## 当前已知状态

- 后端测试：44 个通过
- H5 生产构建：通过，但存在 bundle 体积警告
- 前端全量测试：仍有 6 个失败项，需要修复
- 正式 Supabase：存在 2 条待执行 migration
- 正式 CORS：当前仍为本地地址，不能上线
- 正式加密私钥：当前未配置
- RN/小程序：尚未完成真实设备回归
