import {expect, test} from 'bun:test'
import {cpSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

test('后端入口在仅含 backend 源码的部署目录中可以解析全部本地模块', async () => {
  const isolated = mkdtempSync(join(tmpdir(), 'reffo-backend-deploy-'))
  const backend = fileURLToPath(new URL('..', import.meta.url))
  try {
    cpSync(join(backend, 'src'), join(isolated, 'src'), {recursive: true})
    cpSync(join(backend, 'tsconfig.json'), join(isolated, 'tsconfig.json'))
    const result = await Bun.build({
      entrypoints: [join(isolated, 'src/index.ts')],
      target: 'bun',
      packages: 'external',
    })
    expect(result.logs.filter(log => log.level === 'error').map(log => log.message)).toEqual([])
    expect(result.success).toBe(true)
  } finally {
    rmSync(isolated, {recursive: true, force: true})
  }
})
