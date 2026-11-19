import { AsyncLocalStorage } from 'node:async_hooks'

interface RequestTraceContext {
  traceId: string
}

/**
 * 请求级 trace 上下文：在 Bun.serve 的 fetch 外层用 run 包裹整个请求处理，
 * 让路由 handler、service、logger 都能通过 getTraceId() 拿到当前请求的 traceId，
 * 无需逐层传参。
 */
export const requestTraceStorage = new AsyncLocalStorage<RequestTraceContext>()

export function getTraceId(): string | undefined {
  return requestTraceStorage.getStore()?.traceId
}
