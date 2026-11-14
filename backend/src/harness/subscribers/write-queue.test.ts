import { describe, expect, test } from 'bun:test'
import { enqueueHarnessWrite, resetHarnessWriteQueueForTests } from '@/harness/subscribers/write-queue'

describe('Harness write queue', () => {
  test('serializes writes for the same run', async () => {
    resetHarnessWriteQueueForTests()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = enqueueHarnessWrite(async () => {
      order.push('first:start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      order.push('first:end')
    }, 'run-a')
    const second = enqueueHarnessWrite(async () => {
      order.push('second')
    }, 'run-a')

    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  test('allows separate runs to write concurrently', async () => {
    resetHarnessWriteQueueForTests()
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    const first = enqueueHarnessWrite(async () => {
      order.push('run-a:start')
      await new Promise<void>((resolve) => { releaseFirst = resolve })
      order.push('run-a:end')
    }, 'run-a')
    const second = enqueueHarnessWrite(async () => {
      order.push('run-b')
    }, 'run-b')

    await Promise.resolve()
    expect(order).toEqual(['run-a:start', 'run-b'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(order).toEqual(['run-a:start', 'run-b', 'run-a:end'])
  })

  test('releases queue after failed write', async () => {
    resetHarnessWriteQueueForTests()
    await expect(enqueueHarnessWrite(async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
    await expect(enqueueHarnessWrite(async () => 'ok')).resolves.toBe('ok')
  })
})
