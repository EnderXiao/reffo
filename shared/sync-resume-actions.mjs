import {mkdir, readFile, writeFile} from 'node:fs/promises'
const mode = process.argv[2]
if (!['--write', '--check'].includes(mode)) throw new Error('请使用 --write 或 --check')
const source = await readFile(new URL('./resume-actions.ts', import.meta.url), 'utf8')
const generated = '// 由 shared/sync-resume-actions.mjs 生成，请修改 shared/resume-actions.ts 后重新同步。\n' + source
for (const target of ['../backend/src/shared/resume-actions.ts', '../frontend/Taro/reffo-taro/src/shared/resume-actions.ts']) {
  const file = new URL(target, import.meta.url)
  if (mode === '--write') {
    await mkdir(new URL('.', file), {recursive: true})
    await writeFile(file, generated)
  } else if (await readFile(file, 'utf8').catch(() => '') !== generated) { console.error(`${target} 未同步`); process.exitCode = 1 }
}
