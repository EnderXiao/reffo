import type { CompositionBlueprint } from '@/v5/composition/contract'
import type { ResumeEvidenceBundle } from '@/v5/types'
import type { JobTarget } from '@/v5/targeting/profile'
import type { WritingFact } from '@/v5/writing/facts'
import { writingNumbers } from '@/v5/writing/facts'

export const WRITING_EDITORIAL_VERSION = 'writing-editorial-v1' as const
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
export function editorialTerms(text: string) {
  return new Set([...segmenter.segment(text.toLowerCase())]
    .filter(part => part.isWordLike && part.segment.length > 1 && !/^\d+$/u.test(part.segment))
    .map(part => part.segment)
    .filter(word => !/^(?:负责|参与|产品|项目|工作|进行|完成|相关|业务|团队|能力|通过|支持|推动|设计)$/u.test(word)))
}
export function termOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>) {
  return [...a].filter(word => b.has(word)).length
}

export interface WritingEmphasis {
  evidenceId: string
  text: string
  kind: 'contribution' | 'outcome'
}
export interface SlotEditorialGuide {
  role: 'overview' | 'detail' | 'contribution'
  targetTaskIds: string[]
  emphasis: WritingEmphasis[]
  /** A soft reference in characters for Chinese, words otherwise; never a gate. */
  lengthHint: { unit: 'cjk_characters' | 'words'; target: number; max: number }
  avoidRepeatingSlotIds: string[]
}

/** Select intact clauses, not inferred outcomes or rewritten personal facts. */
export function preferredEmphasis(fact: WritingFact, taskTexts: string[]): WritingEmphasis[] {
  const clauses = fact.text.match(/[^；;。!?！？]+(?:[；;。!?！？]+|$)/gu)?.map(text => text.trim()).filter(Boolean) ?? [fact.text]
  const taskTerms = editorialTerms(taskTexts.join(' '))
  let cursor = 0
  const scored = clauses.map((text, index) => {
    const start = fact.text.indexOf(text, cursor), end = start + text.length
    cursor = end
    return { text, index, start, end, score: termOverlap(editorialTerms(text), taskTerms) }
  })
  const contribution = [...scored].sort((a, b) => b.score - a.score || a.index - b.index)[0]
  // A number alone (interview count, version, headcount) is not a performance result.
  const outcomes = scored.filter(clause => writingNumbers(clause.text).length > 0
    && /(?:提升|增长|降低|下降|降至|减少|节省|缩短|替代率|转化率|留存率|完成率|有效率|准确率|成功率|营收|销售额|reduced|increased|saved)/iu.test(clause.text)
    && !/预计|计划|有望|希望|目标(?:为|是)|旨在|尚未|未验证|未达|未能|未(?:提升|增长|降低|下降|减少)|没有|并未|尚无|expected|planned|\bnot\b/iu.test(fact.text)
    && !fact.boundaries.some(boundary => ['未上线或概念阶段', '未验证', '尚无实际数据'].includes(boundary)))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  const emphasis: WritingEmphasis[] = []
  const normalized = (text: string) => text.replace(/[；;。!?！？\s]+$/gu, '')
  if (contribution && contribution.text.length <= 240 && normalized(contribution.text) !== normalized(fact.focusText ?? '')) {
    emphasis.push({ evidenceId: fact.evidenceId, text: contribution.text, kind: 'contribution' })
  }
  if (outcomes[0]) {
    const first = outcomes[0]
    let last = first
    while (outcomes.some(entry => entry.index === last.index + 1)) {
      const next = scored[last.index + 1]
      if (next.end - first.start > 240) break
      last = next
    }
    const text = fact.text.slice(first.start, last.end)
    if (text.length <= 240) {
      const duplicate = emphasis.findIndex(entry => entry.text === text)
      if (duplicate >= 0) emphasis.splice(duplicate, 1)
      emphasis.push({ evidenceId: fact.evidenceId, text, kind: 'outcome' })
    }
  }
  return emphasis
}

