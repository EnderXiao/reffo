import type {EntryBrief, WrittenEntry} from './entries'
import type {WritingFact} from './facts'
import {SupportedWritingError} from './compiler'
import {writingIssue} from './facts'

// Recovery only selects literal, affirmative source names. It never invents
// method-to-outcome links, proficiency, personal ownership or new tool use.
const PRACTICE_NAMES = /\b(?:SQL|Excel|Python|Java|MySQL|Redis|Kafka|Spring(?:\s+Boot|\s+Cloud)?|JVM|Docker|Kubernetes|Linux|Figma|Tableau|Power\s*BI|SPSS|SAP|Jira|PRD|C\+\+|JavaScript|TypeScript)\b|业务规则建模|需求分析|用户研究|用户调研|门店调研|竞品分析|用户访谈|深度访谈|问卷(?:调研|调查)?|访谈|行为分析|日志分析|数据分析|数据埋点|敏捷迭代|灰度测试|A\s*[/／-]\s*B\s*测试|问题复现|监控|原型(?:设计)?|共创|服务设计|研究报告|调研报告|需求文档|设计规范|用友|金蝶/giu
// Formatting equivalence must retain semantic symbols: C, C++ and C# are
// different abilities, as are a number, a percentage and a signed quantity.
const compact = (text: string) => text.normalize('NFKC').replace(/\s/gu, '').toLowerCase()
const clauses = (text: string) => text.match(/[^；;。]+/gu)?.map(value => value.trim()).filter(Boolean) ?? []
const unsafeSource = (fact: WritingFact) => fact.boundaries.some(boundary => boundary !== '团队或参与贡献')
  || /(?:未|没有|从未|尚未|不曾|计划|拟|待)(?:曾|实际|正式)?(?:开展|进行|负责|参与|使用|掌握|完成|实施)/u.test(fact.text)
const eventNarration = /负责|承担|参与|团队|公司|项目|期间|主导|牵头|协助|推动|推进|完成|形成|交付|实现|提升|降低|增长|减少|覆盖|通过|运用|使用|开展|组织|梳理|制定|建立|搭建|支持|进行|产出|输出|设计了|开发了|[0-9]/u

function recoverIndependentClauses(entry: EntryBrief, facts: WritingFact[], context: SkillRecoveryContext) {
  const candidates: Array<{text: string; evidenceIds: string[]}> = []
  for (const paragraph of context.written.paragraphs) for (const text of clauses(paragraph.text)) {
    // Repeated event narration is handled by the practice projection below. A
    // distinct noun phrase must not disappear merely because a method dictionary
    // does not recognize it. Retain only literal, affirmative cited support.
    if (eventNarration.test(text)) continue
    const supported = facts.filter(fact => paragraph.evidenceIds.includes(fact.evidenceId)
      && !unsafeSource(fact) && compact(fact.text).includes(compact(text)))
    if (!supported.length) throw new SupportedWritingError([writingIssue('WRITER_SKILL_RECOVERY_UNSUPPORTED',
      entry.slot.outputPath, paragraph.evidenceIds, '独立技能分句无法逐字追溯到准入来源，不能仅保留词表识别出的能力子集。')])
    candidates.push({text: !supported.some(fact => fact.claimType === 'skill') && supported.some(fact => fact.boundaries.includes('团队或参与贡献')) ? `参与实践：${text}` : text,
      evidenceIds: supported.map(fact => fact.evidenceId)})
  }
  return candidates
}

function assertDiscardedEventsCovered(entry: EntryBrief, facts: WritingFact[], context: SkillRecoveryContext, retained: Array<{text: string; evidenceIds: string[]}>) {
  // Standalone helper callers may lack a complete document. The orchestrator
  // always supplies otherEntries, including an empty list when none survived.
  if (context.otherEntries === undefined) return
  const comparable = (text: string) => compact(text).replace(/[，,：:]/gu, '')
  for (const paragraph of context.written.paragraphs) for (const text of clauses(paragraph.text)) {
    if (!eventNarration.test(text)) continue
    const phrase = comparable(text)
    const admitted = facts.filter(fact => paragraph.evidenceIds.includes(fact.evidenceId) && !unsafeSource(fact))
    const sources = admitted.filter(fact => comparable(fact.text).includes(phrase)).map(fact => fact.evidenceId)
    const document = [...retained, ...context.otherEntries.flatMap(other => other.paragraphs.map(item => ({
      text: item.segments ? item.segments.filter(segment => segment.kind === 'fact').map(segment => segment.text).join('') : item.text,
      evidenceIds: item.evidenceIds,
    })))]
    const literalCandidateCovered = document.some(item => item.evidenceIds.some(id => sources.includes(id)) && comparable(item.text).includes(phrase))
    // A model may paraphrase an event while repeating its case. The source
    // itself, rather than that rejected wording, is the conservation boundary.
    // Require every cited source to survive in full with the same citation.
    const allSourcesCovered = admitted.length > 0 && paragraph.evidenceIds.every(id => admitted.some(fact => fact.evidenceId === id))
      && admitted.every(fact => clauses(fact.text).every(clause => document.some(item => item.evidenceIds.includes(fact.evidenceId)
        && comparable(item.text).includes(comparable(clause)))))
    if (!literalCandidateCovered && !allSourcesCovered) throw new SupportedWritingError([writingIssue('WRITER_SKILL_RECOVERY_UNSUPPORTED', entry.slot.outputPath,
      paragraph.evidenceIds, '被省略的事件分句未在保留正文中获得同来源逐字覆盖，不能只保留词表识别的方法而丢失独特能力或成果。')])
  }
}

