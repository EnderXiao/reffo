import {Text, View} from '@tarojs/components'
import './ShareEntryButton.h5.scss'

interface ShareEntryButtonProps {
  onClick: () => void
}

export default function ShareEntryButton({onClick}: ShareEntryButtonProps) {
  return (
    <View
      className='reffo-share-entry'
      data-share-surface='entry'
      onClick={event => {
        event.stopPropagation?.()
        onClick()
      }}
    >
      <View className='reffo-share-entry__icon' aria-hidden='true'>
        <Text className='reffo-share-entry__dot reffo-share-entry__dot--top' />
        <Text className='reffo-share-entry__dot reffo-share-entry__dot--left' />
        <Text className='reffo-share-entry__dot reffo-share-entry__dot--right' />
        <Text className='reffo-share-entry__line reffo-share-entry__line--left' />
        <Text className='reffo-share-entry__line reffo-share-entry__line--right' />
      </View>
      <Text className='reffo-share-entry__label'>分享</Text>
    </View>
  )
}
