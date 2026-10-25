import {Text, View} from '@tarojs/components'
import type {PublicShareLink} from '@/types/share'

interface ShareLandingCardProps {
  share: PublicShareLink | null
}

export default function ShareLandingCard({share}: ShareLandingCardProps) {
  if (!share) {
    return <View className='share-landing__card share-landing__card--skeleton' />
  }

  if (share.card.kind === 'blank') {
    return (
      <View className='share-landing__card share-landing__card--blank'>
        <Text className='share-landing__blank-title'>{share.card.title}</Text>
        <Text className='share-landing__blank-prompt'>{share.card.prompt}</Text>
        <Text className='share-landing__blank-action'>{share.card.action}</Text>
      </View>
    )
  }

  return (
    <View className='share-landing__card share-landing__card--job'>
      <View className='share-landing__card-pattern' aria-hidden='true'>
        {Array.from({length: 24}, (_, index) => (
          <Text key={index} className='share-landing__pattern-dot' />
        ))}
      </View>
      <View className='share-landing__job-copy'>
        <Text className='share-landing__job-label'>COMPANY</Text>
        <Text className='share-landing__job-company'>{share.card.company}</Text>
        <Text className='share-landing__job-label'>NAME</Text>
        <Text className='share-landing__job-value'>{share.card.display_name}</Text>
        <Text className='share-landing__job-label'>POSITION</Text>
        <Text className='share-landing__job-value share-landing__job-value--strong'>{share.card.position}</Text>
        <Text className='share-landing__job-date'>Date {share.card.generated_date}</Text>
      </View>
      <View className='share-landing__job-score'>
        <Text className='share-landing__score-number'>{share.card.match_score}</Text>
        <Text className='share-landing__score-copy'>% Match rate</Text>
      </View>
    </View>
  )
}
