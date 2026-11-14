import { z } from 'zod'
import { COMPLETION_TEMPLATES, renderCompletionHint } from '@/shared/resume-completion'
import type { EvidenceAtom, GenerationPolicy, ValidationIssue } from '@/v5/types'
import { SupportedWritingError } from './compiler'
import { writingIssue, inspectSupportedWriting } from './facts'
import type { SourceUncertainty } from './source-uncertainties'
import {resumeDetailRequirements} from './information-routing'

export const FIVE_ELEMENTS = ['responsibility', 'project', 'problem', 'solution', 'result'] as const
export const fiveElementCoverageSchema = z.object({
  element: z.enum(FIVE_ELEMENTS),
  status: z.enum(['known', 'missing', 'ambiguous', 'not_applicable']),
  evidenceIds: z.array(z.string().min(1)).max(80),
  answer: z.string().trim().min(1).max(600).optional(),
  resultKind: z.enum(['deliverable', 'adoption', 'business_outcome', 'unknown', 'not_applicable']).optional(),
}).strict()
export const entryCoverageSchema = z.array(fiveElementCoverageSchema).length(5)
export const gapDecisionSchema = z.discriminatedUnion('action', [
  z.object({element: z.enum(FIVE_ELEMENTS), action: z.literal('omit'),
    reason: z.enum(['already_clear', 'low_value', 'not_established', 'too_complex', 'duplicate', 'context_incomplete'])}).strict(),
  z.object({element: z.enum(FIVE_ELEMENTS), action: z.literal('supplement'),
    purpose: z.enum(['clarify_contribution', 'explain_key_action', 'identify_deliverable', 'complete_existing_comparison', 'identify_object']),
    contextEvidenceIds: z.array(z.string().min(1)).min(1).max(80), targetTaskIds: z.array(z.string().min(1)).max(30)}).strict(),
])
export const gapDecisionsSchema = z.array(gapDecisionSchema)
export type GapDecision = z.infer<typeof gapDecisionSchema>
export const gapCandidateSchema = z.discriminatedUnion('kind', [
  z.object({kind: z.literal('source'), text: z.string().trim().min(1).max(24), evidenceId: z.string().min(1)}).strict(),
  z.object({kind: z.literal('design_deliverables')}).strict(),
  z.object({kind: z.literal('implementation_stages')}).strict(),
])
export const metricGapSchema = z.object({
  evidenceId: z.string().min(1), object: z.string().trim().min(2).max(30),
  missing: z.enum(['value', 'unit', 'month']),
  before: z.string().min(1).max(120), after: z.string().max(120),
}).strict()
export const detailKindSchema = z.enum(['role_detail', 'project_name', 'problem', 'research_problem', 'method',
  'design_deliverable', 'metric_detail', 'implementation_stage', 'metric_definition', 'metric_period', 'metric_population', 'human_intervention', 'research_finding'])
