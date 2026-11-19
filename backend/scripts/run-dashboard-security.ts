import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
const directory=mkdtempSync(join(tmpdir(),'reffo-dashboard-security-'))
let exitCode=1
try {
  const child=Bun.spawn([process.execPath,'scripts/test-dashboard-security.ts'],{cwd:process.cwd(),env:{...process.env,SQLITE_DATABASE_PATH:join(directory,'test.sqlite')},stdout:'inherit',stderr:'inherit'})
  exitCode=await child.exited
}finally{
  // directory 是本进程 mkdtemp 返回的唯一临时目录，仅回收自己的测试数据。
  rmSync(directory,{recursive:true,force:true})
}
process.exit(exitCode)
