import type { EvidenceAtom, ResumeEvidenceBundle } from '@/v5/types'

/** An explicit standalone degree can be preserved as layout metadata, never inferred from a school. */
export function explicitEducationDegree(atom: EvidenceAtom) {
  if (atom.claimType !== 'education' || atom.status !== 'source_supported' || atom.riskFlags.length > 0) return null
  const label = atom.verbatimText.trim()
  return /^(?:本科|专科|(?:理学|工学|文学|管理学|工商管理|经济学|法学|教育学|医学|艺术学|哲学|农学|历史学|军事学)?(?:学士|硕士|博士)(?:学位)?|B\.?Sc\.?|M\.?Sc\.?|MBA|Ph\.?D\.?|(?:Bachelor|Master|Doctor)(?: of (?:Science|Arts|Engineering|Philosophy|Business Administration))?)$/iu.test(label) ? label : null
}

/** Prefer additional education information over repeating the server-rendered heading. */
export function educationDetailPriority(atom: EvidenceAtom, scope: ResumeEvidenceBundle['timeline'][number]) {
  if (isEducationIdentityOnly(atom, scope)) return 0
  if (['education', 'award'].includes(atom.claimType) && /均分|GPA|排名|前\s*\d|奖学金|scholarship|distinction|honou?rs|\btop\s+\d|案例|访谈|课题|原型/iu.test(atom.verbatimText)) return 4
  if (atom.claimType !== 'education') return 1
  if (/本科|学士|硕士|博士|专科|学位|bachelor|master|doctor|\b(?:BSc|MSc|MBA|PhD)\b/iu.test(atom.verbatimText)) return 3
  const signature = (value: string) => value.toLowerCase().replace(/[#|｜\s]/gu, '')
  const heading = signature([scope.organization, scope.title].filter(Boolean).join(''))
  if (signature(atom.verbatimText) === heading) return 0
  return 1
}

/** Keep an explicit degree absent from the heading beside the additional academic information. */
export function educationCompanion(primary: EvidenceAtom, candidates: EvidenceAtom[], scope?: ResumeEvidenceBundle['timeline'][number]) {
  if (!['education', 'award'].includes(primary.claimType)) return undefined
  const signature = (text: string) => text.toLowerCase().replace(/[\s|｜；;。]/gu, '')
  const safe = candidates.filter(atom => atom.evidenceId !== primary.evidenceId
    && atom.sourceScopeId === primary.sourceScopeId && atom.sourceDocumentHash === primary.sourceDocumentHash
    && atom.claimType === 'education' && atom.status === 'source_supported' && !atom.riskFlags.length
    && !signature(primary.verbatimText).includes(signature(atom.verbatimText)))
  if (!explicitEducationDegree(primary)) return safe.find(atom => explicitEducationDegree(atom)
    && (!scope || !isEducationIdentityOnly(atom, scope)))
  return safe.find(atom => /均分|GPA|排名|前\s*\d|奖学金|scholarship|distinction|honou?rs|\btop\s+\d/iu.test(atom.verbatimText))
}


/** Only an explicit, same-scope completed graduation month can refine a known matching end year. */
export function explicitGraduationMonth(atoms: EvidenceAtom[], end: string | null): string | undefined {
  const knownYear = end?.match(/^(?:19|20)\d{2}$/u)?.[0]
  if (!knownYear) return undefined
  const months = [...new Set(atoms.filter(atom => atom.status === 'source_supported' && !atom.riskFlags.length)
    .flatMap(atom => [...atom.verbatimText.matchAll(/((?:19|20)\d{2})[.年/](0?[1-9]|1[0-2])月?\s*毕业/gu)]
      .filter(match => match[1] === knownYear && !/(?:预计|计划|预期|拟|尚未|未)\s*$/u.test(atom.verbatimText.slice(Math.max(0, match.index! - 8), match.index)))
      .map(match => `${match[1]}.${match[2].padStart(2, '0')}`)))]
  return months.length === 1 ? months[0] : undefined
}

export function educationFields(title: string | null): {major: string; degree: string} {
  const parts = title?.split(/[|｜丨]/u).map(value => value.trim()).filter(Boolean) ?? []
  const degree = parts.find(value => /^(?:(?:理学|工学|文学|管理学|工商管理|经济学|法学|教育学|医学|艺术学|哲学|农学|历史学|军事学)?(?:学士|硕士|博士)(?:学位)?|本科|专科|bachelor(?: of .+)?|master(?: of .+)?|doctor(?: of .+)?|M\.?Sc\.?|B\.?Sc\.?|MBA|Ph\.?D\.?)$/iu.test(value))
  return degree ? {major: parts.filter(value => value !== degree).join(' | '), degree} : {major: '', degree: title ?? ''}
}

/** A source identity-only line adds no body information once the server heading has all of it. */
export function isEducationIdentityOnly(atom: EvidenceAtom, scope: ResumeEvidenceBundle['timeline'][number]) {
  if (atom.claimType !== 'education') return false
  let text = atom.verbatimText.replace(/^#{1,6}\s*|^[-*•]\s*/u, '')
  const fields = [scope.organization, ...((scope.title ?? '').split(/[|｜丨]/u))].filter((value): value is string => Boolean(value?.trim()))
  for (const field of fields.sort((a, b) => b.length - a.length)) text = text.split(field.trim()).join('')
  const datePattern = /((?:19|20)\d{2})(?:[.年/](1[0-2]|0?[1-9])月?)?(?:\s*毕业)?/gu
  const knownDates = [scope.start, scope.end].flatMap(value => value ? [...value.matchAll(datePattern)] : [])
  text = text.replace(datePattern, (value, year: string, month: string | undefined) => knownDates.some(date =>
    date[1] === year && (!month || date[2] && Number(month) === Number(date[2]))) ? '' : value)
    .replace(/至今|[\s|｜丨，,。.;；()（）\-–—]/gu, '')
  return !text
}
