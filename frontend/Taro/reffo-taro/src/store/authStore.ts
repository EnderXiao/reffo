import {create} from 'zustand'
import {
  authApi,
  type AuthSession,
  type EmailOtpConfig,
  type OAuthProvider,
  type PasswordResetRequestInput,
  type PasswordUpdateInput,
  type SignInWithPasswordInput,
  type SignUpResult,
  type SignUpWithPasswordInput,
  type VerifyPasswordResetOtpInput,
  type VerifySignupOtpInput,
  type VerifyEmailOtpInput,
} from '@/services/auth'
import {clearPersistedUserData} from '@/utils/user-data-storage'
import {profileApi, type UserProfile} from '@/services/profile'

interface AuthState {
  session: AuthSession | null
  profile: UserProfile | null
  initialized: boolean
  loading: boolean
  error: string | null
  restoreSession: () => Promise<AuthSession | null>
  loadProfile: () => Promise<UserProfile | null>
  restoreOAuthSession: () => Promise<AuthSession | null>
  checkEmailRegistered: (email: string) => Promise<boolean>
  sendEmailOtp: (email: string) => Promise<EmailOtpConfig>
  verifyEmailOtp: (input: VerifyEmailOtpInput) => Promise<AuthSession>
  signInWithPassword: (input: SignInWithPasswordInput) => Promise<AuthSession>
  signUpWithPassword: (input: SignUpWithPasswordInput) => Promise<SignUpResult>
  requestPasswordReset: (input: PasswordResetRequestInput) => Promise<EmailOtpConfig>
  verifyPasswordResetOtp: (input: VerifyPasswordResetOtpInput) => Promise<AuthSession>
  updatePassword: (input: PasswordUpdateInput) => Promise<void>
  verifySignupOtp: (input: VerifySignupOtpInput) => Promise<AuthSession>
  resendSignupOtp: (email: string) => Promise<EmailOtpConfig>
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
}

let restoreSessionPromise: Promise<AuthSession | null> | null = null

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

