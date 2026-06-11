import {StyleSheet, requireNativeComponent} from 'react-native'
import type {ColorValue, ViewProps} from 'react-native'

interface AndroidNativeBlurViewProps extends ViewProps {
  blurRadius?: number
  overlayColor?: ColorValue
  enabled?: boolean
  autoUpdate?: boolean
}

const NativeGlassAndroidBlurView =
  requireNativeComponent<AndroidNativeBlurViewProps>('GlassAndroidBlurView')

export default function AndroidNativeBlurView({
  style,
  blurRadius = 12,
  overlayColor = 'transparent',
  enabled = true,
  autoUpdate = true,
  ...rest
}: AndroidNativeBlurViewProps) {
  return (
    <NativeGlassAndroidBlurView
      {...rest}
      blurRadius={blurRadius}
      overlayColor={overlayColor}
      enabled={enabled}
      autoUpdate={autoUpdate}
      pointerEvents='none'
      style={[StyleSheet.absoluteFillObject, style]}
    />
  )
}
