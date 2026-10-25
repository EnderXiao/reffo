import {Text, View} from '@tarojs/components'
import ShareLandingCard from './ShareLandingCard.h5'
import type {ShareLandingViewModel} from './usePageModel'
import '@/styles/responsive-layout.scss'
import './index.h5.scss'

export default function PageView({
  share,
  status,
  errorMessage,
  retry,
  handleExperience,
}: ShareLandingViewModel) {
  const theme = share?.theme === 'blue' ? 'blue' : 'green'
  const isLoading = status === 'loading'
  const isError = status === 'error'

  return (
    <View className={`share-landing share-landing--${theme} reffo-responsive-page`}>
      <View className='share-landing__atmosphere' aria-hidden='true' />
      <Text className='share-landing__watermark'>新工牌</Text>

      <View className='share-landing__frame reffo-responsive-page__frame'>
        <View className={`share-landing__clip ${isLoading ? 'share-landing__clip--loading' : ''}`} aria-hidden='true'>
          <View className='share-landing__strap' />
          <View className='share-landing__metal' />
        </View>

        <View className='share-landing__card-stage'>
          <ShareLandingCard share={share} />
        </View>

        <View className='share-landing__content'>
          <View
            className={`share-landing__teaser ${status === 'teaser' ? 'share-landing__teaser--visible' : ''}`}
          >
            <Text className='share-landing__teaser-title'>一个岗位</Text>
            <Text className='share-landing__teaser-title'>一份专门准备的简历</Text>
            <Text className='share-landing__teaser-hint'>
              {share?.landing.teaser_hint || '尝试 Reffo，开启全新求职体验'}
            </Text>
          </View>

          <View
            className={`share-landing__revealed ${status === 'revealed' ? 'share-landing__revealed--visible' : ''}`}
          >
            <Text className='share-landing__revealed-title'>
              {share?.landing.revealed_title || '用 Reffo 量身定制你的新简历'}
            </Text>
            <Text className='share-landing__revealed-body'>
              {share?.landing.revealed_body || '智能弥合简历和工作岗位之间的差距，提高在就业市场的竞争力。'}
            </Text>
            <View className='share-landing__cta' onClick={handleExperience}>
              <Text className='share-landing__cta-spark'>✦</Text>
              <Text>{share?.landing.cta || '即刻体验'}</Text>
            </View>
            <Text className='share-landing__reward-note'>
              *接受邀请注册账号，并成功完成一次生成后即可获得额外生成额度
            </Text>
          </View>

          {isLoading ? (
            <View className='share-landing__loading'>
              <View className='share-landing__loading-line share-landing__loading-line--wide' />
              <View className='share-landing__loading-line share-landing__loading-line--short' />
              <Text className='share-landing__loading-copy'>正在准备新工牌...</Text>
            </View>
          ) : null}

          {isError ? (
            <View className='share-landing__error'>
              <Text className='share-landing__error-title'>{errorMessage}</Text>
              <View className='share-landing__retry' onClick={retry}>
                <Text>重新加载</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}
