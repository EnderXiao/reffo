import type { EvidenceAtom } from '@/v5/types'

export interface SourceUncertainty {
  uncertaintyId: string
  evidenceId: string
  scopeId: string
  sourceBlockId: string
  sourceSpan: {start: number; end: number}
  text: string
  readiness: 'metadata_missing' | 'context_incomplete' | 'conflicted'
  detailKinds: Array<'metric_definition' | 'metric_period' | 'metric_population' | 'human_intervention' | 'implementation_stage'>
}

export function uncertaintyDetailRequirements(signal: SourceUncertainty): Array<{detailKind: SourceUncertainty['detailKinds'][number]; subject: string}> {
  const source = signal.text.replace(/^[-*+]\s*/u, '').replace(/^(?:(?:原简历记载|来源记录|述职材料记录)[：:\s]*)+/u, '')
    .replace(/(?<=\d)[,，](?=\d{3}(?:\D|$))/gu, '')
  const clauses = source.split(/[，,；;。！？!?、]/u)
  const metrics = clauses.flatMap(clause => {
    const match = clause.match(/^(.{2,60}?)[：:为达至约\s]*(\d+(?:\.\d+)?\s*\+?\s*(?:%|％|篇|条|小时|分钟|秒|元|万|个|人|次))/u)
    if (!match || /待补|待核|未明确|未说明/u.test(match[1])) return []
    const subject = match[1].trim().replace(/(?:达到|达至|为|至|约|下降到|降低至|提升至|由人工)\s*$/u, '')
    return subject ? [{subject, rate: /%|％/u.test(match[2]) || /率|比例|占比/u.test(subject)}] : []
  })
  const distinct = [...new Map(metrics.map(metric => [metric.subject, metric])).values()]
  return signal.detailKinds.flatMap(detailKind => {
    if (distinct.length < 2 || detailKind === 'implementation_stage') return [{detailKind, subject: signal.text.replace(/待补证.*$/u, '').slice(0, 100)}]
    if (detailKind === 'human_intervention') {
      const review = distinct.filter(metric => /审核|复核|人工|处理/u.test(metric.subject))
      return (review.length ? review : [{subject: '该结果对应的人工处理流程'}]).map(metric => ({detailKind, subject: metric.subject}))
    }
    if (detailKind === 'metric_definition') {
      const rates = distinct.filter(metric => metric.rate)
      return (rates.length ? rates : distinct).map(metric => ({detailKind, subject: metric.subject}))
    }
    const shared = signal.text.split(/[。；;]/u).some(clause => !/未|不明|是否|待补|待核|未知|不确定/u.test(clause)
      && /共用|统一|相同|同一/u.test(clause)
      && (detailKind === 'metric_period' ? /周期|统计时间|统计区间/u : /样本|统计对象|样本范围/u).test(clause))
    return (shared ? [{subject: distinct.map(metric => metric.subject).join('、')}] : distinct).map(metric => ({detailKind, subject: metric.subject}))
  })
}

/** Source-owned wording makes result attribution and uncertainty reproducible. */
export function sourceClaimTemplate(signal: SourceUncertainty) {
  const text = signal.text.trim().replace(/^[-*+]\s+/u, '').replace(/[。；;]\s*$/u, '')
  return {uncertaintyId: signal.uncertaintyId, sourceEvidenceIds: [signal.evidenceId],
    sourceSpans: [{sourceBlockId: signal.sourceBlockId, ...signal.sourceSpan}], readiness: signal.readiness,
    qualifiers: [...new Set(signal.text.match(/原简历记载|来源记录|述职材料记录|待补证|待核实|待确认|未明确|未说明|不明|冲突/gu) ?? [])],
    sourceFact: {kind: 'fact' as const, text: `；${text}`, evidenceIds: [signal.evidenceId]},
    closingFact: {kind: 'fact' as const, text: '。', evidenceIds: [signal.evidenceId]},
    requiredTemplates: [...signal.detailKinds], requiredDetails: uncertaintyDetailRequirements(signal)}
}

/** New resume copy keeps the assertion and its real qualifiers, with audit text confined to provenance. */
export function sourceClaimTemplateV6(signal: SourceUncertainty) {
  if (!signal.detailKinds.includes('implementation_stage') || signal.readiness !== 'metadata_missing') return null
  const legacy = sourceClaimTemplate(signal)
  const sourceText = signal.text.trim().replace(/^[-*+•]\s*/u, '')
    .replace(/^(?:(?:来源记录|原简历记载|述职材料记录)[：:\s]*)+/u, '')
    .replace(/[，,]\s*(?:[^，,]*阶段|上线状态|实施状态).{0,12}(?:未明确|未说明|待补证|待核实|待确认)[\s\S]*$/u, '')
    .split(/[；;。]/u).filter(part => !/待补证|待核实|待确认|未明确|未说明|不明|冲突/u.test(part)).join('；')
    .replace(/[；;。]+$/u, '').trim()
  if (!sourceText) return null
  return {...legacy, sourceFact: {kind: 'fact' as const, text: `；${sourceText}`, evidenceIds: [signal.evidenceId]},
    requiredTemplates: ['implementation_stage'] as const,
    requiredDetails: [{detailKind: 'implementation_stage' as const, subject: sourceText.slice(0, 100)}]}
}

/** Keep unresolved source material separate from facts admitted to the artifact. */
export function sourceUncertainties(atoms: readonly EvidenceAtom[], scopeId: string | null): SourceUncertainty[] {
  return atoms.flatMap(atom => {
    if (atom.sourceScopeId !== scopeId || atom.status === 'excluded'
      || atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text'].includes(flag))) return []
    const text = atom.verbatimText
    const explicit = /待补证|待核实|待确认|尚待核对|口径.{0,8}(?:不明|未说明|未明确)|(?:标准|周期|范围|阶段|数据来源|取数方法).{0,8}(?:待补|待核|未明确|未说明)/u.test(text)
    const conflict = atom.riskFlags.includes('conflicting')
    if (!explicit && !conflict) return []
    const kinds: SourceUncertainty['detailKinds'] = []
    // Only the qualified clause defines missing fields; earlier recorded dates
    // and metrics must not turn into new gaps merely because they exist.
    const qualified = text.split(/[。；;]/u).filter(part => /待补|待核|待确认|未说明|未明确|不明|冲突/u.test(part)).join('；')
    if (/标准|定义|有效.{0,5}(?:口径|判定)/u.test(qualified)) kinds.push('metric_definition')
    if (/周期|统计时间|统计区间/u.test(qualified)) kinds.push('metric_period')
    if (/样本|统计对象|样本范围/u.test(qualified)) kinds.push('metric_population')
    if (/人工|人审|介入/u.test(qualified)) kinds.push('human_intervention')
    if (/阶段|上线状态|实施状态/u.test(qualified)) kinds.push('implementation_stage')
    return [{uncertaintyId: `uncertainty:${atom.evidenceId}`, evidenceId: atom.evidenceId, scopeId: atom.sourceScopeId,
      sourceBlockId: atom.sourceBlockId, sourceSpan: {...atom.sourceSpan}, text,
      readiness: conflict ? 'conflicted' as const : kinds.length || /数据来源|取数方法|数据出处/u.test(qualified) ? 'metadata_missing' as const : 'context_incomplete' as const,
      detailKinds: kinds}]
  })
}
