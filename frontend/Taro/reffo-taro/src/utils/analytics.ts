import { apiClient } from '@/services/api'
import { createTraceId } from './trace-id'

interface AnalyticsEvent {
  session_id: string
  trace_id: string | null
  event_name: string
  properties: Record<string, unknown>
  page: string | null
}

const FLUSH_INTERVAL_MS = 5000
const MAX_BATCH_SIZE = 10

let sessionId = createTraceId()
let buffer: AnalyticsEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** 设置当前会话 ID（登录成功或需要跨页面关联时调用）。 */
export function setAnalyticsSessionId(id: string): void {
  sessionId = id
}

/** 埋点：入队，攒批后由 sendBeacon 发送。埋点丢失不重试（非关键数据）。 */
export function track(eventName: string, properties?: Record<string, unknown>): void {
  buffer.push({
    session_id: sessionId,
    trace_id: null,
    event_name: eventName,
    properties: properties ?? {},
    page: null,
  })

  if (buffer.length >= MAX_BATCH_SIZE) {
    flush()
  } else {
    scheduleFlush()
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    flush()
  }, FLUSH_INTERVAL_MS)
}

function flush(): void {
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
  // Blob 带 application/json，后端才能正确解析；sendBeacon 发字符串会是 text/plain。
  const body = new Blob([JSON.stringify(batch)], { type: 'application/json' })
  const url = `${apiClient.getBaseURL()}/telemetry`
  // 失败静默丢弃，不重试、不阻塞。
  navigator.sendBeacon(url, body)
}
