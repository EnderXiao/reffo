import {requireNativeComponent} from 'react-native'
import type {ViewProps} from 'react-native'

export interface SnapshotBlurViewProps extends ViewProps {
  blurRadius?: number
  downsampleFactor?: number
  enabled?: boolean
  refreshToken?: string
}

const NativeGlassSnapshotBlurView =
  requireNativeComponent<SnapshotBlurViewProps>('GlassSnapshotBlurView')

export default function SnapshotBlurView({
  style,
  blurRadius = 24,
  downsampleFactor = 1,
  enabled = true,
  refreshToken,
  ...rest
}: SnapshotBlurViewProps) {
  return (
    <NativeGlassSnapshotBlurView
      {...rest}
      blurRadius={blurRadius}
      downsampleFactor={downsampleFactor}
      enabled={enabled}
      refreshToken={refreshToken}
      pointerEvents='none'
      style={style}
    />
  )
}
