-- 可重复部署的代码埋点目录：数据源为 backend/catalog/tracking-events.json（56 个新增 + 7 个既有，共 63 个事件）。
-- implemented 仅表示 track 调用已在代码中实现，不表示任何环境已发布或产生事件。
-- JSON 与本迁移的内嵌清单必须同步；只读校验：
-- bun --no-env-file backend/scripts/check-tracking-catalog.ts
-- 分享落地页仅登记 share_id / mode；失败事件保留 error，由 SDK 脱敏。
-- 仅补齐缺失事件，不覆盖已有状态、描述、参数或页面，也不删除用户手工需求。

insert into public.tracking_requirements (event_name, params, page, description, status)
select event_name, params, page, description, status
from jsonb_to_recordset($tracking_catalog$
[
  {
    "event_name": "click_background_generation",
    "params": [
      "task_id"
    ],
    "page": "创建页",
    "description": "用户点击切到后台继续生成并返回首页时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_cancel_generation",
    "params": [
      "task_id"
    ],
    "page": "创建页",
    "description": "用户在生成过程中点击取消生成时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_complete_continue",
    "params": [],
    "page": "完成页",
    "description": "用户在完成页点击返回首页时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_complete_retry",
    "params": [],
    "page": "完成页",
    "description": "用户完成页加载失败时点击重试重新加载简历卡时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_complete_share",
    "params": [
      "history_id"
    ],
    "page": "完成页",
    "description": "用户在完成页点击分享按钮进入分享页时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_generate",
    "params": [
      "task_id",
      "flow",
      "company",
      "position"
    ],
    "page": "创建页",
    "description": "用户在非落地页创建流程成功创建后台生成任务后上报",
    "status": "implemented"
  },
  {
    "event_name": "click_history_update",
    "params": [
      "history_id"
    ],
    "page": "创建页",
    "description": "用户在编辑申请信息模式点击「更新信息」提交修改时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_home_card",
    "params": [
      "history_id"
    ],
    "page": "首页",
    "description": "用户点击首页简历卡片打开该岗位的结果页时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_home_create",
    "params": [
      "has_source_resume"
    ],
    "page": "首页",
    "description": "用户从首页点击新建简历进入创建流程时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_home_delete_task",
    "params": [
      "task_id"
    ],
    "page": "首页",
    "description": "用户在首页确认删除生成失败的任务卡片时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_home_profile",
    "params": [],
    "page": "首页",
    "description": "用户从首页点击头像进入个人中心时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_home_retry_generation",
    "params": [
      "task_id"
    ],
    "page": "首页",
    "description": "用户在首页对生成失败的卡片确认「重试」继续生成时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_landing_select_job",
    "params": [
      "job_id"
    ],
    "page": "落地页",
    "description": "用户在落地页引导中选择一份预设目标岗位时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_landing_skip",
    "params": [],
    "page": "落地页",
    "description": "用户在引导流程中点击「跳过教程」完成引导时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_landing_start_generate",
    "params": [
      "job_id"
    ],
    "page": "落地页",
    "description": "用户在落地页自定义岗位后点击「开始生成最佳简历」时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_landing_upload_resume",
    "params": [
      "parse_id"
    ],
    "page": "落地页",
    "description": "用户在落地页引导流程中成功上传自己的简历文件时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_login_submit",
    "params": [],
    "page": "登录/注册页",
    "description": "用户在登录页完成校验后点击「登录」提交登录时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_oauth_login",
    "params": [
      "provider"
    ],
    "page": "登录/注册页",
    "description": "用户点击 GitHub/Google/Apple 第三方登录按钮发起 OAuth 授权时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_profile_clear_cache",
    "params": [],
    "page": "个人中心",
    "description": "用户在「我的数据」页确认清理本机缓存时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_profile_delete_histories",
    "params": [
      "count"
    ],
    "page": "个人中心",
    "description": "用户在「我的数据」页确认删除全部已生成简历数据时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_profile_sign_out",
    "params": [],
    "page": "个人中心",
    "description": "用户在个人中心点击退出登录时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_register_submit",
    "params": [],
    "page": "登录/注册页",
    "description": "用户在注册页完成校验后点击「确认注册」提交注册时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_resend_otp",
    "params": [
      "purpose"
    ],
    "page": "登录/注册页",
    "description": "用户在验证码倒计时结束后点击「重新发送验证码」时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_result_complete",
    "params": [],
    "page": "结果页",
    "description": "用户点击「完成」进入完成页时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_result_edit_history",
    "params": [
      "history_id"
    ],
    "page": "结果页",
    "description": "用户点击编辑申请信息进入历史编辑模式时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_result_export_pdf",
    "params": [],
    "page": "结果页",
    "description": "用户点击结果页「下载」按钮导出 PDF 时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_result_retry_stage",
    "params": [
      "stage"
    ],
    "page": "结果页",
    "description": "用户对失败或需要刷新的生成阶段点击重试时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_result_save",
    "params": [],
    "page": "结果页",
    "description": "用户点击「保存」保存当前简历结果时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_share_experience",
    "params": [],
    "page": "分享落地页",
    "description": "被邀请用户在分享落地页点击「体验 Reffo」时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_share_image",
    "params": [
      "history_id",
      "mode"
    ],
    "page": "分享页",
    "description": "用户点击分享图片（保存/发送工牌分享图）时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_share_link",
    "params": [
      "history_id",
      "mode"
    ],
    "page": "分享页",
    "description": "用户点击分享链接（发送或复制分享链接）时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_share_mode_switch",
    "params": [
      "mode"
    ],
    "page": "分享页",
    "description": "用户在分享页切换分享内容模式时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_share_retry",
    "params": [],
    "page": "分享落地页",
    "description": "分享落地页加载失败后用户点击重试重新加载分享内容时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_upload_jd_attachment",
    "params": [
      "parse_id"
    ],
    "page": "创建页",
    "description": "用户在 JD 步骤选择并提交岗位描述截图/附件解析时上报",
    "status": "implemented"
  },
  {
    "event_name": "click_upload_resume",
    "params": [
      "parse_id",
      "extension"
    ],
    "page": "创建页",
    "description": "用户在创建流程中选择并成功上传简历文件（解析完成）时上报",
    "status": "implemented"
  },
  {
    "event_name": "generation_failed",
    "params": [
      "task_id",
      "history_id"
    ],
    "page": "首页/创建页/结果页",
    "description": "后台生成任务更新为 failed 终态且状态发生变化时上报；与 generation_success 共用条件调用",
    "status": "implemented"
  },
  {
    "event_name": "generation_success",
    "params": [
      "task_id",
      "history_id"
    ],
    "page": "首页/创建页/结果页",
    "description": "后台生成任务更新为 completed 终态且状态发生变化时上报；与 generation_failed 共用条件调用",
    "status": "implemented"
  },
  {
    "event_name": "jd_parse_failed",
    "params": [
      "error"
    ],
    "page": "创建页",
    "description": "岗位描述截图/附件解析服务失败时上报",
    "status": "implemented"
  },
  {
    "event_name": "jd_parse_success",
    "params": [
      "parse_id"
    ],
    "page": "创建页",
    "description": "岗位描述截图/附件解析服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "landing_generation_failed",
    "params": [],
    "page": "落地页",
    "description": "落地页内联生成流程失败时上报",
    "status": "implemented"
  },
  {
    "event_name": "landing_generation_success",
    "params": [
      "company",
      "position"
    ],
    "page": "落地页",
    "description": "落地页内联生成流程完成后上报，覆盖未创建后台任务的新用户首单",
    "status": "implemented"
  },
  {
    "event_name": "login_failed",
    "params": [
      "error"
    ],
    "page": "登录/注册页",
    "description": "密码登录服务失败时上报（与 login_success 配对）",
    "status": "implemented"
  },
  {
    "event_name": "login_success",
    "params": [],
    "page": "登录/注册页",
    "description": "用户通过密码登录服务成功并持久化登录会话后上报",
    "status": "implemented"
  },
  {
    "event_name": "oauth_login_success",
    "params": [],
    "page": "登录/注册页",
    "description": "第三方 OAuth 回调登录恢复会话成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "password_reset_requested",
    "params": [],
    "page": "登录/注册页",
    "description": "密码重置验证码请求服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "password_updated",
    "params": [],
    "page": "登录/注册页",
    "description": "密码更新（重置/修改密码提交）服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "referral_reward_claimed",
    "params": [
      "bonus_count"
    ],
    "page": "登录/注册页",
    "description": "注册完成后领取分享邀请双方奖励成功时上报",
    "status": "implemented"
  },
  {
    "event_name": "register_failed",
    "params": [
      "error"
    ],
    "page": "登录/注册页",
    "description": "注册服务失败时上报（与 register_success 配对）",
    "status": "implemented"
  },
  {
    "event_name": "register_success",
    "params": [],
    "page": "登录/注册页",
    "description": "用户注册后直接获得登录会话，或完成注册验证码验证并持久化会话后上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_export",
    "params": [
      "export_id",
      "format"
    ],
    "page": "结果页",
    "description": "PDF 导出创建请求成功并取得导出 metadata 后上报，不表示文件下载已完成",
    "status": "implemented"
  },
  {
    "event_name": "resume_history_cleared",
    "params": [
      "count"
    ],
    "page": "个人中心",
    "description": "清空全部简历历史服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_history_deleted",
    "params": [
      "history_id"
    ],
    "page": "创建页",
    "description": "删除单份简历历史服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_history_saved",
    "params": [
      "history_id"
    ],
    "page": "结果页",
    "description": "简历历史保存服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_history_updated",
    "params": [
      "history_id"
    ],
    "page": "创建页",
    "description": "简历历史更新服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_parse_failed",
    "params": [
      "error"
    ],
    "page": "创建页/落地页",
    "description": "简历文件解析服务失败时上报",
    "status": "implemented"
  },
  {
    "event_name": "resume_parse_success",
    "params": [
      "parse_id",
      "file_type"
    ],
    "page": "创建页/落地页",
    "description": "简历文件解析服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "share_created",
    "params": [
      "share_id"
    ],
    "page": "分享页",
    "description": "分享链接创建服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "source_resume_deleted",
    "params": [
      "source_resume_id"
    ],
    "page": "创建页",
    "description": "源简历删除服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "source_resume_saved",
    "params": [
      "source_type"
    ],
    "page": "创建页",
    "description": "源简历保存服务成功后上报",
    "status": "implemented"
  },
  {
    "event_name": "submit_password_reset_request",
    "params": [],
    "page": "登录/注册页",
    "description": "用户在忘记密码流程中输入邮箱并提交「发送重置验证码」时上报",
    "status": "implemented"
  },
  {
    "event_name": "view_landing",
    "params": [],
    "page": "落地页",
    "description": "用户首次进入落地页（splash 阶段）时上报一次页面访问，作为新用户漏斗起点",
    "status": "implemented"
  },
  {
    "event_name": "view_profile",
    "params": [],
    "page": "个人中心",
    "description": "用户进入个人中心设置页时上报",
    "status": "implemented"
  },
  {
    "event_name": "view_share_landing",
    "params": [
      "share_id",
      "mode"
    ],
    "page": "分享落地页",
    "description": "分享链接打开后落地页成功加载分享内容进入预告阶段时上报",
    "status": "implemented"
  }
]
$tracking_catalog$::jsonb) as catalog(
  event_name text,
  params jsonb,
  page text,
  description text,
  status text
)
on conflict (event_name) do nothing;
