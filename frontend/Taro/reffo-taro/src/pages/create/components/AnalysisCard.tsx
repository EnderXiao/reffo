import {Text, View} from '@tarojs/components'
import {Animated} from 'react-native'
import SvgIcon, {Circle, Path} from 'react-native-svg'
import {styles} from './AnalysisStage.styles'

function AnalysisBackFace() {
  return (
    <View style={styles.cardBackContent}>
      <View style={styles.cardHardwareCompact}>
        <View style={[styles.cardHardwareSlot, styles.cardHardwareSlotBack] as any} />
      </View>

      <View style={styles.backBadgeWrap}>
        <SvgIcon width='66' height='66' viewBox='0 0 88 88'>
          <Circle
            cx='44'
            cy='44'
            r='43.5'
            stroke='rgba(255,255,255,0.94)'
            strokeWidth='1'
            fill='none'
          />
          <Path
            d='M44 20C46.4 34.6 53.4 41.6 68 44C53.4 46.4 46.4 53.4 44 68C41.6 53.4 34.6 46.4 20 44C34.6 41.6 41.6 34.6 44 20Z'
            fill='rgba(255,255,255,0.98)'
          />
          <Path
            d='M61 26C61.9 31.1 64.4 33.6 69.5 34.5C64.4 35.4 61.9 37.9 61 43C60.1 37.9 57.6 35.4 52.5 34.5C57.6 33.6 60.1 31.1 61 26Z'
            fill='rgba(255,255,255,0.8)'
          />
        </SvgIcon>
      </View>

      <View style={styles.backBodyBars}>
        <View style={styles.backPrimaryBar} />
        <View style={styles.backSecondaryBar} />
      </View>
    </View>
  )
}

interface AnalysisCardProps {
  monogram: string
  cardAnimatedStyle: object
  frontFaceAnimatedStyle: object
  backFaceAnimatedStyle: object
  androidFaceProps: object
}

export default function AnalysisCard({
  monogram,
  cardAnimatedStyle,
  frontFaceAnimatedStyle,
  backFaceAnimatedStyle,
  androidFaceProps,
}: AnalysisCardProps) {
  return (
    <Animated.View style={[styles.cardStage, cardAnimatedStyle] as any}>
      <View style={styles.cardSpinShell}>
        <Animated.View
          {...androidFaceProps}
          style={[styles.cardFace, styles.cardFront, frontFaceAnimatedStyle] as any}
        >
          <View style={styles.cardHardware}>
            <View style={styles.cardHardwareSlot} />
          </View>
          <View style={styles.frontBadge}>
            <Text style={styles.frontBadgeText}>{monogram}</Text>
          </View>
          <View style={styles.frontPrimaryBar} />
          <View style={styles.frontSecondaryBar} />
        </Animated.View>

        <Animated.View
          {...androidFaceProps}
          style={[styles.cardFace, styles.cardBack, backFaceAnimatedStyle] as any}
        >
          <AnalysisBackFace />
        </Animated.View>
      </View>
    </Animated.View>
  )
}
