import {Text, View} from '@tarojs/components'

interface ShareBlankCardProps {
  title?: string
  prompt?: string
  action?: string
}

export default function ShareBlankCard({
  title = '新的申请',
  prompt = '从描述你的目标岗位',
  action = '开始',
}: ShareBlankCardProps) {
  return (
    <View className='share-blank-card'>
      <View className='share-blank-card__sheen' aria-hidden='true' />
      <Text className='share-blank-card__title'>{title}</Text>
      <View className='share-blank-card__copy'>
        <Text className='share-blank-card__prompt'>{prompt}</Text>
        <Text className='share-blank-card__action'>{action}</Text>
      </View>
    </View>
  )
}
