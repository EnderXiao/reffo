import {createDigest} from '@/harness/run-context'
import type {EvidenceAtom} from '@/v5/types'
import type {OptimizationAction} from '@/shared/resume-actions'
import {sourceUncertainties, type SourceUncertainty} from './source-uncertainties'

export const INFORMATION_ROUTING_POLICY = 'assertion-routing-v1' as const
export type PreparationDimension = 'definition' | 'period' | 'population' | 'data_source' | 'human_intervention'
export interface InterviewPreparationTopic {
  topicId: string
  scopeId: string
  caseGroupId?: string
  subject: string
  dimensions: PreparationDimension[]
  sourceEvidenceIds: string[]
  sourceSpans: Array<{sourceBlockId: string; start: number; end: number}>
  requirementIds: string[]
  actionIds: string[]
  sourceAssertionStatus: 'recorded' | 'meaning_incomplete' | 'conflicted'
  sourceStatement: string
  prompt: string
  preparationFocus: string
  userNotes?: Array<{detailId?: string; text: string; provenance?: {documentId: string; revision: number; gapId?: string}}>
}
export interface RoutedAssertion {
  assertionId: string
  evidenceId: string
  scopeId: string
  sourceSpan: {sourceBlockId: string; start: number; end: number}
  sourceText: string
  resumeDisposition: 'use_source' | 'short_gap' | 'safe_projection' | 'omit'
  resumeText: string
  preparationTopicIds: string[]
  reason: string
}
const unique = <T>(items: T[]) => [...new Set(items)]
const stable = (prefix: string, value: unknown) => `${prefix}:${createDigest(JSON.stringify(value)).slice(0, 20)}`
const uncertainty = /待补证|待核实|待确认|尚待核对|未明确|未说明|不明|冲突|未记录/u
const dimensionPatterns: Array<[PreparationDimension, RegExp, string]> = [
  ['definition', /标准|定义|口径|有效性判定/u, '指标的实际定义与判断标准'],
  ['period', /周期|统计时间|统计区间|起止时间/u, '统计时间与比较区间'],
  ['population', /样本|统计对象|样本范围|统计范围/u, '样本选择及适用范围'],
  ['data_source', /来源|数据源|取数|数据出处/u, '数据来源与取数方法'],
  ['human_intervention', /人工|人审|介入/u, '人工仍参与的环节与自动化边界'],
]

/** Split at sentence/clause boundaries only; comparisons and numeric qualifiers stay together. */
function fragments(atom: EvidenceAtom) {
  return [...atom.verbatimText.matchAll(/[^；;。！？!?]+[；;。！？!?]?/gu)].flatMap(match => {
    const text = match[0]
    const boundary = [...text.matchAll(/[，,]/gu)].find(item => {
      const tail = text.slice((item.index ?? 0) + 1)
      return !/\d/u.test(tail) && isMetadataClause(tail)
    })
    if (boundary?.index !== undefined) return [
      {text: text.slice(0, boundary.index), start: atom.sourceSpan.start + (match.index ?? 0), end: atom.sourceSpan.start + (match.index ?? 0) + boundary.index},
      {text: text.slice(boundary.index + 1), start: atom.sourceSpan.start + (match.index ?? 0) + boundary.index + 1, end: atom.sourceSpan.start + (match.index ?? 0) + text.length},
    ]
    return [{
    text: match[0], start: atom.sourceSpan.start + (match.index ?? 0), end: atom.sourceSpan.start + (match.index ?? 0) + match[0].length,
    }]
  })
}
function ordinarySource(text: string) {
  return text.trim().replace(/^[-*+•]\s*/u, '')
    .replace(/^(?:(?:来源记录|原简历记载|述职材料记录)[：:\s]*)+/u, '')
    .replace(/[；;。]\s*$/u, '').trim()
}
function isMetadataClause(text: string) {
  return uncertainty.test(text) && /标准|定义|口径|周期|统计时间|统计区间|样本|统计对象|统计范围|数据来源|取数|人工|人审|介入/u.test(text)
    && !/未(?:真实)?(?:正式)?(?:开发)?上线|尚未上线|未实施|未落地|未验证|未经验证|冲突|不一致/u.test(text)
}
function dimensions(text: string): PreparationDimension[] {
  return dimensionPatterns.flatMap(([kind, pattern]) => pattern.test(text) ? [kind] : [])
}
function meaningfulProjection(text: string) {
  const endpoint = text.trim().match(/^(.*?)([^，,；;。]*?)(?:从|由)(\d+(?:\.\d+)?\s*(?:%|％|分钟|小时|秒|元|万|亿|人|条|个|次|天|周|月|年))(?:提升至|提高至|增长至|降低至|减少至|下降至|增至|降至|达到)\s*(?:\[数值缺失\])?(?:%|％|分钟|小时|秒|元|万|亿|人|条|个|次|天|周|月|年)?[。；;]?$/u)
  if (endpoint && endpoint[2].trim()) return `${ordinarySource(endpoint[1])}${endpoint[2].trim()}基线为${endpoint[3]}`
  const before = text.split(/[，,]/u)[0]
  return before && !/\d/u.test(before) && /参与|负责|设计|形成|输出|交付|梳理|调研|访谈|开发|搭建/u.test(before)
    ? ordinarySource(before) : ''
}

