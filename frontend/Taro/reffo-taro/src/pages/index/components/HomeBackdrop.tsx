import {StyleSheet, View} from 'react-native'
import SvgIcon, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg'
import {styles} from '../styles'

export default function HomeBackdrop() {
  return (
    <View pointerEvents='none' style={styles.backdrop}>
      <SvgIcon width='100%' height='100%' style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id='home-top-gradient' x1='50%' y1='0%' x2='50%' y2='100%'>
            <Stop offset='0%' stopColor='#0d5ac6' stopOpacity={0.3} />
            <Stop offset='48.1%' stopColor='#b1caed' stopOpacity={0.3} />
            <Stop offset='100%' stopColor='#ffffff' stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        <Rect x='0' y='0' width='100%' height='180' fill='url(#home-top-gradient)' />
      </SvgIcon>
      <View style={styles.backdropTopHighlight} />
      <View style={styles.backdropOrbSecondary} />
      <View style={styles.backdropOrbTertiary} />
    </View>
  )
}
