import type {GlassBlurTint, GlassBlurType} from './types'

const BLUR_TYPE_TO_TINT: Record<GlassBlurType, GlassBlurTint> = {
  xlight: 'extraLight',
  light: 'light',
  dark: 'dark',
  extraDark: 'dark',
  regular: 'regular',
  prominent: 'prominent',
  chromeMaterial: 'systemChromeMaterial',
  material: 'systemMaterial',
  thickMaterial: 'systemThickMaterial',
  thinMaterial: 'systemThinMaterial',
  ultraThinMaterial: 'systemUltraThinMaterial',
  chromeMaterialDark: 'systemChromeMaterialDark',
  materialDark: 'systemMaterialDark',
  thickMaterialDark: 'systemThickMaterialDark',
  thinMaterialDark: 'systemThinMaterialDark',
  ultraThinMaterialDark: 'systemUltraThinMaterialDark',
  chromeMaterialLight: 'systemChromeMaterialLight',
  materialLight: 'systemMaterialLight',
  thickMaterialLight: 'systemThickMaterialLight',
  thinMaterialLight: 'systemThinMaterialLight',
  ultraThinMaterialLight: 'systemUltraThinMaterialLight',
}

const OVERLAY_COLORS: Record<GlassBlurType | GlassBlurTint, string> = {
  xlight: 'rgba(255,255,255,0.72)',
  light: 'rgba(255,255,255,0.22)',
  dark: 'rgba(18,20,28,0.34)',
  extraDark: 'rgba(12,14,20,0.42)',
  regular: 'rgba(255,255,255,0.14)',
  prominent: 'rgba(255,255,255,0.18)',
  chromeMaterial: 'rgba(255,255,255,0.14)',
  material: 'rgba(255,255,255,0.12)',
  thickMaterial: 'rgba(255,255,255,0.16)',
  thinMaterial: 'rgba(255,255,255,0.1)',
  ultraThinMaterial: 'rgba(255,255,255,0.08)',
  chromeMaterialDark: 'rgba(32,35,44,0.24)',
  materialDark: 'rgba(28,32,40,0.22)',
  thickMaterialDark: 'rgba(28,32,40,0.26)',
  thinMaterialDark: 'rgba(24,28,36,0.18)',
  ultraThinMaterialDark: 'rgba(20,24,32,0.16)',
  chromeMaterialLight: 'rgba(255,255,255,0.16)',
  materialLight: 'rgba(255,255,255,0.14)',
  thickMaterialLight: 'rgba(255,255,255,0.18)',
  thinMaterialLight: 'rgba(255,255,255,0.12)',
  ultraThinMaterialLight: 'rgba(255,255,255,0.1)',
  default: 'rgba(255,255,255,0.12)',
  extraLight: 'rgba(255,255,255,0.72)',
  systemChromeMaterial: 'rgba(255,255,255,0.14)',
  systemMaterial: 'rgba(255,255,255,0.12)',
  systemThickMaterial: 'rgba(255,255,255,0.16)',
  systemThinMaterial: 'rgba(255,255,255,0.1)',
  systemUltraThinMaterial: 'rgba(255,255,255,0.08)',
  systemChromeMaterialDark: 'rgba(32,35,44,0.24)',
  systemMaterialDark: 'rgba(28,32,40,0.22)',
  systemThickMaterialDark: 'rgba(28,32,40,0.26)',
  systemThinMaterialDark: 'rgba(24,28,36,0.18)',
  systemUltraThinMaterialDark: 'rgba(20,24,32,0.16)',
  systemChromeMaterialLight: 'rgba(255,255,255,0.16)',
  systemMaterialLight: 'rgba(255,255,255,0.14)',
  systemThickMaterialLight: 'rgba(255,255,255,0.18)',
  systemThinMaterialLight: 'rgba(255,255,255,0.12)',
  systemUltraThinMaterialLight: 'rgba(255,255,255,0.1)',
}

