import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { RequestAuthError, resolveRequestUser } from '@/auth/request-context'
import { env } from '@/config/env'

describe('resolveRequestUser', () => {
  const original = { APP_ENV: env.APP_ENV, AUTH_REQUIRED: env.AUTH_REQUIRED }
  beforeEach(() => {
    env.APP_ENV = 'local'
    env.AUTH_REQUIRED = false
  })
  afterEach(() => Object.assign(env, original))

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
    env.AUTH_REQUIRED = true
    await expect(resolveRequestUser({ authorization: 'Token abc' })).rejects.toMatchObject({
      code: 'INVALID_AUTHORIZATION_HEADER',
    } satisfies Partial<RequestAuthError>)
  })

  test('ignores a stale browser token in local no-login mode', async () => {
    await expect(resolveRequestUser({ authorization: 'Bearer stale-token' })).resolves.toEqual({
      userId: env.DEV_USER_ID,
      useServiceRole: true,
    })
  })

  test.each(['nonprod', 'prod'] as const)('never enables dev-user access in %s', async appEnv => {
    env.APP_ENV = appEnv
    await expect(resolveRequestUser({})).rejects.toMatchObject({code: 'AUTH_REQUIRED'})
  })

  test('requires login when explicitly enabled locally', async () => {
    env.AUTH_REQUIRED = true
    await expect(resolveRequestUser({})).rejects.toMatchObject({code: 'AUTH_REQUIRED'})
  })
})
