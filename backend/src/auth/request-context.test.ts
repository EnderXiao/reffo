import { describe, expect, test } from 'bun:test'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { env } from '@/config/env'

describe('resolveRequestUser', () => {
  test('uses dev user when auth is disabled and token is missing', async () => {
    const previousAuthRequired = env.AUTH_REQUIRED
    env.AUTH_REQUIRED = false

    try {
      const context = await resolveRequestUser({})

      expect(context.userId).toBe(env.DEV_USER_ID)
      expect(context.useServiceRole).toBe(true)
      expect(context.accessToken).toBeUndefined()
    } finally {
      env.AUTH_REQUIRED = previousAuthRequired
    }
  })

  test('rejects non Bearer authorization header', async () => {
    await expect(resolveRequestUser({ authorization: 'Token abc' })).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION_HEADER',
    } satisfies Partial<RequestAuthError>)
  })
})
