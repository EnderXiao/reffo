import { resumeTextFingerprint, type ResumeStrategyReview } from '../../../../shared/resume-strategy'
import type { GeneratedResumeArtifact, ResumeEvidenceBundle, V5MatchAnalysis } from '@/v5/types'
import { normalizeEntryFact, type EntryWritingPlan } from './entries'
import { buildWritingIntents, type EntryStrategyAction } from './intents'
import { buildWritingFact, isWritingBoundaryContext } from './facts'
import { hasIncompleteMetricValue } from '@/v5/composition/source-display'

export interface StrategyActionItem {
  strategyId: string
  strategy: string
  state: 'scheduled' | 'needs_material' | 'not_selected'
  explanation: string
  assignment?: EntryStrategyAction & { entryId: string; referenceEvidenceIds: string[] }
}
export interface StrategyActionPlan { items: StrategyActionItem[] }
export interface EntryParagraphReference {
  entryId: string
  outputPath: string
  location: string
}

/** Complete only an already retained entry, using the same validated intent and source scope. */
export function completeEntryStrategyEvidence(input: {
  match: V5MatchAnalysis
  resume: ResumeEvidenceBundle
  entryPlan: EntryWritingPlan
}): EntryWritingPlan {
  let plan = structuredClone(input.entryPlan)
  const targeting = plan.base.targeting
  if (!targeting) return plan
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const intents = buildWritingIntents({ ...targeting, resume: input.resume,
    selectedEvidenceIds: new Set(atoms.keys()) })
  const priority = { high: 0, medium: 1, low: 2 }
  const seen = new Set<string>()
  let scheduled = 0
  for (const gap of [...input.match.gaps].sort((a, b) => priority[a.priority] - priority[b.priority])) {
    if (scheduled >= 3) break
    if (seen.has(gap.gapId)) continue
    seen.add(gap.gapId)
    const match = { ...input.match, gaps: [gap] }
    const isScheduled = (entryPlan: EntryWritingPlan) => buildStrategyActionPlan({ ...input, match, entryPlan })
      .items.some(item => item.state === 'scheduled')
    if (isScheduled(plan)) { scheduled++; continue }
    const exactTarget = targeting.targets.find(target => `target_gap_${target.id}` === gap.gapId)
    const targets = exactTarget ? [exactTarget] : targeting.targets.filter(target =>
      target.requirementIds.some(id => gap.requirementIds.includes(id)))
    if (!exactTarget && targets.length !== 1) continue
    const targetIds = new Set(targets.map(target => target.id))
    const options = plan.entries.filter(entry => entry.slot.kind === 'business_bullet' && entry.scopeId)
      .flatMap(entry => intents.filter(intent => intent.targetIds.some(id => targetIds.has(id))
        && intent.evidenceIds.some(id => gap.evidenceIds.includes(id))
        && intent.expressionAngle.trim() && intent.expressionAngle.trim() === gap.safeHandling.trim()
        && intent.evidenceIds.every(id => atoms.get(id)?.sourceScopeId === entry.scopeId))
        .map(intent => ({entry, intent})))
      .sort((a, b) => b.intent.evidenceIds.filter(id => b.entry.coreEvidenceIds.includes(id)).length
        - a.intent.evidenceIds.filter(id => a.entry.coreEvidenceIds.includes(id)).length || a.entry.order - b.entry.order)
    for (const {entry, intent} of options) {
      const candidate = structuredClone(plan)
      const destination = candidate.entries.find(item => item.entryId === entry.entryId)!
      const missing = intent.evidenceIds.filter(id => !destination.facts.some(fact => fact.evidenceId === id))
      const facts = missing.map(id => {
        const existing = candidate.base.facts.find(fact => fact.evidenceId === id)
        const expanded = candidate.base.expandedEvidenceIds[id] ?? [id]
        if (expanded.some(sourceId => {
          const source = atoms.get(sourceId)
          return !source || source.sourceScopeId !== destination.scopeId || !buildWritingFact(source)
        })) return null
        const fact = existing ?? buildWritingFact(atoms.get(id)!)
        if (!fact || fact.scopeId !== destination.scopeId) return null
        const safe = normalizeEntryFact(fact, input.resume)
        return hasIncompleteMetricValue(safe.text) ? null : safe
      })
      if (facts.some(fact => !fact)) continue
      for (const fact of facts) {
        if (!fact) continue
        destination.facts.push(fact)
        // Preserve existing validated assemblies and context metadata; new atoms stay individual.
        if (!candidate.base.facts.some(item => item.evidenceId === fact.evidenceId)) candidate.base.facts.push(fact)
        candidate.base.expandedEvidenceIds[fact.evidenceId] ??= [fact.evidenceId]
        if (isWritingBoundaryContext(atoms.get(fact.evidenceId)!)) {
          destination.strategyBoundaryEvidenceIds = [...new Set([...(destination.strategyBoundaryEvidenceIds ?? []), fact.evidenceId])]
          destination.coreEvidenceIds = [...new Set([...destination.coreEvidenceIds, fact.evidenceId])]
        }
      }
      destination.facts.sort((a, b) => (atoms.get(a.evidenceId)?.sourceSpan.start ?? 0) - (atoms.get(b.evidenceId)?.sourceSpan.start ?? 0))
      destination.slot.allowedEvidenceIds = [...new Set([...destination.slot.allowedEvidenceIds, ...missing])]
      const slot = candidate.base.blueprint.slots.find(item => item.slotId === destination.slot.slotId)
      if (slot) slot.allowedEvidenceIds = [...destination.slot.allowedEvidenceIds]
      candidate.base.coreEvidenceIdsBySlot[destination.slot.slotId] = [...destination.coreEvidenceIds]
      const scope = candidate.renderingPlan.scopePlans.find(item => item.scopeId === destination.scopeId)
      if (scope) scope.selectedEvidenceIds = [...new Set([...scope.selectedEvidenceIds, ...missing])]
      if (!isScheduled(candidate)) continue
      plan = candidate
      scheduled++
      break
    }
  }
  return plan
}

