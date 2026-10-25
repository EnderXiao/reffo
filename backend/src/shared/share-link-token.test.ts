import { describe, expect, test } from 'bun:test'
import {
  createShareToken,
  hashShareToken,
  verifyShareToken,
} from '@/shared/share-link-token'

describe('share-link-token', () => {
  test('creates deterministic verifiable tokens per share id', () => {
    const first = createShareToken('share-1', 'secret')
    const second = createShareToken('share-1', 'secret')

    expect(first).toBe(second)
    expect(verifyShareToken(first, 'share-1', 'secret')).toBe(true)
    expect(verifyShareToken(first, 'share-2', 'secret')).toBe(false)
    expect(verifyShareToken(first, 'share-1', 'another-secret')).toBe(false)
  })

  test('hashes tokens without returning the token', () => {
    const token = createShareToken('share-1', 'secret')
    const hash = hashShareToken(token)

    expect(hash).toHaveLength(64)
    expect(hash).not.toContain(token)
    expect(hashShareToken(token)).toBe(hash)
  })
})