/** Authoritative, deterministic routing. It never alters evidence status or marks a claim confirmed. */
export function routeSourceInformation(input: {atoms: readonly EvidenceAtom[]; scopeId?: string | null; actions?: readonly OptimizationAction[]}) {
  const atoms = input.atoms.filter(atom => (input.scopeId === undefined || atom.sourceScopeId === input.scopeId)
    && atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag)))
  const signals = unique(atoms.map(atom => atom.sourceScopeId)).flatMap(scopeId => sourceUncertainties(atoms, scopeId))
  const byEvidence = new Map(signals.map(signal => [signal.evidenceId, signal]))
  const assertions: RoutedAssertion[] = []
  const topics = new Map<string, InterviewPreparationTopic>()
  const admittedTextByEvidence = new Map<string, string>()
  for (const atom of atoms) {
    const signal = byEvidence.get(atom.evidenceId)
    const missingMeaning = /\[(?:数值|单位|月份)缺失\]|(?:单位|比较终值).{0,6}(?:缺失|未记录|未明确)/u.test(atom.verbatimText)
      || /\d[\s\S]*(?:提升至|提高至|增长至|降低至|减少至|下降至|增至|降至|达到)\s*[。；;]?$/u.test(atom.verbatimText)
    if (!signal && !missingMeaning) {admittedTextByEvidence.set(atom.evidenceId, atom.verbatimText); continue}
    const pieces = fragments(atom)
    const metadata = pieces.filter(piece => isMetadataClause(piece.text))
    const metadataDimensions = dimensions(metadata.map(piece => piece.text).join('；'))
    const wholeConflict = atom.riskFlags.includes('conflicting') || /(?:结果|数据|指标|数值).{0,8}(?:冲突|不一致)/u.test(atom.verbatimText)
    const admitted: string[] = []
    for (const piece of pieces) {
      const sourceText = piece.text.trim()
      if (!sourceText) continue
      let resumeDisposition: RoutedAssertion['resumeDisposition'] = 'use_source'
      let resumeText = ordinarySource(sourceText)
      let reason = '来源已记录的完整事实；计算方法不属于简历必填信息。'
      if (missingMeaning && (/\[(?:数值|单位|月份)缺失\]|(?:单位|比较终值).{0,6}(?:缺失|未记录|未明确)/u.test(sourceText)
        || /\d[\s\S]*(?:提升至|提高至|增长至|降低至|减少至|下降至|增至|降至|达到)\s*[。；;]?$/u.test(sourceText))) {
        resumeDisposition = 'short_gap'; resumeText = wholeConflict ? '' : meaningfulProjection(sourceText)
        reason = '只补影响比较含义的数值、单位或终点；保留明确基线或独立行动，不导出悬空比较。'
      } else if (isMetadataClause(sourceText)) {
        resumeDisposition = 'omit'; resumeText = ''; reason = '指标解释进入面试准备，不占用简历正文。'
      } else if (wholeConflict || uncertainty.test(sourceText)) {
        // An explicitly separate action can survive a disputed outcome in the
        // same atom. A mixed or numerical disputed fragment is never released.
        const safeAction = !uncertainty.test(sourceText) && !/[%％]|成果|有效率|收益|增长|提升|降低|节省/u.test(sourceText)
          && /参与|负责|设计|形成|输出|交付|梳理|调研|访谈|开发|搭建/u.test(sourceText)
        if (safeAction) {resumeDisposition = 'safe_projection'; reason = '保留独立、无争议的实际行动，争议结果另行准备。'}
        else {resumeDisposition = 'omit'; resumeText = ''; reason = '该断言尚未成立或含义不完整，不通过填写口径自动放行。'}
      }
      const preparationTopicIds: string[] = []
      const metricClauses = resumeText ? resumeText.split(/，|、|(?<!\d),(?!\d{3}(?:\D|$))/u).filter(text => /\d/u.test(text)) : []
      // Avoid inventing a metric: an uncertain non-metric fragment gets one
      // source-scoped preparation prompt, never a fabricated numeric subject.
      const subjects = metricClauses.length ? metricClauses : resumeDisposition === 'omit' && !isMetadataClause(sourceText) ? [ordinarySource(sourceText)] : []
      for (const statement of subjects) {
        const subject = statement.replace(/^[\s；;，,]+/u, '').replace(/[：:为达至约\s]*\d[\s\S]*$/u, '').trim().slice(0, 100) || '该项结果'
        const topicId = stable('preparation', [atom.sourceScopeId, atom.sourceBlockId, subject])
        const related = (input.actions ?? []).filter(action => action.evidenceIds.includes(atom.evidenceId) || action.sourceScopeIds.includes(atom.sourceScopeId))
        const dims = metadataDimensions.length ? metadataDimensions : dimensions(sourceText)
        if (!dims.length && !wholeConflict && resumeDisposition !== 'omit') continue
        const status = wholeConflict ? 'conflicted' : resumeDisposition === 'omit' ? 'meaning_incomplete' : 'recorded'
        const focus = dimensionPatterns.filter(([kind]) => dims.includes(kind)).map(([, , label]) => label).join('、')
        const topic: InterviewPreparationTopic = {topicId, scopeId: atom.sourceScopeId, subject,
          dimensions: dims, sourceEvidenceIds: [atom.evidenceId], sourceSpans: [{sourceBlockId: atom.sourceBlockId, start: piece.start, end: piece.end},
            ...metadata.map(item => ({sourceBlockId: atom.sourceBlockId, start: item.start, end: item.end}))],
          requirementIds: unique(related.flatMap(action => action.requirementIds)), actionIds: unique(related.map(action => action.actionId)),
          sourceAssertionStatus: status, sourceStatement: statement.trim(),
          prompt: status === 'recorded' ? `你在${subject}中如何界定结果并取得数据？` : `关于${subject}，哪些结果已有依据，哪些仍需澄清？`,
          preparationFocus: focus ? `准备${focus}，结合本人负责环节说明结果边界。` : '区分已完成行动、可支持结果与尚未证实部分，不预设结果已成立。'}
        const existing = topics.get(topicId)
        if (existing) {existing.dimensions = unique([...existing.dimensions, ...dims]); existing.sourceSpans = unique([...existing.sourceSpans.map(span => JSON.stringify(span)), ...topic.sourceSpans.map(span => JSON.stringify(span))]).map(value => JSON.parse(value)); existing.sourceEvidenceIds = unique([...existing.sourceEvidenceIds, atom.evidenceId])}
        else topics.set(topicId, topic)
        preparationTopicIds.push(topicId)
      }
      assertions.push({assertionId: stable('assertion', [atom.evidenceId, piece.start, piece.end]), evidenceId: atom.evidenceId, scopeId: atom.sourceScopeId,
        sourceSpan: {sourceBlockId: atom.sourceBlockId, start: piece.start, end: piece.end}, sourceText, resumeDisposition, resumeText,
        preparationTopicIds, reason})
      if (resumeText) admitted.push(resumeText)
    }
    if (admitted.length) {
      // A methodology tail can also contain a real project boundary. Retain its
      // exact span independently; stripping audit wording must not erase stage,
      // verification or attribution constraints from the same source atom.
      const materialBoundaries = [...atom.verbatimText.matchAll(/(?:尚未|未曾|未)(?:真实)?(?:正式)?(?:开发)?(?:上线|发布|验证|实施|落地)|未经(?:实际)?验证|(?:尚未|未曾|未)(?:开展|进行)(?:评测|测试)|(?:没有|尚无|无)(?:真实用户|实际用户|商业收益|长期运行数据)/gu)]
      for (const boundary of materialBoundaries) if (!admitted.some(text => text.includes(boundary[0]))) {
        const start = atom.sourceSpan.start + (boundary.index ?? 0)
        admitted.push(boundary[0])
        assertions.push({assertionId: stable('assertion', [atom.evidenceId, start, 'boundary']), evidenceId: atom.evidenceId,
          scopeId: atom.sourceScopeId, sourceSpan: {sourceBlockId: atom.sourceBlockId, start, end: start + boundary[0].length},
          sourceText: boundary[0], resumeDisposition: 'safe_projection', resumeText: boundary[0], preparationTopicIds: [],
          reason: '保留来源明确的实施或验证边界，避免指标解释分流时丢失事实性质。'})
      }
      admittedTextByEvidence.set(atom.evidenceId, admitted.join('；').replace(/[；;。]+$/u, '') + '。')
    }
  }
  return {policy: INFORMATION_ROUTING_POLICY, assertions, preparationTopics: [...topics.values()], admittedTextByEvidence,
    uncertainEvidenceIds: unique([...signals.map(signal => signal.evidenceId), ...assertions.map(assertion => assertion.evidenceId)])}
}

/** Only information that changes the claim meaning remains eligible for a short resume blank. */
export function resumeDetailRequirements(signal: SourceUncertainty) {
  return signal.detailKinds.filter(kind => kind === 'implementation_stage').map(detailKind => ({detailKind, subject: ordinarySource(signal.text).slice(0, 100)}))
}
