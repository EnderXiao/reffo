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

const PRIVATE_KEY = /password|secret|token|authorization|cookie|email|phone|mobile/i
function safeProperties(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[TRUNCATED]'
  if (typeof value === 'string') return value.slice(0, 1000)
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sb_secret_|sb_publishable_|sk-)[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
    .replace(/([?&](?:token|shareToken|access_token)=)[^&\s]+/gi, '$1[REDACTED]')
  if (Array.isArray(value)) return value.slice(0, 20).map(v => safeProperties(v, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([key, child]) => [key, PRIVATE_KEY.test(key) ? '[REDACTED]' : safeProperties(child, depth + 1)]))
  return value
}

/** 页面关闭/切到后台时交付未满批次，返回卸载函数以免重复注册。 */
export function initializeAnalyticsLifecycle(): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const onVisibility = () => { if (document.visibilityState === 'hidden') flush() }
  const onPageHide = () => flush()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)
  return () => {
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}

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
    properties: safeProperties(properties ?? {}) as Record<string, unknown>,
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
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  if (buffer.length === 0) return
  const batch = buffer.splice(0, buffer.length)
  if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return
  // Blob 带 application/json，后端才能正确解析；sendBeacon 发字符串会是 text/plain。
  const body = new Blob([JSON.stringify(batch)], { type: 'application/json' })
  const url = `${apiClient.getBaseURL()}/telemetry`
  // 失败静默丢弃，不重试、不阻塞。
  try { navigator.sendBeacon(url, body) } catch { /* 非关键埋点失败不影响业务，不重试。 */ }
}
