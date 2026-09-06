import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

function usage(): never {
  console.error('用法：bun scripts/harness-database-maintenance.ts check [数据库路径]')
  console.error('或：bun scripts/harness-database-maintenance.ts backup <输出文件> [数据库路径]')
  process.exit(2)
}

function assertUnlocked(source: string) {
  const lockPath = `${source}.lock`
  if (!existsSync(lockPath)) return

  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown }
    const pid = typeof owner.pid === 'number' ? owner.pid : Number(owner.pid)
    if (pid > 0) {
      try {
        process.kill(pid, 0)
        throw new Error(`Harness SQLite 正被进程 ${pid} 使用，请先停止服务`)
      } catch (error) {
        if (error instanceof Error && error.message.includes('正被进程')) throw error
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('正被进程')) throw error
  }
}

const mode = process.argv[2]
if (mode !== 'check' && mode !== 'backup') usage()

const source = resolve(process.argv[mode === 'check' ? 3 : 4] || resolve(process.cwd(), 'data', 'harness.sqlite'))
assertUnlocked(source)
const db = new Database(source, { readonly: true })
const integrity = db.query('PRAGMA integrity_check').get() as { integrity_check?: unknown } | null
if (integrity?.integrity_check !== 'ok') {
  console.error(JSON.stringify({ status: 'degraded', integrity }))
  process.exit(1)
}

if (mode === 'backup') {
  const outputArgument = process.argv[3]
  if (!outputArgument) usage()
  const output = resolve(outputArgument)
  mkdirSync(dirname(output), { recursive: true })
  db.query('VACUUM INTO ?').run(output)
  console.log(JSON.stringify({ status: 'ok', source, output }))
} else {
  console.log(JSON.stringify({ status: 'ok', source, integrity }))
}
