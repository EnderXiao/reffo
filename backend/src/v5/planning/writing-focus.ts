import { createHash } from 'node:crypto'
import type { EvidenceAtom, ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { targetingSelectionBasis } from '@/v5/targeting/fit'
import { buildWritingFact } from '@/v5/writing/facts'

export const WRITING_FOCUS_VERSION = 'writing-focus-v1' as const
export interface WritingFocus {
  focusId: string
  targetId: string
  targetKind: 'task' | 'condition' | 'attribute'
  title: string
  priority: JobTarget['priority']
  selectionBasis: 'supported' | 'partial_practice'
  evidenceIds: string[]
  requirementIds: string[]
  taskIds: string[]
  coverageKey: string
  limitation: string
}
export interface ScopeSelectionDecision {
  scopeId: string
  disposition: 'selected' | 'omitted'
  reason: 'incremental_coverage' | 'concrete_practice' | 'project_budget'
  focusIds: string[]
  alternativeScopeIds: string[]
}
export type WritingFocusCoverage = { numerator: number; denominator: number }

const priority = { core: 30, supporting: 12, optional: 4, unclear: 0 }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16)
const unique = (values: string[]) => [...new Set(values)].sort()

/** Internal selection facets describe source practice, never a qualification verdict. */
export function sourcePracticeFacets(atom: EvidenceAtom): string[] {
  if (!isWritingFocusPractice(atom) || atom.riskFlags.includes('future_or_planned')) return []
  const text = atom.verbatimText
  const facets: string[] = []
  if (/用户研究|用户调研|门店调研|访谈|问卷/u.test(text)) facets.push('user_research')
  if (/设计|原型|交互方案/u.test(text)) facets.push('solution_design')
  if (/(?:AI|大模型|人工智能|智能问答|智能辅导)/iu.test(text) && /设计|原型|方案|交互/u.test(text)) facets.push('intelligent_application_design')
  if (/埋点|指标体系|数据分析|数据看板/u.test(text)) facets.push('data_instrumentation')
  if (/行为分析|行为路径分析|用户路径分析/u.test(text)) facets.push('behavior_analysis')
  if (/流程|工作流|权限/u.test(text) && /设计|梳理|重构|优化/u.test(text)) facets.push('workflow_design')
  if (/监控|日志|排障|复现/u.test(text) && /上线|发布|修复|定位/u.test(text)) facets.push('release_diagnosis')
  if (/A\s*\/\s*B\s*(?:测试|实验|test)/iu.test(text)) facets.push('experiment_validation')
  if (/定价|价格策略|商业模式|商业化|竞品分析/u.test(text)) facets.push('commercial_planning')
  if (/知识库|知识体系|内容审核|知识沉淀/u.test(text)) facets.push('knowledge_operations')
  return facets
}

export function isWritingFocusPractice(atom: EvidenceAtom): boolean {
  return ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
    && !atom.riskFlags.includes('self_assessment_only')
    && !(atom.claimType === 'result' && (atom.riskFlags.includes('uncertain') || /待补证|待核实|口径.{0,5}未/u.test(atom.verbatimText)))
    && buildWritingFact(atom) !== null
}

/** A writing focus selects bounded practice; it never changes a qualification verdict. */
export function buildWritingFocus(input: { resume: ResumeEvidenceBundle; targets: JobTarget[]; fit: JobFitMap }): WritingFocus[] {
  const targets = new Map(input.targets.map(target => [target.id, target]))
  const evidence = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  return input.fit.links.flatMap((link): WritingFocus[] => {
    const target = targets.get(link.targetId)
    if (!target || target.kind === 'requirement' || target.basis === 'unknown') return []
    const evidenceIds = unique(link.evidenceIds.filter(id => {
      const atom = evidence.get(id)
      return atom && isWritingFocusPractice(atom) && targetingSelectionBasis(link, atom)
    }))
    if (!evidenceIds.length) return []
    const taskIds = unique(target.taskIds)
    // Repeated task/condition/attribute labels over the same practice receive one
    // coverage credit. A different evidence set can preserve a specific facet.
    const coverageKey = digest({ family: taskIds.length ? taskIds : [target.id], evidenceIds })
    return [{ focusId: `focus_${digest(target.id)}`, targetId: target.id, targetKind: target.kind,
      title: target.text, priority: target.priority,
      selectionBasis: link.status === 'weak_signal' ? 'partial_practice' : 'supported',
      evidenceIds, requirementIds: unique(target.requirementIds), taskIds, coverageKey,
      limitation: link.difference.trim() || '仅表达已引用实践，不扩展责任或资格。' }]
  }).sort((a, b) => priority[b.priority] - priority[a.priority] || a.targetId.localeCompare(b.targetId))
}