function literalNames(fact: WritingFact) {
  if (unsafeSource(fact)) return []
  return [...fact.text.matchAll(PRACTICE_NAMES)].filter(match => {
    const prefix = fact.text.slice(Math.max(0, match.index! - 14), match.index!)
    return !/(?:不会|不熟悉|不具备|未使用|未开展|未进行|尚未|从未|没有|计划|拟|待)[^，,；;。]{0,10}$/u.test(prefix)
  }).map(match => match[0])
}

export interface SkillRecoveryContext {
  written: WrittenEntry
  otherEntries?: WrittenEntry[]
  renderedSkills?: Array<{text: string; evidenceIds: string[]}>
}

/** A source list can be retained verbatim; a practice event cannot be copied as a skill. */
export function recoverSkillParagraphs(entry: EntryBrief, facts: WritingFact[], context: SkillRecoveryContext): WrittenEntry['paragraphs'] {
  const prior = context.renderedSkills ?? []
  const priorClauses = new Map(prior.flatMap(item => clauses(item.text)).map(text => [compact(text), text]))
  const candidates: Array<{text: string; evidenceIds: string[]}> = []
  const add = (text: string, evidenceIds: string[]) => {
    const key = compact(text)
    if (!key || candidates.some(item => compact(item.text) === key)) return
    candidates.push({text, evidenceIds})
  }
  // Preserve every independent original skill clause, not just the first fact.
  for (const fact of facts.filter(item => item.claimType === 'skill' && !unsafeSource(item))) {
    for (const text of clauses(fact.text)) if (!priorClauses.has(compact(text))) add(text, [fact.evidenceId])
  }
  for (const candidate of recoverIndependentClauses(entry, facts, context)) if (!priorClauses.has(compact(candidate.text))) {
    add(candidate.text, candidate.evidenceIds)
  }
  const sourceNames = new Map<string, {name: string; evidenceIds: string[]}>()
  for (const fact of facts.filter(item => ['action', 'responsibility', 'deliverable'].includes(item.claimType))) {
    for (const name of literalNames(fact)) {
      const key = compact(name), existing = sourceNames.get(key)
      sourceNames.set(key, {name, evidenceIds: [...new Set([...(existing?.evidenceIds ?? []), fact.evidenceId])]})
    }
  }
  const presentedNames = new Set([...prior, ...candidates].flatMap(item => [...item.text.matchAll(PRACTICE_NAMES)].map(match => compact(match[0]))))
  const unique = [...sourceNames].filter(([key]) => !presentedNames.has(key)).map(([, value]) => value)
  if (unique.length) add(`参与实践：${unique.map(item => item.name).join('、')}`, [...new Set(unique.flatMap(item => item.evidenceIds))])
  assertDiscardedEventsCovered(entry, facts, context, [...prior, ...candidates])
  if (candidates.length) {
    const text = candidates.map(item => item.text.replace(/[；;。]+$/u, '')).join('；') + '。'
    const evidenceIds = [...new Set(candidates.flatMap(item => item.evidenceIds))]
    return [{unitId: `${entry.entryId}:recovery:skill`, role: 'detail', text, evidenceIds,
      segments: [{kind: 'fact', text, evidenceIds}]}]
  }
  // Exact source skill duplicates are safe for the compiler's clause-level
  // deduplicator to merge. Do not manufacture a substitute ability to fill a slot.
  const covered = facts.filter(fact => fact.claimType === 'skill' && !unsafeSource(fact))
    .flatMap(fact => clauses(fact.text).filter(text => priorClauses.has(compact(text)))
      .map(text => ({text: priorClauses.get(compact(text))!, evidenceId: fact.evidenceId})))
  if (covered.length) {
    const text = covered.map(item => item.text).join('；') + '。'
    const evidenceIds = [...new Set(covered.map(item => item.evidenceId))]
    return [{unitId: `${entry.entryId}:recovery:covered-skill`, role: 'detail', text, evidenceIds,
      segments: [{kind: 'fact', text, evidenceIds}]}]
  }
  throw new SupportedWritingError([writingIssue('WRITER_SKILL_RECOVERY_UNSUPPORTED', entry.slot.outputPath,
    facts.map(fact => fact.evidenceId), '局部技能恢复没有可安全呈现且未被覆盖的方法、工具或产物名称；不能复制完整经历或补造能力。')])
}
