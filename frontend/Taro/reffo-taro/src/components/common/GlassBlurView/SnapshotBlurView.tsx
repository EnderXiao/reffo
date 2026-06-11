import {View} from 'react-native'
import type {ViewProps} from 'react-native'

export interface SnapshotBlurViewProps extends ViewProps {
  blurRadius?: number
  downsampleFactor?: number
  enabled?: boolean
  refreshToken?: string
}

export default function SnapshotBlurView({
  style,
  ...rest
}: SnapshotBlurViewProps) {
  return <View {...rest} pointerEvents='none' style={style} />
}
