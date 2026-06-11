export type CardTone = 'soft' | 'default' | 'dark'

export interface DerivedCardPalette {
  primaryColor: string
  surfaceColor: string
  stackColor: string
  logoColor: string
  borderColor: string
  tone: CardTone
}

interface RgbColor {
  red: number
  green: number
  blue: number
}

interface HslColor {
  hue: number
  saturation: number
  lightness: number
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function normalizeChannel(value: number) {
  return Math.round(clamp(value, 0, 255))
}

function toHex(value: number) {
  return normalizeChannel(value).toString(16).padStart(2, '0').toUpperCase()
}

export function normalizeHexColor(color?: string, fallback = '#2F7BEF') {
  const normalized = color?.trim().replace('#', '') ?? ''

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return `#${normalized.toUpperCase()}`
  }

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    return `#${normalized
      .split('')
      .map(char => `${char}${char}`)
      .join('')
      .toUpperCase()}`
  }

  return fallback
}

function hexToRgb(color: string): RgbColor {
  const normalized = normalizeHexColor(color).replace('#', '')

  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function rgbToHex({red, green, blue}: RgbColor) {
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

function rgbToHsl({red, green, blue}: RgbColor): HslColor {
  const normalizedRed = red / 255
  const normalizedGreen = green / 255
  const normalizedBlue = blue / 255
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue)
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue)
  const delta = max - min
  const lightness = (max + min) / 2

  if (delta === 0) {
    return {
      hue: 0,
      saturation: 0,
      lightness: lightness * 100,
    }
  }

  const saturation =
    lightness > 0.5
      ? delta / (2 - max - min)
      : delta / (max + min)

  let hue = 0

  if (max === normalizedRed) {
    hue = ((normalizedGreen - normalizedBlue) / delta) + (normalizedGreen < normalizedBlue ? 6 : 0)
  } else if (max === normalizedGreen) {
    hue = ((normalizedBlue - normalizedRed) / delta) + 2
  } else {
    hue = ((normalizedRed - normalizedGreen) / delta) + 4
  }

  return {
    hue: (hue * 60) % 360,
    saturation: saturation * 100,
    lightness: lightness * 100,
  }
}

function hueToChannel(temp1: number, temp2: number, hue: number) {
  let resolvedHue = hue

  if (resolvedHue < 0) {
    resolvedHue += 1
  }

  if (resolvedHue > 1) {
    resolvedHue -= 1
  }

  if ((6 * resolvedHue) < 1) {
    return temp1 + ((temp2 - temp1) * 6 * resolvedHue)
  }

  if ((2 * resolvedHue) < 1) {
    return temp2
  }

  if ((3 * resolvedHue) < 2) {
    return temp1 + ((temp2 - temp1) * ((2 / 3) - resolvedHue) * 6)
  }

  return temp1
}

function hslToRgb({hue, saturation, lightness}: HslColor): RgbColor {
  const normalizedHue = ((hue % 360) + 360) % 360 / 360
  const normalizedSaturation = clamp(saturation, 0, 100) / 100
  const normalizedLightness = clamp(lightness, 0, 100) / 100

  if (normalizedSaturation === 0) {
    const channel = normalizedLightness * 255
    return {
      red: channel,
      green: channel,
      blue: channel,
    }
  }

  const temp2 =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness + normalizedSaturation - (normalizedLightness * normalizedSaturation)
  const temp1 = (2 * normalizedLightness) - temp2

  return {
    red: hueToChannel(temp1, temp2, normalizedHue + (1 / 3)) * 255,
    green: hueToChannel(temp1, temp2, normalizedHue) * 255,
    blue: hueToChannel(temp1, temp2, normalizedHue - (1 / 3)) * 255,
  }
}

function hslToHex(color: HslColor) {
  return rgbToHex(hslToRgb(color))
}

function mixColors(left: string, right: string, weight: number) {
  const ratio = clamp(weight, 0, 1)
  const leftRgb = hexToRgb(left)
  const rightRgb = hexToRgb(right)

  return rgbToHex({
    red: (leftRgb.red * (1 - ratio)) + (rightRgb.red * ratio),
    green: (leftRgb.green * (1 - ratio)) + (rightRgb.green * ratio),
    blue: (leftRgb.blue * (1 - ratio)) + (rightRgb.blue * ratio),
  })
}

