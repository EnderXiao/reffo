import { Elysia, t } from 'elysia'
import { env } from '@/config/env'
import {
  decryptPasswordPayload,
  getPasswordEncryptionConfig,
  PasswordCryptoError,
} from '@/auth/password-crypto'
import { createSupabaseRestClient } from '@/repositories/supabase/client'
import type { ApiResponse } from '@/types'

interface EmailStatus {
  registered: boolean
}

interface SupabaseAuthUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

interface SupabaseAuthResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  token_type?: string
  user: SupabaseAuthUser
}

interface SupabaseAuthErrorPayload {
  msg?: string
  message?: string
  error_description?: string
  error?: string
  error_code?: string
  code?: string
}

interface AuthOtpMetadata {
  otp_length: number
  resend_after_seconds: number
}

class SupabaseAuthProxyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'SupabaseAuthProxyError'
  }
}

function getSupabaseAuthUrl(path: string) {
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}${path}`
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function requestSupabaseAuth<T>(
  path: string,
  options: {
    body?: unknown
    method?: 'GET' | 'POST' | 'PATCH'
    accessToken?: string
  } = {},
): Promise<T> {
  const response = await fetch(getSupabaseAuthUrl(path), {
    method: options.method || 'POST',
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      ...(options.accessToken ? {Authorization: `Bearer ${options.accessToken}`} : {}),
      ...(options.body === undefined ? {} : {'Content-Type': 'application/json'}),
    },
    ...(options.body === undefined ? {} : {body: JSON.stringify(options.body)}),
  })
  const payload = await parseJsonResponse(response)

  if (!response.ok) {
    const error = payload && typeof payload === 'object'
      ? payload as SupabaseAuthErrorPayload
      : {}
    throw new SupabaseAuthProxyError(
      error.error_description || error.message || error.msg || error.error || '认证失败',
      response.status,
      error.error_code || error.code || error.error,
    )
  }

  return payload as T
}

function authConfigError(set: {status?: unknown}) {
  set.status = 503
  return {
    success: false,
    error: {
      code: 'AUTH_NOT_CONFIGURED',
      message: '账号服务暂未配置',
    },
  } satisfies ApiResponse<never>
}

function mapAuthProxyError(error: SupabaseAuthProxyError) {
  const code = error.code?.trim().toLowerCase()

  if (code === 'invalid_grant' || code === 'invalid_credentials') {
    return {code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码不正确'}
  }

  if (code === 'user_already_exists' || code === 'email_exists') {
    return {code: 'AUTH_EMAIL_EXISTS', message: '该邮箱已注册，请直接登录'}
  }

  if (code === 'otp_expired' || code === 'expired_token' || code === 'token_expired') {
    return {code: 'AUTH_OTP_EXPIRED', message: '验证码已过期，请重新发送'}
  }

  if (code === 'invalid_otp' || code === 'bad_code') {
    return {code: 'AUTH_OTP_INVALID', message: '验证码错误，请重新输入'}
  }

  if (code === 'otp_disabled') {
    return {code: 'AUTH_OTP_DISABLED', message: '邮箱验证码登录暂时不可用，请稍后重试'}
  }

  if (code === 'email_not_confirmed') {
    return {code: 'AUTH_EMAIL_NOT_CONFIRMED', message: '邮箱尚未完成验证，请先完成邮箱验证'}
  }

  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return {code: 'AUTH_RATE_LIMITED', message: '请求过于频繁，请稍后重试'}
  }

  if (code === 'bad_jwt' || code === 'refresh_token_not_found' || code === 'invalid_refresh_token') {
    return {code: 'AUTH_SESSION_INVALID', message: '登录状态已失效，请重新登录'}
  }

  if (error.status === 429) {
    return {code: 'AUTH_RATE_LIMITED', message: '请求过于频繁，请稍后重试'}
  }

  return {code: 'AUTH_REQUEST_FAILED', message: '账号服务请求失败，请稍后重试'}
}

function authProxyError(error: SupabaseAuthProxyError, set: {status?: unknown}) {
  set.status = error.status >= 400 && error.status < 600 ? error.status : 502
  const clientError = mapAuthProxyError(error)

  return {
    success: false,
    error: {
      code: clientError.code,
      message: clientError.message,
    },
  } satisfies ApiResponse<never>
}

function hasAuthConfig() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY)
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getOtpMetadata(): AuthOtpMetadata {
  return {
    otp_length: env.AUTH_OTP_LENGTH,
    resend_after_seconds: env.AUTH_OTP_RESEND_SECONDS,
  }
}

const oauthProviderSchema = t.Union([
  t.Literal('github'),
  t.Literal('google'),
  t.Literal('apple'),
])

const emailSchema = t.String({
  minLength: 3,
  maxLength: 320,
  pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$',
})

const encryptedPasswordPayloadSchema = t.Object({
  version: t.Number(),
  key_id: t.String({minLength: 1, maxLength: 128}),
  encrypted_key: t.String({minLength: 1, maxLength: 4096}),
  iv: t.String({minLength: 1, maxLength: 128}),
  ciphertext: t.String({minLength: 1, maxLength: 65536}),
  timestamp: t.Number(),
  nonce: t.String({minLength: 1, maxLength: 256}),
})

interface PasswordAuthPayload {
  email?: unknown
  password?: unknown
  access_token?: unknown
  display_name?: unknown
}

function readDecryptedPayload(body: unknown): PasswordAuthPayload {
  const payload = decryptPasswordPayload(body)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证载荷内容无效')
  }

  return payload as PasswordAuthPayload
}

function readPassword(payload: PasswordAuthPayload) {
  if (typeof payload.password !== 'string' || payload.password.length < 1 || payload.password.length > 1024) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '密码格式无效')
  }

  return payload.password
}

function readEmail(payload: PasswordAuthPayload) {
  if (typeof payload.email !== 'string' || !/^\s*[^\s@]+@[^\s@]+\.[^\s@]+\s*$/.test(payload.email)) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '邮箱格式无效')
  }

  return normalizeEmail(payload.email)
}

function readAccessToken(payload: PasswordAuthPayload) {
  if (typeof payload.access_token !== 'string' || payload.access_token.length < 1 || payload.access_token.length > 4096) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '登录状态无效，请重新登录')
  }

  return payload.access_token
}

function passwordCryptoError(error: PasswordCryptoError, set: {status?: unknown}) {
  set.status = 400
  return {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  } satisfies ApiResponse<never>
}

export const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
  .get(
    '/crypto-key',
    () => ({
      success: true,
      data: getPasswordEncryptionConfig(),
    }),
    {
      detail: {
        summary: '获取密码应用层加密公钥',
        description: '返回前端加密密码所需的公钥；私钥只保留在服务端。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/email-status',
    async ({ body, set }) => {
      if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
        set.status = 503
        return {
          success: false,
          error: {
            code: 'AUTH_NOT_CONFIGURED',
            message: '账号服务暂未配置',
          },
        } satisfies ApiResponse<never>
      }

      try {
        const registered = await createSupabaseRestClient({ useServiceRole: true })
          .request<boolean>('/rest/v1/rpc/is_auth_email_registered', {
            method: 'POST',
            body: {check_email: normalizeEmail(body.email)},
          })

        return {
          success: true,
          data: { registered },
        } satisfies ApiResponse<EmailStatus>
      } catch (error) {
        console.error('检查邮箱注册状态失败:', error)
        set.status = 502
        return {
          success: false,
          error: {
            code: 'AUTH_EMAIL_STATUS_FAILED',
            message: '暂时无法检查邮箱状态，请稍后重试',
          },
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({
        email: t.String({
          minLength: 3,
          maxLength: 320,
          pattern: '^\\s*[^\\s@]+@[^\\s@]+\\.[^\\s@]+\\s*$',
          description: '待检查的登录邮箱',
        }),
      }),
      detail: {
        summary: '检查邮箱是否已注册',
        description: '由服务端使用 Supabase Secret Key 查询 Auth 用户，不向前端暴露管理密钥。',
        tags: ['Auth'],
      },
    }
  )
  .post(
    '/email-otp/send',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        await requestSupabaseAuth('/auth/v1/otp', {
          body: {
            email: normalizeEmail(body.email),
            create_user: false,
          },
        })

        return {
          success: true,
          data: {sent: true, ...getOtpMetadata()},
        } satisfies ApiResponse<{sent: boolean} & AuthOtpMetadata>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('发送邮箱验证码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_OTP_SEND_FAILED', message: '验证码发送服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({email: emailSchema}),
      detail: {
        summary: '发送邮箱登录验证码',
        description: '发送 Supabase 邮箱 OTP，不自动创建未注册账号。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/email-otp/verify',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/verify', {
          body: {
            type: 'email',
            email: normalizeEmail(body.email),
            token: body.token.trim(),
          },
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthResponse>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('校验邮箱登录验证码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_OTP_VERIFY_FAILED', message: '验证码校验服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({
        email: emailSchema,
        token: t.String({minLength: 1, maxLength: 32}),
      }),
      detail: {summary: '校验邮箱登录验证码', tags: ['Auth']},
    },
  )
  .post(
    '/sign-in',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const payload = readDecryptedPayload(body)
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/token?grant_type=password', {
          body: {
            email: readEmail(payload),
            password: readPassword(payload),
          },
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthResponse>
      } catch (error) {
        if (error instanceof PasswordCryptoError) {
          return passwordCryptoError(error, set)
        }

        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('密码登录代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '登录服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: encryptedPasswordPayloadSchema,
      detail: {
        summary: '邮箱密码登录（加密载荷）',
        description: '服务端只接受应用层加密载荷，解密后代理 Supabase Auth。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/sign-up',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const payload = readDecryptedPayload(body)
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/signup', {
          body: {
            email: readEmail(payload),
            password: readPassword(payload),
            ...(typeof payload.display_name === 'string' && payload.display_name.trim()
              ? {data: {display_name: payload.display_name.trim()}}
              : {}),
          },
        })

        return {
          success: true,
          data: {...data, ...getOtpMetadata()},
        } satisfies ApiResponse<SupabaseAuthResponse & AuthOtpMetadata>
      } catch (error) {
        if (error instanceof PasswordCryptoError) {
          return passwordCryptoError(error, set)
        }

        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('邮箱注册代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '注册服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: encryptedPasswordPayloadSchema,
      detail: {
        summary: '邮箱注册（加密载荷）',
        description: '服务端只接受应用层加密载荷，并交给 Supabase Auth 负责密码哈希存储。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/password-reset/request',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        await requestSupabaseAuth('/auth/v1/recover', {
          body: {
            email: normalizeEmail(body.email),
            ...(body.redirect_to?.trim() ? {redirect_to: body.redirect_to.trim()} : {}),
          },
        })

        return {
          success: true,
          data: {sent: true, ...getOtpMetadata()},
        } satisfies ApiResponse<{sent: boolean} & AuthOtpMetadata>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('发送密码重置邮件代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_PASSWORD_RESET_FAILED', message: '密码重置邮件发送失败，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({
        email: emailSchema,
        redirect_to: t.Optional(t.String({maxLength: 2048})),
      }),
      detail: {
        summary: '发送密码重置验证码',
        description: '仅发送邮箱地址给服务端；验证码位数和冷却时间由后端返回。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/password-reset/verify',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/verify', {
          body: {
            type: 'recovery',
            email: normalizeEmail(body.email),
            token: body.token.trim(),
          },
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthResponse>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('校验密码重置验证码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_PASSWORD_RESET_VERIFY_FAILED', message: '密码重置验证码校验失败，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({
        email: emailSchema,
        token: t.String({minLength: 1, maxLength: 32}),
      }),
      detail: {
        summary: '校验密码重置验证码',
        description: '校验 Supabase recovery OTP，返回仅用于本次密码更新的登录态。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/password-update',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const payload = readDecryptedPayload(body)
        await requestSupabaseAuth('/auth/v1/user', {
          method: 'PATCH',
          accessToken: readAccessToken(payload),
          body: {password: readPassword(payload)},
        })

        return {
          success: true,
          data: {updated: true},
        } satisfies ApiResponse<{updated: boolean}>
      } catch (error) {
        if (error instanceof PasswordCryptoError) {
          return passwordCryptoError(error, set)
        }

        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('更新密码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_PASSWORD_UPDATE_FAILED', message: '密码更新失败，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: encryptedPasswordPayloadSchema,
      detail: {
        summary: '更新密码（加密载荷）',
        description: '服务端只接受应用层加密载荷，使用载荷内登录态更新 Supabase 密码。',
        tags: ['Auth'],
      },
    },
  )
  .post(
    '/verify-signup',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/verify', {
          body: {
            type: 'signup',
            email: normalizeEmail(body.email),
            token: body.token.trim(),
          },
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthResponse>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('注册验证码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '验证码服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({
        email: emailSchema,
        token: t.String({minLength: 1, maxLength: 32}),
      }),
      detail: {summary: '校验注册验证码', tags: ['Auth']},
    },
  )
  .post(
    '/resend-signup',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        await requestSupabaseAuth('/auth/v1/resend', {
          body: {
            type: 'signup',
            email: body.email.trim().toLowerCase(),
          },
        })

        return {
          success: true,
          data: {sent: true, ...getOtpMetadata()},
        } satisfies ApiResponse<{sent: boolean} & AuthOtpMetadata>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('重发注册验证码代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '验证码服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({email: emailSchema}),
      detail: {summary: '重发注册验证码', tags: ['Auth']},
    },
  )
  .post(
    '/refresh',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const data = await requestSupabaseAuth<SupabaseAuthResponse>('/auth/v1/token?grant_type=refresh_token', {
          body: {refresh_token: body.refresh_token},
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthResponse>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('刷新登录态代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '登录态刷新服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({refresh_token: t.String({minLength: 1, maxLength: 4096})}),
      detail: {summary: '刷新登录态', tags: ['Auth']},
    },
  )
  .post(
    '/user',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      try {
        const data = await requestSupabaseAuth<SupabaseAuthUser>('/auth/v1/user', {
          method: 'GET',
          accessToken: body.access_token,
        })

        return {success: true, data} satisfies ApiResponse<SupabaseAuthUser>
      } catch (error) {
        if (error instanceof SupabaseAuthProxyError) {
          return authProxyError(error, set)
        }

        console.error('获取登录用户代理失败:', error instanceof Error ? error.message : error)
        set.status = 502
        return {
          success: false,
          error: {code: 'AUTH_REQUEST_FAILED', message: '登录态校验服务暂时不可用，请稍后重试'},
        } satisfies ApiResponse<never>
      }
    },
    {
      body: t.Object({access_token: t.String({minLength: 1, maxLength: 4096})}),
      detail: {summary: '校验 OAuth 登录用户', tags: ['Auth']},
    },
  )
  .post(
    '/oauth-url',
    async ({body, set}) => {
      if (!hasAuthConfig()) {
        return authConfigError(set)
      }

      const redirectTo = body.redirect_to.trim()
      let redirectUrl: URL

      try {
        redirectUrl = new URL(redirectTo)
      } catch {
        set.status = 400
        return {
          success: false,
          error: {code: 'AUTH_INVALID_REDIRECT', message: 'OAuth 回调地址无效'},
        } satisfies ApiResponse<never>
      }

      if (!['http:', 'https:'].includes(redirectUrl.protocol)) {
        set.status = 400
        return {
          success: false,
          error: {code: 'AUTH_INVALID_REDIRECT', message: 'OAuth 回调地址无效'},
        } satisfies ApiResponse<never>
      }

      const params = new URLSearchParams({
        provider: body.provider,
        redirect_to: redirectUrl.toString(),
      })
      const authorizeUrl = `${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/authorize?${params.toString()}`

      return {
        success: true,
        data: {authorize_url: authorizeUrl},
      } satisfies ApiResponse<{authorize_url: string}>
    },
    {
      body: t.Object({
        provider: oauthProviderSchema,
        redirect_to: t.String({minLength: 1, maxLength: 2048}),
      }),
      detail: {summary: '生成第三方登录地址', tags: ['Auth']},
    },
  )
