import { createHash } from 'node:crypto'
import type { EvidenceAtom, ValidationIssue } from '@/v5/types'
import { hasEditorialSourceText, sourceBusinessDisplayText } from '@/v5/composition/source-display'
import { areCanonicalAdjacentSourceAtoms } from '@/v5/composition/source-continuation'

export const WRITING_FACT_VIEW_VERSION = 'writing-fact-view-v3' as const
export const SUPPORTED_WRITING_POLICY = 'supported-writing-v1' as const

export interface WritingFact {
  evidenceId: string
  scopeId: string
  text: string
  claimType: EvidenceAtom['claimType']
  protectedNumbers: string[]
  /** First complete contribution, not every incidental fact in the source block. */
  focusText?: string
  requiredNumbers?: string[]
  sourceExcerpts?: Array<{ evidenceId: string; sourceSpan: { start: number; end: number } }>
  boundaries: string[]
  contextForEvidenceId?: string
  contextRole?: 'problem' | 'constraint' | 'stage'
}

/** A narrow presentation projection, never a replacement for immutable source evidence. */
export function writingDisplayText(value: string) {
  return sourceBusinessDisplayText(value)
    .replace(/经本人确认(?=已获批准|已批准|获批)/gu, '')
    .replace(/(^|[，,；;。]\s*)(?:结果\/边界\s*)?个人(?:简历|材料)(?:记录|自述)\s*[:：]?\s*/gu, '$1')
    .trim()
}

export function writingNumbers(text: string) {
  const protectedExpressions: string[] = []
  // Keep priority and count paired: P010条 and P0 10条 describe the same quantity.
  const normalized = text.normalize('NFKC').replace(/\bP([0-2])\s*(\d+)\s*(条|项|个)/giu, (_, priority: string, count: string, unit: string) => {
    protectedExpressions.push(`p${priority}:${count}${unit}`)
    return ' '
  })
  return [...protectedExpressions, ...[...normalized.matchAll(/(?:约|近|超过|至少|最多|不足|不低于|逾|超|>=|<=|[<>≥≤≈])?\s*[¥$￥]?\s*\d+(?:[.,]\d+)*(?:\s*[-~至]\s*\d+(?:[.,]\d+)*)?\s*(?:(?:[kmb](?![a-z])|万|亿|千|百)\s*)?(?:\+|%)?\s*(?:人|次|个|份|项|条|套|种|名|步|家|天|周|个月|月|年|小时|分钟|QPS|ms|MB|GB)?/giu)]
    .map(match => match[0].replace(/\s/g, '').toLowerCase())]
}

export const TEAM_CONTRIBUTION_PATTERN = /团队|参与|协助|支持|配合|协同|跨(?:部门|团队|职能)(?:交付|协作|协同|合作|推进)|team|contribut|assist|support/iu

const PLATFORM_NOT_PERSONAL = /(?:整个平台|平台整体)(?:的)?规模[^。；;]{0,20}(?:并非|不是|不代表)本人(?:模块)?独立承载/u

const BOUNDARIES = [
  { label: '未上线或概念阶段', source: /未(?:真实)?(?:开发)?上线|尚未(?:正式)?上线|未发布|概念(?:项目|方案)|not (?:yet )?(?:launched|released)/iu, output: /未(?:真实)?(?:开发)?上线|尚未(?:正式)?上线|未发布|概念|方案设计|规划|not (?:yet )?(?:launched|released)|concept|prototype/iu },
  { label: '未验证', source: /未.{0,8}(?:验证|验收)|未经.{0,6}验证|not (?:yet )?validated/iu, output: /未.{0,8}(?:验证|验收)|未经.{0,6}验证|not (?:yet )?validated/iu },
  { label: '仅获批', source: /(?:晋升|升职|调任).{0,35}(?:获批|批准)/u, output: /获批|批准|approved/iu },
  { label: '团队或参与贡献', source: /团队(?:共同|整体|成果|实现|完成)|仅参与|协助|assisted|team (?:achieved|delivered)/iu, output: TEAM_CONTRIBUTION_PATTERN },
  { label: '尚无实际数据', source: /(?:没有|尚无|无)(?:真实用户|实际用户|商业收益|长期运行数据)/u, output: /(?:没有|尚无|无)(?:真实用户|实际用户|商业收益|长期运行数据)|未验证|概念|实验|本地压测/u },
] as const

