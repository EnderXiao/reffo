import {createSupabaseRestClient} from './supabase/client'

// 后台查询独立短超时，不能长时间占用业务服务的连接。
export function dashboardClient() {
  const client = createSupabaseRestClient({useServiceRole: true})
  return {
    request<T>(path: string, options: Parameters<typeof client.request>[1] = {}) {
      return client.request<T>(path, {...options, timeoutMs: 5000, maxResponseBytes: 1_048_576})
    },
  }
}
