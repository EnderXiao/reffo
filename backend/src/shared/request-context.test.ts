import { describe, expect, test } from 'bun:test'
import { requestTraceStorage, getTraceId } from './request-context'

describe('requestTraceStorage', () => {
  test('run 内能通过 getTraceId 拿到当前请求的 traceId', () => {
    const seen: string[] = []
    requestTraceStorage.run({ traceId: 'trace-abc-123' }, () => {
      seen.push(getTraceId() ?? '')
    })
    expect(seen).toEqual(['trace-abc-123'])
  })

  test('run 内嵌套异步仍能拿到 traceId', async () => {
    const seen: string[] = []
    await requestTraceStorage.run({ traceId: 'trace-async-456' }, async () => {
      await Promise.resolve()
      seen.push(getTraceId() ?? '')
    })
    expect(seen).toEqual(['trace-async-456'])
  })

  test('run 外部 getTraceId 返回 undefined', () => {
    expect(getTraceId()).toBeUndefined()
  })
})