export function buildWritingFact(atom: EvidenceAtom): WritingFact | null {
  if (atom.status === 'excluded' || atom.riskFlags.some(flag => (
    ['sensitive_pii', 'prompt_injection_like_text', 'conflicting'].includes(flag)
  ))) return null
  const text = writingDisplayText(atom.verbatimText)
  // Unrecognized editorial mixtures are not silently stripped.
  if (!text || hasEditorialSourceText(text) || /经本人确认|已交叉验证/u.test(text)) return null
  // Do not split commas: comparisons and their qualifiers often span both sides.
  const focusText = text.split(/[；;。!?！？]/u).find(part => part.trim())?.trim() ?? text
  return {
    evidenceId: atom.evidenceId,
    scopeId: atom.sourceScopeId,
    text,
    claimType: atom.claimType,
    protectedNumbers: writingNumbers(text),
    focusText,
    requiredNumbers: ['result', 'deliverable'].includes(atom.claimType) ? writingNumbers(focusText) : [],
    boundaries: [...new Set([
      ...BOUNDARIES.filter(rule => rule.source.test(text)).map(rule => rule.label),
      ...(atom.riskFlags.includes('team_attribution') ? ['团队或参与贡献'] : []),
    ])],
  }
}

export function writingIssue(code: string, path: string, ids: string[], message: string, severity: ValidationIssue['severity'] = 'error'): ValidationIssue {
  return {
    issueId: `issue_${createHash('sha256').update(`${code}|${path}`).digest('hex').slice(0, 16)}`,
    code, outputPath: path, claimId: null, evidenceIds: ids, requirementIds: [],
    message, severity, expectedConstraint: '遵循服务端写作计划、已支持事实与原始贡献边界', replacementText: null,
  }
}

