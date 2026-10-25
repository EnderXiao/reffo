import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const SHARE_TOKEN_VERSION = 'v1'

export function createShareToken(shareId: string, secret: string) {
  const signature = createHmac('sha256', secret)
    .update(`${SHARE_TOKEN_VERSION}.${shareId}`)
    .digest('base64url')

  return `${SHARE_TOKEN_VERSION}.${shareId}.${signature}`
}

export function hashShareToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function verifyShareToken(token: string, shareId: string, secret: string) {
  const expected = Buffer.from(createShareToken(shareId, secret))
  const actual = Buffer.from(token)

  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
