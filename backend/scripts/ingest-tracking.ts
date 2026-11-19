// 批量录入埋点需求：POST（pending）。标记 implemented 用 ingest-mark.ts。implemented 仅表示代码已实现，不表示生产上线。
import { readFileSync } from 'node:fs'
import { DashboardApiClient, readDashboardConfig } from '../src/mcp/server.ts'

const path = process.argv[2]
if (!path) { console.error('用法: bun ingest-tracking.ts <清单.json>'); process.exit(1) }

let list: unknown
try { list = JSON.parse(readFileSync(path, 'utf8')) } catch { console.error('清单 JSON 无效'); process.exit(1) }
if (!Array.isArray(list)) { console.error('清单必须是 JSON 数组'); process.exit(1) }

const api = new DashboardApiClient(readDashboardConfig())
let ok = 0, dup = 0, fail = 0
for (const raw of list) {
  const item = raw as { eventName?: unknown; params?: unknown; page?: unknown; description?: unknown }
  const eventName = typeof item.eventName === 'string' ? item.eventName.trim() : ''
  if (!eventName || typeof item.page !== 'string' || typeof item.description !== 'string' || (item.params !== undefined && (!Array.isArray(item.params) || item.params.some((v) => typeof v !== 'string')))) {
    fail++
    console.log('失败: 清单项无效')
    continue
  }
  try {
    await api.request('/tracking/requirements', { method: 'POST', body: { eventName, params: item.params ?? [], page: item.page, description: item.description } })
    ok++
    console.log('已录入:', eventName)
  } catch (error) {
    if (error instanceof Error && 'status' in error && (error as { status?: number }).status === 409) {
      dup++
      console.log('重复跳过:', eventName)
    } else {
      fail++
      console.log('失败:', eventName)
    }
  }
}
console.log('录入完成: 成功', ok, '| 重复', dup, '| 失败', fail)
if (fail > 0) process.exitCode = 1
