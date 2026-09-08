import type { ResumeEvidenceBundle } from '@/v5/types'
import type { JobFitMap } from '@/v5/targeting/contracts'
import type { JobTarget } from '@/v5/targeting/profile'
import { targetingSelectionBasis } from '@/v5/targeting/fit'
import { writingNumbers } from '@/v5/writing/facts'

export const WRITING_INTENT_VERSION = 'writing-intent-v2' as const

// A bounded numeric screen for analysis prose, not a new gate on resume writing.
const analysisNumbers = (text: string) => [...writingNumbers(text),
  ...[...text.matchAll(/[零〇一二两三四五六七八九十百千万亿]+(?:年|个月|月|天|周|项|个|次|人|份|条|家)/gu)].map(m => m[0])]

export interface WritingIntent {
  targetIds: string[]
  evidenceIds: string[]
  selectionBasis: 'supported' | 'partial_practice'
  similarity: string
  difference: string
  expressionAngle: string
}

/** Editing guidance is not a qualification verdict or an additional fact source. */
export function buildWritingIntents(input: {
  resume: ResumeEvidenceBundle
  targets: JobTarget[]
  fit: JobFitMap
  selectedEvidenceIds: ReadonlySet<string>
}): WritingIntent[] {
  const atoms = new Map(input.resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const targets = new Map(input.targets.map(target => [target.id, target]))
  const groups = new Map<string, WritingIntent>()
  for (const link of input.fit.links) {
    const target = targets.get(link.targetId)
    if (!target || target.basis === 'unknown') continue
    const evidenceIds = [...new Set(link.evidenceIds)].filter(id => {
      const atom = atoms.get(id)
      return input.selectedEvidenceIds.has(id) && atom
        && ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
        && !atom.riskFlags.includes('self_assessment_only')
        && targetingSelectionBasis(link, atom)
    }).sort()
    if (!evidenceIds.length) continue
    // A shortened evidence set cannot inherit a statement that depended on omitted facts.
    const complete = link.evidenceIds.every(id => evidenceIds.includes(id))
    const sourceNumbers = new Set(evidenceIds.flatMap(id => analysisNumbers(atoms.get(id)!.verbatimText)))
    const numbersSupported = (text: string) => analysisNumbers(text).every(number => sourceNumbers.has(number))
    const safeCopy = complete && numbersSupported(link.similarity) && numbersSupported(link.expressionAngle)
    const intent: WritingIntent = {
      targetIds: [target.id], evidenceIds,
      selectionBasis: link.status === 'weak_signal' ? 'partial_practice' : 'supported',
      similarity: safeCopy ? link.similarity : '',
      difference: !complete ? '仅表达已选事实，不继承未入选事实支持的结论。'
        : numbersSupported(link.difference) ? link.difference : '只表达已引用实践；其余条件待补充材料，不推断资格或年限。',
      expressionAngle: safeCopy ? link.expressionAngle : '',
    }
    const key = JSON.stringify({ ...intent, targetIds: [] })
    const existing = groups.get(key)
    if (existing) existing.targetIds.push(target.id)
    else groups.set(key, intent)
  }
  return [...groups.values()]
}
