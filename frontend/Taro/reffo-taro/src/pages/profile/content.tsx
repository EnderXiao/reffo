import Taro, {useLoad} from '@tarojs/taro'
import {Image, Text, View} from '@tarojs/components'
import {useCallback, useEffect, useState} from 'react'
import BACK_ICON from '@/assets/common/refo-back.svg'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {profileApi, type ResumeQuota} from '@/services/profile'
import {clearBusinessCache, getBusinessCacheSize} from '@/utils/storage'
import {feedback} from '@/utils/feedback'
import {routePaths, useRouteTransition} from '@/shared/routing'
import {appReleaseDate, appVersion} from '@/config/version'
import ProfileAvatar from './components/ProfileAvatar'
import './content.scss'

type ContentView = 'account' | 'data' | 'privacy' | 'terms' | 'github' | 'version'

const GITHUB_URL = 'https://github.com/EnderXiao/reffo'
const MOCK_SESSION = {
  accessToken: 'mock-token',
  user: {id: 'mock-user', email: 'haishaoyan2020@163.com'},
}
const MOCK_QUOTA: ResumeQuota = {unlimited: false, limit: 3, used: 1, remaining: 2}
const MOCK_CACHE_BYTES = 11_300_000

const titles: Record<ContentView, string> = {
  account: '账号详情',
  data: '我的数据',
  privacy: '隐私政策',
  terms: '用户协议',
  github: 'GitHub',
  version: '版本信息',
}

const PROCESSING_ITEMS = [
  'Reffo 会将源简历和岗位描述发送给 AI 服务进行分析和生成。',
  '数据用于完成当前简历优化任务。',
  '展示当前实际使用的数据保存策略和第三方处理方。',
  '明确哪些内容保存在本机，哪些内容同步到服务端。',
  '明确用户删除数据后各位置的处理方式。',
  '提供隐私政策全文入口。',
]

function openExternalLink(href: string) {
  if (process.env.TARO_ENV === 'h5') {
    const opened = window.open(href, '_blank', 'noopener,noreferrer')
    if (opened) opened.opener = null
    return
  }

  void Taro.setClipboardData({data: href}).then(() => {
    void Taro.showToast({title: '链接已复制', icon: 'none'})
  })
}

function formatCacheSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${bytes}B`
}

function showConfirmation(options: {
  title: string
  content: string
  confirmText: string
  cancelText?: string
  showCancel?: boolean
  tone?: 'danger' | 'guide'
}) {
  return new Promise<boolean>(resolve => {
    feedback.modal({
      ...options,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    })
  })
}

function ProcessingNotice() {
  return (
    <View className='profile-notice'>
      <Text className='profile-notice__heading'>AI如何处理我的简历</Text>
      <Text className='profile-notice__paragraph'>
        当你创建岗位简历时，Reffo 会处理源简历、岗位描述和生成结果。处理这些内容是完成简历分析、岗位匹配和简历生成所必需的。
      </Text>
      <Text className='profile-notice__subheading'>具体说明：</Text>
      <View className='profile-notice__list'>
        {PROCESSING_ITEMS.map(item => (
          <View className='profile-notice__item' key={item}>
            <Text className='profile-notice__marker'>•</Text>
            <Text className='profile-notice__item-text'>{item}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

function DataActionRow({
  label,
  value,
  onClick,
}: {
  label: string
  value: string
  onClick: () => void
}) {
  return (
    <View className='profile-data-actions__row' onClick={onClick}>
      <Text className='profile-data-actions__label'>{label}</Text>
      <Text className='profile-data-actions__value'>{value}</Text>
    </View>
  )
}

export default function ProfileContentPage() {
  const route = useRouteTransition()
  const authSession = useAuthStore(state => state.session)
  const authInitialized = useAuthStore(state => state.initialized)
  const storedHistoryCount = useHistoryStore(state => state.historySummaries.length)
  const clearHistories = useHistoryStore(state => state.clearHistories)
  const isMockMode = process.env.NODE_ENV === 'development' && typeof window !== 'undefined' && window.location.href.includes('mock=1')
  const session = isMockMode ? MOCK_SESSION : authSession
  const historyCount = isMockMode ? 5 : storedHistoryCount
  const [view, setView] = useState<ContentView>('account')
  const [quota, setQuota] = useState<ResumeQuota | null>(isMockMode ? MOCK_QUOTA : null)
  const [cacheSize, setCacheSize] = useState(isMockMode ? MOCK_CACHE_BYTES : 0)
  const [busy, setBusy] = useState(false)

  useLoad(query => {
    const nextView = query.view as ContentView
    if (nextView && nextView in titles) setView(nextView)
  })

  const refreshCacheSize = useCallback(async () => {
    if (isMockMode) {
      setCacheSize(MOCK_CACHE_BYTES)
      return
    }
    try {
      setCacheSize(await getBusinessCacheSize())
    } catch {
      setCacheSize(0)
    }
  }, [isMockMode])

  useEffect(() => {
    if (isMockMode) return
    if (authInitialized && !session) void route.replace(routePaths.auth)
  }, [authInitialized, isMockMode, route, session])

  useEffect(() => {
    if (!session || isMockMode) return
    void profileApi.getQuota().then(setQuota).catch(() => setQuota(null))
  }, [isMockMode, session])

  useEffect(() => {
    if (view === 'data') void refreshCacheSize()
  }, [refreshCacheSize, view])

  const handleClearCache = async () => {
    const confirmed = await showConfirmation({
      title: '清理本机缓存',
      content: '将清理本机页面缓存和历史快照，保留登录态与首次引导状态。',
      confirmText: '清理',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed || busy) return
    setBusy(true)
    try {
      const count = await clearBusinessCache()
      await refreshCacheSize()
      feedback.success(`已清理 ${count} 项本机缓存`)
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : '清理缓存失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteHistories = async () => {
    const confirmed = await showConfirmation({
      title: '删除简历数据',
      content: '仅删除已生成的简历和历史结果，源简历不会被删除。此操作不可恢复。',
      confirmText: '删除',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!confirmed || busy) return
    setBusy(true)
    try {
      await clearHistories()
      feedback.success('已删除简历数据')
    } catch (error) {
      feedback.error(error instanceof Error ? error.message : '删除简历数据失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteAccount = async () => {
    await showConfirmation({
      title: '注销账号',
      content: '账号注销功能即将开放，请稍后再试。',
      confirmText: '知道了',
      showCancel: false,
      tone: 'guide',
    })
  }

  if (!session || (!isMockMode && !authInitialized)) return null

  return (
    <View className='reffo-profile-content'>
      <View className='reffo-profile-content__topbar'>
        <View className='reffo-profile-content__back' onClick={() => void route.back()} aria-label='返回'>
          <Image className='reffo-profile-content__back-icon' src={BACK_ICON} mode='aspectFit' />
        </View>
      </View>
      <View className='reffo-profile-content__body'>
        <Text className='reffo-profile-content__title'>{titles[view]}</Text>

        {view === 'account' ? (
          <View className='profile-account'>
            <View className='profile-account__identity'>
              <ProfileAvatar email={session.user.email || ''} />
              <Text className='profile-account__email'>{session.user.email || '未设置邮箱'}</Text>
            </View>
            <Text className='profile-account__section-label'>订阅</Text>
            <View className='profile-account__panel'>
              <View className='profile-account__row'>
                <Text>剩余可用次数</Text>
                <Text className='profile-account__value'>
                  {quota?.unlimited ? '不限' : quota?.remaining == null ? '—' : `${quota.remaining}次`}
                </Text>
              </View>
              <View className='profile-account__row profile-account__row--disabled'>
                <Text>选择方案</Text>
              </View>
            </View>
            <View className='profile-account__danger' onClick={() => void handleDeleteAccount()}>
              <Text>注销账号</Text>
            </View>
          </View>
        ) : null}

        {view === 'data' ? (
          <View>
            <View className='profile-data-actions'>
              <DataActionRow
                label={busy ? '处理中…' : '清理本机缓存'}
                value={formatCacheSize(cacheSize)}
                onClick={() => void handleClearCache()}
              />
              <DataActionRow
                label={busy ? '处理中…' : '删除简历数据'}
                value={`${historyCount}份简历`}
                onClick={() => void handleDeleteHistories()}
              />
            </View>
            <ProcessingNotice />
          </View>
        ) : null}

        {view === 'privacy' || view === 'terms' ? <ProcessingNotice /> : null}

        {view === 'github' ? (
          <View className='profile-github'>
            <Text className='profile-github__link' onClick={() => openExternalLink(GITHUB_URL)}>GitHub Link</Text>
            <Text className='profile-github__copy'>
              Card variants with absolute image headers or centered images (&quot;With Abs Image Header&quot;, &quot;With Abs Image Header Footer&quot;, &quot;Cover Img&quot;, &quot;Center Img&quot;, &quot;Primary Action&quot;) have a minimum height defined.
            </Text>
          </View>
        ) : null}

        {view === 'version' ? (
          <View className='profile-version'>
            <Text className='profile-version__number'>{appVersion}</Text>
            <Text className='profile-version__date'>发布时间：{appReleaseDate}</Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}
