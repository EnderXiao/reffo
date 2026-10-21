import type { EvidenceAtom } from '@/v5/types'
import { writingIssue } from '@/v5/writing/facts'

type Degree = '本科' | '硕士' | '博士'
type EducationState = 'graduated' | 'enrolled'
export interface EducationIdentity {
  degree: Degree
  state: EducationState | 'unknown'
  evidenceIds: string[]
}

function explicitEducationStates(text: string) {
  // Only explicit status, not dates, desired qualifications, or future graduation.
  return [...text.matchAll(/(本科|硕士|博士)(?:应届)?(毕业生|已毕业|在读|就读)/gu)]
    .filter(match => !/(?:计划|预计|希望|要求|招聘|招收|申请|面向|针对|为|非|不是|并非|尚未|未)\s*$/u.test(text.slice(Math.max(0, match.index! - 8), match.index)))
    .map(match => ({ degree: match[1] as Degree, state: /毕业/u.test(match[2]) ? 'graduated' as const : 'enrolled' as const }))
}

export function deriveEducationIdentity(atoms: EvidenceAtom[]): EducationIdentity[] {
  const groups = new Map<Degree, { states: Set<EducationState>; evidenceIds: Set<string> }>()
  for (const atom of atoms) {
    if (!['education', 'identity', 'timeline', 'other'].includes(atom.claimType)) continue
    if (atom.status === 'excluded' || atom.riskFlags.some(f=>['conflicting', 'sensitive_pii', 'prompt_injection_like_text'].includes(f))) continue
    for (const item of explicitEducationStates(atom.verbatimText)) {
      const group = groups.get(item.degree) ?? { states: new Set<EducationState>(), evidenceIds: new Set<string>() }
      group.states.add(item.state); group.evidenceIds.add(atom.evidenceId); groups.set(item.degree, group)
    }
  }
  return [...groups].map(([degree, group]) => ({ degree,
    state: group.states.size === 1 ? [...group.states][0] : 'unknown', evidenceIds: [...group.evidenceIds] }))
}

export function inspectEducationIdentity(text: string, identity: EducationIdentity[], path: string) {
  return explicitEducationStates(text).flatMap(claim => {
    const source = identity.find(item=>item.degree === claim.degree)
    return source && source.state !== 'unknown' && source.state !== claim.state
      ? [writingIssue('WRITER_EDUCATION_STATUS_CHANGED', path, source.evidenceIds, '正文改变了源材料明确说明的学籍或毕业状态，不能以岗位要求改写候选人身份。')] : []
  })
}
