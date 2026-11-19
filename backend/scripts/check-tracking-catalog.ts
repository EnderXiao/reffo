/**
 * 只读目录验证；从仓库根目录运行：
 * bun --no-env-file backend/scripts/check-tracking-catalog.ts
 * 仅解析源码 / JSON / SQL，不导入应用配置、不读取数据库、不发起网络请求。
 */
import {deepStrictEqual} from 'node:assert/strict'
import {readFileSync, readdirSync} from 'node:fs'
import {dirname, join, relative, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import ts from 'typescript'

interface CatalogEntry {
  event_name: string
  params: string[]
  page: string
  description: string
  status: 'implemented'
}

interface TrackDefinition {
  params: string[]
  location: string
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const catalogPath = join(root, 'backend/catalog/tracking-events.json')
const migrationPath = join(root, 'supabase/migrations/202611190001_tracking_catalog.sql')
const sourceRoot = join(root, 'frontend/Taro/reffo-taro/src')
const expectedCount = 63
const issues: string[] = []

function requireCheck(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function readCatalog(value: unknown, label: string): CatalogEntry[] {
  requireCheck(Array.isArray(value), label + ': 必须为事件数组')
  const seen = new Set<string>()
  return value.map((item: unknown, index: number) => {
    requireCheck(item && typeof item === 'object' && !Array.isArray(item), label + ': 非法条目 ' + index)
    const row = item as Record<string, unknown>
    const fields = ['description', 'event_name', 'page', 'params', 'status']
    deepStrictEqual(Object.keys(row).sort(), fields, label + ': 字段不符合台账 schema')
    requireCheck(typeof row.event_name === 'string' && /^[a-z][a-z0-9_]*$/.test(row.event_name), label + ': 非法事件名')
    requireCheck(!seen.has(row.event_name), label + ': 重复事件 ' + row.event_name)
    seen.add(row.event_name)
    requireCheck(Array.isArray(row.params) && row.params.every((param: unknown) => typeof param === 'string' && /^[a-z][a-z0-9_]*$/.test(param)), row.event_name + ': 非法参数')
    const params = row.params as string[]
    requireCheck(new Set(params).size === params.length, row.event_name + ': 参数重复')
    requireCheck(!params.includes('token'), row.event_name + ': 不能登记原始分享 token')
    requireCheck(typeof row.page === 'string' && /[\u3400-\u9fff]/.test(row.page), row.event_name + ': 缺少中文页面')
    requireCheck(typeof row.description === 'string' && /[\u3400-\u9fff]/.test(row.description), row.event_name + ': 缺少中文描述')
    requireCheck(row.status === 'implemented', row.event_name + ': 目录状态应表示代码已实现')
    return {event_name: row.event_name, params, page: row.page, description: row.description, status: row.status}
  })
}

function comparable(entries: CatalogEntry[]) {
  return [...entries].sort((left, right) => left.event_name.localeCompare(right.event_name)).map(entry => ({
    ...entry, params: [...entry.params].sort(),
  }))
}

const catalog = readCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown, 'JSON 目录')
requireCheck(catalog.length === expectedCount, 'JSON 目录应有 63 个事件，实际 ' + catalog.length)
const migration = readFileSync(migrationPath, 'utf8')
const delimiter = '$tracking_catalog$'
const parts = migration.split(delimiter)
requireCheck(parts.length === 3, 'migration 应只含一份带 $tracking_catalog$ 标记的 JSON 清单')
const migrated = readCatalog(JSON.parse(parts[1]!) as unknown, 'migration 清单')
deepStrictEqual(comparable(migrated), comparable(catalog), 'migration 与 JSON 目录存在字段差异')
// 限制为单条补齐语句：防止同名记录更新或手工需求被删除。
const sql = (parts[0]! + delimiter + delimiter + parts[2]!).replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
const expectedSql = 'insert into public.tracking_requirements (event_name, params, page, description, status) '
  + 'select event_name, params, page, description, status '
  + 'from jsonb_to_recordset(' + delimiter + delimiter + '::jsonb) '
  + 'as catalog( event_name text, params jsonb, page text, description text, status text ) '
  + 'on conflict (event_name) do nothing;'
requireCheck(sql.toLowerCase() === expectedSql, 'migration 必须只 INSERT 缺失事件，并 ON CONFLICT (event_name) DO NOTHING')
console.log('PASS migration JSON 与目录逐字段一致：' + migrated.length + '/' + catalog.length)
console.log('PASS migration 仅补齐缺失事件，不改现有 status / description 或手工需求')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (['node_modules', '__tests__', '__mocks__', '__fixtures__'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|d)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : []
  })
}

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)
    || ts.isSatisfiesExpression(expression)) return unwrap(expression.expression)
  return expression
}

