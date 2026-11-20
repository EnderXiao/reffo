import {describe, expect, mock, test} from 'bun:test'

mock.module('@/services/generation-jobs', () => ({generationJobWorker: {start(){}, tick(){}}}))
mock.module('@/repositories/generation-job-repository', () => ({generationJobRepository: {list: async () => [], get: async () => null, create: async () => null, patch: async () => null}}))

const {generationJobRoutes} = await import('@/routes/generation-jobs')

async function readFirstChunk(response: Response) {
  const reader = response.body!.getReader()
  const {value} = await reader.read()
  await reader.cancel().catch(() => {})
  return new TextDecoder().decode(value)
}

describe('GET /generation-jobs/events', () => {
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
