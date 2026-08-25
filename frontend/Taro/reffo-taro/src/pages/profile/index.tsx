import {Image, Text, View} from '@tarojs/components'
import {useEffect} from 'react'
import {useAuthStore} from '@/store/authStore'
import {feedback} from '@/utils/feedback'
import {resolveUserAvatar} from '@/utils/generated-avatar'
import {routePaths, useRouteTransition} from '@/shared/routing'
import './index.scss'

export default function ProfilePage() {
  const route = useRouteTransition()
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const loadProfile = useAuthStore(state => state.loadProfile)
  const signOut = useAuthStore(state => state.signOut)

  useEffect(() => {
    if (!session) {
      void route.replace(routePaths.auth)
      return
    }
    if (!profile) {
      void loadProfile()
    }
  }, [loadProfile, profile, session])

  const handleSignOut = async () => {
    await signOut()
    feedback.success('已退出登录', {duration: 1000})
    void route.reset(routePaths.home)
  }

  return (
    <View className='reffo-profile'>
      <View className='reffo-profile__topbar'>
        <View className='reffo-profile__back' onClick={() => void route.back()} aria-label='返回'>‹</View>
        <Text className='reffo-profile__heading'>个人资料</Text>
        <View className='reffo-profile__topbar-spacer' />
      </View>
      <View className='reffo-profile__content'>
        <View className='reffo-profile__avatar-wrap'>
          {session ? <Image src={resolveUserAvatar(session.user.id, profile?.avatarUrl)} className='reffo-profile__avatar' mode='aspectFill' /> : null}
          <View className='reffo-profile__upload-placeholder'>更换头像</View>
        </View>
        <Text className='reffo-profile__label'>登录邮箱</Text>
        <Text className='reffo-profile__email'>{session?.user.email || '未设置邮箱'}</Text>
        <View className='reffo-profile__divider' />
        <View className='reffo-profile__row'>
          <Text>头像设置</Text>
          <Text className='reffo-profile__muted'>即将支持上传</Text>
        </View>
        <View className='reffo-profile__logout' onClick={() => void handleSignOut()}>退出登录</View>
      </View>
    </View>
  )
}
