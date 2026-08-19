import {Image, Text, View} from '@tarojs/components'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {styles} from '../styles'
import {useAuthStore} from '@/store/authStore'
import {navigation} from '@/utils/navigation'
import {resolveUserAvatar} from '@/utils/generated-avatar'

interface HomeHeaderProps {
  onViewHistory: () => void
  hasSourceResume: boolean
  sourceResumeTitle: string | null
}

function truncateLabel(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

export default function HomeHeader({
  onViewHistory,
  hasSourceResume,
  sourceResumeTitle,
}: HomeHeaderProps) {
  const session = useAuthStore(state => state.session)
  const profile = useAuthStore(state => state.profile)
  const buttonStyle = hasSourceResume
    ? {...styles.sourceButton, ...styles.sourceButtonActive}
    : styles.sourceButton
  const buttonTextStyle = hasSourceResume
    ? {...styles.sourceButtonText, ...styles.sourceButtonTextActive}
    : styles.sourceButtonText
  const label = hasSourceResume && sourceResumeTitle
    ? truncateLabel(sourceResumeTitle, 16)
    : HOME_PAGE_CONTENT.header.sourceResumeLabel

  return (
    <View style={styles.header}>
      <View style={buttonStyle} onClick={onViewHistory}>
        {!hasSourceResume ? <Text style={styles.sourceButtonPlus}>+</Text> : null}
        <Text style={buttonTextStyle}>{label}</Text>
      </View>
      {session ? (
        <View style={styles.accountButton} onClick={() => void navigation.navigateTo('/pages/profile/index')}>
          <Image
            src={resolveUserAvatar(session.user.id, profile?.avatarUrl)}
            style={styles.accountAvatar as any}
            mode='aspectFill'
          />
        </View>
      ) : (
        <View style={styles.guestAccountButton} onClick={() => void navigation.navigateTo('/pages/auth/index')}>
          <Text style={styles.guestAccountText}>登录</Text>
        </View>
      )}
    </View>
  )
}
