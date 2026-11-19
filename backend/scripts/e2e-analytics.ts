/**
 * 前端埋点端到端回归测试：真实浏览器 sendBeacon → 后端 /telemetry → 落库。
 * 前置：后端已用 SQLITE_DATABASE_PATH=E2E_SQLITE_PATH 启动（SQLite 数据源）。
 * 依赖：系统 Chrome（channel: 'chrome'），或先 npx playwright install chromium。
 */
import { chromium } from 'playwright'
import { Database } from 'bun:sqlite'

const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:3000'
const SQLITE_PATH = process.env.E2E_SQLITE_PATH || '/tmp/reffo-e2e.sqlite'

function countAnalytics(): number {
  const db = new Database(SQLITE_PATH, { readonly: true })
  const tableExists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='analytics_events'").get()
  if (!tableExists) {
    db.close()
    return 0
  }
  const row = db.query('SELECT COUNT(*) AS n FROM analytics_events').get() as { n: number }
  db.close()
  return row.n
}

const before = countAnalytics()

const browser = await chromium.launch({ headless: true, channel: 'chrome' })
const page = await browser.newPage()

page.on('request', req => {
  if (req.url().includes('/telemetry')) {
    const contentType = req.headers()['content-type']
    console.log('抓到的 sendBeacon 请求:', req.method(), req.url(), 'content-type=', contentType)
    if (contentType !== 'application/json') {
      console.error('❌ Content-Type 不是 application/json:', contentType)
      process.exit(1)
    }
  }
})

await page.goto(`${BACKEND_URL}/`)

const sent = await page.evaluate(() => {
  const events = [
    { session_id: 'sess-e2e', trace_id: 'trace-e2e', event_name: 'e2e_test_event', properties: { test: true, step: 1 } },
    { session_id: 'sess-e2e', event_name: 'e2e_second_event' },
  ]
  const body = new Blob([JSON.stringify(events)], { type: 'application/json' })
  return navigator.sendBeacon('/api/v1/telemetry', body)
})
console.log('sendBeacon 是否被浏览器接受:', sent)
if (!sent) {
  console.error('❌ sendBeacon 未被浏览器接受')
  await browser.close()
  process.exit(1)
}

await page.waitForTimeout(2000)
await browser.close()

const after = countAnalytics()
const inserted = after - before
console.log(`落库条数：前置 ${before}，后置 ${after}，本次新增 ${inserted}`)
if (inserted !== 2) {
  console.error('❌ 预期新增 2 条埋点，实际', inserted)
  process.exit(1)
}
console.log('✅ 前端埋点端到端验证通过：sendBeacon → /telemetry → 落库 2 条')
