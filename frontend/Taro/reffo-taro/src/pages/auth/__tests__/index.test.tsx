import React from 'react'
import {act, fireEvent, render, screen} from '@testing-library/react'
import AuthPage from '../index'

jest.mock('@/utils/feedback', () => ({
  feedback: {
    modal: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
  },
}))

jest.mock('@/store/authStore', () => {
  const state = {
    loading: false,
    error: null,
    session: null,
    clearError: jest.fn(),
    checkEmailRegistered: jest.fn(),
    sendEmailOtp: jest.fn(),
    signInWithPassword: jest.fn(),
    signUpWithPassword: jest.fn(),
    requestPasswordReset: jest.fn(),
    verifyPasswordResetOtp: jest.fn(),
    updatePassword: jest.fn(),
    verifySignupOtp: jest.fn(),
    verifyEmailOtp: jest.fn(),
    resendSignupOtp: jest.fn(),
    signInWithOAuth: jest.fn(),
    restoreOAuthSession: jest.fn(),
    signOut: jest.fn(),
  }

  return {
    useAuthStore: (selector: (value: typeof state) => unknown) => selector(state),
    __mockAuthState: state,
  }
})

jest.mock('@tarojs/components', () => ({
  View: ({children, className, onClick, ...props}: any) => <div className={className} onClick={onClick} {...props}>{children}</div>,
  Text: ({children, className, onClick, ...props}: any) => <span className={className} onClick={onClick} {...props}>{children}</span>,
  Image: ({src, className, ...props}: any) => <img src={src} className={className} {...props} />,
  Input: ({value, placeholder, onInput, password, type, maxlength, onConfirm, ...props}: any) => (
    <input
      value={value}
      placeholder={placeholder}
      type={password ? 'password' : type === 'number' ? 'number' : 'text'}
      maxLength={maxlength}
      onChange={event => onInput?.({detail: {value: event.target.value}})}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          onConfirm?.()
        }
      }}
      {...props}
    />
  ),
}))

const mockFeedback = jest.requireMock('@/utils/feedback').feedback as {
  modal: jest.Mock
  error: jest.Mock
  success: jest.Mock
}
const mockAuthState = jest.requireMock('@/store/authStore').__mockAuthState as {
  loading: boolean
  error: string | null
  session: null
  clearError: jest.Mock
  checkEmailRegistered: jest.Mock
  sendEmailOtp: jest.Mock
  signInWithPassword: jest.Mock
  signUpWithPassword: jest.Mock
  requestPasswordReset: jest.Mock
  verifyPasswordResetOtp: jest.Mock
  updatePassword: jest.Mock
  verifySignupOtp: jest.Mock
  verifyEmailOtp: jest.Mock
  resendSignupOtp: jest.Mock
  signInWithOAuth: jest.Mock
  restoreOAuthSession: jest.Mock
  signOut: jest.Mock
}

function fillLoginForm() {
  fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
    target: {value: 'user@example.com'},
  })
  fireEvent.change(screen.getByPlaceholderText('至少 8 位密码'), {
    target: {value: 'password123'},
  })
}

