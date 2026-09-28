import {View} from '@tarojs/components'
import './HomeLoadingCover.h5.scss'

export default function HomeLoadingCover({logoSource}: {logoSource: string}) {
  return (
    <View
      className='reffo-home-loading-cover'
      role='status'
      aria-label='正在加载首页数据'
      aria-busy='true'
    >
      <img src={logoSource} className='reffo-home-loading-cover__logo' alt='Reffo' />
      <View className='reffo-home-loading-cover__loading'>
        <View className='reffo-home-loading-cover__loading-dot' />
        <View className='reffo-home-loading-cover__loading-dot' />
        <View className='reffo-home-loading-cover__loading-dot' />
      </View>
    </View>
  )
}

