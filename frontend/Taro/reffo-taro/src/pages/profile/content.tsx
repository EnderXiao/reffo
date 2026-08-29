import Taro, {useLoad} from '@tarojs/taro'
import {Text, View} from '@tarojs/components'
import {useEffect, useMemo, useState} from 'react'
import {useAuthStore} from '@/store/authStore'
import {useHistoryStore} from '@/store/historyStore'
import {useSourceResumeStore} from '@/store/sourceResumeStore'
import {routePaths, useRouteTransition} from '@/shared/routing'
import './content.scss'
import {appReleaseNotes, appVersion} from '@/config/version'
import {privacyMarkdown, termsMarkdown} from '@/content/compliance.generated'
import {ComplianceInline, parseComplianceMarkdown} from './utils/complianceMarkdown'

type ContentView = 'account' | 'data' | 'privacy' | 'terms' | 'version'

const titles: Record<ContentView, string> = {
  account: '账号详情',
  data: '我的数据',
  privacy: '隐私政策',
  terms: '用户协议',
  version: '版本信息',
}

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

function renderInline(content: ComplianceInline[], keyPrefix: string) {
  return content.map((inline, index) => {
    const key = `${keyPrefix}-${inline.type}-${index}`
    if (inline.type === 'strong') return <Text key={key} className='reffo-profile-content__strong'>{inline.text}</Text>
    if (inline.type === 'code') return <Text key={key} className='reffo-profile-content__code'>{inline.text}</Text>
    if (inline.type === 'link') {
      return (
        <Text
          key={key}
          className='reffo-profile-content__link'
          onClick={() => openExternalLink(inline.href)}
          aria-label={`${inline.text}，外部链接`}
        >
          {inline.text}
        </Text>
      )
    }
    return <Text key={key}>{inline.text}</Text>
  })
}

export default function ProfileContentPage() {
  const route = useRouteTransition()
  const session = useAuthStore(state => state.session)
  const authInitialized = useAuthStore(state => state.initialized)
  const profile = useAuthStore(state => state.profile)
  const historyCount = useHistoryStore(state => state.histories.length)
  const sourceResume = useSourceResumeStore(state => state.latestSourceResume)
  const [view, setView] = useState<ContentView>('account')

  useLoad(query => {
    const nextView = query.view as ContentView
    if (nextView && nextView in titles) setView(nextView)
  })

  useEffect(() => {
    if (authInitialized && !session) void route.replace(routePaths.auth)
  }, [authInitialized, route, session])

  const complianceMarkdown = view === 'privacy' ? privacyMarkdown : termsMarkdown
  const blocks = useMemo(() => parseComplianceMarkdown(complianceMarkdown), [complianceMarkdown])
  if (!authInitialized || !session) return null

  return (
    <View className='reffo-profile-content'>
      <View className='reffo-profile-content__topbar'>
        <View className='reffo-profile-content__back' onClick={() => void route.back()} aria-label='返回'>‹</View>
        <Text className='reffo-profile-content__title'>{titles[view]}</Text>
        <View className='reffo-profile-content__spacer' />
      </View>
      {view === 'account' ? (
        <View className='reffo-profile-content__panel'>
          <Text className='reffo-profile-content__label'>登录邮箱</Text>
          <Text className='reffo-profile-content__value'>{session.user.email || '未设置邮箱'}</Text>
          <Text className='reffo-profile-content__label'>显示名称</Text>
          <Text className='reffo-profile-content__value'>{profile?.displayName || '未设置'}</Text>
          <Text className='reffo-profile-content__hint'>账号信息由登录服务维护。</Text>
        </View>
      ) : null}
      {view === 'data' ? (
        <View className='reffo-profile-content__panel'>
          <Text className='reffo-profile-content__value'>生成简历 {historyCount} 份</Text>
          <Text className='reffo-profile-content__label'>源简历</Text>
          <Text className='reffo-profile-content__value'>{sourceResume?.title || '暂未保存'}</Text>
          <Text className='reffo-profile-content__hint'>源简历与生成结果分开保存。删除生成简历不会影响源简历。</Text>
        </View>
      ) : null}
      {view === 'version' ? (
        <View className='reffo-profile-content__panel reffo-profile-content__version'>
          <Text className='reffo-profile-content__version-number'>{appVersion}</Text>
          <Text className='reffo-profile-content__value'>{appReleaseNotes}</Text>
          <Text className='reffo-profile-content__hint'>包含简历分析、岗位匹配、简历生成和个人资料设置。</Text>
        </View>
      ) : null}
      {view === 'privacy' || view === 'terms' ? (
        <View className='reffo-profile-content__markdown'>
          {blocks.length === 0 ? (
            <Text className='reffo-profile-content__error'>内容暂时无法加载，请稍后重试。</Text>
          ) : blocks.map((block, index) => {
            const key = `${block.type}-${index}`
            if (block.type === 'table') {
              return (
                <View key={key} className='reffo-profile-content__table-wrap'>
                  <View className='reffo-profile-content__table'>
                    <View className='reffo-profile-content__table-row reffo-profile-content__table-row--head'>
                      {block.headers.map((cell, cellIndex) => (
                        <View key={`${key}-head-${cellIndex}`} className='reffo-profile-content__table-cell'>
                          <Text>{renderInline(cell, `${key}-head-${cellIndex}`)}</Text>
                        </View>
                      ))}
                    </View>
                    {block.rows.map((row, rowIndex) => (
                      <View key={`${key}-row-${rowIndex}`} className='reffo-profile-content__table-row'>
                        {block.headers.map((_, cellIndex) => (
                          <View key={`${key}-${rowIndex}-${cellIndex}`} className='reffo-profile-content__table-cell'>
                            <Text>{renderInline(row[cellIndex] || [], `${key}-${rowIndex}-${cellIndex}`)}</Text>
                          </View>
                        ))}
                      </View>
                    ))}
                  </View>
                </View>
              )
            }
            if (block.type === 'li') {
              return (
                <View key={key} className='reffo-profile-content__block reffo-profile-content__block--li'>
                  <Text className='reffo-profile-content__list-marker'>{block.marker}</Text>
                  <Text className='reffo-profile-content__list-text'>{renderInline(block.content, key)}</Text>
                </View>
              )
            }
            return (
              <Text key={key} className={`reffo-profile-content__block reffo-profile-content__block--${block.type}`}>
                {renderInline(block.content, key)}
              </Text>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}
