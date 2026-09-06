import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(projectRoot, '../../..')
const outputPath = resolve(projectRoot, 'src/content/compliance.generated.ts')
const privacyPath = resolve(repositoryRoot, 'docs/compliance/01-隐私政策.md')
const termsPath = resolve(repositoryRoot, 'docs/compliance/02-用户协议.md')

// 分支可能不保留内部合规草稿，此时继续使用已提交的页面内容。
// 仅缺少其中一份原文或没有展示内容时仍失败，避免掩盖不完整更新。
if (!existsSync(privacyPath) && !existsSync(termsPath) && existsSync(outputPath)) {
  console.warn('[compliance] 当前分支不包含合规源文档，使用已提交的 compliance.generated.ts。')
} else {
  const privacy = readFileSync(privacyPath, 'utf8')
  const terms = readFileSync(termsPath, 'utf8')
  mkdirSync(dirname(outputPath), {recursive: true})
  writeFileSync(outputPath, `// 此文件由 scripts/generate-compliance-content.mjs 生成，请勿手动编辑。\nexport const privacyMarkdown = ${JSON.stringify(privacy)}\nexport const termsMarkdown = ${JSON.stringify(terms)}\n`)
}
