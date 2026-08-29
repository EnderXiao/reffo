import {apiClient} from './api'
import {getJSON, setJSON, storage} from '@/utils/storage'
import {encryptPasswordPayload, type PasswordEncryptionConfig} from '@/utils/password-encryption'
import {RequestError} from '@/utils/request'
import {getPublicRuntimeConfig} from './runtime-config'
import {routePaths} from '@/shared/routing'

function getLegacyAuthSessionStorageKey() {
  const env = process.env.REFFO_ENV?.trim() || process.env.API_BASE_URL?.trim() || 'local'

  return `reffo.auth.session.${env}`
}

async function getAuthSessionStorageKey() {
  try {
    const {appEnv} = await getPublicRuntimeConfig()
    return `reffo.auth.session.${appEnv}`
  } catch {
    return getLegacyAuthSessionStorageKey()
  }
}

interface SupabaseAuthUser {
  id: string
  email?: string
}

interface SupabaseAuthResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  token_type?: string
  user: SupabaseAuthUser
  otp_length?: number
  resend_after_seconds?: number
}

export interface AuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  user: SupabaseAuthUser
}

export interface SignInWithPasswordInput {
  email: string
  password: string
}

export interface SignUpWithPasswordInput extends SignInWithPasswordInput {
  displayName?: string
}

export interface SignUpResult {
  session: AuthSession | null
  user: SupabaseAuthUser
  otpLength: number
  resendAfterSeconds: number
}

export interface EmailOtpConfig {
  otpLength: number
  resendAfterSeconds: number
}

export interface PasswordResetRequestInput {
  email: string
  redirectTo?: string
}

export interface VerifyPasswordResetOtpInput {
  email: string
  token: string
}

export interface PasswordUpdateInput {
  accessToken: string
  password: string
}

export interface VerifySignupOtpInput {
  email: string
  token: string
}

export interface VerifyEmailOtpInput {
  email: string
  token: string
}

export type OAuthProvider = 'github' | 'google' | 'apple'

let passwordEncryptionConfigPromise: Promise<PasswordEncryptionConfig> | null = null

export function resetPasswordEncryptionConfigCache() {
  passwordEncryptionConfigPromise = null
}

async function getPasswordEncryptionConfig() {
  if (!passwordEncryptionConfigPromise) {
    passwordEncryptionConfigPromise = apiClient.get<PasswordEncryptionConfig>('/auth/crypto-key')
      .catch(error => {
        passwordEncryptionConfigPromise = null
        throw error
      })
  }

  return passwordEncryptionConfigPromise
}

async function encryptPasswordData(payload: Record<string, unknown>) {
  const config = await getPasswordEncryptionConfig()
  return encryptPasswordPayload(config, payload)
}

async function postEncryptedPasswordData<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const request = async () => apiClient.post<T>(path, await encryptPasswordData(payload))

  try {
    return await request()
  } catch (error) {
    if (!(error instanceof RequestError) || error.code !== 'AUTH_ENCRYPTION_INVALID') {
      throw error
    }

    resetPasswordEncryptionConfigCache()
    return request()
  }
}

export class AuthRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'AuthRequestError'
  }
}

function mapAuthResponse(response: SupabaseAuthResponse): AuthSession {
  if (!response.access_token) {
    throw new AuthRequestError('认证响应缺少访问令牌', 'AUTH_TOKEN_MISSING')
  }

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: response.expires_at || (
      response.expires_in
        ? Math.floor(Date.now() / 1000) + response.expires_in
        : undefined
    ),
    user: response.user,
  }
}

function mapOtpConfig(response: Pick<SupabaseAuthResponse, 'otp_length' | 'resend_after_seconds'>): EmailOtpConfig {
  const otpLength = response.otp_length
  const resendAfterSeconds = response.resend_after_seconds

  return {
    otpLength: typeof otpLength === 'number' && Number.isInteger(otpLength) && otpLength > 0
      ? otpLength
      : 6,
    resendAfterSeconds: typeof resendAfterSeconds === 'number' && Number.isInteger(resendAfterSeconds) && resendAfterSeconds > 0
      ? resendAfterSeconds
      : 60,
  }
}

function readOAuthParams() {
  if (typeof window === 'undefined') {
    return null
  }

  const hashIndex = window.location.href.lastIndexOf('#')
  if (hashIndex < 0) {
    return null
  }

  const params = new URLSearchParams(window.location.href.slice(hashIndex + 1))
  return params.has('access_token') ? params : null
}