/** Selection is bounded by the existing plan. No additional evidence is admitted. */
export function buildStrategyActionPlan(input: {
  match: V5MatchAnalysis
  resume: ResumeEvidenceBundle
  entryPlan: EntryWritingPlan
}): StrategyActionPlan {
  const targeting = input.entryPlan.base.targeting
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const businessEntries = input.entryPlan.entries.filter(entry => entry.slot.kind === 'business_bullet')
  const intentsFor = (ids: string[]) => targeting ? buildWritingIntents({ ...targeting, resume: input.resume,
    selectedEvidenceIds: new Set(ids) }) : []
  const allIntents = intentsFor(input.resume.evidenceAtoms.map(atom => atom.evidenceId))
  const entryIntents = new Map(businessEntries.map(entry => [entry.entryId, intentsFor(entry.facts.map(fact => fact.evidenceId))]))
  const priority = { high: 0, medium: 1, low: 2 }
  let scheduled = 0
  const decisions = new Map<string, StrategyActionItem>()
  for (const gap of [...input.match.gaps].sort((a, b) => priority[a.priority] - priority[b.priority])) {
    const strategyId = `strategy_${gap.gapId}`
    if (decisions.has(strategyId)) continue
    const item: StrategyActionItem = { strategyId, strategy: gap.safeHandling,
      state: 'needs_material', explanation: '这条建议需要先补充或核对相关材料。' }
    decisions.set(strategyId, item)
    const usableIds = gap.evidenceIds.filter(id => {
      const atom = atoms.get(id)
      return atom && atom.status !== 'excluded'
        && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text', 'conflicting'].includes(flag))
    })
    if (!targeting) {
      item.state = 'not_selected'
      item.explanation = '本次未建立这条建议与正文的对应关系。'
      continue
    }
    if (!usableIds.length) continue
    // Targeted gaps have a server-owned identity; legacy gaps need an unambiguous target.
    const exactTarget = targeting.targets.find(target => `target_gap_${target.id}` === gap.gapId)
    const targets = exactTarget ? [exactTarget] : targeting.targets.filter(target =>
      target.requirementIds.some(id => gap.requirementIds.includes(id)))
    if (!exactTarget && targets.length !== 1) continue
    const targetIds = new Set(targets.map(target => target.id))
    const relevant = (intent: ReturnType<typeof intentsFor>[number]) => intent.targetIds.some(id => targetIds.has(id))
      && intent.evidenceIds.some(id => usableIds.includes(id))
      // A request to verify missing qualifications is not a writing operation.
      && Boolean(intent.expressionAngle.trim()) && intent.expressionAngle.trim() === gap.safeHandling.trim()
    if (!allIntents.some(relevant)) continue
    item.state = 'not_selected'
    item.explanation = '这条建议所需的相关材料未完整选入本次对应经历。'
    const options = businessEntries.flatMap(entry => (entryIntents.get(entry.entryId) ?? []).filter(relevant)
      .map(intent => ({ entry, intent })))
      .sort((a, b) => b.intent.evidenceIds.filter(id => b.entry.coreEvidenceIds.includes(id)).length
        - a.intent.evidenceIds.filter(id => a.entry.coreEvidenceIds.includes(id)).length || a.entry.order - b.entry.order)
    const selected = options[0]
    if (!selected) continue
    if (scheduled >= 3) {
      item.explanation = '本次优先处理了另外三条策略，这条建议暂未纳入。'
      continue
    }
    scheduled++
    item.state = 'scheduled'
    item.explanation = ''
    item.assignment = { strategyId, entryId: selected.entry.entryId,
      instruction: selected.intent.expressionAngle,
      targetIds: selected.intent.targetIds.filter(id => targetIds.has(id)),
      evidenceIds: [...selected.intent.evidenceIds],
      referenceEvidenceIds: [...new Set(selected.intent.evidenceIds.flatMap(id => input.entryPlan.base.expandedEvidenceIds[id] ?? [id]))] }
  }
  return { items: [...decisions.values()] }
}

