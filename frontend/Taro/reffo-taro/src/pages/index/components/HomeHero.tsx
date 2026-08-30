import {Image, Text, View} from '@tarojs/components'
import {useEffect, useMemo, useRef, useState} from 'react'
import {Animated} from 'react-native'
import type {HomeCardItem} from '@/components/business/HomeCardDeck'
import {HOME_PAGE_CONTENT} from '../constants/content'
import {styles} from '../styles'

type HeroMode = 'brand' | 'strategy' | 'create'

interface HomeHeroProps {
  currentCard: HomeCardItem | null
  isStrategyVisible: boolean
  isCreateMode: boolean
  logoSource: string
  compact?: boolean
}

function HeroLabel({children, compact, strategy}: {children: string; compact: boolean; strategy?: boolean}) {
  return (
    <View style={styles.heroLabelRow as any}>
      <Text
        style={[
          (strategy ? styles.heroStrategyLabel : styles.heroCreateLabel) as any,
          compact
            ? (strategy ? styles.heroStrategyLabelCompact : styles.heroCreateLabelCompact) as any
            : null,
        ] as any}
      >
        {children}
      </Text>
      <View style={styles.heroLabelSpark as any}>
        <Text style={styles.heroLabelSparkMain as any}>✦</Text>
        <Text style={styles.heroLabelSparkSmall as any}>✦</Text>
      </View>
    </View>
  )
}

export default function HomeHero({
  currentCard,
  isStrategyVisible,
  isCreateMode,
  logoSource,
  compact = false,
}: HomeHeroProps) {
  const fade = useRef(new Animated.Value(1)).current
  const [renderMode, setRenderMode] = useState<HeroMode>(
    isCreateMode ? 'create' : isStrategyVisible ? 'strategy' : 'brand',
  )
  const [renderStrategyBody, setRenderStrategyBody] = useState(currentCard?.strategyBody || '')
  const strategyParagraphs = useMemo(
    () =>
      renderStrategyBody
        .split(/\n+/)
        .map(paragraph => paragraph.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 2),
    [renderStrategyBody],
  )

  useEffect(() => {
    const nextMode: HeroMode = isCreateMode ? 'create' : isStrategyVisible ? 'strategy' : 'brand'
    const nextStrategyBody = currentCard?.strategyBody || ''
    const shouldUpdate =
      renderMode !== nextMode ||
      (nextMode === 'strategy' && renderStrategyBody !== nextStrategyBody)

    if (!shouldUpdate) {
      return
    }

    Animated.timing(fade, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({finished}) => {
      if (!finished) {
        return
      }

      setRenderMode(nextMode)
      setRenderStrategyBody(nextStrategyBody)

      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start()
    })
  }, [currentCard?.strategyBody, fade, isCreateMode, isStrategyVisible, renderMode, renderStrategyBody])

  const stageAnimatedStyle = {
    opacity: fade,
    transform: [
      {
        translateY: fade.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
          extrapolate: 'clamp',
        }),
      },
    ],
  }

  return (
    <View style={[styles.heroSection, compact ? styles.heroSectionCompact : null] as any}>
      <Animated.View
        style={[styles.heroStage as any, compact ? styles.heroStageCompact : null, stageAnimatedStyle]}
      >
        {renderMode === 'brand' ? (
          <View style={[styles.heroBrandWrap as any, compact ? styles.heroBrandWrapCompact : null] as any}>
            <Image src={logoSource} style={styles.logoImage as any} mode='aspectFit' />
            <Text style={[styles.heroTitle as any, compact ? styles.heroTitleCompact : null] as any}>
              {HOME_PAGE_CONTENT.hero.titlePrefix}
              <Text style={styles.heroHighlight as any}>{HOME_PAGE_CONTENT.hero.titleAccentOne}</Text>
              {HOME_PAGE_CONTENT.hero.titleMiddle}
              {HOME_PAGE_CONTENT.hero.titleSuffixPrefix}
              <Text style={styles.heroHighlight as any}>{HOME_PAGE_CONTENT.hero.titleAccentTwo}</Text>
            </Text>
          </View>
        ) : renderMode === 'create' ? (
          <View style={[styles.heroCreateWrap as any, compact ? styles.heroCreateWrapCompact : null] as any}>
            <Text style={[styles.heroCreateTitle as any, compact ? styles.heroCreateTitleCompact : null] as any}>
              {HOME_PAGE_CONTENT.hero.createTitlePrefix}
              <Text style={styles.heroHighlight as any}>{HOME_PAGE_CONTENT.hero.createTitleAccent}</Text>
            </Text>
            <HeroLabel compact={compact}>{HOME_PAGE_CONTENT.hero.createGuideLabel}</HeroLabel>
            <Text
              style={[
                styles.heroCreateBody as any,
                compact ? styles.heroCreateBodyCompact : null,
              ] as any}
            >
              {HOME_PAGE_CONTENT.hero.createGuideBody}
            </Text>
          </View>
        ) : (
          <View
            style={[styles.heroStrategyWrap as any, compact ? styles.heroStrategyWrapCompact : null] as any}
          >
            <HeroLabel compact={compact} strategy>{HOME_PAGE_CONTENT.hero.strategyLabel}</HeroLabel>
            <View
              style={[
                styles.heroStrategyBodyGroup as any,
                compact ? styles.heroStrategyBodyGroupCompact : null,
              ] as any}
            >
              {strategyParagraphs.map((paragraph, index) => (
                <Text
                  key={`${index}-${paragraph}`}
                  style={[
                    styles.heroStrategyBody as any,
                    compact ? styles.heroStrategyBodyCompact : null,
                    index < strategyParagraphs.length - 1 ? styles.heroStrategyParagraph : null,
                  ] as any}
                  numberOfLines={compact ? 2 : index === 0 ? 3 : 2}
                >
                  {paragraph}
                </Text>
              ))}
            </View>
          </View>
        )}
      </Animated.View>
    </View>
  )
}
