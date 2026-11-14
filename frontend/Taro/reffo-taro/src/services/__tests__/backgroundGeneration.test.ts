import {ReadableStream} from 'node:stream/web'
import {TextDecoder, TextEncoder} from 'node:util'
import {generationTasksApi, subscribeGenerationTaskEvents} from '../backgroundGeneration'
import type {GenerationTask} from '../backgroundGeneration'
import {apiClient} from '../api'

function createTask(): GenerationTask {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    status: 'running',
    stage: 'matching',
    background: true,
    read_at: null,
    confirmed_at: null,
    history_id: null,
    company: 'Reffo',
    position: '产品经理',
    location: '上海',
    score: null,
    error: null,
    created_at: '2026-10-14T00:00:00.000Z',
    updated_at: '2026-10-14T00:00:01.000Z',
  }
}

test('创建任务携带 OCR 关联标识和新版简历契约能力', async () => {
  const input = {
    request_id: '11111111-1111-4111-8111-111111111111',
    resume_markdown: '# 候选人',
    jd_text: '负责 AI 产品规划',
    jd_parse_id: '22222222-2222-4222-8222-222222222222',
    resume_parse_id: '33333333-3333-4333-8333-333333333333',
    company: '目标公司', position: '产品经理', location: '上海',
  }
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(createTask())
  try {
    await generationTasksApi.create(input)
    expect(post).toHaveBeenCalledWith('/generation-jobs/', input, {
      header: {'X-Reffo-Completion-Schema': 'resume-completion-v4'},
    })
    expect(Object.keys(post.mock.calls[0][1] as object)).not.toContain('rawText')
  } finally {
    post.mockRestore()
  }
})

test('重试继续声明v4能力，普通任务动作沿用现有请求', async () => {
  const post = jest.spyOn(apiClient, 'post').mockResolvedValue(createTask())
  try {
    await generationTasksApi.action('job-v4', 'retry')
    expect(post).toHaveBeenNthCalledWith(1, '/generation-jobs/job-v4/retry', {}, {header: {'X-Reffo-Completion-Schema': 'resume-completion-v4'}})
    await generationTasksApi.action('job-v4', 'read')
    expect(post).toHaveBeenNthCalledWith(2, '/generation-jobs/job-v4/read', {})
  } finally { post.mockRestore() }
})

describe('subscribeGenerationTaskEvents', () => {
  test('解析 SSE 心跳和任务更新事件', async () => {
    Object.assign(globalThis, {ReadableStream, TextDecoder, TextEncoder})
    const task = createTask()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${[
          ': ping',
          '',
          `id: ${task.id}:${task.updated_at}`,
          'event: job.updated',
          `data: ${JSON.stringify(task)}`,
          '',
        ].join('\n')}\n`))
        controller.close()
      },
    })
    const originalFetch = globalThis.fetch
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      body: stream,
    })) as unknown as typeof fetch
    const onTask = jest.fn()
    const onOpen = jest.fn()
    const onActivity = jest.fn()
    const onError = jest.fn()
    const onClose = jest.fn()

    subscribeGenerationTaskEvents({onTask, onOpen, onActivity, onError, onClose})
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onActivity).toHaveBeenCalled()
    expect(onTask).toHaveBeenCalledWith(task)
    expect(onClose).toHaveBeenCalledTimes(1)
    globalThis.fetch = originalFetch
  })

  test('连接关闭后按退避时间自动重连', async () => {
    jest.useFakeTimers()
    Object.assign(globalThis, {ReadableStream, TextDecoder, TextEncoder})
    const originalFetch = globalThis.fetch
    const createResponse = () => ({
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.close()
        },
      }),
    })
    globalThis.fetch = jest.fn()
      .mockResolvedValueOnce(createResponse())
      .mockResolvedValueOnce(createResponse()) as unknown as typeof fetch
    const onOpen = jest.fn()
    const onClose = jest.fn()

    const unsubscribe = subscribeGenerationTaskEvents({onTask: jest.fn(), onOpen, onClose})
    await jest.advanceTimersByTimeAsync(0)

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    await jest.advanceTimersByTimeAsync(2000)

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
    expect(onOpen).toHaveBeenCalledTimes(2)
    unsubscribe()
    globalThis.fetch = originalFetch
    jest.useRealTimers()
  })
})
