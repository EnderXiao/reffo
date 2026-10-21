import {afterEach, describe, expect, test} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const directories: string[] = []
const databaseModule = new URL('./database.ts', import.meta.url).pathname

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true})
})

function probeDatabase(sameProcessOwner: boolean) {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-harness-lock-'))
  directories.push(directory)
  const databasePath = join(directory, 'harness.sqlite')
  const lockPath = `${databasePath}.lock`
  if (!sameProcessOwner) writeFileSync(lockPath, JSON.stringify({pid: process.pid}))
  const result = Bun.spawnSync([process.execPath, '-e', `
    import {writeFileSync} from 'node:fs'
    if (${sameProcessOwner}) writeFileSync(process.env.HARNESS_DATABASE_PATH + '.lock', JSON.stringify({pid: process.pid}))
    const {getHarnessDatabase} = await import(${JSON.stringify(databaseModule)})
    try {
      const db = getHarnessDatabase()
      db.exec("CREATE TABLE lock_probe (value TEXT); INSERT INTO lock_probe VALUES ('ok')")
      console.log(JSON.stringify(db.query('SELECT value FROM lock_probe').get()))
    } catch (error) {
      console.log(JSON.stringify({code: error.code}))
      process.exitCode = 1
    }
  `], {env: {...process.env, HARNESS_DATABASE_PATH: databasePath}, stdout: 'pipe', stderr: 'pipe'})
  return {result, lockPath}
}

describe('Harness database ownership', () => {
  test('reopens and writes after a watch reload leaves this process owning the lock', () => {
    const {result, lockPath} = probeDatabase(true)
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout.toString())).toEqual({value: 'ok'})
    expect(existsSync(lockPath)).toBe(false)
  })

  test('rejects another live process without removing its lock', () => {
    const {result, lockPath} = probeDatabase(false)
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout.toString())).toEqual({code: 'HARNESS_DATABASE_IN_USE'})
    expect(JSON.parse(readFileSync(lockPath, 'utf8')).pid).toBe(process.pid)
  })
})
