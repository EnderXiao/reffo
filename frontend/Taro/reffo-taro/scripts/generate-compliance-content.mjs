import {readFileSync, writeFileSync, mkdirSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(projectRoot, '../../..')
const outputPath = resolve(projectRoot, 'src/content/compliance.generated.ts')
const privacy = readFileSync(resolve(repositoryRoot, 'docs/compliance/01-隐私政策.md'), 'utf8')
const terms = readFileSync(resolve(repositoryRoot, 'docs/compliance/02-用户协议.md'), 'utf8')

mkdirSync(dirname(outputPath), {recursive: true})
writeFileSync(outputPath, `// 此文件由 scripts/generate-compliance-content.mjs 生成，请勿手动编辑。\nexport const privacyMarkdown = ${JSON.stringify(privacy)}\nexport const termsMarkdown = ${JSON.stringify(terms)}\n`)
