import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { env } from '@/config/env'
import { encryptPasswordPayloadForTest } from '@/auth/password-crypto'

const requests: Array<{path: string; options: unknown}> = []
let registeredResult = false

mock.module('@/repositories/supabase/client', () => ({
  createSupabaseRestClient: () => ({
    request: async (path: string, options: unknown) => {
      requests.push({ path, options })
      return registeredResult
    },
  }),
}))

const { authRoutes } = await import('@/routes/auth')

describe('authRoutes', () => {
  const originalSupabaseUrl = env.SUPABASE_URL
  const originalSecretKey = env.SUPABASE_SECRET_KEY
  const originalPublishableKey = env.SUPABASE_PUBLISHABLE_KEY
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    requests.length = 0
    registeredResult = false
    env.SUPABASE_URL = 'https://example.supabase.co'
    env.SUPABASE_SECRET_KEY = 'secret-test-key'
    env.SUPABASE_PUBLISHABLE_KEY = 'publishable-test-key'
  })

  afterEach(() => {
    env.SUPABASE_URL = originalSupabaseUrl
    env.SUPABASE_SECRET_KEY = originalSecretKey
    env.SUPABASE_PUBLISHABLE_KEY = originalPublishableKey
    globalThis.fetch = originalFetch
  })

  test('normalizes email and returns registration status', async () => {
    registeredResult = true
    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/email-status', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: '  User@Example.COM '}),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {registered: true},
    })
    expect(requests).toEqual([{
      path: '/rest/v1/rpc/is_auth_email_registered',
      options: {
        method: 'POST',
        body: {check_email: 'user@example.com'},
      },
    }])
  })

  test('returns 503 when Supabase auth is unavailable', async () => {
    env.SUPABASE_SECRET_KEY = ''
    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/email-status', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'user@example.com'}),
    }))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {code: 'AUTH_NOT_CONFIGURED'},
    })
    expect(requests).toHaveLength(0)
  })

  test('sends email login OTP without creating unknown users', async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.supabase.co/auth/v1/otp')
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        create_user: false,
      })
      return new Response('{}', {status: 200, headers: {'Content-Type': 'application/json'}})
    }) as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/email-otp/send', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: ' User@Example.COM '}),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        sent: true,
        otp_length: env.AUTH_OTP_LENGTH,
        resend_after_seconds: env.AUTH_OTP_RESEND_SECONDS,
      },
    })
  })

  test('verifies email login OTP and returns session', async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.supabase.co/auth/v1/verify')
      expect(JSON.parse(String(init?.body))).toEqual({
        type: 'email',
        email: 'user@example.com',
        token: '12345678',
      })
      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        user: {id: 'user-1', email: 'user@example.com'},
      }), {status: 200, headers: {'Content-Type': 'application/json'}})
    }) as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/email-otp/verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'User@Example.COM', token: '12345678'}),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {access_token: 'access-token', user: {id: 'user-1'}},
    })
  })

  test('proxies password login without exposing Supabase URL to browser client', async () => {
    const fetchMock = async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.supabase.co/auth/v1/token?grant_type=password')
      expect(init?.headers).toMatchObject({
        apikey: 'publishable-test-key',
        'Content-Type': 'application/json',
      })
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        password: 'secret-password',
      })

      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        user: {id: 'user-1', email: 'user@example.com'},
      }), {status: 200, headers: {'Content-Type': 'application/json'}})
    }
    globalThis.fetch = fetchMock as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/sign-in', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(encryptPasswordPayloadForTest({email: ' User@Example.COM ', password: 'secret-password'})),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {access_token: 'access-token', user: {id: 'user-1'}},
    })
  })

  test('does not return Supabase password errors as server failures', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: 'invalid_grant',
      error_description: 'Invalid login credentials',
    }), {status: 400})) as unknown as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/sign-in', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(encryptPasswordPayloadForTest({email: 'user@example.com', password: 'wrong-password'})),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: {code: 'AUTH_INVALID_CREDENTIALS', message: '邮箱或密码不正确'},
    })
  })

  test('decrypts password updates before forwarding to Supabase', async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.supabase.co/auth/v1/user')
      expect(init?.method).toBe('PATCH')
      expect(init?.headers).toMatchObject({Authorization: 'Bearer access-token'})
      expect(JSON.parse(String(init?.body))).toEqual({password: 'new-secret-password'})
      return new Response(JSON.stringify({id: 'user-1'}), {status: 200})
    }) as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/password-update', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(encryptPasswordPayloadForTest({
        access_token: 'access-token',
        password: 'new-secret-password',
      })),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {updated: true},
    })
  })

  test('verifies recovery OTP before password update', async () => {
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://example.supabase.co/auth/v1/verify')
      expect(JSON.parse(String(init?.body))).toEqual({
        type: 'recovery',
        email: 'user@example.com',
        token: '12345678',
      })
      return new Response(JSON.stringify({
        access_token: 'recovery-token',
        user: {id: 'user-1', email: 'user@example.com'},
      }), {status: 200, headers: {'Content-Type': 'application/json'}})
    }) as typeof fetch

    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/password-reset/verify', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'User@Example.COM', token: '12345678'}),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {access_token: 'recovery-token'},
    })
  })

  test('rejects plaintext password payloads', async () => {
    const response = await authRoutes.handle(new Request('http://localhost/api/v1/auth/sign-in', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({email: 'user@example.com', password: 'secret-password'}),
    }))

    expect(response.status).toBe(422)
  })
})