/** Deterministic checks catch known changes; they are NOT a semantic entailment oracle. */
export function isAbilityAbstraction(text: string, path: string) {
  return /^(?:summary|skills)\[/u.test(path)
    && /^(?:具备|具有|能够|可运用|可通过|擅长|熟悉|可推动|可完成)/u.test(text)
    && writingNumbers(text).length === 0
    && !/独立|全权|主导|唯一|首创|实现|达成|增长|上线|完成了|交付了|提升了|sole|led\b/iu.test(text)
}

export function inspectSupportedWriting(text: string, atoms: EvidenceAtom[], path: string, allowTeamAbstraction = false): ValidationIssue[] {
  const ids = atoms.map(atom => atom.evidenceId)
  const sources = atoms.map(atom => writingDisplayText(atom.verbatimText))
  const issues: ValidationIssue[] = []
  const report = (code: string, message: string) => issues.push(writingIssue(code, path, ids, message))
  const numericSources = areCanonicalAdjacentSourceAtoms(atoms) ? [...sources, sources.join('')] : sources
  const allowedNumbers = new Set(numericSources.flatMap(writingNumbers))
  if (writingNumbers(text).some(value => !allowedNumbers.has(value))) {
    report('WRITER_NUMBER_CHANGED', '正文出现引用来源中不存在的数字、单位或限定表达。')
  }
  for (const rule of BOUNDARIES) {
    if (rule.label === '团队或参与贡献' && allowTeamAbstraction && isAbilityAbstraction(text, path)) continue
    // An approval qualifies a promotion claim, not unrelated duties in the same source atom.
    if (rule.label === '仅获批' && !/晋升|升职|调任|履任|promot|appointed/iu.test(text)) continue
    const sourceRequiresBoundary = sources.some(source => rule.source.test(source))
      || (rule.label === '团队或参与贡献' && atoms.some(atom => atom.riskFlags.includes('team_attribution')))
    const explicitPlatformBoundary = rule.label === '团队或参与贡献'
      && sources.some(source => PLATFORM_NOT_PERSONAL.test(source)) && PLATFORM_NOT_PERSONAL.test(text)
    if (sourceRequiresBoundary && !rule.output.test(text) && !explicitPlatformBoundary) {
      report('WRITER_BOUNDARY_LOST', `正文未保留来源中的${rule.label}边界。`)
    }
  }
  // Preserve explicit negation of responsibility; do not turn a substring into a claim.
  if (sources.some(source => /(?:从未|未曾|并未|没有|未)(?:负责|参与|使用|主导)/u.test(source))
    && !/(?:从未|未曾|并未|没有|未)(?:负责|参与|使用|主导)/u.test(text)) {
    report('WRITER_NEGATION_LOST', '正文丢失源文明确的职责或使用经历否定。')
  }
  if (hasEditorialSourceText(text) || /经本人确认|已交叉验证|source_supported|source_qualified|\b[ABC]\s*[|｜丨]/u.test(text)) {
    report('WRITER_EDITORIAL_LEAK', '投递正文包含核验、资料等级或编辑说明。')
  }
  if (/(?:精通|专家级|expert in|mastery of)/iu.test(text)
    && !sources.some(source => /(?:精通|专家级|expert in|mastery of)/iu.test(source))) {
    report('WRITER_PROFICIENCY_UPGRADE', '输出新增无来源支持的熟练度或专家身份。')
  }
  if (/(?:独立(?:完成|负责|推进|设计|交付|主导)|全权负责|single.handedly|solely responsible)/iu.test(text)
    && !sources.some(source => /(?:独立(?:完成|负责|推进|设计|交付|主导)|全权负责|single.handedly|solely responsible)/iu.test(source))) {
    report('WRITER_OWNERSHIP_UPGRADE', '输出把一般参与或职责升级为独立完成或全权负责。')
  }
  if (sources.some(source => PLATFORM_NOT_PERSONAL.test(source))
    && /(?:本人|个人|本模块)(?:独立)?(?:支撑|承载)/u.test(text.replace(PLATFORM_NOT_PERSONAL, ''))) {
    report('WRITER_OWNERSHIP_UPGRADE', '平台规模不能转化为本人或个人模块的承载业绩。')
  }
  const teams = (value: string) => [
    ...value.matchAll(/(?:协同|协调|联合|对接|联动|和|与)\s*((?:(?:研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺)(?:团队|部门)?[、，,与和及\s]*){1,8})/gu),
    ...value.matchAll(/(?:^|[、，,；;。\s])((?:(?:研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺)(?:团队|部门)?[、,与和及\s]*){1,8})(?:协同|协作|沟通|联动|对接)/gu),
    // Explicit organizations, or an actor followed by a concrete action. A metric
    // such as 销售增长 / 工艺改善 alone does not establish a collaborator.
    ...value.matchAll(/(?:^|[，,；;。\s])(?:推动|促成|支持|协助|配合)\s*((?:研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺)(?:团队|部门))/gu),
    ...value.matchAll(/(?:^|[，,；;。\s])(?:推动|促成|支持|协助|配合)\s*(研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发)(?=(?:重新)?(?:议价|报价|谈判|排期|评审|修复|交付|上线|制定|调整|完成|执行|开展|处理))/gu),
  ].flatMap(match => match[1].match(/研发|开发|设计|市场|运营|测试|销售|业务|商务|宣发|工艺/gu) ?? [])
    // Only normalize names inside a collaboration phrase; never rewrite product development.
    .map(team => team === '开发' ? '研发' : team)
  const supportedTeams = new Set(sources.flatMap(teams))
  if (teams(text).some(team => !supportedTeams.has(team))) {
    report('WRITER_COLLABORATOR_ADDED', '输出新增引用来源未说明的协作部门。')
  }
  const concreteTerms = /\b(?:PRD|SQL|Python|Figma|Jira|Tableau|Excel|PowerBI|SPSS|JMeter|Redis|Kubernetes)\b|A\/B\s*(?:测试|test)|可用性测试/giu
  for (const match of text.matchAll(concreteTerms)) {
    if (!sources.some(source => source.toLowerCase().includes(match[0].toLowerCase()))) {
      report('WRITER_UNSUPPORTED_TOOL', '正文新增来源未说明的具体工具、方法或交付物。')
      break
    }
  }
  return issues
}
