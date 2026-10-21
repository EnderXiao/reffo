import {expect, test} from 'bun:test'
import {env} from '@/config/env'
import {generationJobRoutes} from '@/routes/generation-jobs'

test('生成任务接口未登录时返回 401', async () => {
  const previousAppEnv = env.APP_ENV
  const previousAuthRequired = env.AUTH_REQUIRED
  env.APP_ENV = 'nonprod'
  env.AUTH_REQUIRED = true
  try {
    const response = await generationJobRoutes.handle(new Request('http://localhost/api/v1/generation-jobs/'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: {code: 'AUTH_REQUIRED'},
    })
  } finally {
    env.APP_ENV = previousAppEnv
    env.AUTH_REQUIRED = previousAuthRequired
  }
})
