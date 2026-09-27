import {View} from '@tarojs/components'

export default function CreateStepLoading() {
  return (
    <View className='reffo-create-step-loading' aria-label='正在加载步骤' aria-busy='true'>
      <View className='reffo-create-step-loading__title' />
      <View className='reffo-create-step-loading__block' />
      <View className='reffo-create-step-loading__block reffo-create-step-loading__block--short' />
    </View>
  )
}