export function assignEntryStrategyActions(plan: EntryWritingPlan, actions: StrategyActionPlan): EntryWritingPlan {
  return { ...plan, entries: plan.entries.map(entry => ({ ...entry,
    strategyActions: actions.items.flatMap(item => {
      const action = item.assignment
      if (item.state !== 'scheduled' || action?.entryId !== entry.entryId) return []
      return [{ strategyId: action.strategyId, instruction: action.instruction,
        targetIds: action.targetIds, evidenceIds: action.evidenceIds }]
    }),
  })) }
}

/** Links identify actual final prose. They deliberately do not certify that an editing goal was met. */
export function buildStrategyReview(input: {
  plan: StrategyActionPlan
  artifact: GeneratedResumeArtifact
  paragraphs: EntryParagraphReference[]
}): ResumeStrategyReview {
  const lines = new Set(input.artifact.markdown.split(/\r?\n/u))
  return { version: 'resume-strategy-v1', resumeFingerprint: resumeTextFingerprint(input.artifact.markdown),
    items: input.plan.items.map(item => {
      if (item.state !== 'scheduled' || !item.assignment) return { strategyId: item.strategyId,
        strategy: item.strategy, status: item.state === 'needs_material' ? 'needs_material' : 'not_selected',
        explanation: item.explanation, references: [] }
      const action = item.assignment
      const references = input.paragraphs.filter(paragraph => paragraph.entryId === action.entryId).flatMap(paragraph => {
        const claims = input.artifact.claims.filter(claim => claim.outputPath === paragraph.outputPath)
        const claim = claims.length === 1 ? claims[0] : undefined
        if (!claim || !claim.evidenceIds.some(id => action.referenceEvidenceIds.includes(id))
          || !lines.has(claim.outputText) || !claim.outputText.trim()) return []
        return [{ outputPath: claim.outputPath, location: paragraph.location, quote: claim.outputText }]
      })
      const unique = [...new Map(references.map(reference => [reference.outputPath, reference])).values()].slice(0, 2)
      return { strategyId: item.strategyId, strategy: item.strategy, status: unique.length ? 'linked' : 'not_located',
        explanation: unique.length
          ? '本次对应正文如下，可对照查看具体表达。'
          : '本次未找到这条建议对应的正文。',
        references: unique }
    }),
  }
}