export const detailAssessmentSchema = z.object({
  detailId: z.string().min(1), element: z.enum(FIVE_ELEMENTS), detailKind: detailKindSchema,
  subject: z.string().trim().min(1).max(120),
  anchorEvidenceIds: z.array(z.string().min(1)).min(1), targetTaskIds: z.array(z.string().min(1)),
  sourceState: z.enum(['known', 'missing', 'ambiguous', 'context_incomplete', 'not_established']),
  answerEvidenceIds: z.array(z.string().min(1)),
  expressionState: z.enum(['clear', 'underspecified', 'not_used']),
  decision: z.enum(['keep', 'use_source', 'supplement', 'omit']),
  reason: z.string().trim().min(1).max(240), benefit: z.string().trim().min(1).max(120),
}).strict()
export type DetailAssessment = z.infer<typeof detailAssessmentSchema>
export const uncertaintyResolutionSchema = z.object({
  uncertaintyId: z.string().min(1), action: z.enum(['dependent_claim', 'use_safe_facts', 'omit']),
  claimId: z.string().min(1).nullable(),
  reason: z.enum(['metadata_fields', 'requires_evidence', 'conflict', 'safe_alternative', 'unrelated']),
  explanation: z.string().trim().min(1).max(240),
}).strict()
export type UncertaintyResolution = z.infer<typeof uncertaintyResolutionSchema>
export const factSegmentSchema = z.object({kind: z.literal('fact'), text: z.string().min(1).max(6000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(80)}).strict()
const gapFields = {
  template: detailKindSchema, metric: metricGapSchema.nullish(),
  hint: z.string().trim().min(1).max(240).optional(),
  candidates: z.array(gapCandidateSchema).max(3),
}
export const optionalGapSchema = z.object({kind: z.literal('optional_gap_clause'),
  detailId: z.string().min(1).optional(), ...gapFields}).strict()
export const requiredDetailGapSchema = z.object({kind: z.literal('required_detail_gap'),
  detailId: z.string().min(1), ...gapFields}).strict()
export const dependentClaimSchema = z.object({
  kind: z.literal('dependent_claim'), claimId: z.string().min(1), sourceEvidenceIds: z.array(z.string().min(1)).min(1),
  sourceSpans: z.array(z.object({sourceBlockId: z.string().min(1), start: z.number().int().nonnegative(), end: z.number().int().nonnegative()}).strict()).min(1),
  readiness: z.enum(['metadata_missing', 'context_incomplete', 'conflicted']), qualifiers: z.array(z.string().min(1)).min(1),
  parts: z.array(z.discriminatedUnion('kind', [factSegmentSchema, requiredDetailGapSchema])).min(1),
  requiredDetailIds: z.array(z.string().min(1)).min(1), fillPolicy: z.literal('all_required'),
}).strict()
export const entrySegmentSchema = z.discriminatedUnion('kind', [factSegmentSchema, optionalGapSchema, dependentClaimSchema])
export const entrySegmentV4Schema = z.discriminatedUnion('kind', [factSegmentSchema, optionalGapSchema.extend({detailId: z.string().min(1)}), dependentClaimSchema])
const shortHintSchema = z.string().trim().min(1).max(240)
export const entrySegmentV6Schema = z.discriminatedUnion('kind', [factSegmentSchema,
  optionalGapSchema.extend({detailId: z.string().min(1), hint: shortHintSchema}),
  dependentClaimSchema.extend({parts: z.array(z.discriminatedUnion('kind', [factSegmentSchema, requiredDetailGapSchema.extend({hint: shortHintSchema})])).min(1)}),
])
export type EntrySegment = z.infer<typeof entrySegmentSchema>
export type EntryCoverage = z.infer<typeof entryCoverageSchema>
export type FactSegment = z.infer<typeof factSegmentSchema>
export type GapSegment = z.infer<typeof optionalGapSchema>
export type RequiredDetailGap = z.infer<typeof requiredDetailGapSchema>
export type DependentClaim = z.infer<typeof dependentClaimSchema>

const METRIC_MARKERS = {value: '[数值缺失]', unit: '[单位缺失]', month: '[月份缺失]'} as const
const METRIC_GUIDANCE = {value: '填这一个实际数值', unit: '填这一数值的实际单位', month: '填这一个实际月份'} as const

export const GAP_TEMPLATES = COMPLETION_TEMPLATES

export const GAP_GUIDANCE = Object.entries(GAP_TEMPLATES).map(([template, value]) => ({
  template, element: value.element, fill: value.instruction,
}))

export function gapPresentation(segment: GapSegment | RequiredDetailGap) {
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

const OPTIONAL_BOUNDARY_PUNCTUATION = /^[，。；！？,;.!?]/u
const UNFINISHED_OPTIONAL_ANCHOR = /(?:针对|围绕|采用|交付|负责|提升至|降低至|从|至|为|达|约)\s*$/u

/** Element is a template lookup, not a second model judgment about the source. */
export function normalizeDetailTemplateElements(details: readonly DetailAssessment[],
  paragraphs: ReadonlyArray<{segments?: EntrySegment[]}>): DetailAssessment[] {
  const ids = new Map<string, number>()
  const templates = new Map<string, Set<string>>()
  for (const detail of details) ids.set(detail.detailId, (ids.get(detail.detailId) ?? 0) + 1)
  const record = (gap: GapSegment | RequiredDetailGap) => {
    if (!gap.detailId) return
    const kinds = templates.get(gap.detailId) ?? new Set<string>()
    kinds.add(gap.template)
    templates.set(gap.detailId, kinds)
  }
  for (const paragraph of paragraphs) for (const segment of paragraph.segments ?? []) {
    if (segment.kind === 'optional_gap_clause') record(segment)
    if (segment.kind === 'dependent_claim') for (const part of segment.parts) if (part.kind === 'required_detail_gap') record(part)
  }
  return details.map(detail => {
    const kinds = templates.get(detail.detailId)
    // An ambiguous identifier or conflicting template still requires correction.
    if (ids.get(detail.detailId) !== 1 || kinds && (kinds.size !== 1 || !kinds.has(detail.detailKind))) return {...detail}
    return {...detail, element: GAP_TEMPLATES[detail.detailKind].element}
  })
}

/** Transfer existing punctuation across optional clauses; never invent facts or a closing stop. */
export function normalizeOptionalGapPunctuation(segments: readonly EntrySegment[]): EntrySegment[] {
  const next = structuredClone([...segments])
  for (let index = 0; index < next.length; index++) {
    if (next[index].kind !== 'optional_gap_clause' || next[index - 1]?.kind !== 'fact') continue
    const before = next[index - 1] as FactSegment
    let afterIndex = index + 1
    while (next[afterIndex]?.kind === 'optional_gap_clause') afterIndex++
    const after = next[afterIndex]
    const stop = before.text.match(/[，。；！？,;.!?](\s*)$/u)
    if (!stop || !before.text.slice(0, -stop[0].length).trim()
      || UNFINISHED_OPTIONAL_ANCHOR.test(before.text.slice(0, -stop[0].length))) continue
    if (!after) {
      // A trailing comma does not prove that a source sentence is complete.
      if (!/^[。.！？!?]/u.test(stop[0])) continue
      before.text = before.text.slice(0, -stop[0].length)
      next.push({kind: 'fact', text: stop[0], evidenceIds: [...before.evidenceIds]})
    } else if (after.kind === 'fact' && !OPTIONAL_BOUNDARY_PUNCTUATION.test(after.text)) {
      before.text = before.text.slice(0, -stop[0].length)
      after.text = `${stop[0]}${after.text}`
    }
  }
  return next
}

export function renderEntrySegments(segments: readonly EntrySegment[], enabledGapIndices?: ReadonlySet<number>): string {
  return segments.map((segment, index) => {
    if (segment.kind === 'fact') return segment.text
    if (segment.kind === 'dependent_claim') return segment.parts.map(part => part.kind === 'fact' ? part.text
      : renderEntrySegments([{...part, kind: 'optional_gap_clause'}])).join('')
    if (enabledGapIndices && !enabledGapIndices.has(index)) return ''
    const template = gapPresentation(segment)
    const hint = renderCompletionHint(segment)
    return `${template.prefix}【待完善：${hint}】${template.suffix}`
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
  requireDetails?: boolean
  requireInformationRouting?: boolean
  detailAssessments?: DetailAssessment[]
  uncertaintyResolutions?: UncertaintyResolution[]
  sourceUncertainties?: SourceUncertainty[]
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
  entryId?: string
}) {
  const issues: ValidationIssue[] = []
  const reportIssue: Report = (code, message, location) => {
    const identity = [code, location?.subcode, location?.detailId, location?.paragraphIndex, location?.segmentIndex].join('|')
    const issue = writingIssue(identity, input.outputPath, [], message)
    issues.push({...issue, code, ...location})
  }
  const report = reportIssue
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
  const details = new Map((input.detailAssessments ?? []).map(detail => [detail.detailId, detail]))
  const seenDetails = new Set<string>()
  const seenElements = new Set<string>()
  for (const [paragraphIndex, paragraph] of input.paragraphs.entries()) {
    const paragraphReport: Report = (code, message, location) => reportIssue(code, message, {paragraphIndex, ...location})
    if (!paragraph.segments) { report('WRITER_SEGMENTS_INVALID', '同一新契约条目不得混用自由文本和分段正文。'); continue }
    const segments = paragraph.segments
    if (projectFactSegments(segments) !== paragraph.text
      || JSON.stringify(segmentEvidenceIds(segments)) !== JSON.stringify(paragraph.evidenceIds)) {
      report('WRITER_PROJECTION_MISMATCH', '事实段与编译投影不一致。')
    }
    for (const [index, segment] of segments.entries()) {
      const report: Report = (code, message, location) => paragraphReport(code, message, {segmentIndex: index, ...location})
      if (segment.kind === 'fact') {
        if (/【待完善|[\r\n]|```|<\/?[a-z][^>]*>/iu.test(segment.text)) {
          report('WRITER_SEGMENTS_INVALID', '事实段不能包含留白、换行或结构标记。')
        }
        continue
      }
      if (segment.kind === 'dependent_claim') {
        inspectDependentClaim(segment, input, details, seenDetails, new Set(paragraph.evidenceIds), report)
        continue
      }
      const template = GAP_TEMPLATES[segment.template]
      const element = coverage.get(template.element)
      if (!input.business || !element || (!input.requireDetails && (!['missing', 'ambiguous'].includes(element.status) || seenElements.has(template.element)))) {
        report('WRITER_KNOWN_ELEMENT_BLANKED', '仅业务经历中真实缺失或待核对的单一要素可留白，同要素不重复挖空。')
      }
      seenElements.add(template.element)
      if (input.requireDetails) inspectDetailGap(segment, input, details, seenDetails, new Set(paragraph.evidenceIds), report)
      // Optional clauses own the comma and all unknown syntax. A bare marker can
      // never be used to complete a mandatory verb, subject or numeric comparison.
      let beforeIndex = index - 1, afterIndex = index + 1
      while (input.requireDetails && segments[beforeIndex]?.kind === 'optional_gap_clause') beforeIndex--
      while (input.requireDetails && segments[afterIndex]?.kind === 'optional_gap_clause') afterIndex++
      const before = segments[beforeIndex], after = segments[afterIndex]
      if (before?.kind !== 'fact' || after?.kind !== 'fact'
        || /[，。；：！？、,;:!?]\s*$/u.test(before.text)
        || !OPTIONAL_BOUNDARY_PUNCTUATION.test(after.text)
        || UNFINISHED_OPTIONAL_ANCHOR.test(before.text)) {
        report('WRITER_GAP_BOUNDARY_INVALID', '留白必须是可整段删除的独立子句，事实投影不得留下未完成短语或比较。', {subcode: 'OPTIONAL_CLAUSE_BOUNDARY_INVALID', detailId: segment.detailId})
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
        if (candidate.kind === 'implementation_stages') {
          if (segment.template !== 'implementation_stage' || segment.candidates.length !== 1) report('WRITER_GAP_CANDIDATE_INVALID', '阶段选项只用于未明确的实施阶段，由用户确认。')
          continue
        }
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
  if (input.requireGapDecisions && !input.requireDetails) {
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
  if (input.requireDetails) inspectDetailAssessments(input, details, seenDetails, coverageIds, report)
  return issues
}

/** Only the presentation has annotations. Fact budgets and evidence credit are unchanged. */
export function deliveryLength(markdown: string, policy: GenerationPolicy) {
  return policy.outputLength.unit === 'cjk_characters'
    ? (markdown.match(/[\u4e00-\u9fff]/gu) ?? []).length : markdown.trim().split(/\s+/u).length
}
export function validateDeliveryBudget(markdown: string, policy: GenerationPolicy) {
  if (deliveryLength(markdown, policy) > policy.outputLength.hardMax) throw new SupportedWritingError([
    writingIssue('WRITER_FACT_LENGTH_EXCEEDED', 'entries', [], '事实正文超过既有篇幅上限；应精简重复正文，不能按填写格数量删掉有效缺口。'),
  ])
}

type SkeletonInput = Parameters<typeof inspectEntrySkeleton>[0]
type IssueLocation = Pick<ValidationIssue, 'subcode' | 'detailId' | 'paragraphIndex' | 'segmentIndex'> & {outputPath?: string | null}
type Report = (code: string, message: string, location?: IssueLocation) => void

function inspectDetailGap(gap: GapSegment | RequiredDetailGap, input: SkeletonInput,
  details: Map<string, DetailAssessment>, seen: Set<string>, paragraphEvidenceIds: Set<string>, report: Report) {
  const detail = gap.detailId && details.get(gap.detailId)
  if (!detail || detail.decision !== 'supplement' || detail.detailKind !== gap.template
    || detail.element !== GAP_TEMPLATES[gap.template].element || seen.has(detail.detailId)) {
    const subcode = !detail ? 'DETAIL_REFERENCE_MISSING' : seen.has(detail.detailId) ? 'DETAIL_GAP_DUPLICATE'
      : detail.decision !== 'supplement' ? 'DECISION_GAP_MISMATCH' : 'TEMPLATE_MISMATCH'
    report('WRITER_DETAIL_INVALID', '每个空位必须唯一对应同类型、同要素的真实细节补充决策。', {subcode, detailId: gap.detailId})
    return
  }
  seen.add(detail.detailId)
  if (input.requireInformationRouting && ['metric_definition', 'metric_period', 'metric_population', 'human_intervention'].includes(gap.template)) {
    report('WRITER_DETAIL_INVALID', '指标解释应进入面试准备，不在简历正文建立填写格；仅保留影响事实含义的最小缺口。', {subcode: 'INFORMATION_ROUTE_INVALID', detailId: detail.detailId})
  }
  if (detail.anchorEvidenceIds.some(id => !paragraphEvidenceIds.has(id))) {
    report('WRITER_DETAIL_INVALID', '细节留白必须放在锚定实践实际出现的段落，不能挂到同经历的其他内容上。', {subcode: 'ANCHOR_NOT_RENDERED_IN_PARAGRAPH', detailId: detail.detailId})
  }
  if (!['missing', 'ambiguous'].includes(detail.sourceState) || detail.answerEvidenceIds.length
    || input.gapContextComplete === false) report('WRITER_DETAIL_INVALID', '不能把已知答案、缺少实践或不完整上下文转成用户空位。', {
      subcode: detail.sourceState === 'known' || detail.answerEvidenceIds.length ? 'KNOWN_INFORMATION_BLANKED' : 'GAP_CONTEXT_INCOMPLETE', detailId: detail.detailId})
  if (['metric_definition', 'metric_period', 'metric_population', 'human_intervention'].includes(gap.template)
    && gap.candidates.length) report('WRITER_GAP_CANDIDATE_INVALID', '真实指标口径只能由用户填写，不提供猜测候选。')
}

function inspectDetailAssessments(input: SkeletonInput, details: Map<string, DetailAssessment>, seen: Set<string>,
  coverageIds: Set<string>, report: Report) {
  const assessments = input.detailAssessments ?? []
  if (!input.detailAssessments) report('WRITER_DETAIL_INVALID', '细节评估必须存在。', {subcode: 'DETAIL_ASSESSMENTS_MISSING'})
  const duplicateIds = new Set(assessments.filter((detail, index) => assessments.findIndex(item => item.detailId === detail.detailId) !== index).map(detail => detail.detailId))
  for (const detailId of duplicateIds) report('WRITER_DETAIL_INVALID', '细节评估的 detailId 不得重复。', {subcode: 'DETAIL_ID_DUPLICATE', detailId})
  const taskIds = new Set(input.targetTaskIds ?? [])
  const own = new Set(input.facts.map(fact => fact.evidenceId))
  const used = new Set(input.paragraphs.flatMap(paragraph => paragraph.evidenceIds))
  const claims = input.paragraphs.flatMap(paragraph => paragraph.segments?.filter((segment): segment is DependentClaim => segment.kind === 'dependent_claim') ?? [])
  for (const detail of assessments) {
    const locations = input.paragraphs.flatMap((paragraph, paragraphIndex) => (paragraph.segments ?? []).flatMap((segment, segmentIndex) =>
      segment.kind === 'optional_gap_clause' && segment.detailId === detail.detailId
        || segment.kind === 'dependent_claim' && segment.parts.some(part => part.kind === 'required_detail_gap' && part.detailId === detail.detailId)
        ? [{paragraphIndex, segmentIndex}] : []))
    const anchors = input.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.evidenceIds.some(id => detail.anchorEvidenceIds.includes(id)) ? [{paragraphIndex}] : [])
    // A missing gap has no segment to locate. Its admitted practice may be in
    // a later paragraph; the entry slot's first bullet is never its location.
    const candidates = locations.length ? locations : anchors
    const detailReport: Report = (code, message, location) => report(code, message,
      {...(candidates.length === 1 ? candidates[0] : {outputPath: input.entryId ?? input.outputPath}), detailId: detail.detailId, ...location})
    if (detail.element !== GAP_TEMPLATES[detail.detailKind].element) {
      detailReport('WRITER_DETAIL_INVALID', `detailId=${detail.detailId} 的 element 必须为模板规定的 ${GAP_TEMPLATES[detail.detailKind].element}。`, {subcode: 'TEMPLATE_MISMATCH'})
    }
    if (detail.anchorEvidenceIds.some(id => !coverageIds.has(id)) || detail.answerEvidenceIds.some(id => !coverageIds.has(id))) {
      detailReport('WRITER_DETAIL_INVALID', `detailId=${detail.detailId} 的 anchorEvidenceIds/answerEvidenceIds 只能引用本 entry 的 facts 或 gapContextFacts。`, {subcode: 'ANCHOR_INVALID'})
    }
    if (detail.targetTaskIds.some(id => !taskIds.has(id))) {
      detailReport('WRITER_DETAIL_INVALID', `detailId=${detail.detailId} 的 targetTaskIds 只能从本 entry.targetTaskIds=${JSON.stringify([...taskIds])} 逐字选择；没有对应任务时返回 []，不能借用其他 entry 或 jobTargeting 的 ID。`, {subcode: 'TASK_REFERENCE_INVALID'})
    }
    if ((detail.decision === 'supplement') !== seen.has(detail.detailId)) detailReport('WRITER_DETAIL_INVALID', '补充决策与实际空位必须一一对应。', {subcode: 'DECISION_GAP_MISMATCH'})
    if (detail.sourceState === 'known' && !detail.answerEvidenceIds.length) detailReport('WRITER_DETAIL_INVALID', '已知细节须引用实际答案。', {subcode: 'KNOWN_ANSWER_MISSING'})
    if (detail.decision === 'keep' && (detail.sourceState !== 'known' || detail.expressionState !== 'clear'
      || detail.answerEvidenceIds.some(id => !own.has(id) || !used.has(id)))) {
      detailReport('WRITER_DETAIL_INVALID', '保留决策须对应正文已经清晰呈现的已知答案，未写入或表达不足时应采用来源完善。', {subcode: 'ANSWER_NOT_RENDERED'})
    }
    if (detail.decision === 'use_source' && (detail.sourceState !== 'known'
      || detail.answerEvidenceIds.some(id => !own.has(id) || !used.has(id)))) {
      detailReport('WRITER_DETAIL_INVALID', '使用已知答案须通过正文准入并实际写入，不能只记录已知而不呈现。', {subcode: 'ANSWER_NOT_RENDERED'})
    }
    const owner = claims.find(claim => claim.requiredDetailIds.includes(detail.detailId))
    if (detail.decision === 'supplement' && !detail.anchorEvidenceIds.some(id => own.has(id) || owner?.sourceEvidenceIds.includes(id))) {
      detailReport('WRITER_DETAIL_INVALID', '普通补充必须依附已准入的真实实践。', {subcode: 'PRACTICE_ANCHOR_MISSING'})
    }
  }
  const uncertainties = input.sourceUncertainties ?? []
  const resolutions = input.uncertaintyResolutions ?? []
  const byId = new Map(resolutions.map(resolution => [resolution.uncertaintyId, resolution]))
  if (new Set(claims.map(claim => claim.claimId)).size !== claims.length) report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果 claimId 不得重复。')
  if (byId.size !== resolutions.length || resolutions.length !== uncertainties.length
    || resolutions.some(resolution => !uncertainties.some(signal => signal.uncertaintyId === resolution.uncertaintyId))) {
    report('WRITER_UNCERTAINTY_UNRESOLVED', '每条显式待核实来源必须有唯一、可追踪的处置，不能静默忽略。')
  }
  for (const signal of uncertainties) {
    const resolution = byId.get(signal.uncertaintyId)
    if (!resolution) continue
    if (resolution.action === 'dependent_claim') {
      if (resolution.reason !== 'metadata_fields' || !claims.some(claim => claim.claimId === resolution.claimId
        && claim.sourceEvidenceIds.includes(signal.evidenceId))) report('WRITER_UNCERTAINTY_UNRESOLVED', '结果补充决策必须关联实际依赖结果。')
    } else if (resolution.claimId !== null || claims.some(claim => claim.sourceEvidenceIds.includes(signal.evidenceId))) {
      report('WRITER_UNCERTAINTY_UNRESOLVED', '省略或安全替代的待核实结果不能同时出现在依赖结果中。')
    }
  }
}

function inspectDependentClaim(claim: DependentClaim, input: SkeletonInput, details: Map<string, DetailAssessment>,
  seen: Set<string>, paragraphEvidenceIds: Set<string>, report: Report) {
  const signals = (input.sourceUncertainties ?? []).filter(signal => claim.sourceEvidenceIds.includes(signal.evidenceId))
  const atoms = input.atoms.filter(atom => claim.sourceEvidenceIds.includes(atom.evidenceId) && atom.sourceScopeId === input.scopeId)
  const required = claim.parts.filter((part): part is RequiredDetailGap => part.kind === 'required_detail_gap')
  const ids = required.map(part => part.detailId)
  const text = claim.parts.filter((part): part is FactSegment => part.kind === 'fact').map(part => part.text).join('')
  if (!input.facts.some(fact => paragraphEvidenceIds.has(fact.evidenceId))) {
    report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果所在段落必须同时保留至少一句已准入的真实行动，不能只输出结果和填写格。')
  }
  if (!input.requireDetails || !input.business || !signals.length || signals.length !== claim.sourceEvidenceIds.length
    || new Set(claim.sourceEvidenceIds).size !== claim.sourceEvidenceIds.length
    || new Set(ids).size !== ids.length || claim.requiredDetailIds.length !== ids.length || new Set(claim.requiredDetailIds).size !== ids.length
    || claim.requiredDetailIds.some(id => !ids.includes(id))
    || claim.sourceSpans.some(span => !signals.some(signal => span.start === signal.sourceSpan.start && span.end === signal.sourceSpan.end
      && (!span.sourceBlockId || span.sourceBlockId === signal.sourceBlockId)))
    || claim.sourceSpans.length !== signals.length
    || signals.some(signal => !claim.sourceSpans.some(span => span.start === signal.sourceSpan.start && span.end === signal.sourceSpan.end && span.sourceBlockId === signal.sourceBlockId))) {
    report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果须锚定完整的同经历待核实来源，并精确关联全部必要字段。')
  }
  const readiness = signals.some(signal => signal.readiness === 'conflicted') ? 'conflicted'
    : signals.some(signal => signal.readiness === 'context_incomplete') ? 'context_incomplete' : 'metadata_missing'
  if (claim.readiness !== readiness) report('WRITER_DEPENDENT_CLAIM_INVALID', '填写不能改变来源冲突或资料不足的真实状态。')
  const expected = new Set(signals.flatMap(signal => input.requireInformationRouting ? resumeDetailRequirements(signal).map(item => item.detailKind) : signal.detailKinds))
  if ([...expected].some(kind => !required.some(gap => gap.template === kind))) {
    report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果必须包含来源明确指出的全部待核实维度，不能只填部分即放行。')
  }
  const auditQualifier = (value: string) => /原简历记载|来源记录|述职材料记录|待补证|待核实|待确认|未明确|未说明|不明/u.test(value)
  const sourceQualifiers = [...new Set([...atoms.flatMap(atom => atom.qualifiers.filter(value => atom.verbatimText.includes(value))),
    ...signals.flatMap(signal => signal.text.match(/原简历记载|来源记录|述职材料记录|待补证|待核实|待确认/gu) ?? [])])]
  if (sourceQualifiers.some(qualifier => !(input.requireInformationRouting && auditQualifier(qualifier)) && !text.includes(qualifier))) report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果不能省略来源已标明的归属和不确定性限定。')
  if (!claim.qualifiers.every(qualifier => signals.some(signal => signal.text.includes(qualifier)) && (text.includes(qualifier) || input.requireInformationRouting && auditQualifier(qualifier)))
    || !/待补证|待核实|待确认|未明确|未说明|不明|冲突/u.test(claim.qualifiers.join('；'))
    || !/^[，；,;]/u.test(text) || !/[。；;]$/u.test(text)) {
    report('WRITER_DEPENDENT_CLAIM_INVALID', '待核实结果须是独立可删除分句，保留来源中的待核实限定。')
  }
  for (const part of claim.parts) {
    if (part.kind === 'required_detail_gap') {
      inspectDetailGap(part, input, details, seen, new Set([...paragraphEvidenceIds, ...claim.sourceEvidenceIds]), report)
      if (!['metric_definition', 'metric_period', 'metric_population', 'human_intervention', 'implementation_stage'].includes(part.template)
        || part.candidates.length || part.metric) report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果只补真实口径或阶段，不猜测数值、效果或结论。')
    } else {
      if (part.evidenceIds.some(id => !claim.sourceEvidenceIds.includes(id))) report('WRITER_DEPENDENT_CLAIM_INVALID', '依赖结果文本只能引用该结果来源。')
      const fragment = part.text.replace(/^[，；,;\s]+|[。；;\s]+$/gu, '')
      if (fragment && !signals.some(signal => signal.text.includes(fragment))) report('WRITER_DEPENDENT_CLAIM_INVALID', '待核实结果只保留逐字来源，不新增或改写成果。')
    }
  }
  if (inspectSupportedWriting(text, atoms, input.outputPath).some(issue => issue.severity === 'error')) {
    report('WRITER_DEPENDENT_CLAIM_INVALID', '待核实结果仍须保留全部数字、责任和阶段边界。')
  }
}
