export interface AuthSession {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
  user: {
    id: string
    email?: string
  }
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
  user: AuthSession['user']
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

export class AuthRequestError extends Error {
  constructor(message: string, public readonly code = 'OFFLINE_MODE', public readonly status = 501) {
    super(message)
    this.name = 'AuthRequestError'
  }
}

function unavailable(): never {
  throw new AuthRequestError('离线小工具已移除登录流程')
}

export class AuthApi {
  async restoreSession(): Promise<AuthSession | null> {
    return null
  }

  async restoreOAuthSessionFromUrl(): Promise<AuthSession | null> {
    return null
  }

  async checkEmailRegistered(_email: string): Promise<boolean> {
    unavailable()
  }

  async sendEmailOtp(_email: string): Promise<EmailOtpConfig> {
    unavailable()
  }

  async verifyEmailOtp(_input: VerifyEmailOtpInput): Promise<AuthSession> {
    unavailable()
  }

  async signInWithPassword(_input: SignInWithPasswordInput): Promise<AuthSession> {
    unavailable()
  }

  async signUpWithPassword(_input: SignUpWithPasswordInput): Promise<SignUpResult> {
    unavailable()
  }

  async requestPasswordReset(_input: PasswordResetRequestInput): Promise<EmailOtpConfig> {
    unavailable()
  }

  async verifyPasswordResetOtp(_input: VerifyPasswordResetOtpInput): Promise<AuthSession> {
    unavailable()
  }

  async updatePassword(_input: PasswordUpdateInput): Promise<void> {
    unavailable()
  }

  async verifySignupOtp(_input: VerifySignupOtpInput): Promise<AuthSession> {
    unavailable()
  }

  async resendSignupOtp(_email: string): Promise<EmailOtpConfig> {
    unavailable()
  }

  async getOAuthAuthorizeUrl(_provider: OAuthProvider): Promise<string> {
    unavailable()
  }

  async signOut(): Promise<void> {}
}

export const authApi = new AuthApi()

export function resetPasswordEncryptionConfigCache() {}
