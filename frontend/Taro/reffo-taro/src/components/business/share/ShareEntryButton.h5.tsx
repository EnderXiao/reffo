import {Image, Text, View} from '@tarojs/components'
import SHARE_ICON from '@/assets/share/share.svg'
import './ShareEntryButton.h5.scss'

interface ShareEntryButtonProps {
  onClick: () => void
  exiting?: boolean
}

export default function ShareEntryButton({onClick, exiting = false}: ShareEntryButtonProps) {
  return (
    <View
      className={`reffo-share-entry ${exiting ? 'reffo-share-entry--exit' : ''}`}
      data-share-surface='entry'
      onClick={event => {
        event.stopPropagation?.()
        onClick()
      }}
    >
      <View className='reffo-share-entry__content'>
        <Image className='reffo-share-entry__icon' src={SHARE_ICON} mode='aspectFit' aria-hidden='true' />
        <Text className='reffo-share-entry__label'>分享你的新工牌</Text>
      </View>
      <Text className='reffo-share-entry__footnote'>*分享邀请好友注册账号，并成功完成一次生成后即可获得额外生成额度</Text>
    </View>
  )
}
