const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: '请求参数验证失败，请检查后重试',
  NOT_FOUND: '资源不存在',
  INTERNAL_ERROR: '服务暂时不可用，请稍后重试',
  NETWORK_ERROR: '网络连接失败，请检查网络设置',
  TIMEOUT: '请求超时，请检查网络连接',
  REQUEST_ERROR: '请求失败，请稍后重试',
  UNKNOWN_ERROR: '操作失败，请稍后重试',
  AUTH_REQUIRED: '请先登录后再继续',
  INVALID_AUTHORIZATION_HEADER: '登录状态无效，请重新登录',
  INVALID_ACCESS_TOKEN: '登录状态已失效，请重新登录',
  AUTH_NOT_CONFIGURED: '账号服务暂时不可用，请稍后重试',
  AUTH_EMAIL_STATUS_FAILED: '邮箱状态检查失败，请稍后重试',
  AUTH_OTP_SEND_FAILED: '验证码发送失败，请稍后重试',
  AUTH_OTP_VERIFY_FAILED: '验证码校验失败，请稍后重试',
  AUTH_REQUEST_FAILED: '账号服务请求失败，请稍后重试',
  AUTH_INVALID_CREDENTIALS: '邮箱或密码不正确',
  AUTH_EMAIL_EXISTS: '该邮箱已注册，请直接登录',
  AUTH_OTP_EXPIRED: '验证码已过期，请重新发送',
  AUTH_OTP_INVALID: '验证码错误，请重新输入',
  AUTH_OTP_DISABLED: '邮箱验证码登录暂时不可用，请稍后重试',
  AUTH_RATE_LIMITED: '请求过于频繁，请稍后重试',
  AUTH_SESSION_INVALID: '登录状态已失效，请重新登录',
  AUTH_EMAIL_NOT_CONFIRMED: '邮箱尚未完成验证，请先完成邮箱验证',
  AUTH_PASSWORD_RESET_FAILED: '密码重置邮件发送失败，请稍后重试',
  AUTH_PASSWORD_RESET_VERIFY_FAILED: '密码重置验证码校验失败，请稍后重试',
  AUTH_PASSWORD_UPDATE_FAILED: '密码更新失败，请稍后重试',
  AUTH_ENCRYPTION_REQUIRED: '当前登录请求不安全，请刷新页面后重试',
  AUTH_ENCRYPTION_INVALID: '登录加密信息已失效，请重新提交',
  AUTH_ENCRYPTION_EXPIRED: '登录请求已过期，请重新提交',
  AUTH_INVALID_REDIRECT: '第三方登录暂时不可用，请稍后重试',
  INVALID_GRANT: '邮箱或密码不正确',
  invalid_grant: '邮箱或密码不正确',
  invalid_credentials: '邮箱或密码不正确',
  email_not_confirmed: '邮箱尚未完成验证，请先完成邮箱验证',
  user_already_exists: '该邮箱已注册，请直接登录',
  email_exists: '该邮箱已注册，请直接登录',
  otp_expired: '验证码已过期，请重新发送',
  otp_disabled: '邮箱验证码登录暂时不可用，请稍后重试',
  invalid_otp: '验证码错误，请重新输入',
  bad_code: '验证码错误，请重新输入',
  token_expired: '验证码已过期，请重新发送',
  expired_token: '登录链接或验证码已过期，请重新获取',
  over_email_send_rate_limit: '验证码发送过于频繁，请稍后重试',
  over_request_rate_limit: '请求过于频繁，请稍后重试',
  refresh_token_not_found: '登录状态已失效，请重新登录',
  bad_jwt: '登录状态已失效，请重新登录',
  RESUME_HISTORY_LIST_FAILED: '历史记录加载失败，请稍后重试',
  RESUME_HISTORY_GET_FAILED: '历史记录加载失败，请稍后重试',
  RESUME_HISTORY_SAVE_FAILED: '历史记录保存失败，请稍后重试',
  RESUME_HISTORY_UPDATE_FAILED: '历史记录更新失败，请稍后重试',
  RESUME_HISTORY_DELETE_FAILED: '历史记录删除失败，请稍后重试',
  RESUME_HISTORY_CLEAR_FAILED: '历史记录清理失败，请稍后重试',
  RESUME_HISTORY_NOT_FOUND: '历史记录不存在或已删除',
  SOURCE_RESUME_GET_FAILED: '源简历加载失败，请稍后重试',
  SOURCE_RESUME_SAVE_FAILED: '源简历保存失败，请稍后重试',
  SOURCE_RESUME_DELETE_FAILED: '源简历删除失败，请稍后重试',
  SOURCE_RESUME_NOT_FOUND: '源简历不存在或已删除',
  PROCESS_FAILED: '简历分析失败，请稍后重试',
  ANALYSIS_FAILED: '简历分析失败，请稍后重试',
  MATCH_FAILED: '岗位匹配分析失败，请稍后重试',
  GENERATE_FAILED: '简历生成失败，请稍后重试',
  INTERVIEW_FAILED: '面试建议生成失败，请稍后重试',
  OCR_FILE_MISSING: '请选择要解析的文件',
  OCR_UNSUPPORTED_FILE: '文件类型或内容不支持，请更换文件后重试',
  STORAGE_FILE_DOWNLOAD_FAILED: '读取上传文件失败，请重新上传',
  OCR_PROVIDER_NOT_CONFIGURED: '文件解析服务暂时不可用，请稍后重试',
  OCR_PARSE_FAILED: '文件解析失败，请检查文件后重试',
}

export function getClientErrorMessage(code: string | undefined, statusCode: number | undefined, fallback: string) {
  const normalizedCode = code?.trim()
  const mappedMessage = normalizedCode
    ? CLIENT_ERROR_MESSAGES[normalizedCode] || CLIENT_ERROR_MESSAGES[normalizedCode.toLowerCase()]
    : undefined

  if (mappedMessage) {
    return mappedMessage
  }

  if (statusCode === 401 || statusCode === 403) {
    return '登录状态已失效，请重新登录'
  }

  if (statusCode === 404) {
    return '请求的数据不存在'
  }

  if (statusCode === 408 || statusCode === 429) {
    return '请求过于频繁或已超时，请稍后重试'
  }

  if (statusCode !== undefined && statusCode >= 500) {
    return '服务暂时不可用，请稍后重试'
  }

  return fallback
}
