import {useCallback, useEffect, useRef} from 'react'
import {Text, View} from '@tarojs/components'
import {useVisualTier} from '@/utils'
import '@/pages/index/index.h5.scss'
import '@/styles/responsive-layout.scss'
import PhysicsBadge from '@/pages/share/PhysicsBadge.h5'
import type {ShareLandingViewModel} from './usePageModel'
import ShareLandingCard from './ShareLandingCard.h5'
import '@/pages/share/index.h5.scss'
import './index.h5.scss'

const STRAP_GRADIENT_JOB: readonly [string, string] = ['#b8efd3', '#f2fff9']
const STRAP_GRADIENT_BLANK: readonly [string, string] = ['#bdd8fc', '#f2f8ff']
const TEASER_HINT = '尝试 reffo，开启全新求职体验'

export default function PageView({
  share,
  status,
  errorMessage,
  retry,
  handleExperience,
}: ShareLandingViewModel) {
  const visualCapability = useVisualTier({benchmark: true})
  const revealedContentRef = useRef<any>(null)
  const mode = share?.mode === 'blank' ? 'blank' : 'job'
  const isLoading = status === 'loading'
  const isTeaser = status === 'teaser'
  const isRevealed = status === 'revealed'
  const isError = status === 'error'

  const updateCopyFade = useCallback(() => {
    const element = revealedContentRef.current as HTMLElement | null
    if (!element) return

    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    const topFade = Math.min(24, Math.max(0, element.scrollTop))
    const bottomFade = Math.min(24, Math.max(0, maxScrollTop - element.scrollTop))
    element.style.setProperty('--share-content-fade-top', `${topFade}px`)
    element.style.setProperty('--share-content-fade-bottom', `${bottomFade}px`)
  }, [])

  useEffect(() => {
    updateCopyFade()
    const element = revealedContentRef.current as HTMLElement | null
    element?.addEventListener('scroll', updateCopyFade, {passive: true})
    window.addEventListener('resize', updateCopyFade)

    return () => {
      element?.removeEventListener('scroll', updateCopyFade)
      window.removeEventListener('resize', updateCopyFade)
    }
  }, [status, updateCopyFade])

  const renderRevealedContent = () => {
    if (share?.card.kind === 'job') {
      return (
        <>
          <Text className='share-page__lead'>
            用 <Text className='share-page__accent'>reffo</Text> 榨干了
            <Text className='share-page__source-reference'>我的简历</Text>
            和
            <Text className='share-page__source-reference'>目标岗位描述</Text>
            ，我得到了：
          </Text>
          {share.card.summary_lines.map(line => (
            <Text key={line} className='share-page__paragraph'>{line}</Text>
          ))}
        </>
      )
    }

    return (
      <>
        <Text className='share-page__lead'>
          用 <Text className='share-page__accent'>reffo</Text> 量身定制你的新简历
        </Text>
        <Text className='share-page__paragraph'>
          {share?.landing.revealed_body || '智能弥合简历和工作岗位之间的差距，提高在就业市场的竞争力。'}
        </Text>
      </>
    )
  }

  return (
    <View
      className={`share-page share-page--${mode} share-landing reffo-responsive-page`}
    >
      <View
        className={`share-page__mode-backdrop share-page__mode-backdrop--${mode} is-active`}
        aria-hidden='true'
      />
      <View className='share-page__atmosphere' aria-hidden='true' />
      <Text className='share-page__watermark'>新工牌</Text>

      <View className='share-page__content-shell reffo-responsive-page__frame'>
        <View className='share-page__badge-stage'>
          <PhysicsBadge
            strapGradient={mode === 'blank' ? STRAP_GRADIENT_BLANK : STRAP_GRADIENT_JOB}
            strapWidth={1}
            gravity={1.2}
            damping={0.78}
            elasticity={0.08}
            breeze={0.08}
            captureOnMount={!isError}
            interactive
          >
            <View
              className='share-mode-card'
              data-share-card-source={mode}
              data-share-transition-role='card'
            >
              <ShareLandingCard share={share} visualTier={visualCapability.tier} />
            </View>
          </PhysicsBadge>
        </View>

        <View className='share-page__copy share-landing__copy'>
          <View className='share-page__copy-content share-landing__copy-content'>
            <View className={`share-landing__teaser ${isTeaser ? 'is-visible' : ''}`}>
              <Text className='share-landing__teaser-title'>
                {share?.landing.teaser_title || '一个岗位'}
              </Text>
              <Text className='share-landing__teaser-title'>
                {share?.landing.teaser_subtitle || '一份专门准备的简历'}
              </Text>
              <Text className='share-landing__teaser-hint'>{TEASER_HINT}</Text>
            </View>

            <View
              ref={revealedContentRef}
              className={`share-landing__revealed ${isRevealed ? 'is-visible' : ''}`}
            >
              {renderRevealedContent()}
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

          {isRevealed ? (
            <View className='share-landing__actions'>
              <View className='share-landing__cta' onClick={handleExperience}>
                <View className='share-landing__cta-spark' aria-hidden='true'>
                  <Text className='share-landing__cta-spark-main'>✦</Text>
                  <Text className='share-landing__cta-spark-small'>✦</Text>
                </View>
                <Text>{share?.landing.cta || '即刻体验'}</Text>
              </View>
              <Text className='share-landing__reward-note'>
                *接受邀请注册账号，并成功完成一次生成后即可获得额外生成额度
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  )
}
