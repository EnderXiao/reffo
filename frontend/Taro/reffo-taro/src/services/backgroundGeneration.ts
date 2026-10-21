import {apiClient} from './api'

export interface GenerationTask {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  stage: 'analysis' | 'matching' | 'optimized' | 'interview' | 'saving'
  background: boolean
  read_at: string | null
  confirmed_at: string | null
  history_id: string | null
  company: string
  position: string
  location: string
  score: number | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface GenerationTaskInput {
  request_id: string
  resume_markdown: string
  jd_text: string
  company: string
  position: string
  location: string
}

export interface GenerationTaskStreamHandlers {
  onTask: (task: GenerationTask) => void
  onOpen?: () => void
  onActivity?: () => void
  onError?: (error: unknown) => void
  onClose?: () => void
}

const GENERATION_STREAM_RECONNECT_DELAYS = [2000, 5000, 10000, 30000]

export function createGenerationRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
    const value = Math.floor(Math.random() * 16)
    return (character === 'x' ? value : (value & 3) | 8).toString(16)
  })
}

function parseGenerationTaskEvent(
  block: string,
  handlers: GenerationTaskStreamHandlers,
) {
  let eventName = 'message'
  const dataLines: string[] = []

  block.split('\n').forEach(line => {
    if (!line || line.startsWith(':')) {
      handlers.onActivity?.()
      return
    }

    const separatorIndex = line.indexOf(':')
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
    const value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1).replace(/^ /, '')

    if (field === 'event') {
      eventName = value
    } else if (field === 'data') {
      dataLines.push(value)
    }
  })

  if (eventName !== 'job.updated' || dataLines.length === 0) {
    return
  }

  try {
    const task = JSON.parse(dataLines.join('\n')) as GenerationTask
    if (task?.id) handlers.onTask(task)
  } catch (error) {
    handlers.onError?.(error)
  }
}

export function subscribeGenerationTaskEvents(
  handlers: GenerationTaskStreamHandlers,
): () => void {
  if (typeof fetch !== 'function' || typeof ReadableStream === 'undefined') {
    handlers.onError?.(new Error('当前运行环境不支持实时任务流'))
    handlers.onClose?.()
    return () => undefined
  }

  const controller = new AbortController()
  let stopped = false
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  const readStream = async () => {
    try {
      const token = apiClient.getAuthToken()
      const response = await fetch(`${apiClient.getBaseURL()}/generation-jobs/events`, {
        headers: {
          Accept: 'text/event-stream',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`实时任务流连接失败 (${response.status})`)
      }

      handlers.onOpen?.()
      reconnectAttempt = 0
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (!stopped) {
        const {done, value} = await reader.read()
        if (done) break
        handlers.onActivity?.()
        buffer += decoder.decode(value, {stream: true})
        const blocks = buffer.split(/\n\n/)
        buffer = blocks.pop() || ''
        blocks.forEach(block => parseGenerationTaskEvent(block, handlers))
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === 'AbortError')) {
        handlers.onError?.(error)
      }
    } finally {
      if (!stopped) {
        handlers.onClose?.()
        const delay = GENERATION_STREAM_RECONNECT_DELAYS[
          Math.min(reconnectAttempt, GENERATION_STREAM_RECONNECT_DELAYS.length - 1)
        ]
        reconnectAttempt += 1
        reconnectTimer = setTimeout(() => {
          reconnectTimer = undefined
          if (!stopped) void readStream()
        }, delay)
      }
    }
  }

  void readStream()
  return () => {
    stopped = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    controller.abort()
  }
}

export const generationTasksApi = {
  create: (input: GenerationTaskInput) => apiClient.post<GenerationTask>('/generation-jobs/', input),
  list: () => apiClient.get<GenerationTask[]>('/generation-jobs/'),
  get: (id: string) => apiClient.get<GenerationTask>(`/generation-jobs/${encodeURIComponent(id)}`),
  action: (id: string, action: 'background' | 'read' | 'confirm' | 'retry' | 'cancel') =>
    apiClient.post<GenerationTask>(`/generation-jobs/${encodeURIComponent(id)}/${action}`, {}),
}