describe('AuthPage', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockAuthState.loading = false
    mockAuthState.error = null
    mockAuthState.session = null
    mockAuthState.restoreOAuthSession.mockResolvedValue(null)
    mockAuthState.checkEmailRegistered.mockResolvedValue(false)
    mockAuthState.sendEmailOtp.mockResolvedValue({otpLength: 8, resendAfterSeconds: 60})
    mockAuthState.signUpWithPassword.mockResolvedValue({
      session: null,
      user: {id: 'user-1', email: 'user@example.com'},
      otpLength: 8,
      resendAfterSeconds: 60,
    })
    mockAuthState.requestPasswordReset.mockResolvedValue({otpLength: 8, resendAfterSeconds: 60})
    mockAuthState.verifyPasswordResetOtp.mockResolvedValue({
      accessToken: 'recovery-token',
      user: {id: 'user-1', email: 'user@example.com'},
    })
    mockAuthState.updatePassword.mockResolvedValue(undefined)
    mockAuthState.verifySignupOtp.mockResolvedValue({
      accessToken: 'access-token',
      user: {id: 'user-1', email: 'user@example.com'},
    })
    mockAuthState.verifyEmailOtp.mockResolvedValue({
      accessToken: 'access-token',
      user: {id: 'user-1', email: 'user@example.com'},
    })
  })

  test('only offers registration after login email is not found', async () => {
    render(<AuthPage />)

    expect(screen.queryByText('注册账号')).toBeNull()
    expect(screen.queryByText('返回')).toBeNull()
    fillLoginForm()

    await act(async () => {
      fireEvent.click(screen.getByText('登录'))
    })

    expect(mockFeedback.modal).toHaveBeenCalledWith(expect.objectContaining({
      title: '邮箱尚未注册',
      confirmText: '注册账号',
    }))

    await act(async () => {
      mockFeedback.modal.mock.calls[0][0].onConfirm()
      await Promise.resolve()
    })

    expect(screen.getByText('初次见面')).not.toBeNull()
    expect(screen.getByText('返回')).not.toBeNull()
    expect(screen.getByDisplayValue('user@example.com')).not.toBeNull()
    expect(screen.getByDisplayValue('password123')).not.toBeNull()
    expect((screen.getByPlaceholderText('再次输入密码') as HTMLInputElement).value).toBe('')
  })

  test('returns existing account to login with email only', async () => {
    render(<AuthPage />)
    fillLoginForm()

    await act(async () => {
      fireEvent.click(screen.getByText('登录'))
    })
    await act(async () => {
      mockFeedback.modal.mock.calls[0][0].onConfirm()
      await Promise.resolve()
    })

    mockAuthState.checkEmailRegistered.mockResolvedValueOnce(true)
    fireEvent.change(screen.getByPlaceholderText('再次输入密码'), {
      target: {value: 'password123'},
    })

    await act(async () => {
      fireEvent.click(screen.getByText('确认注册'))
    })
    expect(mockFeedback.modal).toHaveBeenLastCalledWith(expect.objectContaining({
      title: '账号已存在',
      confirmText: '去登录',
    }))

    await act(async () => {
      mockFeedback.modal.mock.calls.at(-1)?.[0].onConfirm()
      await Promise.resolve()
    })

    expect(screen.getByText('登录 Reffo')).not.toBeNull()
    expect(screen.getByDisplayValue('user@example.com')).not.toBeNull()
    expect((screen.getByPlaceholderText('至少 8 位密码') as HTMLInputElement).value).toBe('')
  })

  test('verifies automatically after configured OTP digits', async () => {
    render(<AuthPage />)
    fillLoginForm()

    await act(async () => {
      fireEvent.click(screen.getByText('登录'))
    })
    await act(async () => {
      mockFeedback.modal.mock.calls[0][0].onConfirm()
      await Promise.resolve()
    })
    fireEvent.change(screen.getByPlaceholderText('再次输入密码'), {
      target: {value: 'password123'},
    })

    await act(async () => {
      fireEvent.click(screen.getByText('确认注册'))
    })

    expect(screen.getByText('查收验证码')).not.toBeNull()
    const otpInput = screen.getByRole('spinbutton')

    await act(async () => {
      fireEvent.change(otpInput, {target: {value: '12345678'}})
    })

    expect(mockAuthState.verifySignupOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '12345678',
    })
  })

  test('supports passwordless email OTP login', async () => {
    mockAuthState.checkEmailRegistered.mockResolvedValueOnce(true)
    render(<AuthPage />)

    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: {value: 'user@example.com'},
    })

    await act(async () => {
      fireEvent.click(screen.getByText('使用邮箱验证码登录'))
    })

    expect(mockAuthState.sendEmailOtp).toHaveBeenCalledWith('user@example.com')
    expect(screen.getByText('输入 8 位验证码')).not.toBeNull()

    await act(async () => {
      fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '87654321'}})
    })

    expect(mockAuthState.verifyEmailOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '87654321',
    })
  })

  test('resets password through recovery OTP and encrypted password update action', async () => {
    render(<AuthPage />)

    fireEvent.click(screen.getByText('忘记密码'))
    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: {value: 'user@example.com'},
    })

    await act(async () => {
      fireEvent.click(screen.getByText('发送重置验证码'))
    })

    expect(mockAuthState.requestPasswordReset).toHaveBeenCalledWith({email: 'user@example.com'})

    await act(async () => {
      fireEvent.change(screen.getByRole('spinbutton'), {target: {value: '12345678'}})
    })

    expect(mockAuthState.verifyPasswordResetOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      token: '12345678',
    })
    expect(screen.getByText('设置新密码')).not.toBeNull()

    fireEvent.change(screen.getByPlaceholderText('至少 8 位新密码'), {
      target: {value: 'new-password-123'},
    })
    fireEvent.change(screen.getByPlaceholderText('再次输入新密码'), {
      target: {value: 'new-password-123'},
    })

    await act(async () => {
      fireEvent.click(screen.getByText('确认新密码'))
    })

    expect(mockAuthState.updatePassword).toHaveBeenCalledWith({
      accessToken: 'recovery-token',
      password: 'new-password-123',
    })
    expect(screen.getByText('登录 Reffo')).not.toBeNull()
  })
})
