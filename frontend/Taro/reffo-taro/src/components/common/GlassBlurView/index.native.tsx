import {BlurView} from 'expo-blur'
import {Platform, StyleSheet, View} from 'react-native'
import AndroidNativeBlurView from './AndroidNativeBlurView'
import {
  resolveGlassBlurAmount,
  resolveGlassBlurRadius,
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
  blurAmount,
  blurType,
  intensity = 50,
  blurReductionFactor = 4,
  tint,
  overlayColor,
  fallbackColor,
  reducedTransparencyFallbackColor,
  blurRadius,
  androidBlurEnabled = true,
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
  const resolvedIntensity = resolveGlassBlurAmount(blurAmount, intensity)
  const resolvedBlurRadius = resolveGlassBlurRadius(blurRadius, blurAmount, intensity)
  const shouldUseAndroidNativeBlur =
    enabled &&
    resolvedBlurRadius > 0 &&
    Platform.OS === 'android' &&
    androidBlurEnabled
  const shouldUseNativeBlur =
    enabled &&
    resolvedIntensity > 0 &&
    Platform.OS !== 'android' &&
    androidBlurEnabled

  if (shouldUseAndroidNativeBlur) {
    return (
      <View
        style={[
          styles.container,
          borderRadius != null ? {borderRadius} : null,
          style,
        ]}
      >
        <AndroidNativeBlurView
          style={StyleSheet.absoluteFill}
          blurRadius={resolvedBlurRadius}
          overlayColor={resolvedOverlayColor}
          enabled={enabled}
        />
        {children ? <View style={[styles.content, contentStyle]}>{children}</View> : null}
      </View>
    )
  }

  if (!shouldUseNativeBlur) {
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

  return (
    <View
      style={[
        styles.container,
        borderRadius != null ? {borderRadius} : null,
        style,
      ]}
      >
      <BlurView
        tint={resolvedTint}
        intensity={Math.max(1, resolvedIntensity)}
        blurReductionFactor={blurReductionFactor}
        experimentalBlurMethod='none'
        style={StyleSheet.absoluteFill}
      />
      <View
        pointerEvents='none'
        style={[
          StyleSheet.absoluteFillObject,
          {backgroundColor: resolvedOverlayColor},
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