async function resetUserBusinessState(userId?: string | null) {
  const [historyModule, sourceResumeModule, resumeModule, jdModule, landingFlowModule] = await Promise.all([
    import('./historyStore'),
    import('./sourceResumeStore'),
    import('./resumeStore'),
    import('./jdStore'),
    import('./landingFlowStore'),
  ])

  historyModule.useHistoryStore.getState().reset()
  sourceResumeModule.useSourceResumeStore.getState().reset()
  resumeModule.useResumeStore.getState().reset()
  jdModule.useJDStore.getState().reset()
  landingFlowModule.useLandingFlowStore.getState().clear()

  await clearPersistedUserData(userId)
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  initialized: false,
  loading: false,
  error: null,

  restoreSession: async () => {
    if (get().initialized) {
      return get().session
    }

    if (restoreSessionPromise) {
      return restoreSessionPromise
    }

    set({loading: true, error: null})

    restoreSessionPromise = (async () => {
      try {
        const session = await authApi.restoreSession()
        set({session, profile: null, initialized: true, loading: false})
        return session
      } catch (error) {
        set({
          session: null,
          profile: null,
          initialized: true,
          loading: false,
          error: getErrorMessage(error, '恢复登录态失败'),
        })
        return null
      }
    })().finally(() => {
      restoreSessionPromise = null
    })

    return restoreSessionPromise
  },

  loadProfile: async () => {
    if (!get().session) {
      set({profile: null})
      return null
    }

    try {
      const profile = await profileApi.getProfile()
      set({profile})
      return profile
    } catch (error) {
      console.warn('[AuthStore] 加载用户资料失败:', error)
      return null
    }
  },

  restoreOAuthSession: async () => {
    set({loading: true, error: null})
    try {
      const session = await authApi.restoreOAuthSessionFromUrl()
      set({
        ...(session ? {session, profile: null, initialized: true} : {}),
        ...(!session ? {profile: null} : {}),
        loading: false,
      })
      return session
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '第三方登录失败')})
      throw error
    }
  },

  checkEmailRegistered: async email => {
    set({loading: true, error: null})
    try {
      const registered = await authApi.checkEmailRegistered(email)
      set({loading: false})
      return registered
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '邮箱检查失败')})
      throw error
    }
  },

  sendEmailOtp: async email => {
    set({loading: true, error: null})
    try {
      const config = await authApi.sendEmailOtp(email)
      set({loading: false})
      return config
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '验证码发送失败')})
      throw error
    }
  },

  signInWithPassword: async input => {
    set({loading: true, error: null})
    try {
      const session = await authApi.signInWithPassword(input)
      restoreSessionPromise = null
      set({session, initialized: true, loading: false, profile: null})
      return session
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '登录失败')})
      throw error
    }
  },

  signUpWithPassword: async input => {
    set({loading: true, error: null})
    try {
      const result = await authApi.signUpWithPassword(input)
      restoreSessionPromise = null
      set({
        ...(result.session ? {session: result.session, initialized: true} : {}),
        ...(result.session ? {profile: null} : {}),
        loading: false,
      })
      return result
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '注册失败')})
      throw error
    }
  },

  requestPasswordReset: async input => {
    set({loading: true, error: null})
    try {
      const config = await authApi.requestPasswordReset(input)
      set({loading: false})
      return config
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '密码重置邮件发送失败')})
      throw error
    }
  },

  verifyPasswordResetOtp: async input => {
    set({loading: true, error: null})
    try {
      const session = await authApi.verifyPasswordResetOtp(input)
      set({loading: false})
      return session
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '密码重置验证码校验失败')})
      throw error
    }
  },

  updatePassword: async input => {
    set({loading: true, error: null})
    try {
      await authApi.updatePassword(input)
      set({loading: false})
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '密码更新失败')})
      throw error
    }
  },

  verifySignupOtp: async input => {
    set({loading: true, error: null})
    try {
      const session = await authApi.verifySignupOtp(input)
      restoreSessionPromise = null
      set({session, initialized: true, loading: false, profile: null})
      return session
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '验证码校验失败')})
      throw error
    }
  },

  verifyEmailOtp: async input => {
    set({loading: true, error: null})
    try {
      const session = await authApi.verifyEmailOtp(input)
      restoreSessionPromise = null
      set({session, initialized: true, loading: false, profile: null})
      return session
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '验证码校验失败')})
      throw error
    }
  },

  resendSignupOtp: async email => {
    set({loading: true, error: null})
    try {
      const config = await authApi.resendSignupOtp(email)
      set({loading: false})
      return config
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '验证码发送失败')})
      throw error
    }
  },

  signInWithOAuth: async provider => {
    set({loading: true, error: null})
    try {
      const authorizeUrl = await authApi.getOAuthAuthorizeUrl(provider)
      window.location.assign(authorizeUrl)
    } catch (error) {
      set({loading: false, error: getErrorMessage(error, '第三方登录失败')})
      throw error
    }
  },

  signOut: async () => {
    const userId = get().session?.user.id
    set({loading: true, error: null})

    let signOutError: unknown = null
    let cleanupError: unknown = null

    try {
      await authApi.signOut()
    } catch (error) {
      signOutError = error
    }

    try {
      await resetUserBusinessState(userId)
    } catch (error) {
      cleanupError = error
      console.error('[AuthStore] Failed to clear user data after sign out:', error)
    }

    restoreSessionPromise = null
    set({
      session: null,
      profile: null,
      initialized: true,
      loading: false,
      error: signOutError
        ? getErrorMessage(signOutError, '退出登录失败')
        : cleanupError
          ? '账号已退出，但部分本地数据清理失败'
          : null,
    })
  },

  clearError: () => {
    set({error: null})
  },
}))
