import { z } from 'zod'
import { COMPLETION_TEMPLATES } from '@/shared/resume-completion'
import type { EvidenceAtom, GenerationPolicy, ValidationIssue } from '@/v5/types'
import { SupportedWritingError } from './compiler'
import { writingIssue } from './facts'

export const FIVE_ELEMENTS = ['responsibility', 'project', 'problem', 'solution', 'result'] as const
export const fiveElementCoverageSchema = z.object({
  element: z.enum(FIVE_ELEMENTS),
  status: z.enum(['known', 'missing', 'ambiguous', 'not_applicable']),
  evidenceIds: z.array(z.string().min(1)).max(80),
}).strict()
export const entryCoverageSchema = z.array(fiveElementCoverageSchema).length(5)
export const gapDecisionSchema = z.discriminatedUnion('action', [
  z.object({element: z.enum(FIVE_ELEMENTS), action: z.literal('omit'),
    reason: z.enum(['already_clear', 'low_value', 'not_established', 'too_complex', 'duplicate', 'context_incomplete'])}).strict(),
  z.object({element: z.enum(FIVE_ELEMENTS), action: z.literal('supplement'),
    purpose: z.enum(['clarify_contribution', 'explain_key_action', 'identify_deliverable', 'complete_existing_comparison', 'identify_object']),
    contextEvidenceIds: z.array(z.string().min(1)).min(1).max(80), targetTaskIds: z.array(z.string().min(1)).max(30)}).strict(),
])
export const gapDecisionsSchema = z.array(gapDecisionSchema).max(5)
export type GapDecision = z.infer<typeof gapDecisionSchema>
export const gapCandidateSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('source'), text: z.string().trim().min(1).max(24), evidenceId: z.string().min(1)}).strict(),
  z.object({kind: z.literal('design_deliverables')}).strict(),
])
export const metricGapSchema = z.object({
  evidenceId: z.string().min(1), object: z.string().trim().min(2).max(30),
  missing: z.enum(['value', 'unit', 'month']),
  before: z.string().min(1).max(120), after: z.string().max(120),
}).strict()
export const entrySegmentSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('fact'), text: z.string().min(1).max(6000),
    evidenceIds: z.array(z.string().min(1)).min(1).max(80)}).strict(),
  z.object({kind: z.literal('optional_gap_clause'),
    template: z.enum(['problem', 'research_problem', 'method', 'role_detail', 'project_name', 'design_deliverable', 'metric_detail']),
    metric: metricGapSchema.nullish(),
    candidates: z.array(gapCandidateSchema).max(3)}).strict(),
])
export type EntrySegment = z.infer<typeof entrySegmentSchema>
export type EntryCoverage = z.infer<typeof entryCoverageSchema>
export type FactSegment = Extract<EntrySegment, {kind: 'fact'}>
export type GapSegment = Extract<EntrySegment, {kind: 'optional_gap_clause'}>

const METRIC_MARKERS = {value: '[数值缺失]', unit: '[单位缺失]', month: '[月份缺失]'} as const
const METRIC_GUIDANCE = {value: '填这一个实际数值', unit: '填这一数值的实际单位', month: '填这一个实际月份'} as const

export const GAP_TEMPLATES = COMPLETION_TEMPLATES

export const GAP_GUIDANCE = Object.entries(GAP_TEMPLATES).map(([template, value]) => ({
  template, element: value.element, fill: value.instruction,
}))

export function gapPresentation(segment: GapSegment) {
  const base = GAP_TEMPLATES[segment.template]
  return segment.template === 'metric_detail' && segment.metric
    ? {...base, prefix: `，${segment.metric.before}${segment.metric.missing === 'month' ? '，对比记录月份为' : ''}`,
      suffix: segment.metric.after, instruction: METRIC_GUIDANCE[segment.metric.missing]}
    : base
}

export function projectFactSegments(segments: readonly EntrySegment[]) {
  return segments.filter((segment): segment is FactSegment => segment.kind === 'fact').map(segment => segment.text).join('').trim()
}
export function segmentEvidenceIds(segments: readonly EntrySegment[]) {
  return [...new Set(segments.flatMap(segment => segment.kind === 'fact' ? segment.evidenceIds : []))]
}
export function renderEntrySegments(segments: readonly EntrySegment[], enabledGapIndices?: ReadonlySet<number>) {
  return segments.map((segment, index) => {
    if (segment.kind === 'fact') return segment.text
    if (enabledGapIndices && !enabledGapIndices.has(index)) return ''
    const template = gapPresentation(segment)
    const sourceOptions = segment.candidates.flatMap(candidate => candidate.kind === 'source' ? [candidate.text] : [])
    const reference = segment.candidates.some(candidate => candidate.kind === 'design_deliverables')
      ? '；类别示例“需求文档/页面原型/交互流程”，可组合且须确实完成'
      : sourceOptions.length ? `；可参考“${sourceOptions.join('/')}”，须实际适用` : ''
    const deletion = `${template.prefix}……${template.suffix}`
    return `${template.prefix}【待完善：${template.instruction}${reference}；${template.benefit}；无法确认时删去“${deletion}”分句】${template.suffix}`
  }).join('').trim()
}

