import type {PropsWithChildren} from 'react'
import type {StyleProp, ViewStyle} from 'react-native'

export type GlassBlurTint =
  | 'light'
  | 'dark'
  | 'default'
  | 'extraLight'
  | 'regular'
  | 'prominent'
  | 'systemUltraThinMaterial'
  | 'systemThinMaterial'
  | 'systemMaterial'
  | 'systemThickMaterial'
  | 'systemChromeMaterial'
  | 'systemUltraThinMaterialLight'
  | 'systemThinMaterialLight'
  | 'systemMaterialLight'
  | 'systemThickMaterialLight'
  | 'systemChromeMaterialLight'
  | 'systemUltraThinMaterialDark'
  | 'systemThinMaterialDark'
  | 'systemMaterialDark'
  | 'systemThickMaterialDark'
  | 'systemChromeMaterialDark'

export type GlassBlurType =
  | 'xlight'
  | 'light'
  | 'dark'
  | 'extraDark'
  | 'regular'
  | 'prominent'
  | 'chromeMaterial'
  | 'material'
  | 'thickMaterial'
  | 'thinMaterial'
  | 'ultraThinMaterial'
  | 'chromeMaterialDark'
  | 'materialDark'
  | 'thickMaterialDark'
  | 'thinMaterialDark'
  | 'ultraThinMaterialDark'
  | 'chromeMaterialLight'
  | 'materialLight'
  | 'thickMaterialLight'
  | 'thinMaterialLight'
  | 'ultraThinMaterialLight'

export interface GlassBlurViewProps extends PropsWithChildren {
  style?: StyleProp<ViewStyle>
  contentStyle?: StyleProp<ViewStyle>
  overlayStyle?: StyleProp<ViewStyle>
  fallbackStyle?: StyleProp<ViewStyle>
  borderRadius?: number
  blurAmount?: number
  blurType?: GlassBlurType
  blurRadius?: number
  downsampleFactor?: number
  intensity?: number
  blurReductionFactor?: number
  tint?: GlassBlurTint
  overlayColor?: string
  fallbackColor?: string
  reducedTransparencyFallbackColor?: string
  androidBlurEnabled?: boolean
  enabled?: boolean
}
