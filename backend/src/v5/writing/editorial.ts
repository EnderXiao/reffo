import type { CompositionBlueprint } from '@/v5/composition/contract'
import type { GenerationPolicy, ResumeEvidenceBundle } from '@/v5/types'
import type { JobTarget } from '@/v5/targeting/profile'
import type { WritingFact } from '@/v5/writing/facts'
import { writingNumbers } from '@/v5/writing/facts'

export const WRITING_EDITORIAL_VERSION = 'writing-editorial-v4' as const
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
  kind: 'contribution' | 'outcome' | 'delivery'
}
export interface SlotEditorialGuide {
  role: 'overview' | 'detail' | 'contribution'
  targetTaskIds: string[]
  emphasis: WritingEmphasis[]
  /** A soft reference in characters for Chinese, words otherwise; never a gate. */
  lengthHint: { unit: 'cjk_characters' | 'words'; target: number; max: number }
  avoidRepeatingSlotIds: string[]
  priorityEvidenceIds?: string[]
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
  const delivery = scored.find(clause => /交付|形成|产出|整理|建立|输出|完成|developed|documented|delivered/iu.test(clause.text)
    && !/预计|计划|有望|希望|目标|旨在|未能|没有|并未|expected|planned/iu.test(clause.text)
    && clause.text.length <= 240 && !emphasis.some(item => item.text.includes(clause.text))
    && normalized(clause.text) !== normalized(fact.focusText ?? ''))
  if (delivery && emphasis.length < 2) emphasis.push({ evidenceId: fact.evidenceId, text: delivery.text, kind: 'delivery' })
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
      if (work.organization && project.organization && !sourceOrganizationNames(input.resume, work.scopeId).has(project.organization.trim())) return false
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
  outputLength: GenerationPolicy['outputLength']
  methodSkills?: boolean
}): Record<string, SlotEditorialGuide> {
  const facts = new Map(input.facts.map(fact => [fact.evidenceId, fact]))
  const tasks = new Map(input.targets.filter(target => target.kind === 'task').map(task => [task.id, task]))
  const unit = input.outputLength.unit
  const headroom = unit === 'words' ? 10 : 20
  const entries = input.blueprint.slots.filter(slot => slot.kind === 'business_bullet').map(slot => {
    const core = (input.coreBySlot[slot.slotId] ?? []).flatMap(id => facts.get(id) ?? [])
    const targetTaskIds = [...new Set(core.flatMap(fact => [...(input.taskLinks.get(fact.evidenceId) ?? [])]))].filter(id => tasks.has(id)).sort()
    const relatedDetails = new Set(slot.allowedEvidenceIds.flatMap(id => input.overlaps.get(id) ?? []))
    const avoidRepeatingSlotIds = input.blueprint.slots.filter(other => other.slotId !== slot.slotId
      && (input.coreBySlot[other.slotId] ?? []).some(id => relatedDetails.has(id))).map(other => other.slotId)
    const supplemental = slot.allowedEvidenceIds.flatMap(id => facts.get(id) ?? []).filter(fact =>
      !core.some(item => item.evidenceId === fact.evidenceId) && ['action', 'deliverable', 'result'].includes(fact.claimType)
      && !fact.contextForEvidenceId).slice(0, 1)
    const emphasis = [...supplemental, ...core].flatMap(fact => {
      const selected = preferredEmphasis(fact, targetTaskIds.map(id => tasks.get(id)!.text))
      return selected.length ? selected : supplemental.includes(fact) && fact.text.length <= 240
        ? [{ evidenceId: fact.evidenceId, text: fact.text, kind: 'contribution' as const }] : []
    }).slice(0, 2)
    const coreTask = targetTaskIds.some(id => tasks.get(id)?.priority === 'core')
    const firstWorkSlot = slot.sectionKey === 'experience' && input.blueprint.slots.find(other => other.scopeId === slot.scopeId && other.kind === 'business_bullet')?.slotId === slot.slotId
    const role: SlotEditorialGuide['role'] = avoidRepeatingSlotIds.length || (firstWorkSlot && core.some(fact => fact.claimType === 'responsibility'))
      ? 'overview' : slot.sectionKey === 'project' ? 'detail' : 'contribution'
    const coreIds = new Set(core.map(fact => fact.evidenceId))
    // Only material assigned to this slot may earn space; unrelated or unselected
    // facts cannot inflate it. Optional context receives less space than the core.
    const materialSize = [...new Set(slot.allowedEvidenceIds)].reduce((sum, id) => {
      const fact = facts.get(id)
      return sum + (fact ? estimatedWritingUnits(fact.text, unit) * (coreIds.has(id) ? 1 : 0.5) : 0)
    }, 0)
    const demand = materialSize ? Math.ceil(materialSize * (role === 'overview' ? 0.5 : 0.8)) + headroom : 0
    const guide: SlotEditorialGuide = { role, targetTaskIds, emphasis,
      ...(supplemental.length ? { priorityEvidenceIds: supplemental.map(fact => fact.evidenceId) } : {}),
      lengthHint: { unit, target: 0, max: 0 }, avoidRepeatingSlotIds }
    return { slotId: slot.slotId, guide, demand, weight: demand * (coreTask ? 1.5 : 1) }
  })
  const ancillaryIds = new Set(input.blueprint.slots.filter(slot => !['business_bullet', 'summary'].includes(slot.kind)
    && !(input.methodSkills && slot.kind === 'skill'))
    .flatMap(slot => slot.allowedEvidenceIds))
  const methodSize = input.methodSkills ? input.blueprint.slots.filter(slot => slot.kind === 'skill').reduce((sum, slot) => {
    const anchor = facts.get(input.coreBySlot[slot.slotId]?.[0] ?? slot.allowedEvidenceIds[0])
    return sum + (anchor ? Math.ceil(estimatedWritingUnits(anchor.focusText ?? anchor.text, unit) * 0.25) + headroom : 0)
  }, 0) : 0
  const ancillarySize = methodSize + [...ancillaryIds].reduce((sum, id) => sum + estimatedWritingUnits(facts.get(id)?.text ?? '', unit), 0)
  // Reserve room for headings/summary and known ancillary facts. These are editing
  // estimates, not a minimum length, new output quota, or reason to retry a model.
  const bodyBudget = (total: number) => Math.max(0, Math.floor(total * 0.8) - Math.min(ancillarySize, Math.ceil(total * 0.3)))
  const targets = allocateEditingBudget(entries.map(entry => ({ demand: entry.demand, weight: entry.weight })),
    bodyBudget(Math.min(input.outputLength.softMax, input.outputLength.hardMax)))
  const additional = allocateEditingBudget(entries.map(entry => ({ demand: entry.demand ? headroom : 0, weight: entry.weight })),
    Math.max(0, bodyBudget(input.outputLength.hardMax) - targets.reduce((sum, value) => sum + value, 0)))
  return Object.fromEntries(entries.map((entry, index) => [entry.slotId, { ...entry.guide,
    lengthHint: { unit, target: targets[index], max: targets[index] + additional[index] },
  }]))
}

