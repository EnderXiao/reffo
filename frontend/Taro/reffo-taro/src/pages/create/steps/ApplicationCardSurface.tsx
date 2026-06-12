import {View} from '@tarojs/components'
import {StyleSheet} from 'react-native'
import SvgIcon, {Defs, Ellipse, LinearGradient, Rect, Stop} from 'react-native-svg'
import {styles} from './JobDescriptionStep.styles'

export default function ApplicationCardSurface({compact = false}: {compact?: boolean}) {
  const baseId = compact ? 'job-description-card-base-compact' : 'job-description-card-base'
  const sheenId = compact ? 'job-description-card-sheen-compact' : 'job-description-card-sheen'

  return (
    <View
      {...({pointerEvents: 'none'} as any)}
      style={[styles.cardSurface, compact ? styles.cardSurfaceCompact : null] as any}
    >
      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={baseId} x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor='#fffdfb' />
            <Stop offset='58%' stopColor='#fff8f2' />
            <Stop offset='100%' stopColor='#fff3e9' />
          </LinearGradient>
          <LinearGradient id={sheenId} x1='100%' y1='0%' x2='72%' y2='100%'>
            <Stop offset='0%' stopColor='#ffffff' stopOpacity={0.96} />
            <Stop offset='34%' stopColor='#ffffff' stopOpacity={0.52} />
            <Stop offset='100%' stopColor='#ffffff' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill={`url(#${baseId})`} />
        <Ellipse
          cx='84%'
          cy='44%'
          rx={compact ? 88 : 96}
          ry={compact ? 114 : 126}
          fill='#ffd7bf'
          fillOpacity={0.42}
        />
        <Ellipse
          cx='18%'
          cy='82%'
          rx={compact ? 64 : 74}
          ry={compact ? 78 : 92}
          fill='#ffe7d8'
          fillOpacity={0.72}
        />
        <Rect x='0' y='0' width='100%' height='100%' fill={`url(#${sheenId})`} />
      </SvgIcon>
    </View>
  )
}
