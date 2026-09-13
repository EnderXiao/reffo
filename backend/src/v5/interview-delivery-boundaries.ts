import type { EvidenceAtom, ResumeEvidenceBundle } from '@/v5/types'
import { deriveInterviewCaseGroups } from '@/v5/interview-source-structure'

const RELEASE = /上线|全国推送|正式推送|全国推广|正式发布|部署/gu
const DELIVERY = /交付/gu
const DENIAL = /(?:不能|不可|不得|不应|不要|不)(?:写成|写为|表述为|声称|说成|描述为|认定为|视为)[^，,。；;！？!?]*|(?:尚未|还未|没有|未曾|未)(?:完成)?[^，,。；;！？!?]{0,24}/gu
const NONFACTUAL_PREFIX = /计划|规划|预计|准备|拟|将|待|尚未|还未|没有|未曾|未|不能|不可|不得|不应|不写成|假设|如果/u

function completedMilestones(atom: EvidenceAtom, pattern: RegExp) {
  const matches: string[] = []
  for (const clause of atom.verbatimText.split(/[，,。；;！？!?]/u)) {
    for (const match of clause.matchAll(pattern)) {
      const prefix = clause.slice(0, match.index)
      if (NONFACTUAL_PREFIX.test(prefix)) continue
      if (/全国|正式/u.test(match[0]) || /已|完成|成功|并|全面/u.test(prefix)) matches.push(clause)
    }
  }
  return matches
}

/** A request for independent proof may qualify a self-report, but cannot negate it. */
export function interviewDeliveryContradictions(input: {
  preparationGap: string
  evidenceIds: string[]
  scopeId: string
  resume: ResumeEvidenceBundle
}): EvidenceAtom[] {
  const groups = deriveInterviewCaseGroups(input.resume)
  const byEvidence = new Map(groups.flatMap(group => group.evidenceIds.map(id => [id, group.caseGroupId] as const)))
  const citedGroups = new Set(input.evidenceIds.map(id => byEvidence.get(id)).filter(Boolean))
  // Mixed proven cases are rejected separately; do not borrow another case's delivery.
  if (citedGroups.size > 1) return []
  const selected = new Set(input.evidenceIds)
  const atoms = input.resume.evidenceAtoms.filter(atom => selected.has(atom.evidenceId)
    && atom.sourceScopeId === input.scopeId && atom.status !== 'excluded'
    && ['action', 'result', 'deliverable'].includes(atom.claimType)
    && !atom.riskFlags.some(flag => ['conflicting', 'sensitive_pii', 'prompt_injection_like_text'].includes(flag)))
  const contradictions = new Map<string, EvidenceAtom>()
  for (const denial of input.preparationGap.matchAll(DENIAL)) {
    const prefix = input.preparationGap.slice(0, denial.index).split(/[，,。；;！？!?]/u).at(-1) ?? ''
    if (/不能|不应|不等于|并不|不得|不可|不要|不代表|如果|假设/u.test(prefix)) continue
    // “不能声称由 PRD 证明上线” limits the corroborating document, not the project.
    if (/证明|佐证|核验|交叉验证|核实|验证记录/u.test(denial[0])) continue
    const pattern = /上线|推送|推广|发布|部署/u.test(denial[0]) ? RELEASE
      : /交付/u.test(denial[0]) ? DELIVERY : null
    if (!pattern) continue
    for (const atom of atoms) {
      const completed = completedMilestones(atom, pattern)
      if (completed.some(text => (!/全国/u.test(denial[0]) || /全国/u.test(text))
        && (!/全量|全面|所有/u.test(denial[0]) || /全量|全面|所有/u.test(text)))) {
        contradictions.set(atom.evidenceId, atom)
      }
    }
  }
  return [...contradictions.values()]
}
