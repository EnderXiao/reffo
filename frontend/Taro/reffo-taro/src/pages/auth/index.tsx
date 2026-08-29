import {useEffect, useRef, useState} from 'react'
import Taro from '@tarojs/taro'
import {Image, Input, Text, View} from '@tarojs/components'
import classNames from 'classnames'
import githubIcon from '@/assets/home/github.svg'
import {CardGlass, CardTexture} from '@/components/business/HomeCardDeck/CardMaterial.h5'
import ReffoGlyph from '@/components/business/HomeCardDeck/ReffoGlyph.h5'
import {type EmailOtpConfig, type OAuthProvider} from '@/services/auth'
import {useAuthStore} from '@/store/authStore'
import {feedback} from '@/utils/feedback'
import {routePaths, useRouteTransition} from '@/shared/routing'

import './index.scss'

type AuthPhase = 'login' | 'register' | 'verify' | 'reset-request' | 'reset-password' | 'change-password'
type TransitionDirection = 'forward' | 'back'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DEFAULT_OTP_CONFIG: EmailOtpConfig = {
  otpLength: 6,
  resendAfterSeconds: 60,
}

const AUTH_TEXTURE_SOURCE = {
  id: 'auth-card',
  company: 'Reffo',
  role: 'Account',
  tone: 'soft',
} as const

