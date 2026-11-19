// 批量标记已实现：查列表按 event_name 找 id → PATCH implemented。
// implemented 仅表示代码已实现，不表示生产上线。
import { readFileSync } from 'node:fs'
import { DashboardApiClient, readDashboardConfig } from '../src/mcp/server.ts'

const path = process.argv[2]
if (!path) { console.error('用法: bun ingest-mark.ts <清单.json>'); process.exit(1) }

let list: unknown
try { list = JSON.parse(readFileSync(path, 'utf8')) } catch { console.error('清单 JSON 无效'); process.exit(1) }
if (!Array.isArray(list)) { console.error('清单必须是 JSON 数组'); process.exit(1) }

const api = new DashboardApiClient(readDashboardConfig())
let ok = 0, miss = 0, fail = 0
for (const raw of list) {
  const item = raw as { eventName?: unknown }
  const eventName = typeof item.eventName === 'string' ? item.eventName.trim() : ''
  if (!eventName) { fail++; console.log('失败: 清单项无效'); continue }
  try {
    const result = await api.request<{ requirements: Array<{ id: string; event_name?: string }> }>('/tracking/requirements', { query: { eventName, limit: 1, offset: 0 } })
    const req = result.requirements?.[0]
    if (!req) { miss++; console.log('未找到:', eventName); continue }
    await api.request('/tracking/requirements/' + encodeURIComponent(req.id), { method: 'PATCH', body: { status: 'implemented' } })
    ok++
    console.log('已标记:', eventName)
  } catch {
    fail++
    console.log('失败:', eventName)
  }
}
console.log('标记完成: 成功', ok, '| 未找到', miss, '| 失败', fail)
if (fail > 0 || miss > 0) process.exitCode = 1
