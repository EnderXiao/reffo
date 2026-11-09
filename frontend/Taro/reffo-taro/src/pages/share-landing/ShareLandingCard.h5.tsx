import {useMemo} from 'react'
import {View} from '@tarojs/components'
import HomeScoreCard from '@/components/business/HomeCardDeck/HomeScoreCard.h5'
import type {HomeCardItem} from '@/components/business/HomeCardDeck/shared'
import {
  deriveCardPalette,
  deriveSeedColorFromString,
} from '@/components/business/HomeCardDeck/palette'
import ShareBlankCard from '@/pages/share/ShareBlankCard.h5'
import type {PublicShareLink} from '@/types/share'
import type {VisualTier} from '@/utils'

interface ShareLandingCardProps {
  share: PublicShareLink | null
  visualTier: VisualTier
}

function toHomeCardItem(share: PublicShareLink): HomeCardItem {
  const card = share.card
  if (card.kind !== 'job') {
    throw new Error('工牌卡片数据不正确')
  }

  const seedColor = card.card_color
    || deriveSeedColorFromString(`${share.share_id}:${card.company}:${card.position}`)
  const palette = deriveCardPalette(seedColor)

  return {
    id: share.share_id,
    company: card.company,
    personName: card.display_name,
    indexLabel: card.display_name.slice(0, 1),
    location: card.location,
    role: card.position,
    dateLabel: `生成日期 ${card.generated_date}`,
    score: card.match_score,
    strategyBody: share.landing.revealed_body,
    strategyTitle: share.landing.revealed_title,
    ...palette,
  }
}

export default function ShareLandingCard({
  share,
  visualTier,
}: ShareLandingCardProps) {
  const homeCard = useMemo(
    () => share?.card.kind === 'job' ? toHomeCardItem(share) : null,
    [share],
  )

  if (!share) {
    return <View className='share-page__card-skeleton' />
  }

  if (share.card.kind === 'blank') {
    return (
      <ShareBlankCard
        title={share.card.title}
        prompt={share.card.prompt}
        action={share.card.action}
      />
    )
  }

  return (
    <View className='share-badge__card-frame'>
      <HomeScoreCard
        card={homeCard}
        depth={0}
        active
        visualTier={visualTier}
        className='share-badge__home-card'
      />
    </View>
  )
}