function getLuminance(color: string) {
  const {red, green, blue} = hexToRgb(color)
  return ((red * 299) + (green * 587) + (blue * 114)) / 1000 / 255
}

function shiftHsl(color: string, transform: Partial<HslColor>) {
  const resolved = rgbToHsl(hexToRgb(color))
  return hslToHex({
    hue: transform.hue ?? resolved.hue,
    saturation: transform.saturation ?? resolved.saturation,
    lightness: transform.lightness ?? resolved.lightness,
  })
}

function createReadableDarkAccent(color: string) {
  const hsl = rgbToHsl(hexToRgb(color))

  return hslToHex({
    hue: hsl.hue,
    saturation: clamp(Math.max(hsl.saturation, 52), 40, 92),
    lightness: clamp(Math.max(hsl.lightness, 68), 68, 84),
  })
}

export function hashSeed(seed: string) {
  return seed
    .split('')
    .reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, 17)
}

export function deriveSeedColorFromString(seed: string) {
  const hashed = hashSeed(seed)
  const darkTone = hashed % 5 === 0

  return hslToHex({
    hue: hashed % 360,
    saturation: darkTone ? 18 + ((hashed >> 8) % 18) : 68 + ((hashed >> 8) % 18),
    lightness: darkTone ? 16 + ((hashed >> 16) % 8) : 50 + ((hashed >> 16) % 8),
  })
}

export function deriveCardPalette(seedColor: string): DerivedCardPalette {
  const normalizedSeed = normalizeHexColor(seedColor)
  const hsl = rgbToHsl(hexToRgb(normalizedSeed))
  const luminance = getLuminance(normalizedSeed)
  const isDark = luminance < 0.34 || hsl.lightness < 34
  const isWarm = hsl.hue >= 14 && hsl.hue <= 56 && hsl.saturation >= 48
  const tone: CardTone = isDark ? 'dark' : isWarm ? 'soft' : 'default'

  if (tone === 'dark') {
    const surfaceColor = mixColors(normalizedSeed, '#010101', 0.975)
    const primaryColor = createReadableDarkAccent(normalizedSeed)

    return {
      primaryColor,
      surfaceColor,
      stackColor: mixColors(surfaceColor, '#000000', 0.62),
      logoColor: shiftHsl(normalizedSeed, {
        saturation: clamp(hsl.saturation * 0.3, 8, 36),
        lightness: clamp(hsl.lightness + 18, 28, 42),
      }),
      borderColor: 'rgba(255,255,255,0.08)',
      tone,
    }
  }

  const surfaceBase = mixColors(normalizedSeed, '#FFFFFF', tone === 'soft' ? 0.88 : 0.84)

  return {
    primaryColor: shiftHsl(normalizedSeed, {
      saturation: clamp(hsl.saturation + 8, 56, 94),
      lightness: clamp(hsl.lightness, 44, 56),
    }),
    surfaceColor: shiftHsl(surfaceBase, {
      saturation: clamp(rgbToHsl(hexToRgb(surfaceBase)).saturation * 0.72, 12, 34),
      lightness: tone === 'soft' ? 95.8 : 93.8,
    }),
    stackColor: mixColors(surfaceBase, normalizedSeed, tone === 'soft' ? 0.12 : 0.18),
    logoColor: shiftHsl(normalizedSeed, {
      saturation: clamp(hsl.saturation * 0.72, 28, 72),
      lightness: tone === 'soft' ? 86 : 80,
    }),
    borderColor: 'rgba(255,255,255,0.72)',
    tone,
  }
}

export function resolveCardInk(tone: CardTone, accentColor: string) {
  if (tone === 'dark') {
    return {
      grade: '#FFFFFF',
      gradeMeta: 'rgba(255,255,255,0.6)',
      company: 'rgba(255,255,255,0.98)',
      body: 'rgba(255,255,255,0.98)',
      label: 'rgba(255,255,255,0.58)',
      date: 'rgba(255,255,255,0.78)',
    }
  }

  return {
    grade: accentColor,
    gradeMeta: accentColor,
    company: accentColor,
    body: '#1F2937',
    label: 'rgba(31,41,55,0.4)',
    date: 'rgba(31,41,55,0.46)',
  }
}

export function resolveCardGrade(score: number) {
  if (score >= 88) {
    return 'A'
  }

  if (score >= 72) {
    return 'B'
  }

  return 'C'
}
