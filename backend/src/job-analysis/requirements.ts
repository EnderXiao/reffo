import { z } from 'zod'
import { canonicalizeSourceDocument } from '@/v5/canonical-source'
import { writingNumbers } from '@/v5/writing/facts'

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  text: z.string().trim().min(1).max(300),
  basis: z.enum(['explicit', 'inferred', 'unknown']),
  strength: z.enum(['necessary', 'preferred', 'unspecified']),
  sourceQuotes: z.array(z.string().min(1).max(1500)).max(6),
  rationale: z.string().max(240),
  dimension: z.enum(['knowledge', 'skill', 'experience', 'ability', 'behavior', 'motivation_fit']).optional(),
  evidenceExpectation: z.string().max(240).optional(),
}).strict()
const items = z.array(itemSchema).max(20)
export const requirementAnalysisSchema = z.object({
  version: z.literal('job-requirement-analysis-v1'),
  portrait: itemSchema.nullable(),
  tasks: items,
  outcomes: items,
  successConditions: items,
  attributes: items,
  externalRequirements: items,
  unknowns: z.array(z.string().max(300)).max(20),
  conflicts: items,
}).strict()
export type RequirementAnalysis = z.infer<typeof requirementAnalysisSchema>
export type RequirementAnalysisItem = z.infer<typeof itemSchema>

/** Optional presentation never starts a repair call or changes the source JD. */
export function normalizeRequirementAnalysis(value: unknown, jdText: string): RequirementAnalysis | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value)
    || value.version !== 'job-requirement-analysis-v1') return undefined
  const input = value as Record<string, unknown>
  const blocks = canonicalizeSourceDocument(jdText, 'jd:requirements').canonicalDocument.blocks
  const seen = new Set<string>()
  const clean = (item: RequirementAnalysisItem): RequirementAnalysisItem[] => {
    if (seen.has(item.id)) return []
    seen.add(item.id)
    if (item.basis === 'unknown') return [{ ...item, strength: 'unspecified', sourceQuotes: [] }]
    if (!item.sourceQuotes.length || item.sourceQuotes.some(quote => !blocks.some(block => !block.inputRiskFlags.length && block.text.includes(quote)))) return []
    if (item.basis === 'inferred' && !item.rationale.trim()) return []
    const numbers = new Set(item.sourceQuotes.flatMap(writingNumbers))
    if (writingNumbers(item.text).some(number => !numbers.has(number))) return []
    const cautious = item.basis !== 'explicit'
      || (item.strength === 'necessary' && (/优先|例如|加分|preferred|e\.g\./iu.test(item.sourceQuotes.join(' '))
        || !/必须|要求|至少|以上|需|must|required/iu.test(item.sourceQuotes.join(' '))))
    return [{ ...item, strength: cautious ? 'unspecified' : item.strength }]
  }
  const parsedPortrait = itemSchema.safeParse(input.portrait)
  const portrait = parsedPortrait.success ? clean({ ...parsedPortrait.data, basis: 'inferred', strength: 'unspecified' })[0] ?? null : null
  const cleanItems = (value: unknown): RequirementAnalysisItem[] => Array.isArray(value) ? value.slice(0, 20).flatMap(value => {
    const parsed = itemSchema.safeParse(value)
    return parsed.success ? clean(parsed.data) : []
  }) : []
  return {
    version: 'job-requirement-analysis-v1', portrait,
    tasks: cleanItems(input.tasks), outcomes: cleanItems(input.outcomes), successConditions: cleanItems(input.successConditions),
    attributes: cleanItems(input.attributes), externalRequirements: cleanItems(input.externalRequirements), conflicts: cleanItems(input.conflicts),
    unknowns: Array.isArray(input.unknowns) ? input.unknowns.filter((item): item is string => typeof item === 'string' && !!item.trim() && item.length <= 300).slice(0, 20) : [],
  }
}

export const REQUIREMENT_ANALYSIS_INSTRUCTIONS = `
同次输出可选 requirement_analysis，不额外调用模型。它只解释 JD，不评价候选人：
{"version":"job-requirement-analysis-v1","portrait":null,"tasks":[],"outcomes":[],"successConditions":[],"attributes":[],"externalRequirements":[],"unknowns":[],"conflicts":[]}
portrait 是一句理想候选人画像：基于已知场景，什么样的人能承担关键任务并支持预期结果。不是企业官方结论，也不保证长期绩效。
所有非空条目（包括 portrait）用同一结构：{"id":"唯一短标识","text":"简短解释","basis":"explicit|inferred|unknown","strength":"necessary|preferred|unspecified","sourceQuotes":["JD中的连续原文"],"rationale":"推导依据"}。
tasks 是工作任务；outcomes 是绩效方向（无数字不编 KPI）；successConditions 解释怎样才可能做好；attributes 是人才属性及深层能力要求，可加 dimension=knowledge|skill|experience|ability|behavior|motivation_fit 和 evidenceExpectation（应看到什么实践/交付/结果）。externalRequirements 是学历、年限、工具及明示现实条件。unknowns 为未说明项字符串；conflicts 保留矛盾，不择有利解释。
每组只保留关键项，通常 0–4 条，不凑齐六类属性、不重复职责全文。portrait 用 inferred 并给原文依据；未说明可留 null。explicit 与 inferred 区分企业明说/任务推导；strength 独立表示必要/优先/未明确。优先、例如、或不改为全部必须。未知不判不合格，不猜公司文化、稳定性、候选人人格。不要输出推理过程。
`