function cleanOAuthCallbackUrl() {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return
  }

  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${routePaths.auth}`)
}

export class AuthApi {
  async checkEmailRegistered(email: string): Promise<boolean> {
    const result = await apiClient.post<{registered: boolean}>('/auth/email-status', {
      email: email.trim().toLowerCase(),
    })

    return result.registered
  }

  async sendEmailOtp(email: string): Promise<EmailOtpConfig> {
    const response = await apiClient.post<{sent: boolean; otp_length: number; resend_after_seconds: number}>(
      '/auth/email-otp/send',
      {email: email.trim().toLowerCase()},
    )

    return mapOtpConfig(response)
  }

  async verifyEmailOtp(input: VerifyEmailOtpInput): Promise<AuthSession> {
    const response = await apiClient.post<SupabaseAuthResponse>('/auth/email-otp/verify', {
      email: input.email.trim().toLowerCase(),
      token: input.token,
    })
    const session = mapAuthResponse(response)

    await this.persistSession(session)
    return session
  }

  async signInWithPassword(input: SignInWithPasswordInput): Promise<AuthSession> {
    const response = await postEncryptedPasswordData<SupabaseAuthResponse>('/auth/sign-in', {
      email: input.email.trim().toLowerCase(),
      password: input.password,
    })
    const session = mapAuthResponse(response)

    await this.persistSession(session)
    return session
  }

  async signUpWithPassword(input: SignUpWithPasswordInput): Promise<SignUpResult> {
    const response = await postEncryptedPasswordData<SupabaseAuthResponse>('/auth/sign-up', {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      ...(input.displayName ? {display_name: input.displayName.trim()} : {}),
    })
    const session = response.access_token ? mapAuthResponse(response) : null

    if (session) {
      await this.persistSession(session)
    }

    return {
      session,
      user: response.user,
      ...mapOtpConfig(response),
    }
  }

  async requestPasswordReset(input: PasswordResetRequestInput): Promise<EmailOtpConfig> {
    const response = await apiClient.post<{sent: boolean; otp_length: number; resend_after_seconds: number}>('/auth/password-reset/request', {
      email: input.email.trim().toLowerCase(),
      ...(input.redirectTo ? {redirect_to: input.redirectTo} : {}),
    })

    return mapOtpConfig(response)
  }

  async verifyPasswordResetOtp(input: VerifyPasswordResetOtpInput): Promise<AuthSession> {
    const response = await apiClient.post<SupabaseAuthResponse>('/auth/password-reset/verify', {
      email: input.email.trim().toLowerCase(),
      token: input.token,
    })

    return mapAuthResponse(response)
  }

  async updatePassword(input: PasswordUpdateInput): Promise<void> {
    await postEncryptedPasswordData<{updated: boolean}>('/auth/password-update', {
      access_token: input.accessToken,
      password: input.password,
    })
  }

  async verifySignupOtp(input: VerifySignupOtpInput): Promise<AuthSession> {
    const response = await apiClient.post<SupabaseAuthResponse>('/auth/verify-signup', {
      email: input.email.trim().toLowerCase(),
      token: input.token,
    })
    const session = mapAuthResponse(response)

    await this.persistSession(session)
    return session
  }

  async resendSignupOtp(email: string): Promise<EmailOtpConfig> {
    const response = await apiClient.post<{sent: boolean; otp_length: number; resend_after_seconds: number}>('/auth/resend-signup', {
      email: email.trim().toLowerCase(),
    })

    return mapOtpConfig(response)
  }

  async refreshSession(refreshToken: string): Promise<AuthSession> {
    const response = await apiClient.post<SupabaseAuthResponse>('/auth/refresh', {
      refresh_token: refreshToken,
    })
    const session = mapAuthResponse(response)

    await this.persistSession(session)
    return session
  }

  async getOAuthAuthorizeUrl(provider: OAuthProvider): Promise<string> {
    if (typeof window === 'undefined') {
      throw new AuthRequestError('当前平台暂不支持网页授权登录', 'OAUTH_PLATFORM_UNSUPPORTED')
    }

    const redirectTo = `${window.location.origin}${window.location.pathname}#${routePaths.auth}`
    const response = await apiClient.post<{authorize_url: string}>('/auth/oauth-url', {
      provider,
      redirect_to: redirectTo,
    })

    return response.authorize_url
  }

  async restoreOAuthSessionFromUrl(): Promise<AuthSession | null> {
    const params = readOAuthParams()
    if (!params) {
      return null
    }

    const accessToken = params.get('access_token') || ''
    const user = await apiClient.post<SupabaseAuthUser>('/auth/user', {
      access_token: accessToken,
    })
    const expiresIn = Number(params.get('expires_in') || 0)
    const session: AuthSession = {
      accessToken,
      refreshToken: params.get('refresh_token') || undefined,
      expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : undefined,
      user,
    }

    await this.persistSession(session)
    cleanOAuthCallbackUrl()
    return session
  }

  async restoreSession(): Promise<AuthSession | null> {
    const storageKey = await getAuthSessionStorageKey()
    const legacyStorageKey = getLegacyAuthSessionStorageKey()
    let session = await getJSON<AuthSession>(storageKey)

    if (!session && storageKey !== legacyStorageKey) {
      session = await getJSON<AuthSession>(legacyStorageKey)
      if (session) {
        await setJSON(storageKey, session)
        await storage.removeItem(legacyStorageKey)
      }
    }

    if (!session?.accessToken) {
      apiClient.setAuthToken(null)
      return null
    }

    const refreshDeadline = Math.floor(Date.now() / 1000) + 30
    if (session.refreshToken && session.expiresAt && session.expiresAt <= refreshDeadline) {
      try {
        session = await this.refreshSession(session.refreshToken)
      } catch (error) {
        console.warn('[Auth] 登录态刷新失败，将清理过期登录态:', error instanceof Error ? error.message : error)
        await storage.removeItem(storageKey)
        apiClient.setAuthToken(null)
        return null
      }
    }

    apiClient.setAuthToken(session.accessToken)
    return session
  }

  async persistSession(session: AuthSession): Promise<void> {
    const storageKey = await getAuthSessionStorageKey()
    await setJSON(storageKey, session)

    const legacyStorageKey = getLegacyAuthSessionStorageKey()
    if (storageKey !== legacyStorageKey) {
      await storage.removeItem(legacyStorageKey)
    }

    apiClient.setAuthToken(session.accessToken)
  }

  async signOut(): Promise<void> {
    apiClient.setAuthToken(null)
    const storageKey = await getAuthSessionStorageKey()
    const legacyStorageKey = getLegacyAuthSessionStorageKey()
    const keys = new Set([
      storageKey,
      legacyStorageKey,
      'reffo.auth.session.local',
      'reffo.auth.session.nonprod',
      'reffo.auth.session.prod',
    ])
    await Promise.all(Array.from(keys, key => storage.removeItem(key)))
  }
}

export const authApi = new AuthApi()
