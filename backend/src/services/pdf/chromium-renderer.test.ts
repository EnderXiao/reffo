import {describe, expect, test} from 'bun:test'
import type {Browser} from 'playwright'
import {ChromiumResumePdfRenderer} from './chromium-renderer'
import type {ResumePdfModel} from './resume-template'

const model: ResumePdfModel = {version: 'resume-pdf-model-v1', title: '示例', disposition: 'draft_only', blocks: []}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(complete => {resolve = complete})
  return {promise, resolve}
}

describe('PDF renderer deadlines', () => {
  test('a browser that starts after the deadline never receives a private context', async () => {
    const started = deferred<Browser>()
    let contexts = 0
    const renderer = new ChromiumResumePdfRenderer({timeoutMs: 5})
    Object.defineProperty(renderer, 'getBrowser', {value: () => started.promise})
    await expect(renderer.render(model)).rejects.toMatchObject({code: 'PDF_RENDER_UNAVAILABLE'})
    started.resolve({newContext: async () => {contexts++; throw new Error('must not create')}} as unknown as Browser)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(contexts).toBe(0)
  })

  test('a private context created after the deadline closes immediately', async () => {
    const created = deferred<Awaited<ReturnType<Browser['newContext']>>>()
    let closed = 0, routed = 0
    const renderer = new ChromiumResumePdfRenderer({timeoutMs: 5})
    Object.defineProperty(renderer, 'getBrowser', {value: async () => ({newContext: () => created.promise})})
    await expect(renderer.render(model)).rejects.toMatchObject({code: 'PDF_RENDER_UNAVAILABLE'})
    created.resolve({close: async () => {closed++}, route: async () => {routed++}} as unknown as Awaited<ReturnType<Browser['newContext']>>)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(closed).toBe(1)
    expect(routed).toBe(0)
  })
})
