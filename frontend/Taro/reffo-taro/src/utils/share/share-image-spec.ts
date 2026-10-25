import type {PublicShareLink} from '@/types/share'

export const SHARE_IMAGE_WIDTH = 1080
export const SHARE_IMAGE_HEIGHT = 2400
export const SHARE_LANDING_REVEAL_DELAY_MS = 2500

function sanitizeFilenamePart(value: string) {
  return value
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
}

export function buildShareImageFilename(share: PublicShareLink, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('')
  const label = share.card.kind === 'job'
    ? `${share.card.company}-${share.card.position}`
    : share.card.title

  return `Reffo-${sanitizeFilenamePart(label) || '分享'}-${date}.png`
}

export function wrapShareText(text: string, maxCharacters: number, maxLines: number) {
  const characters = Array.from(text.trim())
  const lines: string[] = []
  let current = ''

  for (const character of characters) {
    if (current.length >= maxCharacters) {
      lines.push(current)
      current = ''
      if (lines.length === maxLines) break
    }
    current += character
  }

  if (current && lines.length < maxLines) lines.push(current)
  if (lines.length === maxLines && characters.length > maxCharacters * maxLines) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxCharacters - 1))}…`
  }

  return lines
}
