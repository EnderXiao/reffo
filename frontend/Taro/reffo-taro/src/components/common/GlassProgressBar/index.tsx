import type {PropsWithChildren} from 'react'
import {StyleSheet, View} from 'react-native'
import type {StyleProp, ViewStyle} from 'react-native'

interface GlassProgressBarProps extends PropsWithChildren {
  value: number
  max?: number
  style?: StyleProp<ViewStyle>
  fillStyle?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export default function GlassProgressBar({
  value,
  max = 100,
  style,
  fillStyle,
  contentStyle,
  children,
}: GlassProgressBarProps) {
  const progress = max <= 0 ? 0 : clamp(value / max, 0, 1)

  return (
    <View style={[styles.track, style]}>
      <View pointerEvents='none' style={styles.glassTint} />
      <View pointerEvents='none' style={[styles.fill, {width: `${progress * 100}%`}, fillStyle]} />
      {children ? <View style={[styles.content, contentStyle]}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  track: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.08)',
  },
  glassTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#1b76ea',
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
})
