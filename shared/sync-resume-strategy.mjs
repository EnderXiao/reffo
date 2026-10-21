import {mkdir, readFile, writeFile} from 'node:fs/promises'

const mode = process.argv[2]
if (!['--write', '--check'].includes(mode)) {
  throw new Error('用法：node shared/sync-resume-strategy.mjs --write 或 --check')
}

const source = await readFile(new URL('./resume-strategy.ts', import.meta.url), 'utf8')
const generated = '// 由 shared/sync-resume-strategy.mjs 生成，请修改 shared/resume-strategy.ts 后重新同步。\n' + source
const targets = [
  '../backend/src/shared/resume-strategy.ts',
  '../frontend/Taro/reffo-taro/src/shared/resume-strategy.ts',
]

for (const target of targets) {
  const file = new URL(target, import.meta.url)
  if (mode === '--write') {
    await mkdir(new URL('.', file), {recursive: true})
    await writeFile(file, generated)
  } else {
    const actual = await readFile(file, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return ''
      throw error
    })
    if (actual !== generated) {
      console.error(`${target} 未同步，请运行 node shared/sync-resume-strategy.mjs --write 并提交生成文件。`)
      process.exitCode = 1
    }
  }
}