function showConfirmation(options: {
  title: string
  content: string
  confirmText: string
  cancelText?: string
}) {
  return new Promise<boolean>(resolve => {
    feedback.modal({
      ...options,
      tone: 'guide',
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

function focusOtpInput() {
  if (typeof document === 'undefined') {
    return
  }

  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLInputElement>('.reffo-auth__otp-input input, input.reffo-auth__otp-input')
    input?.focus()
  })
}

function getPhaseContent(phase: AuthPhase, email: string) {
  if (phase === 'register') {
    return {
      eyebrow: '创建账号',
      title: '初次见面',
      subtitle: '确认登录信息，开始建立你的求职档案',
    }
  }

  if (phase === 'verify') {
    return {
      eyebrow: '邮箱验证',
      title: '查收验证码',
      subtitle: `验证码已发送至 ${email}`,
    }
  }

  if (phase === 'reset-request') {
    return {
      eyebrow: '找回账号',
      title: '重置密码',
      subtitle: '输入注册邮箱，我们会发送密码重置验证码',
    }
  }

  if (phase === 'reset-password' || phase === 'change-password') {
    return {
      eyebrow: phase === 'change-password' ? '账号安全' : '验证完成',
      title: phase === 'change-password' ? '修改密码' : '设置新密码',
      subtitle: '新密码至少 8 位，提交时使用应用层加密保护',
    }
  }

  return {
    eyebrow: '欢迎回来',
    title: '登录 Reffo',
    subtitle: '继续你的下一份最佳申请',
  }
}

export default function AuthPage() {
  const route = useRouteTransition()
  const [phase, setPhase] = useState<AuthPhase>('login')
  const [transitionDirection, setTransitionDirection] = useState<TransitionDirection>('forward')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [otpPurpose, setOtpPurpose] = useState<'signup' | 'login' | 'reset'>('signup')
  const [recoveryAccessToken, setRecoveryAccessToken] = useState('')
  const [otpConfig, setOtpConfig] = useState<EmailOtpConfig>(DEFAULT_OTP_CONFIG)
  const [otpFocused, setOtpFocused] = useState(false)
  const [otpShaking, setOtpShaking] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(DEFAULT_OTP_CONFIG.resendAfterSeconds)
  const verificationRequestRef = useRef(false)
  const loading = useAuthStore(state => state.loading)
  const error = useAuthStore(state => state.error)
  const session = useAuthStore(state => state.session)
  const clearError = useAuthStore(state => state.clearError)
  const checkEmailRegistered = useAuthStore(state => state.checkEmailRegistered)
  const sendEmailOtp = useAuthStore(state => state.sendEmailOtp)
  const signInWithPassword = useAuthStore(state => state.signInWithPassword)
  const signUpWithPassword = useAuthStore(state => state.signUpWithPassword)
  const requestPasswordReset = useAuthStore(state => state.requestPasswordReset)
  const verifyPasswordResetOtp = useAuthStore(state => state.verifyPasswordResetOtp)
  const submitPasswordUpdate = useAuthStore(state => state.updatePassword)
  const verifySignupOtp = useAuthStore(state => state.verifySignupOtp)
  const verifyEmailOtp = useAuthStore(state => state.verifyEmailOtp)
  const resendSignupOtp = useAuthStore(state => state.resendSignupOtp)
  const signInWithOAuth = useAuthStore(state => state.signInWithOAuth)
  const restoreOAuthSession = useAuthStore(state => state.restoreOAuthSession)
  const signOut = useAuthStore(state => state.signOut)
  const phaseContent = getPhaseContent(phase, email)

  const completeAuth = () => {
    feedback.success('登录成功', {duration: 1400})
    const pages = Taro.getCurrentPages()

    if (pages.length > 1) {
      void route.back()
      return
    }

    void route.reset(routePaths.home)
  }

  useEffect(() => {
    let active = true

    void restoreOAuthSession()
      .then(restoredSession => {
        if (active && restoredSession) {
          completeAuth()
        }
      })
      .catch(errorValue => {
        if (active) {
          feedback.error(errorValue instanceof Error ? errorValue.message : '第三方登录失败')
        }
      })

    return () => {
      active = false
    }
  }, [restoreOAuthSession])

  useEffect(() => {
    if (phase !== 'verify' || resendSeconds <= 0) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setResendSeconds(previous => Math.max(0, previous - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [phase, resendSeconds])

  const changePhase = (nextPhase: AuthPhase, direction: TransitionDirection) => {
    clearError()
    setTransitionDirection(direction)
    setPhase(nextPhase)
  }

  const validateEmail = () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      feedback.error('请输入有效邮箱')
      return null
    }

    return normalizedEmail
  }

  const validatePassword = () => {
    if (password.length < 8) {
      feedback.error('密码至少需要 8 位')
      return false
    }

    return true
  }

  const handleLogin = async () => {
    const normalizedEmail = validateEmail()
    if (!normalizedEmail || !validatePassword()) {
      return
    }

    try {
      const registered = await checkEmailRegistered(normalizedEmail)
      if (!registered) {
        const shouldRegister = await showConfirmation({
          title: '邮箱尚未注册',
          content: `${normalizedEmail} 还没有 Reffo 账号，是否立即注册？`,
          confirmText: '注册账号',
          cancelText: '取消',
        })

        if (shouldRegister) {
          setEmail(normalizedEmail)
          setConfirmPassword('')
          changePhase('register', 'forward')
        }
        return
      }

      await signInWithPassword({email: normalizedEmail, password})
      completeAuth()
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '登录失败，请重试')
    }
  }

  const handleEmailOtpLogin = async () => {
    const normalizedEmail = validateEmail()
    if (!normalizedEmail) {
      return
    }

    try {
      const registered = await checkEmailRegistered(normalizedEmail)
      if (!registered) {
        const shouldRegister = await showConfirmation({
          title: '邮箱尚未注册',
          content: `${normalizedEmail} 还没有 Reffo 账号，是否立即注册？`,
          confirmText: '注册账号',
          cancelText: '取消',
        })

        if (shouldRegister) {
          setEmail(normalizedEmail)
          setConfirmPassword('')
          changePhase('register', 'forward')
        }
        return
      }

      const config = await sendEmailOtp(normalizedEmail)
      setEmail(normalizedEmail)
      setOtp('')
      setOtpPurpose('login')
      setOtpConfig(config)
      setResendSeconds(config.resendAfterSeconds)
      changePhase('verify', 'forward')
      window.setTimeout(focusOtpInput, 360)
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '验证码发送失败，请稍后重试')
    }
  }

  const handleRequestPasswordReset = async () => {
    const normalizedEmail = validateEmail()
    if (!normalizedEmail) {
      return
    }

    try {
      const config = await requestPasswordReset({email: normalizedEmail})
      setEmail(normalizedEmail)
      setOtp('')
      setOtpPurpose('reset')
      setOtpConfig(config)
      setResendSeconds(config.resendAfterSeconds)
      changePhase('verify', 'forward')
      window.setTimeout(focusOtpInput, 360)
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '密码重置验证码发送失败')
    }
  }

  const handleRegister = async () => {
    const normalizedEmail = validateEmail()
    if (!normalizedEmail || !validatePassword()) {
      return
    }

    if (password !== confirmPassword) {
      feedback.error('两次输入的密码不一致')
      return
    }

    try {
      const registered = await checkEmailRegistered(normalizedEmail)
      if (registered) {
        const shouldLogin = await showConfirmation({
          title: '账号已存在',
          content: `${normalizedEmail} 已注册，是否直接返回登录？`,
          confirmText: '去登录',
          cancelText: '取消',
        })

        if (shouldLogin) {
          setEmail(normalizedEmail)
          setPassword('')
          setConfirmPassword('')
          changePhase('login', 'back')
        }
        return
      }

      const result = await signUpWithPassword({email: normalizedEmail, password})
      if (result.session) {
        completeAuth()
        return
      }

      setEmail(normalizedEmail)
      setOtp('')
      setOtpPurpose('signup')
      setOtpConfig({
        otpLength: result.otpLength,
        resendAfterSeconds: result.resendAfterSeconds,
      })
      setResendSeconds(result.resendAfterSeconds)
      changePhase('verify', 'forward')
      window.setTimeout(focusOtpInput, 360)
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '注册失败，请重试')
    }
  }

  const verifyCode = async (code: string) => {
    if (verificationRequestRef.current || code.length !== otpConfig.otpLength) {
      return
    }

    verificationRequestRef.current = true
    try {
      if (otpPurpose === 'login') {
        await verifyEmailOtp({email, token: code})
        completeAuth()
      } else if (otpPurpose === 'signup') {
        await verifySignupOtp({email, token: code})
        completeAuth()
      } else {
        const recoverySession = await verifyPasswordResetOtp({email, token: code})
        setRecoveryAccessToken(recoverySession.accessToken)
        setPassword('')
        setConfirmPassword('')
        changePhase('reset-password', 'forward')
      }
    } catch (errorValue) {
      setOtpShaking(true)
      setOtp('')
      focusOtpInput()
      window.setTimeout(() => setOtpShaking(false), 420)
      feedback.error(errorValue instanceof Error ? errorValue.message : '验证码错误，请重新输入')
    } finally {
      verificationRequestRef.current = false
    }
  }

  const handleOtpInput = (value: string) => {
    clearError()
    const nextOtp = value.replace(/\D/g, '').slice(0, otpConfig.otpLength)
    setOtp(nextOtp)

    if (nextOtp.length === otpConfig.otpLength) {
      void verifyCode(nextOtp)
    }
  }

  const handleResend = async () => {
    if (resendSeconds > 0 || loading) {
      return
    }

    try {
      const config = otpPurpose === 'login'
        ? await sendEmailOtp(email)
        : otpPurpose === 'signup'
          ? await resendSignupOtp(email)
          : await requestPasswordReset({email})
      setOtp('')
      setOtpConfig(config)
      setResendSeconds(config.resendAfterSeconds)
      focusOtpInput()
      feedback.success('验证码已重新发送')
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '发送失败，请稍后重试')
    }
  }

  const handleOAuth = async (provider: OAuthProvider) => {
    try {
      await signInWithOAuth(provider)
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '第三方登录失败')
    }
  }

  const handlePasswordUpdate = async () => {
    if (!validatePassword()) {
      return
    }

    if (password !== confirmPassword) {
      feedback.error('两次输入的密码不一致')
      return
    }

    const accessToken = phase === 'change-password' ? session?.accessToken : recoveryAccessToken
    if (!accessToken) {
      feedback.error('密码重置状态已失效，请重新验证邮箱')
      changePhase('reset-request', 'back')
      return
    }

    try {
      await submitPasswordUpdate({accessToken, password})
      setPassword('')
      setConfirmPassword('')
      setRecoveryAccessToken('')
      feedback.success('密码已更新')
      changePhase('login', 'back')
    } catch (errorValue) {
      feedback.error(errorValue instanceof Error ? errorValue.message : '密码更新失败，请重试')
    }
  }

  const handleBack = () => {
    if (phase === 'verify') {
      setOtp('')
      changePhase(otpPurpose === 'login' ? 'login' : otpPurpose === 'signup' ? 'register' : 'reset-request', 'back')
      return
    }

    if (phase === 'register') {
      setConfirmPassword('')
      changePhase('login', 'back')
      return
    }

    if (phase === 'reset-request' || phase === 'reset-password' || phase === 'change-password') {
      setPassword('')
      setConfirmPassword('')
      setRecoveryAccessToken('')
      changePhase('login', 'back')
      return
    }

    const pages = Taro.getCurrentPages()
    if (pages.length > 1) {
      void route.back()
    } else {
      void route.reset(routePaths.home)
    }
  }

  const updateEmail = (value: string) => {
    clearError()
    setEmail(value)
  }

  const updatePasswordValue = (value: string) => {
    clearError()
    setPassword(value)
  }

  const renderLogin = () => (
    <View className='reffo-auth__fields'>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>邮箱</Text>
        <Input
          className='reffo-auth__input'
          value={email}
          type='text'
          placeholder='name@example.com'
          onInput={event => updateEmail(String(event.detail.value || ''))}
        />
      </View>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>密码</Text>
        <Input
          className='reffo-auth__input'
          value={password}
          password
          placeholder='至少 8 位密码'
          onInput={event => updatePasswordValue(String(event.detail.value || ''))}
          onConfirm={() => void handleLogin()}
        />
      </View>
      <View className='reffo-auth__secondary-action' role='button' onClick={() => void handleEmailOtpLogin()}>
        <Text>使用邮箱验证码登录</Text>
      </View>
      <View className='reffo-auth__secondary-action' role='button' onClick={() => changePhase('reset-request', 'forward')}>
        <Text>忘记密码</Text>
      </View>
      {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
      <View
        className={classNames('reffo-auth__primary', {'reffo-auth__primary--loading': loading})}
        role='button'
        aria-disabled={loading}
        onClick={() => void handleLogin()}
      >
        <Text>{loading ? '正在登录...' : '登录'}</Text>
      </View>
      <View className='reffo-auth__oauth-divider'>
        <View className='reffo-auth__oauth-divider-line' />
        <Text>或使用其他账号</Text>
        <View className='reffo-auth__oauth-divider-line' />
      </View>
      <View className='reffo-auth__oauth-list'>
        <View className='reffo-auth__oauth' role='button' aria-label='使用 GitHub 登录' onClick={() => void handleOAuth('github')}>
          <Image src={githubIcon} className='reffo-auth__oauth-image' mode='aspectFit' />
        </View>
        <View className='reffo-auth__oauth reffo-auth__oauth--google' role='button' aria-label='使用 Google 登录' onClick={() => void handleOAuth('google')}>
          <Text>G</Text>
        </View>
        <View className='reffo-auth__oauth reffo-auth__oauth--apple' role='button' aria-label='使用 Apple 登录' onClick={() => void handleOAuth('apple')}>
          <Text>A</Text>
        </View>
      </View>
    </View>
  )

  const renderRegister = () => (
    <View className='reffo-auth__fields'>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>邮箱</Text>
        <Input className='reffo-auth__input' value={email} type='text' placeholder='name@example.com' onInput={event => updateEmail(String(event.detail.value || ''))} />
      </View>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>密码</Text>
        <Input className='reffo-auth__input' value={password} password placeholder='至少 8 位密码' onInput={event => updatePasswordValue(String(event.detail.value || ''))} />
      </View>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>再次确认密码</Text>
        <Input className='reffo-auth__input' value={confirmPassword} password placeholder='再次输入密码' onInput={event => {
          clearError()
          setConfirmPassword(String(event.detail.value || ''))
        }} onConfirm={() => void handleRegister()} />
      </View>
      {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
      <View className={classNames('reffo-auth__primary', {'reffo-auth__primary--loading': loading})} role='button' aria-disabled={loading} onClick={() => void handleRegister()}>
        <Text>{loading ? '正在确认...' : '确认注册'}</Text>
      </View>
    </View>
  )

  const renderVerification = () => (
    <View className='reffo-auth__verify'>
      <Text className='reffo-auth__verify-label'>输入 {otpConfig.otpLength} 位验证码</Text>
      <View
        className={classNames('reffo-auth__otp', {
          'reffo-auth__otp--focused': otpFocused,
          'reffo-auth__otp--shaking': otpShaking,
        })}
        style={{'--otp-length': otpConfig.otpLength} as any}
        role='group'
        aria-label={`${otpConfig.otpLength} 位邮箱验证码`}
        onClick={focusOtpInput}
      >
        <Input
          className='reffo-auth__otp-input'
          value={otp}
          type='number'
          maxlength={otpConfig.otpLength}
          onFocus={() => setOtpFocused(true)}
          onBlur={() => setOtpFocused(false)}
          onInput={event => handleOtpInput(String(event.detail.value || ''))}
        />
        {Array.from({length: otpConfig.otpLength}, (_, index) => (
          <View key={index} className={classNames('reffo-auth__otp-cell', {
            'reffo-auth__otp-cell--filled': Boolean(otp[index]),
            'reffo-auth__otp-cell--cursor': otpFocused && index === otp.length,
          })}>
            <Text>{otp[index] || ''}</Text>
          </View>
        ))}
      </View>
      <View className='reffo-auth__resend'>
        {resendSeconds > 0 ? (
          <Text>{resendSeconds} 秒后可重新发送</Text>
        ) : (
          <View className='reffo-auth__resend-action' role='button' onClick={() => void handleResend()}>
            重新发送验证码
          </View>
        )}
      </View>
      {loading ? (
        <View className='reffo-auth__verifying'>
          <View className='reffo-auth__spinner' />
          <Text>正在校验...</Text>
        </View>
      ) : null}
      {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
    </View>
  )

  const renderResetRequest = () => (
    <View className='reffo-auth__fields'>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>注册邮箱</Text>
        <Input
          className='reffo-auth__input'
          value={email}
          type='text'
          placeholder='name@example.com'
          onInput={event => updateEmail(String(event.detail.value || ''))}
          onConfirm={() => void handleRequestPasswordReset()}
        />
      </View>
      {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
      <View className={classNames('reffo-auth__primary', {'reffo-auth__primary--loading': loading})} role='button' aria-disabled={loading} onClick={() => void handleRequestPasswordReset()}>
        <Text>{loading ? '正在发送...' : '发送重置验证码'}</Text>
      </View>
    </View>
  )

  const renderPasswordUpdate = () => (
    <View className='reffo-auth__fields'>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>新密码</Text>
        <Input className='reffo-auth__input' value={password} password placeholder='至少 8 位新密码' onInput={event => updatePasswordValue(String(event.detail.value || ''))} />
      </View>
      <View className='reffo-auth__field'>
        <Text className='reffo-auth__label'>再次确认密码</Text>
        <Input className='reffo-auth__input' value={confirmPassword} password placeholder='再次输入新密码' onInput={event => {
          clearError()
          setConfirmPassword(String(event.detail.value || ''))
        }} onConfirm={() => void handlePasswordUpdate()} />
      </View>
      {error ? <Text className='reffo-auth__error'>{error}</Text> : null}
      <View className={classNames('reffo-auth__primary', {'reffo-auth__primary--loading': loading})} role='button' aria-disabled={loading} onClick={() => void handlePasswordUpdate()}>
        <Text>{loading ? '正在更新...' : '确认新密码'}</Text>
      </View>
    </View>
  )

  return (
    <View className='reffo-auth' style={{'--card-accent': '#126fe8'} as any}>
      <CardTexture
        source={AUTH_TEXTURE_SOURCE}
        color='#2f7de0'
        className='reffo-auth__texture'
        mode='repeat'
        columns={4}
        rows={8}
        tileWidth={82}
        tileHeight={80}
        gapX={50}
        gapY={48}
      />
      <View className='reffo-auth__wash' aria-hidden='true' />
      {phase !== 'login' ? (
        <View className='reffo-auth__back' role='button' aria-label='返回' onClick={handleBack}>
          <Text>返回</Text>
        </View>
      ) : null}

      <View className='reffo-auth__brand'>
        <View className='reffo-auth__brand-mark'><ReffoGlyph color='#126fe8' /></View>
        <View key={phase} className={classNames('reffo-auth__heading', `reffo-auth__heading--${transitionDirection}`)}>
          <Text className='reffo-auth__eyebrow'>{phaseContent.eyebrow}</Text>
          <Text className='reffo-auth__title'>{phaseContent.title}</Text>
          <Text className='reffo-auth__subtitle'>{phaseContent.subtitle}</Text>
        </View>
      </View>

      <CardGlass className='reffo-auth__glass'>
        {session && phase !== 'change-password' ? (
          <View className='reffo-auth__account'>
            <Text className='reffo-auth__account-label'>当前账号</Text>
            <Text className='reffo-auth__account-email'>{session.user.email || session.user.id}</Text>
            <View className='reffo-auth__primary' role='button' onClick={() => changePhase('change-password', 'forward')}>
              <Text>修改密码</Text>
            </View>
            <View className='reffo-auth__primary reffo-auth__primary--secondary' role='button' onClick={() => void signOut()}>
              <Text>{loading ? '正在退出...' : '退出登录'}</Text>
            </View>
          </View>
        ) : (
          <View key={phase} className={classNames('reffo-auth__form-step', `reffo-auth__form-step--${transitionDirection}`)}>
            {phase === 'login'
              ? renderLogin()
              : phase === 'register'
                ? renderRegister()
                : phase === 'verify'
                  ? renderVerification()
                  : phase === 'reset-request'
                    ? renderResetRequest()
                    : renderPasswordUpdate()}
          </View>
        )}
      </CardGlass>
    </View>
  )
}
