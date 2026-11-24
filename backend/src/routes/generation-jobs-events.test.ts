import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {env} from '@/config/env'
import {generationJobRoutes} from '@/routes/generation-jobs'

// 不 mock 模块：bun test 同进程共享模块注册表，mock.module 会污染其它测试文件。
const originalAppEnv = env.APP_ENV
const originalAuthRequired = env.AUTH_REQUIRED

async function readFirstChunk(response: Response) {
  const reader = response.body!.getReader()
  const {value} = await reader.read()
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(value)
}

describe('GET /generation-jobs/events', () => {
  beforeEach(() => {
    env.APP_ENV = 'local'
    env.AUTH_REQUIRED = false
  })

  afterEach(() => {
    env.APP_ENV = originalAppEnv
    env.AUTH_REQUIRED = originalAuthRequired
  })

  test('建流后立即发送首帧，避免边缘代理首字节超时返回 502', async () => {
    const response = await generationJobRoutes.handle(new Request('http://localhost/api/v1/generation-jobs/events', {
      headers: {accept: 'text/event-stream'},
    }))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    // hop-by-hop 头会破坏代理转发，不能再出现在响应里
    expect(response.headers.get('connection')).toBeNull()

    const first = await readFirstChunk(response)
    expect(first).toBe(': connected\n\n')
  })
})
