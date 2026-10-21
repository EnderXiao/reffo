import {Image, Text, View} from '@tarojs/components'
import quoteIcon from '@/assets/result/quote.svg'
import {normalizeRequirementAnalysis} from '@/utils/requirement-analysis'
import './requirement-analysis.h5.scss'

export function RequirementAnalysisPanel({value}: {value: unknown}) {
  const portrait = normalizeRequirementAnalysis(value)?.portrait?.text

  if (!portrait) return null

  return (
    <View className='reffo-requirements' role='region' aria-label='岗位理想候选人画像'>
      <View className='reffo-requirements__header'>
        <Image className='reffo-requirements__quote' src={quoteIcon} mode='aspectFit' aria-hidden='true' />
        <Text className='reffo-requirements__title'>岗位理想候选人画像</Text>
      </View>
      <Text className='reffo-requirements__text'>{portrait}</Text>
    </View>
  )
}