/** Only explicit source aliases; lexical resemblance or a shared date is not ownership proof. */
export function sourceOrganizationNames(resume: ResumeEvidenceBundle, scopeId: string) {
  const organization = resume.timeline.find(scope => scope.scopeId === scopeId)?.organization?.trim()
  const names = new Set(organization ? [organization, organization.split(/[|｜]/u)[0].trim()] : [])
  for (const atom of resume.evidenceAtoms.filter(atom => atom.sourceScopeId === scopeId && atom.status !== 'excluded' && !atom.riskFlags.length)) {
    const match = atom.verbatimText.match(/^(.{2,80}?)\s*[（(]\s*(?:以下简称|简称|also known as)\s*[:：]?\s*[“「"]?([^”」"）)]{2,40})[”」"]?\s*[）)]/iu)
    if (match && names.has(match[1].trim())) names.add(match[2].trim())
  }
  return names
}

/** Estimate translated/mixed-language material in the requested output unit. */
function estimatedWritingUnits(text: string, unit: SlotEditorialGuide['lengthHint']['unit']) {
  const cjk = (text.match(/[\u3400-\u9FFF]/gu) ?? []).length
  const words = [...segmenter.segment(text)].filter(part => part.isWordLike
    && !/^[\u3400-\u9FFF]+$/u.test(part.segment)).length
  return unit === 'words' ? words + Math.ceil(cjk / 2) : cjk + Math.ceil(words * 1.5)
}

/** Capped proportional allocation: leave unused room unused, never pad sparse input. */
function allocateEditingBudget(entries: { demand: number; weight: number }[], budget: number): number[] {
  const allocated = entries.map(() => 0)
  let remaining = Math.floor(budget)
  while (remaining > 0) {
    const active = entries.map((entry, index) => ({ ...entry, index, left: entry.demand - allocated[index] }))
      .filter(entry => entry.left > 0)
    if (!active.length) break
    const totalWeight = active.reduce((sum, entry) => sum + entry.weight, 0)
    const shares = active.map(entry => ({ ...entry, share: remaining * entry.weight / totalWeight }))
    const capped = shares.filter(entry => entry.share >= entry.left)
    if (capped.length) {
      for (const entry of capped) {
        allocated[entry.index] += entry.left
        remaining -= entry.left
      }
      continue
    }
    for (const entry of shares) {
      const amount = Math.floor(entry.share)
      allocated[entry.index] += amount
      remaining -= amount
    }
    shares.sort((a, b) => (b.share % 1) - (a.share % 1) || a.index - b.index)
    for (const entry of shares.slice(0, remaining)) allocated[entry.index] += 1
    break
  }
  return allocated
}