// These are action cues, not proof of attribution; the existing fact checks still apply.
function concreteActionCues(text: string): Set<string> {
  return new Set([...text.matchAll(/(参与|主导|负责|协助|推动|完成|实施|组织|搭建|开发|构建|验证|梳理|制定|优化|交付|访谈|收集|提炼|识别|输出|执行|建立|编写|设计|分析|调研|评估|测试)(?!能力|阶段|领域|方向|与|和|、|工作[，。；;]|方案阶段)(?=[^\s，。；;：:]{2})/gu)]
    .map(match => match[1]))
}

export function inspectEntrySkeleton(input: {
  coverage?: EntryCoverage
  gapDecisions?: GapDecision[]
  requireGapDecisions?: boolean
  gapContextFacts?: Array<{evidenceId: string; scopeId: string; text: string}>
  gapContextComplete?: boolean
  targetTaskIds?: string[]
  paragraphs: Array<{segments?: EntrySegment[]; text: string; evidenceIds: string[]}>
  facts: Array<{evidenceId: string; scopeId: string; text: string}>
  identityEvidenceIds?: string[]
  hasProjectIdentity?: boolean
  atoms: EvidenceAtom[]
  scopeId: string | null
  business: boolean
  outputPath: string
}) {
  const issues: ValidationIssue[] = []
  const report = (code: string, message: string) => issues.push(writingIssue(code, input.outputPath, [], message))
  const hasSegments = input.paragraphs.some(paragraph => paragraph.segments)
  if (!hasSegments) return issues // Historical text-only replay has no cloze contract.
  if (!input.coverage || new Set(input.coverage.map(item => item.element)).size !== 5) {
    report('WRITER_COVERAGE_INVALID', '五要素覆盖图必须完整且每项恰好一次。')
    return issues
  }
  const ownIds = new Set(input.facts.map(fact => fact.evidenceId))
  const identityIds = new Set(input.identityEvidenceIds ?? [])
  const coverageIds = new Set([...ownIds, ...(input.gapContextFacts ?? [])
    .filter(fact => fact.scopeId === input.scopeId).map(fact => fact.evidenceId)])
  for (const item of input.coverage) {
    const allowed = item.element === 'project' ? new Set([...coverageIds, ...identityIds]) : coverageIds
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length || item.evidenceIds.some(id => !allowed.has(id))
      || (item.status === 'known' && !item.evidenceIds.length)
      || (item.status === 'not_applicable' && item.evidenceIds.length)) {
      report('WRITER_COVERAGE_INVALID', '覆盖图引用必须来自本经历的有效事实，已知要素须有引用。')
    }
    if (input.business && input.hasProjectIdentity && item.element === 'project' && item.status !== 'known') {
      report('WRITER_KNOWN_ELEMENT_BLANKED', '标题已明确真实项目或任职对象，不得将其重新标成缺失。')
    }
  }
  const coverage = new Map(input.coverage.map(item => [item.element, item]))
  let gapCount = 0
  const seenElements = new Set<string>()
  for (const paragraph of input.paragraphs) {
    if (!paragraph.segments) { report('WRITER_SEGMENTS_INVALID', '同一新契约条目不得混用自由文本和分段正文。'); continue }
    const segments = paragraph.segments
    if (projectFactSegments(segments) !== paragraph.text
      || JSON.stringify(segmentEvidenceIds(segments)) !== JSON.stringify(paragraph.evidenceIds)) {
      report('WRITER_PROJECTION_MISMATCH', '事实段与编译投影不一致。')
    }
    for (const [index, segment] of segments.entries()) {
      if (segment.kind === 'fact') {
        if (/【待完善|[\r\n]|```|<\/?[a-z][^>]*>/iu.test(segment.text)) {
          report('WRITER_SEGMENTS_INVALID', '事实段不能包含留白、换行或结构标记。')
        }
        continue
      }
      gapCount++
      const template = GAP_TEMPLATES[segment.template]
      const element = coverage.get(template.element)
      if (!input.business || !element || !['missing', 'ambiguous'].includes(element.status) || seenElements.has(template.element)) {
        report('WRITER_KNOWN_ELEMENT_BLANKED', '仅业务经历中真实缺失或待核对的单一要素可留白，同要素不重复挖空。')
      }
      seenElements.add(template.element)
      // Optional clauses own the comma and all unknown syntax. A bare marker can
      // never be used to complete a mandatory verb, subject or numeric comparison.
      const before = segments[index - 1], after = segments[index + 1]
      if (before?.kind !== 'fact' || after?.kind !== 'fact'
        || /[，。；：！？、,;:!?]\s*$/u.test(before.text)
        || !/^[，。；！？,;.!?]/u.test(after.text)
        || /(?:针对|围绕|采用|交付|负责|提升至|降低至|从|至|为|达|约)\s*$/u.test(before.text)) {
        report('WRITER_GAP_BOUNDARY_INVALID', '留白必须是可整段删除的独立子句，事实投影不得留下未完成短语或比较。')
      }
      if (segment.template === 'problem' || segment.template === 'research_problem') {
        const paragraphIds = new Set(paragraph.evidenceIds)
        const sourceActions = new Set(input.facts.filter(fact => fact.scopeId === input.scopeId)
          .flatMap(fact => [...concreteActionCues(fact.text)]))
        const paragraphSourceActions = new Set(input.facts.filter(fact => paragraphIds.has(fact.evidenceId)
          && fact.scopeId === input.scopeId).flatMap(fact => [...concreteActionCues(fact.text)]))
        if (sourceActions.size && ![...concreteActionCues(paragraph.text)]
          .some(action => paragraphSourceActions.has(action))) {
          report('WRITER_GAP_ACTION_MISSING', '问题留白应放入本经历已有且有来源支持的具体动作句；将空位移至实际问卷、访谈、分析等行动段，不放在仅重述项目或阶段的背景段，也不新增未经来源支持的动作。')
        }
      }
      if (segment.template === 'project_name' && input.hasProjectIdentity) {
        report('WRITER_KNOWN_ELEMENT_BLANKED', '已知项目名称不得挖空。')
      }
      if (segment.template === 'design_deliverable'
        && !input.facts.some(fact => /设计|原型|交互|design|prototype/iu.test(fact.text))) {
        report('WRITER_GAP_CANDIDATE_INVALID', '只有真实设计实践可提供设计产物类别参考。')
      }
      if (segment.template === 'metric_detail') {
        const metric = segment.metric
        const fact = metric && input.facts.find(item => item.evidenceId === metric.evidenceId && item.scopeId === input.scopeId)
        const atom = metric && input.atoms.find(item => item.evidenceId === metric.evidenceId && item.sourceScopeId === input.scopeId)
        const source = atom?.verbatimText ?? ''
        const markedContext = metric ? `${metric.before}${METRIC_MARKERS[metric.missing]}${metric.after}` : ''
        const known = metric ? `${metric.before}${metric.after}` : ''
        const hasExplicitGap = metric && source.includes(markedContext)
        const context = hasExplicitGap ? markedContext : known
        const insertionSafe = metric && (hasExplicitGap
          || (source.includes(known) && (metric.missing === 'value'
            ? /(?:从|由|提升至|提高至|增长至|降低至|减少至|下降至|增至|降至|达到|到|至)$/u.test(metric.before) && !/^\d/u.test(metric.after) && !/^\d/u.test(source.slice(source.indexOf(known) + metric.before.length))
            : metric.missing === 'unit'
              ? /\d$/u.test(metric.before) && !/^[\d.]/u.test(metric.after) && !/(?:[%％元天人份次家条万亿]|小时|分钟)/u.test(source)
              : metric.after === '' && !/(?:20\d{2}[.年/-]\d{1,2}|\d{1,2}月)/u.test(source))))
        const markers = source.match(/\[(?:数值|单位|月份)缺失\]/gu) ?? []
        const numbers = known.match(/\d+(?:\.\d+)?/gu) ?? []
        const projection = input.paragraphs.map(item => item.text).join(' ')
        if (!metric || !fact || !atom || segment.candidates.length || atom.status === 'excluded'
          || atom.riskFlags.some(flag => ['future_or_planned', 'conflicting', 'sensitive_pii', 'prompt_injection_like_text'].includes(flag))
          || !insertionSafe || (markers.length > 0 && (markers.length !== 1 || markers[0] !== METRIC_MARKERS[metric.missing]))
          || !source.includes(context) || !known.includes(metric.object) || !projection.includes(metric.object)
          || /[\r\n【】<>]/u.test(known)
          || !/(?:(?:从|由)[\s\S]+(?:至|到)|基线[\s\S]+(?:结果|终值)|前后对比|提升至|下降至|提高至|降低至)/u.test(context)
          || numbers.length < (metric.missing === 'value' ? 1 : 2)
          || numbers.some(number => !projection.includes(number))) {
          report('WRITER_GAP_CANDIDATE_INVALID', '指标留白必须锚定同经历已有对比记录中的唯一明确缺口，保留对象和其余已知数字，不推断比较或方向。')
        }
      } else if (segment.metric) {
        report('WRITER_GAP_CANDIDATE_INVALID', '指标锚点只能用于单项指标留白。')
      }
      const candidates = new Set<string>()
      for (const candidate of segment.candidates) {
        if (candidate.kind === 'design_deliverables') {
          if (segment.template !== 'design_deliverable' || segment.candidates.length !== 1) {
            report('WRITER_GAP_CANDIDATE_INVALID', '设计产物类别示例仅用于设计交付缺口，不能混作已知选项。')
          }
          continue
        }
        const fact = input.facts.find(item => item.evidenceId === candidate.evidenceId)
        const atom = input.atoms.find(item => item.evidenceId === candidate.evidenceId)
        if (!fact || fact.scopeId !== input.scopeId || (atom && (atom.status === 'excluded'
          || atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))))
          || !fact.text.includes(candidate.text) || candidates.has(candidate.text)
          || !/^[\p{L}\p{M} /·-]+$/u.test(candidate.text)
          || /[\d%％\r\n【】<>]|主导|独立|全权|精通|显著|大幅|提升|降低|增长|节省/u.test(candidate.text)) {
          report('WRITER_GAP_CANDIDATE_INVALID', '参考项必须是同经历原文中的短语，不含数字、效果预设或责任升级。')
        }
        candidates.add(candidate.text)
      }
      if (['problem', 'research_problem'].includes(segment.template) && segment.candidates.length) {
        report('WRITER_GAP_CANDIDATE_INVALID', '实际业务或研究问题由本人补充，不把已知业务场景包装为未确认痛点选项。')
      }
    }
  }
  if (input.requireGapDecisions) {
    const missing = input.coverage.filter(item => ['missing', 'ambiguous'].includes(item.status))
    const decisions = input.gapDecisions ?? []
    const taskIds = new Set(input.targetTaskIds ?? [])
    if (decisions.length !== missing.length || new Set(decisions.map(item => item.element)).size !== decisions.length
      || decisions.some(item => !missing.some(value => value.element === item.element))) {
      report('WRITER_GAP_DECISION_INVALID', '每个真实缺失或模糊要素须有且只有一个补充或省略决策；已知或不适用要素不能另作补充决策。')
    }
    for (const decision of decisions) {
      if ((decision.action === 'supplement') !== seenElements.has(decision.element)) {
        report('WRITER_GAP_DECISION_INVALID', '补充决策必须对应一个同要素空位；省略决策不得生成空位。')
      }
      if (decision.action === 'supplement') {
        const allowedPurposes = {responsibility: ['clarify_contribution'], project: ['identify_object'],
          problem: ['explain_key_action'], solution: ['explain_key_action'],
          result: ['identify_deliverable', 'complete_existing_comparison']} as const
        const attached = input.paragraphs.filter(paragraph => paragraph.segments?.some(segment =>
          segment.kind === 'optional_gap_clause' && GAP_TEMPLATES[segment.template].element === decision.element))
        if (!(allowedPurposes[decision.element] as readonly string[]).includes(decision.purpose)
          || !attached.some(paragraph => decision.contextEvidenceIds.every(id => paragraph.evidenceIds.includes(id)))) {
          report('WRITER_GAP_DECISION_INVALID', '补充作用须匹配五要素；依附事实引用须在实际留白段落中使用。')
        }
      }
      if (decision.action === 'supplement' && (input.gapContextComplete === false
        || new Set(decision.contextEvidenceIds).size !== decision.contextEvidenceIds.length
        || decision.contextEvidenceIds.some(id => !ownIds.has(id))
        || new Set(decision.targetTaskIds).size !== decision.targetTaskIds.length
        || decision.targetTaskIds.some(id => !taskIds.has(id)))) {
        report('WRITER_GAP_DECISION_INVALID', '补充须依附本经历已准入正文事实及合法岗位任务；上下文未完整传入时不能将未看到认证为真实缺失。')
      }
    }
  }
  if (gapCount > 2) report('WRITER_GAP_BUDGET_EXCEEDED', '每条重点经历最多保留两个独立且有价值的最小缺口。')
  return issues
}

/** Only the presentation has annotations. Fact budgets and evidence credit are unchanged. */
export function deliveryLength(markdown: string, policy: GenerationPolicy) {
  return policy.outputLength.unit === 'cjk_characters'
    ? (markdown.match(/[\u4e00-\u9fff]/gu) ?? []).length : markdown.trim().split(/\s+/u).length
}
export function validateDeliveryBudget(markdown: string, policy: GenerationPolicy) {
  if (deliveryLength(markdown, policy) > policy.outputLength.hardMax) throw new SupportedWritingError([
    writingIssue('WRITER_GAP_BUDGET_EXCEEDED', 'entries', [], '填写说明使交付正文超过既有篇幅上限；减少低优先级留白，保留已有事实。'),
  ])
}
