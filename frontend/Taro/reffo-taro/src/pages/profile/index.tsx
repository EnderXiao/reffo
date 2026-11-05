import Taro from '@tarojs/taro'
import {Image, Text, View} from '@tarojs/components'
import {useEffect, useState} from 'react'
import BACK_ICON from '@/assets/common/refo-back.svg'
import LOGOUT_ICON from '@/assets/profile/logout.svg'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {profileApi, type ResumeQuota} from '@/services/profile'
import {feedback} from '@/utils/feedback'
import {routePaths, useRouteTransition} from '@/shared/routing'
import ProfileAvatar from './components/ProfileAvatar'
import './index.scss'

const MOCK_SESSION = {
  accessToken: 'mock-token',
  user: {id: 'mock-user', email: 'haishaoyan2020@163.com'},
}
const MOCK_QUOTA: ResumeQuota = {unlimited: false, limit: 3, used: 1, remaining: 2}

interface SettingsRowProps {
  label: string
  onClick: () => void
}

function SettingsRow({label, onClick}: SettingsRowProps) {
  return (
    <View className='reffo-profile__row' onClick={onClick}>
      <Text>{label}</Text>
      <Text className='reffo-profile__chevron'>›</Text>
    </View>
  )
}

function QuotaValue({quota}: {quota: ResumeQuota | null}) {
  if (quota?.unlimited) return <Text className='reffo-profile__stat-value reffo-profile__stat-value--text'>不限</Text>
  return (
    <View className='reffo-profile__stat-value-line'>
      <Text className='reffo-profile__stat-value'>{quota?.remaining ?? '—'}</Text>
      <Text className='reffo-profile__stat-unit'>次</Text>
    </View>
  )
}

export default function ProfilePage() {
  const route = useRouteTransition()
  const authSession = useAuthStore(state => state.session)
  const authInitialized = useAuthStore(state => state.initialized)
  const profile = useAuthStore(state => state.profile)
  const loadProfile = useAuthStore(state => state.loadProfile)
  const signOut = useAuthStore(state => state.signOut)
  const storedHistoryCount = useHistoryStore(state => state.historySummaries.length)
  const loadHistorySummaries = useHistoryStore(state => state.loadHistorySummaries)
  const latestSourceResumeSummary = useSourceResumeStore(state => state.latestSourceResumeSummary)
  const loadLatestSourceSummary = useSourceResumeStore(state => state.loadLatestSourceSummary)
  const isMockMode = process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.location.href.includes('mock=1')
  const session = isMockMode ? MOCK_SESSION : authSession
  const historyCount = isMockMode ? 5 : storedHistoryCount
  const [quota, setQuota] = useState<ResumeQuota | null>(isMockMode ? MOCK_QUOTA : null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    if (isMockMode) return
    if (!authInitialized) return
    if (!session) {
      void route.replace(routePaths.auth)
      return
    }
    if (!profile) void loadProfile()
    void loadHistorySummaries({skipIfLoaded: true})
    void loadLatestSourceSummary({skipIfLoaded: true})
    void profileApi.getQuota().then(setQuota).catch(() => setQuota(null))
  }, [authInitialized, isMockMode, loadHistorySummaries, loadLatestSourceSummary, loadProfile, profile, route, session])

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await signOut()
      feedback.success('已退出登录', {duration: 1000})
      void route.reset(routePaths.home)
    } finally {
      setSigningOut(false)
    }
  }

  const openContent = (view: 'account' | 'data' | 'privacy' | 'terms' | 'github' | 'version') => {
    void route.navigate(routePaths.profileContent, isMockMode ? {view, mock: '1'} : {view})
  }

  if (!session || (!isMockMode && !authInitialized)) return null

  return (
    <View className='reffo-profile'>
      <View className='reffo-profile__topbar'>
        <View className='reffo-profile__back' onClick={() => void route.back()} aria-label='返回'>
          <Image className='reffo-profile__back-icon' src={BACK_ICON} mode='aspectFit' />
        </View>
      </View>
      <View className='reffo-profile__content'>
        <Text className='reffo-profile__title'>设置</Text>

        <View className='reffo-profile__user'>
          <ProfileAvatar email={session.user.email || ''} />
          <Text className='reffo-profile__email'>{session.user.email || '未设置邮箱'}</Text>
        </View>

        <View className='reffo-profile__stats'>
          <View className='reffo-profile__stat'>
            <View className='reffo-profile__stat-value-line'>
              <Text className='reffo-profile__stat-value'>{isMockMode || latestSourceResumeSummary ? 1 : 0}</Text>
              <Text className='reffo-profile__stat-unit'>份</Text>
            </View>
            <Text className='reffo-profile__stat-label'>源简历</Text>
          </View>
          <View className='reffo-profile__stat'>
            <View className='reffo-profile__stat-value-line'>
              <Text className='reffo-profile__stat-value'>{historyCount}</Text>
              <Text className='reffo-profile__stat-unit'>份</Text>
              <Text className='reffo-profile__stat-star'>*</Text>
            </View>
            <Text className='reffo-profile__stat-label'>相契简历</Text>
          </View>
          <View className='reffo-profile__stat'>
            <QuotaValue quota={quota} />
            <Text className='reffo-profile__stat-label'>剩余可用</Text>
          </View>
        </View>

        <View className='reffo-profile__group'>
          <SettingsRow label='账号详情' onClick={() => openContent('account')} />
        </View>

        <Text className='reffo-profile__section-title'>隐私与数据</Text>
        <View className='reffo-profile__group'>
          <SettingsRow label='我的数据' onClick={() => openContent('data')} />
        </View>

        <Text className='reffo-profile__section-title'>帮助与关于</Text>
        <View className='reffo-profile__group'>
          <SettingsRow label='隐私政策' onClick={() => openContent('privacy')} />
          <SettingsRow label='用户协议' onClick={() => openContent('terms')} />
          <SettingsRow label='GitHub' onClick={() => openContent('github')} />
          <SettingsRow label='版本信息' onClick={() => openContent('version')} />
        </View>

        <View className='reffo-profile__group reffo-profile__group--logout'>
          <View className='reffo-profile__row reffo-profile__row--logout' onClick={() => void handleSignOut()}>
            <Text>{signingOut ? '退出中…' : '退出登录'}</Text>
            <Image className='reffo-profile__logout-icon' src={LOGOUT_ICON} mode='aspectFit' />
          </View>
        </View>
      </View>
    </View>
  )
}