const FALLBACK_COLORS: Record<GlassBlurType | GlassBlurTint, string> = {
  xlight: 'rgba(255,255,255,0.82)',
  light: 'rgba(255,255,255,0.28)',
  dark: 'rgba(34,38,48,0.66)',
  extraDark: 'rgba(22,24,31,0.74)',
  regular: 'rgba(255,255,255,0.22)',
  prominent: 'rgba(255,255,255,0.26)',
  chromeMaterial: 'rgba(255,255,255,0.2)',
  material: 'rgba(255,255,255,0.18)',
  thickMaterial: 'rgba(255,255,255,0.24)',
  thinMaterial: 'rgba(255,255,255,0.16)',
  ultraThinMaterial: 'rgba(255,255,255,0.12)',
  chromeMaterialDark: 'rgba(42,46,57,0.72)',
  materialDark: 'rgba(38,42,52,0.68)',
  thickMaterialDark: 'rgba(38,42,52,0.74)',
  thinMaterialDark: 'rgba(34,38,48,0.62)',
  ultraThinMaterialDark: 'rgba(30,34,44,0.56)',
  chromeMaterialLight: 'rgba(255,255,255,0.24)',
  materialLight: 'rgba(255,255,255,0.22)',
  thickMaterialLight: 'rgba(255,255,255,0.28)',
  thinMaterialLight: 'rgba(255,255,255,0.18)',
  ultraThinMaterialLight: 'rgba(255,255,255,0.14)',
  default: 'rgba(255,255,255,0.18)',
  extraLight: 'rgba(255,255,255,0.82)',
  systemChromeMaterial: 'rgba(255,255,255,0.2)',
  systemMaterial: 'rgba(255,255,255,0.18)',
  systemThickMaterial: 'rgba(255,255,255,0.24)',
  systemThinMaterial: 'rgba(255,255,255,0.16)',
  systemUltraThinMaterial: 'rgba(255,255,255,0.12)',
  systemChromeMaterialDark: 'rgba(42,46,57,0.72)',
  systemMaterialDark: 'rgba(38,42,52,0.68)',
  systemThickMaterialDark: 'rgba(38,42,52,0.74)',
  systemThinMaterialDark: 'rgba(34,38,48,0.62)',
  systemUltraThinMaterialDark: 'rgba(30,34,44,0.56)',
  systemChromeMaterialLight: 'rgba(255,255,255,0.24)',
  systemMaterialLight: 'rgba(255,255,255,0.22)',
  systemThickMaterialLight: 'rgba(255,255,255,0.28)',
  systemThinMaterialLight: 'rgba(255,255,255,0.18)',
  systemUltraThinMaterialLight: 'rgba(255,255,255,0.14)',
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function resolveGlassTint(
  blurType?: GlassBlurType,
  tint?: GlassBlurTint,
): GlassBlurTint {
  if (tint) {
    return tint
  }

  if (blurType) {
    return BLUR_TYPE_TO_TINT[blurType]
  }

  return 'default'
}

export function resolveGlassBlurAmount(blurAmount?: number, intensity?: number) {
  const value = blurAmount ?? intensity ?? 50
  return clamp(Math.round(value), 0, 100)
}

export function resolveGlassBlurRadius(
  blurRadius?: number,
  blurAmount?: number,
  intensity?: number,
) {
  if (blurRadius != null) {
    return clamp(Math.round(blurRadius), 0, 40)
  }

  return clamp(Math.round(resolveGlassBlurAmount(blurAmount, intensity) * 0.8), 0, 40)
}

export function resolveGlassDownsampleFactor(
  downsampleFactor?: number,
  blurRadius?: number,
  blurAmount?: number,
  intensity?: number,
) {
  if (downsampleFactor != null) {
    return clamp(Math.round(downsampleFactor), 0, 25)
  }

  return resolveGlassBlurRadius(blurRadius, blurAmount, intensity)
}

export function resolveGlassOverlayColor(
  overlayColor?: string,
  blurType?: GlassBlurType,
  tint?: GlassBlurTint,
) {
  if (overlayColor) {
    return overlayColor
  }

  if (blurType && OVERLAY_COLORS[blurType]) {
    return OVERLAY_COLORS[blurType]
  }

  if (tint && OVERLAY_COLORS[tint]) {
    return OVERLAY_COLORS[tint]
  }

  return OVERLAY_COLORS.default
}

export function resolveGlassFallbackColor(
  fallbackColor?: string,
  reducedTransparencyFallbackColor?: string,
  blurType?: GlassBlurType,
  tint?: GlassBlurTint,
) {
  if (reducedTransparencyFallbackColor) {
    return reducedTransparencyFallbackColor
  }

  if (fallbackColor) {
    return fallbackColor
  }

  if (blurType && FALLBACK_COLORS[blurType]) {
    return FALLBACK_COLORS[blurType]
  }

  if (tint && FALLBACK_COLORS[tint]) {
    return FALLBACK_COLORS[tint]
  }

  return FALLBACK_COLORS.default
}
