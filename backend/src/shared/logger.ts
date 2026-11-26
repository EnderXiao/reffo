import { getTraceId } from './request-context'

function prefix(): string {
  const traceId = getTraceId()
  return traceId ? `[${traceId}]` : ''
}

/**
 * 统一日志：自动带当前请求的 traceId 前缀，替代散落的 console.*。
 * 后台任务（无请求上下文）调用时 traceId 为空，前缀为空。
 */
export const logger = {
  error(message: string, error?: unknown) {
    console.error(prefix(), message, error ?? '')
  },
  warn(message: string, data?: unknown) {
    console.warn(prefix(), message, data ?? '')
  },
  info(message: string, data?: unknown) {
    console.log(prefix(), message, data ?? '')
  },
}