/** Historical plans have no focus measurement, rather than an invented 100%. */
export function measureWritingFocusCoverage(plan: Pick<V5ResumePlan, 'writingFocusVersion' | 'writingFocus' | 'primaryFocusIds'>,
  usedEvidenceIds: Iterable<string>): WritingFocusCoverage | null {
  if (plan.writingFocusVersion !== WRITING_FOCUS_VERSION) return null
  const used = new Set(usedEvidenceIds), primary = new Set(plan.primaryFocusIds ?? [])
  const groups = new Map<string, boolean>()
  for (const focus of plan.writingFocus ?? []) {
    if (!primary.has(focus.focusId)) continue
    groups.set(focus.coverageKey, Boolean(groups.get(focus.coverageKey)) || focus.evidenceIds.some(id => used.has(id)))
  }
  return { numerator: [...groups.values()].filter(Boolean).length, denominator: groups.size }
}

export function selectWritingProjectScopes(input: {
  scopes: ReadonlyMap<string, EvidenceAtom[]>
  focus: WritingFocus[]
  retainedWorkEvidenceIds: Iterable<string>
  retainedWorkAtoms?: Iterable<EvidenceAtom>
  limit: number
  softTarget?: number
  compareAtoms: (a: EvidenceAtom, b: EvidenceAtom) => number
}): { scopeIds: Set<string>; decisions: ScopeSelectionDecision[] } {
  const covered = new Set<string>(), selected = new Set<string>()
  const coveredFacets = new Set([...input.retainedWorkAtoms ?? []].flatMap(sourcePracticeFacets))
  const work = new Set(input.retainedWorkEvidenceIds)
  for (const focus of input.focus) if (focus.evidenceIds.some(id => work.has(id))) covered.add(focus.coverageKey)
  const focusFor = (atoms: EvidenceAtom[]) => input.focus.filter(focus => atoms.some(atom => focus.evidenceIds.includes(atom.evidenceId)))
  const remaining = [...input.scopes].map(([scopeId, atoms]) => ({ scopeId, atoms: [...atoms].sort(input.compareAtoms), focuses: focusFor(atoms) }))
  const decisions: ScopeSelectionDecision[] = []
  const practiceGain = (item: typeof remaining[number]) => {
    if (!item.focuses.length) return 0
    const weight = Math.max(...item.focuses.map(focus => priority[focus.priority] * (focus.selectionBasis === 'partial_practice' ? 0.75 : 1)))
    return new Set(item.atoms.flatMap(sourcePracticeFacets).filter(facet => !coveredFacets.has(facet))).size * weight
  }
  const gain = (focuses: WritingFocus[]) => {
    const scores = new Map<string, number>()
    for (const focus of focuses) if (!covered.has(focus.coverageKey)) scores.set(focus.coverageKey,
      Math.max(scores.get(focus.coverageKey) ?? 0, priority[focus.priority] * (focus.selectionBasis === 'partial_practice' ? 0.75 : 1)))
    return [...scores.values()].reduce((sum, value) => sum + value, 0)
  }
  while (remaining.length && selected.size < input.limit) {
    if (input.softTarget !== undefined && selected.size >= input.softTarget) {
      // Additional projects must add a source practice facet; another generic
      // label over an already represented action cannot consume more space.
      const distinct = remaining.filter(item => practiceGain(item) > 0)
      if (!distinct.length) break
      remaining.sort((a, b) => Number(distinct.includes(b)) - Number(distinct.includes(a))
        || practiceGain(b) - practiceGain(a) || input.compareAtoms(a.atoms[0], b.atoms[0]))
    } else {
      remaining.sort((a, b) => gain(b.focuses) + practiceGain(b) - gain(a.focuses) - practiceGain(a)
        || input.compareAtoms(a.atoms[0], b.atoms[0]) || a.scopeId.localeCompare(b.scopeId))
    }
    const next = remaining.shift()!
    decisions.push({ scopeId: next.scopeId, disposition: 'selected', reason: gain(next.focuses) + practiceGain(next) > 0 ? 'incremental_coverage' : 'concrete_practice',
      focusIds: next.focuses.map(focus => focus.focusId), alternativeScopeIds: [] })
    selected.add(next.scopeId)
    for (const focus of next.focuses) covered.add(focus.coverageKey)
    for (const facet of next.atoms.flatMap(sourcePracticeFacets)) coveredFacets.add(facet)
  }
  for (const item of remaining) decisions.push({ scopeId: item.scopeId, disposition: 'omitted', reason: 'project_budget',
    focusIds: item.focuses.map(focus => focus.focusId), alternativeScopeIds: decisions.filter(decision => decision.disposition === 'selected'
      && decision.focusIds.some(id => input.focus.some(focus => focus.focusId === id && item.focuses.some(other => other.coverageKey === focus.coverageKey))))
      .map(decision => decision.scopeId) })
  return { scopeIds: selected, decisions }
}
