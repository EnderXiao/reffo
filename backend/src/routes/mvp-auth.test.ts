import { describe, expect, test } from 'bun:test'
import { mvpRoutes } from '@/routes/mvp'

describe('mvpRoutes auth guard', () => {
  test('keeps health public', async () => {
    const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/health'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' })
  })

  test('rejects malformed authorization headers on protected routes', async () => {
    const response = await mvpRoutes.handle(new Request('http://localhost/api/v1/mvp/dashboard', {
      headers: { Authorization: 'Token invalid-token' },
    }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: { code: 'INVALID_AUTHORIZATION_HEADER' },
    })
  })
})