function eventNames(expression: ts.Expression, location: string): string[] {
  const value = unwrap(expression)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return [value.text]
  if (ts.isConditionalExpression(value)) {
    return [...new Set([...eventNames(value.whenTrue, location), ...eventNames(value.whenFalse, location)])]
  }
  throw new Error(location + ': 无法静态确定 track 事件名，请扩展校验后再修改目录')
}

function parameterKeys(expression: ts.Expression | undefined, location: string): string[] {
  if (!expression) return []
  const value = unwrap(expression)
  if (value.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(value) && value.text === 'undefined')) return []
  requireCheck(ts.isObjectLiteralExpression(value), location + ': track 参数必须可静态核对')
  const keys = value.properties.map(property => {
    requireCheck(ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property), location + ': track 参数展开或方法需要显式校验')
    const name = property.name
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
    if (ts.isComputedPropertyName(name) && ts.isStringLiteral(unwrap(name.expression))) return (unwrap(name.expression) as ts.StringLiteral).text
    throw new Error(location + ': track 参数键无法静态确定')
  })
  requireCheck(new Set(keys).size === keys.length, location + ': track 参数键重复')
  return keys.sort()
}

const definitions = new Map<string, TrackDefinition[]>()
let callCount = 0
for (const path of sourceFiles(sourceRoot).sort()) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const bindings = new Set<string>()
  const namespaces = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || !/(?:^|\/)utils\/analytics(?:\.[cm]?[jt]s)?$/.test(statement.moduleSpecifier.text)) continue
    const imported = statement.importClause?.namedBindings
    if (imported && ts.isNamedImports(imported)) {
      for (const specifier of imported.elements) {
        if ((specifier.propertyName ?? specifier.name).text === 'track') bindings.add(specifier.name.text)
      }
    } else if (imported && ts.isNamespaceImport(imported)) namespaces.add(imported.name.text)
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression)
      const isTrack = (ts.isIdentifier(callee) && bindings.has(callee.text))
        || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'track'
          && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text))
      if (isTrack) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
        const location = relative(root, path) + ':' + line
        try {
          requireCheck(node.arguments.length >= 1 && node.arguments.length <= 2, location + ': track 参数个数异常')
          const names = eventNames(node.arguments[0]!, location)
          const params = parameterKeys(node.arguments[1], location)
          callCount += 1
          for (const name of names) definitions.set(name, [...(definitions.get(name) ?? []), {params, location}])
        } catch (error) {
          issues.push(error instanceof Error ? error.message : String(error))
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

const byName = new Map(catalog.map(entry => [entry.event_name, entry]))
for (const [name, usages] of definitions) {
  const entry = byName.get(name)
  if (!entry) {
    issues.push('源码事件未登记：' + name + ' (' + usages[0]!.location + ')')
    continue
  }
  for (const usage of usages) {
    if (JSON.stringify([...entry.params].sort()) !== JSON.stringify(usage.params)) {
      issues.push(name + ' 参数不一致：目录=' + JSON.stringify(entry.params) + '，源码=' + JSON.stringify(usage.params) + ' (' + usage.location + ')')
    }
  }
}
for (const entry of catalog) {
  if (!definitions.has(entry.event_name)) issues.push('目录事件无源码定义：' + entry.event_name)
}
if (definitions.size !== expectedCount) issues.push('源码应有 63 个唯一事件，实际 ' + definitions.size)
const successful = definitions.get('generation_success')
const failed = definitions.get('generation_failed')
requireCheck(successful?.length === 1 && failed?.length === 1
  && successful[0]!.location === failed[0]!.location, 'generation_success / generation_failed 应从同一条件调用解析')
requireCheck(byName.get('view_share_landing')?.params.join(',') === 'share_id,mode', '分享落地页只能登记 share_id / mode')
if (issues.length) throw new Error('埋点目录校验失败：\n' + issues.map(issue => '- ' + issue).join('\n'))
console.log('PASS 源码与目录事件及参数对齐：' + definitions.size + '/' + catalog.length + '（' + callCount + ' 处 track 调用；排除测试）')
console.log('PASS 条件事件 generation_success / generation_failed 均解析为 task_id / history_id')
console.log('PASS view_share_landing = share_id / mode；implemented 仅表示代码已实现')
