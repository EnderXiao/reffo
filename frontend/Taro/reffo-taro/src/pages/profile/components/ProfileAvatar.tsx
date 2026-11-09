import {Text, View} from '@tarojs/components'

interface ProfileAvatarProps {
  email: string
}

export default function ProfileAvatar({email}: ProfileAvatarProps) {
  const initial = email.trim().charAt(0).toUpperCase() || 'R'
  return (
    <View className='reffo-profile-avatar' aria-label='用户头像'>
      <Text>{initial}</Text>
    </View>
  )
}
