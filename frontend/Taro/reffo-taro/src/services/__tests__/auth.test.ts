import {authApi, resetPasswordEncryptionConfigCache} from '../auth'
import {apiClient} from '../api'
import {setJSON} from '@/utils/storage'
import {encryptPasswordPayload} from '@/utils/password-encryption'

jest.mock('@/utils/password-encryption', () => ({
  encryptPasswordPayload: jest.fn(async () => ({
    version: 1,
    key_id: 'test-key',
    encrypted_key: 'encrypted-key',
    iv: 'iv',
    ciphertext: 'opaque-ciphertext',
    timestamp: Date.now(),
    nonce: 'nonce',
  })),
}))

jest.mock('../api', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    setAuthToken: jest.fn(),
  },
}))

jest.mock('@/utils/storage', () => ({
  getJSON: jest.fn(),
  setJSON: jest.fn(),
  storage: {removeItem: jest.fn()},
}))

const mockApiPost = apiClient.post as jest.Mock
const mockApiGet = apiClient.get as jest.Mock
const mockSetJSON = setJSON as jest.Mock
const mockEncryptPasswordPayload = encryptPasswordPayload as jest.Mock

describe('authApi', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resetPasswordEncryptionConfigCache()
    mockApiGet.mockImplementation((path: string) => Promise.resolve(
      path === '/system/public-config'
        ? {appEnv: 'nonprod', databaseProvider: 'supabase', supabase: {}}
        : {
            version: 1,
            key_id: 'test-key',
            algorithm: 'RSA-OAEP-256+A256GCM',
            public_key: 'test-public-key',
          },
    ))
  })

  test('encrypts password login before calling Reffo backend', async () => {
    mockApiPost.mockResolvedValueOnce({
      access_token: 'access-token',
      user: {id: 'user-1', email: 'user@example.com'},
    })

    await authApi.signInWithPassword({
      email: 'USER@example.com',
      password: 'password-123',
    })

    expect(mockApiPost).toHaveBeenCalledWith('/auth/sign-in', expect.objectContaining({
      version: 1,
      key_id: 'test-key',
      encrypted_key: 'encrypted-key',
    }))
    expect(mockEncryptPasswordPayload).toHaveBeenCalledWith(expect.objectContaining({
      key_id: 'test-key',
    }), {
      email: 'user@example.com',
      password: 'password-123',
    })
    expect(JSON.stringify(mockApiPost.mock.calls[0][1])).not.toContain('password-123')
  })

  test('encrypts password update before calling Reffo backend', async () => {
    mockApiPost.mockResolvedValueOnce({updated: true})

    await authApi.updatePassword({
      accessToken: 'recovery-token',
      password: 'new-password-123',
    })

    expect(mockApiPost).toHaveBeenCalledWith('/auth/password-update', expect.objectContaining({
      ciphertext: 'opaque-ciphertext',
    }))
    expect(mockEncryptPasswordPayload).toHaveBeenCalledWith(expect.any(Object), {
      access_token: 'recovery-token',
      password: 'new-password-123',
    })
    expect(JSON.stringify(mockApiPost.mock.calls[0][1])).not.toContain('new-password-123')
  })

  test('checks normalized email through Reffo backend', async () => {
    mockApiPost.mockResolvedValue({registered: true})

    await expect(authApi.checkEmailRegistered(' User@Example.COM ')).resolves.toBe(true)
    expect(mockApiPost).toHaveBeenCalledWith('/auth/email-status', {
      email: 'user@example.com',
    })
  })

  test('starts signup and waits for OTP when Supabase returns no session', async () => {
    mockApiPost.mockResolvedValueOnce({
      user: {id: 'user-1', email: 'user@example.com'},
    })

    await expect(authApi.signUpWithPassword({
      email: 'USER@example.com',
      password: 'password-123',
    })).resolves.toEqual({
      session: null,
      user: {id: 'user-1', email: 'user@example.com'},
      otpLength: 8,
      resendAfterSeconds: 60,
    })
    expect(mockApiGet).toHaveBeenCalledWith('/auth/crypto-key')
    expect(mockApiPost).toHaveBeenCalledWith('/auth/sign-up', expect.objectContaining({
      version: 1,
      key_id: 'test-key',
    }))
    expect(mockSetJSON).not.toHaveBeenCalled()
  })

  test('requests email OTP through Reffo backend and uses returned config', async () => {
    mockApiPost.mockResolvedValue({
      sent: true,
      otp_length: 8,
      resend_after_seconds: 45,
    })

    await expect(authApi.sendEmailOtp(' USER@example.com ')).resolves.toEqual({
      otpLength: 8,
      resendAfterSeconds: 45,
    })
    expect(mockApiPost).toHaveBeenCalledWith('/auth/email-otp/send', {
      email: 'user@example.com',
    })
  })

  test('requests and verifies password reset OTP through Reffo backend', async () => {
    mockApiPost
      .mockResolvedValueOnce({sent: true, otp_length: 8, resend_after_seconds: 45})
      .mockResolvedValueOnce({
        access_token: 'recovery-token',
        user: {id: 'user-1', email: 'user@example.com'},
      })

    await expect(authApi.requestPasswordReset({email: ' USER@example.com '})).resolves.toEqual({
      otpLength: 8,
      resendAfterSeconds: 45,
    })
    await expect(authApi.verifyPasswordResetOtp({
      email: ' USER@example.com ',
      token: '12345678',
    })).resolves.toMatchObject({accessToken: 'recovery-token'})

    expect(mockApiPost).toHaveBeenNthCalledWith(1, '/auth/password-reset/request', {
      email: 'user@example.com',
    })
    expect(mockApiPost).toHaveBeenNthCalledWith(2, '/auth/password-reset/verify', {
      email: 'user@example.com',
      token: '12345678',
    })
    expect(mockSetJSON).not.toHaveBeenCalled()
  })

  test('verifies email OTP and persists returned session', async () => {
    mockApiPost.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      user: {id: 'user-1', email: 'user@example.com'},
    })

    await expect(authApi.verifyEmailOtp({
      email: 'USER@example.com',
      token: '12345678',
    })).resolves.toMatchObject({
      accessToken: 'access-token',
      user: {id: 'user-1'},
    })
    expect(mockApiPost).toHaveBeenCalledWith('/auth/email-otp/verify', {
      email: 'user@example.com',
      token: '12345678',
    })
    expect(mockSetJSON).toHaveBeenCalledTimes(1)
  })

  test('verifies signup OTP and persists returned session', async () => {
    mockApiPost.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      user: {id: 'user-1', email: 'user@example.com'},
    })

    const session = await authApi.verifySignupOtp({
      email: 'user@example.com',
      token: '123456',
    })

    expect(session).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      user: {id: 'user-1'},
    })
    expect(mockApiPost).toHaveBeenCalledWith('/auth/verify-signup', {
      email: 'user@example.com',
      token: '123456',
    })
    expect(mockSetJSON).toHaveBeenCalledTimes(1)
    expect(apiClient.setAuthToken).toHaveBeenCalledWith('access-token')
  })

  test('builds OAuth authorize URL with auth page callback', async () => {
    window.history.replaceState(null, '', '/app#/pages/auth/index')
    mockApiPost.mockResolvedValue({
      authorize_url: 'https://example.supabase.co/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%2Fapp%23%2Fpages%2Fauth%2Findex',
    })

    const url = await authApi.getOAuthAuthorizeUrl('github')

    expect(url).toBe(
      'https://example.supabase.co/auth/v1/authorize?provider=github&redirect_to=http%3A%2F%2Flocalhost%2Fapp%23%2Fpages%2Fauth%2Findex',
    )
    expect(mockApiPost).toHaveBeenCalledWith('/auth/oauth-url', {
      provider: 'github',
      redirect_to: 'http://localhost/app#/pages/auth/index',
    })
  })
})
