import {StyleSheet, View} from 'react-native'
import {
  resolveGlassFallbackColor,
  resolveGlassOverlayColor,
  resolveGlassTint,
} from './config'
import type {GlassBlurViewProps} from './types'

export default function GlassBlurView({
  style,
  contentStyle,
  overlayStyle,
  fallbackStyle,
  borderRadius,
  blurType,
  tint,
  overlayColor,
  fallbackColor,
  reducedTransparencyFallbackColor,
  enabled = true,
  children,
}: GlassBlurViewProps) {
  const resolvedTint = resolveGlassTint(blurType, tint)
  const resolvedOverlayColor = resolveGlassOverlayColor(overlayColor, blurType, resolvedTint)
  const resolvedFallbackColor = resolveGlassFallbackColor(
    fallbackColor,
    reducedTransparencyFallbackColor,
    blurType,
    resolvedTint,
  )

  return (
    <View
      style={[
        styles.container,
        borderRadius != null ? {borderRadius} : null,
        enabled ? {backgroundColor: resolvedFallbackColor} : null,
        fallbackStyle,
        style,
      ]}
    >
      <View
        pointerEvents='none'
        style={[
          StyleSheet.absoluteFillObject,
          enabled ? {backgroundColor: resolvedOverlayColor} : null,
          overlayStyle,
        ]}
      />
      {children ? <View style={[styles.content, contentStyle]}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  content: {
    ...StyleSheet.absoluteFillObject,
  },
})
