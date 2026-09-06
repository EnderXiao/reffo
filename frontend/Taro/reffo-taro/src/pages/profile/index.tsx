import Taro from '@tarojs/taro'
import {Image, Text, View} from '@tarojs/components'
import {useEffect, useMemo, useState} from 'react'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {clearBusinessCache} from '@/utils/storage'
import {profileApi, type ResumeQuota} from '@/services/profile'
import {feedback} from '@/utils/feedback'
import {resolveUserAvatar} from '@/utils/generated-avatar'
import {routePaths, useRouteTransition} from '@/shared/routing'
import {appVersion} from '@/config/version'
import './index.scss'

const GITHUB_URL = 'https://github.com/EnderXiao/reffo'

interface SettingsRowProps {
  label: string
  value?: string
  danger?: boolean
  onClick: () => void
}

function SettingsRow({label, value, danger, onClick}: SettingsRowProps) {
  return (
    <View className={`reffo-profile__row${danger ? ' reffo-profile__row--danger' : ''}`} onClick={onClick}>
      <Text>{label}</Text>
      <View className='reffo-profile__row-tail'>
        {value ? <Text className='reffo-profile__row-value'>{value}</Text> : null}
        <Text className='reffo-profile__chevron'>›</Text>
      </View>
    </View>
  )
}

export default function ProfilePage() {
  const route = useRouteTransition()
  const session = useAuthStore(state => state.session)
  const authInitialized = useAuthStore(state => state.initialized)
  const profile = useAuthStore(state => state.profile)
  const loadProfile = useAuthStore(state => state.loadProfile)
  const signOut = useAuthStore(state => state.signOut)
  const histories = useHistoryStore(state => state.histories)
  const latestSourceResume = useSourceResumeStore(state => state.latestSourceResume)
  const loadHistories = useHistoryStore(state => state.loadHistories)
  const loadLatestSourceResume = useSourceResumeStore(state => state.loadLatestSourceResume)
  const [busy, setBusy] = useState(false)
  const [quota, setQuota] = useState<ResumeQuota | null>(null)

  useEffect(() => {
    if (!authInitialized) return
    if (!session) {
      void route.replace(routePaths.auth)
      return
    }
    if (!profile) void loadProfile()
    void loadHistories({skipIfLoaded: true})
    void loadLatestSourceResume({skipIfLoaded: true})
    void profileApi.getQuota().then(setQuota).catch(() => setQuota(null))
  }, [authInitialized, loadHistories, loadLatestSourceResume, loadProfile, profile, route, session])

  const displayName = useMemo(() => profile?.displayName || session?.user.email?.split('@')[0] || 'Reffo 用户', [profile?.displayName, session?.user.email])

  const handleClearCache = async () => {
    const modal = await Taro.showModal({
      title: '清除本机缓存',
      content: '将清除本机页面缓存和历史快照，保留登录态与首次引导状态。',
      confirmText: '清除',
      cancelText: '取消',
    })
    if (!modal.confirm || busy) return
    setBusy(true)
    try {
      const count = await clearBusinessCache()
      feedback.success(`已清除 ${count} 项本机缓存`)
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : '清除缓存失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteHistories = async () => {
    const modal = await Taro.showModal({
      title: '删除简历数据',
      content: '仅删除已生成的简历和历史结果，源简历不会被删除。此操作不可恢复。',
      confirmText: '删除',
      cancelText: '取消',
    })
    if (!modal.confirm || busy) return
    setBusy(true)
    try {
      await useHistoryStore.getState().clearHistories()
      feedback.success('已删除生成简历数据')
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : '删除简历数据失败')
    } finally {
      setBusy(false)
    }
  }

  const handleGithub = () => {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(GITHUB_URL, '_blank', 'noopener,noreferrer')
      return
    }
    void Taro.setClipboardData({data: GITHUB_URL})
    feedback.success('GitHub 链接已复制')
  }

  const handleSignOut = async () => {
    if (busy) return
    setBusy(true)
    try {
      await signOut()
      feedback.success('已退出登录', {duration: 1000})
      void route.reset(routePaths.home)
    } finally {
      setBusy(false)
    }
  }

  if (!authInitialized || !session) return null

  return (
    <View className='reffo-profile'>
      <View className='reffo-profile__topbar'>
        <View className='reffo-profile__back' onClick={() => void route.back()} aria-label='返回'>‹</View>
        <Text className='reffo-profile__heading'>个人资料</Text>
        <View className='reffo-profile__topbar-spacer' />
      </View>
      <View className='reffo-profile__content'>
        <View className='reffo-profile__account-card' onClick={() => void route.navigate(routePaths.profileContent, {view: 'account'})}>
          <Image src={resolveUserAvatar(session.user.id, profile?.avatarUrl)} className='reffo-profile__avatar' mode='aspectFill' />
          <View className='reffo-profile__account-copy'>
            <Text className='reffo-profile__account-name'>{displayName}</Text>
            <Text className='reffo-profile__account-email'>{session.user.email || '未设置邮箱'}</Text>
          </View>
          <Text className='reffo-profile__chevron'>›</Text>
        </View>
        <Text className='reffo-profile__section-title'>账户</Text>
        <View className='reffo-profile__group'>
          <SettingsRow label='账号详情' onClick={() => void route.navigate(routePaths.profileContent, {view: 'account'})} />
          <SettingsRow label='我的数据' value={`${histories.length} 份生成简历`} onClick={() => void route.navigate(routePaths.profileContent, {view: 'data'})} />
          <SettingsRow label='今日生成次数' value={quota?.unlimited ? '不限' : quota ? `${quota.remaining}/${quota.limit}` : '加载中'} onClick={() => undefined} />
        </View>
        <Text className='reffo-profile__section-title'>关于 Reffo</Text>
        <View className='reffo-profile__group'>
          <SettingsRow label='隐私政策' onClick={() => void route.navigate(routePaths.profileContent, {view: 'privacy'})} />
          <SettingsRow label='用户协议' onClick={() => void route.navigate(routePaths.profileContent, {view: 'terms'})} />
          <SettingsRow label='GitHub 项目' onClick={handleGithub} />
          <SettingsRow label='版本信息' value={appVersion} onClick={() => void route.navigate(routePaths.profileContent, {view: 'version'})} />
        </View>
        <Text className='reffo-profile__section-title'>数据管理</Text>
        <View className='reffo-profile__group'>
          <SettingsRow label='清除本机缓存' value={busy ? '处理中…' : undefined} onClick={() => void handleClearCache()} />
          <SettingsRow label='删除简历数据' value={latestSourceResume ? '源简历保留' : undefined} danger onClick={() => void handleDeleteHistories()} />
        </View>
        <View className='reffo-profile__logout' onClick={() => void handleSignOut()}>退出登录</View>
      </View>
    </View>
  )
}
