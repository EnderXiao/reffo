import {describe, expect, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

function isolated(script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'reffo-error-reporter-'))
  try {
    const result = Bun.spawnSync([process.execPath, '-e', script + '\nprocess.exit(0)'], {
      cwd: join(import.meta.dir, '../..'),
      env: {...process.env, APP_ENV: 'local', DATABASE_PROVIDER: 'sqlite', AUTH_REQUIRED: 'false', SQLITE_DATABASE_PATH: join(directory, 'history.sqlite')},
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect({code: result.exitCode, stderr: result.stderr.toString()}).toEqual({code: 0, stderr: ''})
    return JSON.parse(result.stdout.toString()) as Record<string, unknown>
  } finally {
    rmSync(directory, {recursive: true, force: true})
  }
}

describe('error-reporter 去重', () => {
  test('同签名错误 5 分钟内只上报一次，不同签名各自上报', () => {
    const output = isolated([
      "import {reportError} from './src/shared/error-reporter.ts'",
      "import {getDatabase} from './src/repositories/database.ts'",
      "const base = {path: '/api/v1/generation-jobs/events', method: 'GET', errorCode: 'UNKNOWN', status: 500}",
      "reportError({...base, error: new Error('登录状态无效，请重新登录')})",
      "reportError({...base, error: new Error('登录状态无效，请重新登录')})",
      "reportError({...base, error: new Error('登录状态无效，请重新登录')})",
      "reportError({...base, errorCode: 'NOT_FOUND', status: 404, error: new Error('请求的资源不存在')})",
      "const rows = getDatabase().query('SELECT path, error_code, status FROM error_events ORDER BY created_at').all()",
      'console.log(JSON.stringify({rows}))',
    ].join('\n'))
    expect(output.rows).toEqual([
      {path: '/api/v1/generation-jobs/events', error_code: 'UNKNOWN', status: 500},
      {path: '/api/v1/generation-jobs/events', error_code: 'NOT_FOUND', status: 404},
    ])
  })
})
