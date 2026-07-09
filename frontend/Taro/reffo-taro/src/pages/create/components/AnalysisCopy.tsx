import {Text, View} from '@tarojs/components'
import {Animated} from 'react-native'
import {styles} from './AnalysisStage.styles'

interface AnalysisCopyProps {
  detailItems: string[]
  detailActiveIndex: number
  copyAnimatedStyle: object
  detailCurrentAnimatedStyle: object
  detailNextAnimatedStyle: object
}

const singleLineProps = {numberOfLines: 1, ellipsizeMode: 'tail'} as any

export default function AnalysisCopy({
  detailItems,
  detailActiveIndex,
  copyAnimatedStyle,
  detailCurrentAnimatedStyle,
  detailNextAnimatedStyle,
}: AnalysisCopyProps) {
  return (
    <Animated.View style={[styles.copyBlock, copyAnimatedStyle] as any}>
      <View style={styles.titleRow}>
        <Text style={styles.titleLead}>正在分析</Text>
        <View style={styles.detailViewport}>
          {detailItems.length > 0 ? (
            detailItems.length === 1 ? (
              <View style={styles.detailItem}>
                <Text {...singleLineProps} style={styles.titleDetail}>
                  {detailItems[0]}
                </Text>
              </View>
            ) : (
              <>
                <Animated.View style={[styles.detailSlide, detailCurrentAnimatedStyle] as any}>
                  <Text {...singleLineProps} style={styles.titleDetail}>
                    {detailItems[detailActiveIndex]}
                  </Text>
                </Animated.View>
                <Animated.View style={[styles.detailSlide, detailNextAnimatedStyle] as any}>
                  <Text {...singleLineProps} style={styles.titleDetail}>
                    {detailItems[(detailActiveIndex + 1) % detailItems.length]}
                  </Text>
                </Animated.View>
              </>
            )
          ) : null}
        </View>
      </View>

      <Text style={styles.subtitle}>正在为你的目标岗位量身定做最佳匹配简历……</Text>
    </Animated.View>
  )
}
