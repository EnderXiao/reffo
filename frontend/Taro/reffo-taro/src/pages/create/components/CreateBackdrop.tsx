import {StyleSheet, View} from 'react-native'
import SvgIcon, {Defs, Ellipse, LinearGradient, Rect, Stop} from 'react-native-svg'
import {styles} from '../styles'

interface CreateBackdropProps {
  variant?: 'cool' | 'warm'
}

export default function CreateBackdrop({
  variant = 'cool',
}: CreateBackdropProps) {
  const gradientId =
    variant === 'warm' ? 'create-page-gradient-warm' : 'create-page-gradient-cool'
  const haloId =
    variant === 'warm' ? 'create-page-halo-warm' : 'create-page-halo-cool'
  const topWashId =
    variant === 'warm' ? 'create-page-topwash-warm' : 'create-page-topwash-cool'
  const gradientStops =
    variant === 'warm'
      ? ['#f8ddd6', '#fff2eb', '#fffaf6']
      : ['#dce9f9', '#eef4fb', '#ffffff']

  return (
    <View pointerEvents='none' style={styles.backdrop}>
      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1='50%' y1='0%' x2='50%' y2='100%'>
            <Stop offset='0%' stopColor={gradientStops[0]} />
            <Stop offset={variant === 'warm' ? '44%' : '42%'} stopColor={gradientStops[1]} />
            <Stop offset='100%' stopColor={gradientStops[2]} />
          </LinearGradient>
          <LinearGradient id={haloId} x1='0%' y1='0%' x2='100%' y2='100%'>
            <Stop offset='0%' stopColor='#ffffff' stopOpacity={0.78} />
            <Stop offset='100%' stopColor='#ffffff' stopOpacity={0} />
          </LinearGradient>
          <LinearGradient id={topWashId} x1='50%' y1='0%' x2='50%' y2='100%'>
            <Stop offset='0%' stopColor={variant === 'warm' ? '#f7d7d0' : '#dce9f9'} stopOpacity={0.78} />
            <Stop offset='100%' stopColor='#ffffff' stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='100%' fill={`url(#${gradientId})`} />
        <Rect x='0' y='0' width='100%' height='22%' fill={`url(#${topWashId})`} />
        <Ellipse cx='82%' cy='6%' rx='96' ry='96' fill={`url(#${haloId})`} />
        {variant === 'warm' ? (
          <>
            <Ellipse cx='18%' cy='10%' rx='180' ry='132' fill='#f5c6b0' fillOpacity={0.26} />
            <Ellipse cx='22%' cy='44%' rx='164' ry='216' fill='#f5c4a6' fillOpacity={0.16} />
            <Ellipse cx='70%' cy='44%' rx='148' ry='200' fill='#ffffff' fillOpacity={0.12} />
          </>
        ) : (
          <Ellipse cx='18%' cy='10%' rx='180' ry='132' fill='#c5d7f6' fillOpacity={0.2} />
        )}
      </SvgIcon>
    </View>
  )
}
