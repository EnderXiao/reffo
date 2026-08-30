const GLYPH_PATHS = [
  'M48 36C48 42.0751 43.0751 47 37 47C30.9249 47 26 42.0751 26 36C26 29.9249 30.9249 25 37 25C43.0751 25 48 29.9249 48 36Z',
  'M0 25V47H10C15.6 47 17.6667 40.6667 18 37.5V22C18 19.6 20 19.3333 21 19.5H29.5C34.7 19.5 37.3333 13.8333 38 11V0H26C22.8 0 20.6667 2 20 3C14.6667 8 3.6 18.4 2 20C0.4 21.6 0 24 0 25Z',
]

function hashSeed(seed: string) {
  return seed.split('').reduce((value, char) => ((value * 33) + char.charCodeAt(0)) >>> 0, 17)
}

function buildGeneratedAvatar(seed: string) {
  const hash = hashSeed(seed)
  const hue = hash % 360
  const accentHue = (hue + 34 + ((hash >> 8) % 28)) % 360
  const glyphColor = `hsl(${(hue + 180) % 360} 30% 98%)`
  const tilePositions = Array.from({length: 9}, (_, index) => {
    const column = index % 3
    const row = Math.floor(index / 3)
    const rotation = ((hash >> (index % 12)) % 28) - 14
    const scale = 0.72 + (((hash >> ((index + 3) % 16)) % 18) / 100)
    return `<g transform="translate(${column * 76 - 14} ${row * 76 - 12}) rotate(${rotation} 24 23.5) scale(${scale})" opacity="${0.24 + (index % 3) * 0.05}"><path d="${GLYPH_PATHS[0]}" fill="${glyphColor}"/><path d="${GLYPH_PATHS[1]}" fill="${glyphColor}"/></g>`
  }).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><defs><linearGradient id="g" x1="18" y1="12" x2="178" y2="184" gradientUnits="userSpaceOnUse"><stop stop-color="hsl(${hue} 78% 72%)"/><stop offset="1" stop-color="hsl(${accentHue} 72% 48%)"/></linearGradient><linearGradient id="w" x1="0" y1="0" x2="192" y2="192"><stop stop-color="rgba(255,255,255,.22)"/><stop offset=".62" stop-color="rgba(255,255,255,0)"/></linearGradient></defs><rect width="192" height="192" rx="48" fill="url(#g)"/><g>${tilePositions}</g><rect width="192" height="192" rx="48" fill="url(#w)"/><circle cx="150" cy="38" r="10" fill="rgba(255,255,255,.3)"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function resolveUserAvatar(seed: string, avatarUrl?: string | null) {
  // Generated server avatars are data URLs. Rebuild them with card texture so
  // existing accounts also receive the current deterministic visual treatment.
  if (avatarUrl && !avatarUrl.startsWith('data:image/svg+xml')) {
    return avatarUrl
  }

  return buildGeneratedAvatar(seed)
}
