import {Text, View} from '@tarojs/components'

export default function ShareBlankCard() {
  return (
    <View className='share-blank-card'>
      <View className='share-blank-card__sheen' aria-hidden='true' />
      <Text className='share-blank-card__title'>新的申请</Text>
      <View className='share-blank-card__copy'>
        <Text className='share-blank-card__prompt'>从描述你的目标岗位</Text>
        <Text className='share-blank-card__action'>开始</Text>
      </View>
    </View>
  )
}
