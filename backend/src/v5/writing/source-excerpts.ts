import type { EvidenceAtom, ResumeEvidenceBundle, V5ResumePlan } from '@/v5/types'

export interface WritingSourceExcerpt {
  anchorEvidenceId: string
  evidenceId: string
  sourceSpan: { start: number; end: number }
  text: string
}

/** Only recover a complete metric prefix before an explicitly unfinished period/count tail.
 * Never joins the next block, promotes an excluded atom, or changes canonical evidence.
 */
export function completeMetricPrefix(atom: EvidenceAtom): Omit<WritingSourceExcerpt, 'anchorEvidenceId'> | null {
  if (atom.status === 'excluded' || atom.claimType !== 'result'
    || atom.riskFlags.some(flag => !['self_assessment_only', 'team_attribution'].includes(flag))) return null
  const tail = /[，,](?:日均|月均|年均|累计|平均)(?:优秀|有效|新增|活跃)?(?:案例|订单|工单|用户|客户|收入|营收|销量|产量|交易额|访问量|处理量|提交量|完成量)\s*$/u.exec(atom.verbatimText)
  if (!tail || /但|不过|然而|不|未|无|预计|目标|计划|假设|模拟|可能|疑似|仅供参考/u.test(atom.verbatimText)) return null
  const text = atom.verbatimText.slice(0, tail.index).trimEnd()
  // Require complete metric clauses, not an isolated count or an unfinished comparison.
  const clauses = text.split(/[；;]/u)
  if (clauses.length < 2 || !clauses.every(clause => /\d/u.test(clause)
    && /(?:率|时长|时间|审核|成本|收入|用户|转化|留存)/u.test(clause))
    || /(?:由|从|至|到|提升|减少|降低|和|与|[，,：:])$/u.test(text)) return null
  if (atom.sourceSpan.end - atom.sourceSpan.start !== atom.verbatimText.length) return null
  return { evidenceId: atom.evidenceId, text,
    sourceSpan: { start: atom.sourceSpan.start, end: atom.sourceSpan.start + text.length } }
}

export function deriveWritingSourceExcerpts(resume: ResumeEvidenceBundle, plan: V5ResumePlan): WritingSourceExcerpt[] {
  const selected = new Set(plan.scopePlans.flatMap(scope => scope.selectedEvidenceIds))
  const atoms = [...resume.evidenceAtoms].sort((a, b) => a.sourceSpan.start - b.sourceSpan.start)
  const uniqueCoordinates = (atom: EvidenceAtom) => atoms.filter(other => other.evidenceId === atom.evidenceId
    || other.sourceBlockId === atom.sourceBlockId || other.sourceSpan.start === atom.sourceSpan.start).length === 1
  const excerpts: WritingSourceExcerpt[] = []
  for (const [index, atom] of atoms.entries()) {
    const anchor = atoms[index - 1]
    if (!anchor || !uniqueCoordinates(anchor) || !uniqueCoordinates(atom) || !selected.has(anchor.evidenceId) || selected.has(atom.evidenceId)
      || !['action', 'responsibility', 'deliverable'].includes(anchor.claimType)
      || anchor.status === 'excluded' || anchor.riskFlags.some(flag => !['self_assessment_only', 'team_attribution'].includes(flag))
      || atom.sourceDocumentHash !== resume.sourceDocument.sha256 || anchor.sourceDocumentHash !== atom.sourceDocumentHash
      // Separate complete clauses, not delimiter-free source concatenation. Blank lines are allowed.
      || atom.sourceScopeId !== anchor.sourceScopeId || atom.sourceSpan.start <= anchor.sourceSpan.end
      || atom.sourceSpan.start - anchor.sourceSpan.end > 4
      || !/^B\d+$/u.test(atom.sourceBlockId) || !/^B\d+$/u.test(anchor.sourceBlockId)
      || Number(atom.sourceBlockId.slice(1)) !== Number(anchor.sourceBlockId.slice(1)) + 1) continue
    const excerpt = completeMetricPrefix(atom)
    if (excerpt) excerpts.push({ anchorEvidenceId: anchor.evidenceId, ...excerpt })
  }
  return excerpts
}

export function sourceAtomsForWritingInspection(atoms: EvidenceAtom[], excerpts: WritingSourceExcerpt[]) {
  return atoms.map(atom => {
    const excerpt = excerpts.find(item => item.evidenceId === atom.evidenceId && atoms.some(source => source.evidenceId === item.anchorEvidenceId))
    return excerpt ? { ...atom, verbatimText: excerpt.text, sourceSpan: excerpt.sourceSpan } : atom
  })
}
