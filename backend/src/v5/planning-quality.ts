import type { EvidenceAtom, JobRequirementBundle, ResumeEvidenceBundle } from '@/v5/types'
import { isBusinessMetadata, sourceBusinessDisplayText } from '@/v5/composition/source-display'

/** Quality-selection hints only; these never certify a claim or change its type. */
export function hasHighValueEvidenceRole(atom: EvidenceAtom, role: 'result' | 'deliverable') {
  if (atom.claimType === role) return true
  const text = sourceBusinessDisplayText(atom.verbatimText)
  if (role === 'deliverable') {
    return /(?:交付|完成|产出|形成|发布|上线).{0,24}(?:报告|方案|原型|模型|系统|平台|功能|版本|需求|文档|PRD)/iu.test(text)
      || /(?:功能|版本|系统|平台).{0,12}(?:上线|发布)/u.test(text)
  }
  // Count observed outcomes, not activity quantities such as interviewing 20
  // users. Future/unsafe/fragment filtering remains the catalog's job.
  return /(?:日活|月活|营收|销售额|转化率|留存率|完成率|替代率|DAU|MAU|GMV).{0,16}\d/iu.test(text)
    || /(?:提升|增长|降低|下降|减少|节省)(?:了|至|到|约|近|超过|超|至少|不低于|\s)*\d/iu.test(text)
}

/** Selection signal only: lexical overlap never upgrades a requirement match. */
export function buildTargetEvidenceScores(resume: ResumeEvidenceBundle, job: JobRequirementBundle) {
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
  const words = (text: string) => new Set([...segmenter.segment(text.toLowerCase())]
    .filter(part => part.isWordLike && part.segment.length >= 2 && !/^\d+$/u.test(part.segment))
    .map(part => part.segment)
    .filter(word => !/^(?:负责|工作|能力|经验|相关|业务|产品|经理|工程师|设计师|高级|资深|进行|具备|良好|优秀|以及|能够|要求|以上)$/u.test(word)))
  const importance = { core_outcome: 4, must_have: 3, differentiator: 2, nice_to_have: 1 }
  const terms = new Map<string, number>()
  for (const requirement of job.requirementAtoms) {
    for (const word of words(requirement.normalizedRequirement)) {
      terms.set(word, Math.max(terms.get(word) ?? 0, importance[requirement.importance]))
    }
  }
  const tokens = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, words(atom.verbatimText)]))
  const roleFocus = words(job.basicInfo.title ?? '')
  const frequency = new Map([...terms.keys()].map(term => [term,
    [...tokens.values()].filter(values => values.has(term)).length]))
  return new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId,
    [...(tokens.get(atom.evidenceId) ?? [])].reduce((sum, word) => sum
      + (roleFocus.has(word) ? 32 : 0)
      + (terms.get(word) ?? 0) / Math.sqrt(Math.max(1, frequency.get(word) ?? 1)), 0)]))
}

/** Suppress only metadata-only duplicates. Never merge evidence across jobs. */
export function duplicateTimelineOnlyScopes(resume: ResumeEvidenceBundle, selectedScopes: ReadonlySet<string>) {
  const norm = (value: string | null) => (value ?? '').normalize('NFKC').toLowerCase().replace(/[\s.。|｜丨、]/gu, '')
  const title = (value: string | null) => norm((value ?? '').split(/[；;]/)[0])
  const atomById = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const scopeText = (scope: ResumeEvidenceBundle['timeline'][number]) => scope.evidenceIds
    .map(id => atomById.get(id)?.verbatimText ?? '').join('\n').toLowerCase()
  const work = resume.timeline.filter(scope => ['experience', 'internship'].includes(scope.kind))
  const omitted = new Set<string>()
  for (const source of work) {
    if (selectedScopes.has(source.scopeId) || !source.start || !source.end || !source.organization || !source.title) continue
    const hasSubstantiveBody = source.evidenceIds.some(id => {
      const atom = atomById.get(id)
      return atom && atom.status !== 'excluded'
        && ['responsibility', 'action', 'deliverable', 'result'].includes(atom.claimType)
        && !isBusinessMetadata(atom, resume)
    })
    if (hasSubstantiveBody) continue
    const equivalents = work.filter(target => {
      const richerTarget = selectedScopes.has(target.scopeId)
        || target.evidenceIds.length > source.evidenceIds.length
      if (target.scopeId === source.scopeId || !richerTarget
        || norm(source.start) !== norm(target.start) || norm(source.end) !== norm(target.end)
        || title(source.title) !== title(target.title)) return false
      const organization = norm(source.organization)
      return (target.organization && (norm(target.organization).includes(organization)
        || organization.includes(norm(target.organization))))
        || norm(scopeText(target)).includes(organization)
    })
    if (equivalents.length === 1) omitted.add(source.scopeId)
  }
  return omitted
}
