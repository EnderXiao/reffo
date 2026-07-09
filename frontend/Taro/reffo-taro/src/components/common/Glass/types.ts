import type {PropsWithChildren} from 'react'
import type {StyleProp, ViewStyle} from 'react-native'
import type {GlassBlurType} from '../GlassBlurView/types'

export type GlassSurfacePresetName =
  | 'darkCardPanel'
  | 'lightCardPanel'
  | 'floatingPill'

export interface GlassLayerProps {
  style?: StyleProp<ViewStyle>
  borderRadius?: number
}

export interface GlassTintLayerProps extends GlassLayerProps {
  color?: string
  opacity?: number
}

export interface GlassGradientLayerProps extends GlassLayerProps {
  opacity?: number
  fromColor?: string
  middleColor?: string
  toColor?: string
}

export interface GlassSurfaceVisualProps {
  borderRadius?: number
  blurType?: GlassBlurType
  blurAmount?: number
  overlayColor?: string
  fallbackColor?: string
  reducedTransparencyFallbackColor?: string
  borderColor?: string
  borderWidth?: number
  tintColor?: string
  tintOpacity?: number
  topHighlightColor?: string
  topHighlightOpacity?: number
  topHighlightHeight?: number
  specularOpacity?: number
  specularFromColor?: string
  specularMiddleColor?: string
  specularToColor?: string
  depthOpacity?: number
  depthFromColor?: string
  depthToColor?: string
  androidBlurEnabled?: boolean
  enabled?: boolean
}

export interface GlassSurfaceProps extends PropsWithChildren, GlassSurfaceVisualProps {
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  preset?: GlassSurfacePresetName
}
