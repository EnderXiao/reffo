// 批量标记已实现：查列表按 event_name 找 id → PATCH implemented
const path = process.argv[2]
if (!path) { console.error('用法: bun ingest-mark.ts <清单.json>'); process.exit(1) }
const fs = await import('node:fs')
const list = JSON.parse(fs.readFileSync(path, 'utf8'))
const BASE = process.env.TRACKING_API_BASE || 'http://localhost:3000/api/v1/dashboard/tracking'
const all = await fetch(BASE + '/requirements').then(r => r.json())
const byName = new Map((all?.data?.requirements ?? []).map((r: any) => [r.event_name, r]))
let ok = 0, miss = 0, fail = 0
for (const item of list) {
  const req = byName.get(item.eventName)
  if (!req) { miss++; console.log('未找到:', item.eventName); continue }
  try {
    await fetch(BASE + '/requirements/' + req.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'implemented' }) })
    ok++; console.log('已标记:', item.eventName)
  } catch (e) { fail++; console.log('异常:', item.eventName, String(e).slice(0, 80)) }
}
console.log('标记完成: 成功', ok, '| 未找到', miss, '| 失败', fail)