import type {
  GlassSurfacePresetName,
  GlassSurfaceVisualProps,
} from './types'

const BASE_GLASS_SURFACE_PROPS: GlassSurfaceVisualProps = {
  blurType: 'materialDark',
  blurAmount: 18,
  borderColor: 'rgba(255,255,255,0.08)',
  borderWidth: 1,
  tintOpacity: 1,
  topHighlightColor: 'rgba(255,255,255,0.12)',
  topHighlightOpacity: 1,
  topHighlightHeight: 18,
  specularOpacity: 1,
  depthOpacity: 1,
  androidBlurEnabled: true,
  enabled: true,
}

const GLASS_SURFACE_PRESETS: Record<GlassSurfacePresetName, GlassSurfaceVisualProps> = {
  darkCardPanel: {
    blurType: 'thinMaterialDark',
    blurAmount: 0,
    overlayColor: 'rgba(0,0,0,0)',
    fallbackColor: 'rgba(0,0,0,0)',
    borderColor: 'rgba(255,255,255,0.08)',
    tintColor: 'rgba(255,255,255,0.05)',
    tintOpacity: 0.38,
    topHighlightColor: 'rgba(255,255,255,0.18)',
    topHighlightOpacity: 0.12,
    topHighlightHeight: 10,
    specularOpacity: 0.16,
    specularFromColor: 'rgba(255,255,255,0.08)',
    specularMiddleColor: 'rgba(255,255,255,0.02)',
    specularToColor: 'rgba(255,255,255,0)',
    depthOpacity: 0.12,
    depthFromColor: 'rgba(255,255,255,0.025)',
    depthToColor: 'rgba(0,0,0,0.06)',
    enabled: false,
  },
  lightCardPanel: {
    blurType: 'thinMaterialLight',
    blurAmount: 18,
    overlayColor: 'rgba(255,255,255,0.08)',
    fallbackColor: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.22)',
    tintColor: 'rgba(255,255,255,0.2)',
    tintOpacity: 1,
    topHighlightColor: 'rgba(255,255,255,0.42)',
    topHighlightOpacity: 0.52,
    topHighlightHeight: 18,
    specularOpacity: 0.44,
    specularFromColor: 'rgba(255,255,255,0.18)',
    specularMiddleColor: 'rgba(255,255,255,0.06)',
    specularToColor: 'rgba(255,255,255,0)',
    depthOpacity: 0.18,
    depthFromColor: 'rgba(255,255,255,0.12)',
    depthToColor: 'rgba(255,255,255,0)',
  },
  floatingPill: {
    blurType: 'thinMaterialLight',
    blurAmount: 20,
    overlayColor: 'rgba(255,255,255,0.12)',
    fallbackColor: 'rgba(255,255,255,0.24)',
    borderColor: 'rgba(255,255,255,0.24)',
    tintColor: 'rgba(255,255,255,0.16)',
    tintOpacity: 1,
    topHighlightColor: 'rgba(255,255,255,0.34)',
    topHighlightOpacity: 0.4,
    topHighlightHeight: 12,
    specularOpacity: 0.28,
    specularFromColor: 'rgba(255,255,255,0.14)',
    specularMiddleColor: 'rgba(255,255,255,0.04)',
    specularToColor: 'rgba(255,255,255,0)',
    depthOpacity: 0.14,
    depthFromColor: 'rgba(255,255,255,0.08)',
    depthToColor: 'rgba(255,255,255,0)',
  },
}

function assignDefined<T extends object>(target: T, source?: Partial<T>) {
  if (!source) {
    return target
  }

  for (const key of Object.keys(source) as Array<keyof T>) {
    const value = source[key]

    if (value !== undefined) {
      target[key] = value
    }
  }

  return target
}

export function resolveGlassSurfaceProps(
  preset?: GlassSurfacePresetName,
  overrides?: GlassSurfaceVisualProps,
): GlassSurfaceVisualProps {
  const resolved = {...BASE_GLASS_SURFACE_PROPS}

  assignDefined(resolved, preset ? GLASS_SURFACE_PRESETS[preset] : undefined)
  assignDefined(resolved, overrides)

  return resolved
}