/** Only suggests different emphasis; it never merges scopes or establishes project ownership. */
export function overviewDetailOverlaps(input: {
  resume: ResumeEvidenceBundle
  blueprint: CompositionBlueprint
  facts: WritingFact[]
  taskLinks: ReadonlyMap<string, ReadonlySet<string>>
  primaryDetailIds?: ReadonlySet<string>
}) {
  const timeline = new Map(input.resume.timeline.map(scope => [scope.scopeId, scope]))
  const positions = new Map(input.resume.timeline.map(scope => [scope.scopeId,
    Math.min(...input.resume.evidenceAtoms.filter(atom => atom.sourceScopeId === scope.scopeId).map(atom => atom.sourceSpan.start))]))
  const selected = new Set(input.blueprint.slots.filter(slot => slot.kind === 'business_bullet').flatMap(slot => slot.allowedEvidenceIds))
  const details = input.facts.filter(fact => selected.has(fact.evidenceId) && timeline.get(fact.scopeId)?.kind === 'project'
    && (!input.primaryDetailIds || input.primaryDetailIds.has(fact.evidenceId)))
  const date = (value: string | null) => {
    const parts = value?.match(/^(\d{4})(?:[-./年](\d{1,2}))?/u)
    return parts ? Number(parts[1]) * 12 + Number(parts[2] ?? 1) : null
  }
  const pairs = new Map<string, string[]>()
  for (const overview of input.facts.filter(fact => selected.has(fact.evidenceId) && ['experience', 'internship'].includes(timeline.get(fact.scopeId)?.kind ?? ''))) {
    const work = timeline.get(overview.scopeId)!, workStart = positions.get(work.scopeId)!
    const nextWork = Math.min(...input.resume.timeline.filter(scope => ['experience', 'internship', 'education'].includes(scope.kind)
      && positions.get(scope.scopeId)! > workStart).map(scope => positions.get(scope.scopeId)!))
    const matches = details.filter(detail => {
      const project = timeline.get(detail.scopeId)!, projectStart = positions.get(project.scopeId)!
      // Same tool, broad ability, or similar jobs alone cannot establish duplication.
      if (!Number.isFinite(workStart) || !Number.isFinite(projectStart) || projectStart <= workStart || projectStart >= nextWork) return false
      if (work.organization && project.organization && work.organization !== project.organization) return false
      const workFrom = date(work.start), workTo = date(work.end), projectFrom = date(project.start), projectTo = date(project.end)
      if ((workFrom !== null && projectFrom !== null && projectFrom < workFrom)
        || (workTo !== null && projectTo !== null && projectTo > workTo)) return false
      if (!termOverlap(input.taskLinks.get(overview.evidenceId) ?? new Set(), input.taskLinks.get(detail.evidenceId) ?? new Set())) return false
      const left = editorialTerms(overview.text), right = editorialTerms(detail.text), common = termOverlap(left, right)
      return common >= 3 && common / Math.max(1, left.size) >= 0.35 && detail.text.length > overview.text.length
    }).map(detail => detail.evidenceId).sort()
    if (matches.length) pairs.set(overview.evidenceId, matches)
  }
  return pairs
}

export function buildSlotEditorialGuides(input: {
  blueprint: CompositionBlueprint
  facts: WritingFact[]
  coreBySlot: Record<string, string[]>
  taskLinks: ReadonlyMap<string, ReadonlySet<string>>
  targets: JobTarget[]
  overlaps: ReadonlyMap<string, string[]>
  unit: 'cjk_characters' | 'words'
}): Record<string, SlotEditorialGuide> {
  const facts = new Map(input.facts.map(fact => [fact.evidenceId, fact]))
  const tasks = new Map(input.targets.filter(target => target.kind === 'task').map(task => [task.id, task]))
  return Object.fromEntries(input.blueprint.slots.filter(slot => slot.kind === 'business_bullet').map(slot => {
    const core = (input.coreBySlot[slot.slotId] ?? []).flatMap(id => facts.get(id) ?? [])
    const targetTaskIds = [...new Set(core.flatMap(fact => [...(input.taskLinks.get(fact.evidenceId) ?? [])]))].filter(id => tasks.has(id)).sort()
    const relatedDetails = new Set(slot.allowedEvidenceIds.flatMap(id => input.overlaps.get(id) ?? []))
    const avoidRepeatingSlotIds = input.blueprint.slots.filter(other => other.slotId !== slot.slotId
      && (input.coreBySlot[other.slotId] ?? []).some(id => relatedDetails.has(id))).map(other => other.slotId)
    const emphasis = core.flatMap(fact => preferredEmphasis(fact, targetTaskIds.map(id => tasks.get(id)!.text))).slice(0, 2)
    const coreTask = targetTaskIds.some(id => tasks.get(id)?.priority === 'core')
    const role = avoidRepeatingSlotIds.length ? 'overview' : slot.sectionKey === 'project' ? 'detail' : 'contribution'
    const materialSize = core.reduce((sum, fact) => sum + (input.unit === 'words' ? fact.text.trim().split(/\s+/u).length : fact.text.length), 0)
    const target = input.unit === 'words' ? Math.min(materialSize + 10, coreTask ? 45 : 30)
      : Math.min(materialSize + 20, role === 'overview' ? 55 : coreTask ? 105 : 65)
    return [slot.slotId, { role, targetTaskIds, emphasis,
      lengthHint: { unit: input.unit, target, max: target + (input.unit === 'words' ? 10 : 20) }, avoidRepeatingSlotIds }]
  }))
}
