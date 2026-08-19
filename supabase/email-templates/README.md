# Supabase 邮件模板

这些模板对应 Supabase Dashboard 的 `Authentication -> Email Templates`。

| Dashboard 模板 | 文件 | 当前流程 |
| --- | --- | --- |
| Confirm signup | `confirm-signup.html` | 注册验证码 |
| Invite user | `invite-user.html` | 管理员邀请 |
| Magic link or OTP | `magic-link-or-otp.html` | 邮箱登录验证码 |
| Change email address | `change-email-address.html` | 修改邮箱 |
| Reset password | `reset-password.html` | 找回密码验证码 |
| Reauthentication | `reauthentication.html` | 敏感操作二次验证 |

复制对应 HTML 到 Supabase 模板编辑器后保存。邮箱登录、注册和找回密码必须保留 `{{ .Token }}`，不要使用 `{{ .ConfirmationURL }}`，否则会发送授权链接而不是验证码。

当前项目 nonprod 配置：

- OTP 位数：6
- 重发间隔：60 秒

Supabase Dashboard 中的 OTP 配置必须与后端 `AUTH_OTP_LENGTH`、`AUTH_OTP_RESEND_SECONDS` 保持一致。
