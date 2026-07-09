import {StyleSheet, View} from 'react-native'
import SvgIcon, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg'
import GlassBlurView from '../GlassBlurView'
import {resolveGlassSurfaceProps} from './presets'
import type {
  GlassGradientLayerProps,
  GlassSurfaceProps,
  GlassTintLayerProps,
} from './types'

export function GlassTintLayer({
  style,
  borderRadius,
  color = 'rgba(255,255,255,0.03)',
  opacity = 1,
}: GlassTintLayerProps) {
  return (
    <View
      pointerEvents='none'
      style={[
        StyleSheet.absoluteFillObject,
        borderRadius != null ? {borderRadius} : null,
        {backgroundColor: color, opacity},
        style,
      ]}
    />
  )
}

export function GlassSpecularOverlay({
  style,
  borderRadius,
  opacity = 1,
  fromColor = 'rgba(255,255,255,0.18)',
  middleColor = 'rgba(255,255,255,0.05)',
  toColor = 'rgba(0,0,0,0.12)',
}: GlassGradientLayerProps) {
  return (
    <SvgIcon
      width='100%'
      height='100%'
      pointerEvents='none'
      style={[StyleSheet.absoluteFillObject, borderRadius != null ? {borderRadius} : null, style]}
    >
      <Defs>
        <LinearGradient id='glass-specular-gradient' x1='0%' y1='0%' x2='100%' y2='100%'>
          <Stop offset='0%' stopColor={fromColor} stopOpacity={opacity} />
          <Stop offset='34%' stopColor={middleColor} stopOpacity={opacity} />
          <Stop offset='100%' stopColor={toColor} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      <Rect x='0' y='0' width='100%' height='100%' fill='url(#glass-specular-gradient)' />
    </SvgIcon>
  )
}

export function GlassDepthOverlay({
  style,
  borderRadius,
  opacity = 1,
  fromColor = 'rgba(255,255,255,0.04)',
  middleColor = 'rgba(255,255,255,0)',
  toColor = 'rgba(0,0,0,0.18)',
}: GlassGradientLayerProps) {
  return (
    <SvgIcon
      width='100%'
      height='100%'
      pointerEvents='none'
      style={[StyleSheet.absoluteFillObject, borderRadius != null ? {borderRadius} : null, style]}
    >
      <Defs>
        <LinearGradient id='glass-depth-gradient' x1='0%' y1='0%' x2='0%' y2='100%'>
          <Stop offset='0%' stopColor={fromColor} stopOpacity={opacity} />
          <Stop offset='36%' stopColor={middleColor} stopOpacity={opacity} />
          <Stop offset='100%' stopColor={toColor} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      <Rect x='0' y='0' width='100%' height='100%' fill='url(#glass-depth-gradient)' />
    </SvgIcon>
  )
}

export default function GlassSurface({
  style,
  contentStyle,
  preset,
  borderRadius,
  blurType,
  blurAmount,
  overlayColor,
  fallbackColor,
  reducedTransparencyFallbackColor,
  borderColor,
  borderWidth,
  tintColor,
  tintOpacity,
  topHighlightColor,
  topHighlightOpacity,
  topHighlightHeight,
  specularOpacity,
  specularFromColor,
  specularMiddleColor,
  specularToColor,
  depthOpacity,
  depthFromColor,
  depthToColor,
  androidBlurEnabled,
  enabled,
  children,
}: GlassSurfaceProps) {
  const resolvedSurface = resolveGlassSurfaceProps(preset, {
    borderRadius,
    blurType,
    blurAmount,
    overlayColor,
    fallbackColor,
    reducedTransparencyFallbackColor,
    borderColor,
    borderWidth,
    tintColor,
    tintOpacity,
    topHighlightColor,
    topHighlightOpacity,
    topHighlightHeight,
    specularOpacity,
    specularFromColor,
    specularMiddleColor,
    specularToColor,
    depthOpacity,
    depthFromColor,
    depthToColor,
    androidBlurEnabled,
    enabled,
  })
  const resolvedBorderWidth = resolvedSurface.borderWidth ?? 0

  return (
    <View
      style={[
        styles.container,
        resolvedSurface.borderRadius != null ? {borderRadius: resolvedSurface.borderRadius} : null,
        style,
      ]}
    >
      <GlassBlurView
        style={StyleSheet.absoluteFill}
        borderRadius={resolvedSurface.borderRadius}
        blurType={resolvedSurface.blurType}
        blurAmount={resolvedSurface.blurAmount}
        overlayColor={resolvedSurface.overlayColor}
        fallbackColor={resolvedSurface.fallbackColor}
        reducedTransparencyFallbackColor={resolvedSurface.reducedTransparencyFallbackColor}
        androidBlurEnabled={resolvedSurface.androidBlurEnabled}
        enabled={resolvedSurface.enabled}
      />

      {resolvedSurface.tintColor ? (
        <GlassTintLayer
          borderRadius={resolvedSurface.borderRadius}
          color={resolvedSurface.tintColor}
          opacity={resolvedSurface.tintOpacity}
        />
      ) : null}

      <GlassSpecularOverlay
        borderRadius={resolvedSurface.borderRadius}
        opacity={resolvedSurface.specularOpacity}
        fromColor={resolvedSurface.specularFromColor}
        middleColor={resolvedSurface.specularMiddleColor}
        toColor={resolvedSurface.specularToColor}
      />

      <GlassDepthOverlay
        borderRadius={resolvedSurface.borderRadius}
        opacity={resolvedSurface.depthOpacity}
        fromColor={resolvedSurface.depthFromColor}
        toColor={resolvedSurface.depthToColor}
      />

      <View
        pointerEvents='none'
        style={[
          styles.topHighlight,
          {
            height: resolvedSurface.topHighlightHeight,
            backgroundColor: resolvedSurface.topHighlightColor,
            opacity: resolvedSurface.topHighlightOpacity,
          },
        ]}
      />

      {resolvedBorderWidth > 0 ? (
        <View
          pointerEvents='none'
          style={[
            StyleSheet.absoluteFillObject,
            resolvedSurface.borderRadius != null ? {borderRadius: resolvedSurface.borderRadius} : null,
            {borderColor: resolvedSurface.borderColor, borderWidth: resolvedBorderWidth},
          ]}
        />
      ) : null}

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
  topHighlight: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
})

export type {
  GlassGradientLayerProps,
  GlassSurfacePresetName,
  GlassSurfaceProps,
  GlassSurfaceVisualProps,
  GlassTintLayerProps,
} from './types'
