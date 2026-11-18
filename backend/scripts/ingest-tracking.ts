// 批量录入埋点需求：POST（pending）。标记 implemented 用 ingest-mark.ts
const path = process.argv[2]
if (!path) { console.error('用法: bun ingest-tracking.ts <清单.json>'); process.exit(1) }
const fs = await import('node:fs')
const list = JSON.parse(fs.readFileSync(path, 'utf8'))
const BASE = process.env.TRACKING_API_BASE || 'http://localhost:3000/api/v1/dashboard/tracking'
let ok = 0, dup = 0, fail = 0
for (const item of list) {
  try {
    const created = await fetch(BASE + '/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventName: item.eventName, params: item.params ?? [], page: item.page, description: item.description }),
    }).then(r => r.json())
    const req = created?.data?.requirement
    if (!req?.id) {
      if (JSON.stringify(created).includes('duplicate') || JSON.stringify(created).includes('UNIQUE')) { dup++; console.log('重复跳过:', item.eventName) }
      else { fail++; console.log('失败:', item.eventName, JSON.stringify(created).slice(0, 150)) }
      continue
    }
    ok++; console.log('已录入:', item.eventName)
  } catch (e) { fail++; console.log('异常:', item.eventName, String(e).slice(0, 100)) }
}
console.log('录入完成: 成功', ok, '| 重复', dup, '| 失败', fail)