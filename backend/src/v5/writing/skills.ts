import type { EvidenceAtom, V5ResumePlan } from '@/v5/types'

export const PRACTICE_SKILL_POLICY = 'practice-skills-v1' as const

const SKILL_DIMENSIONS: ReadonlyArray<readonly [string, RegExp]> = [
  ['research', /用户研究/u], ['service', /服务设计/u], ['rules', /业务规则建模/u],
  ['requirements', /需求分析/u], ['prototype', /原型/u], ['prd', /\bPRD\b/iu],
  ['tracking', /(?:数据)?埋点/u], ['iteration', /敏捷迭代/u], ['gray', /灰度/u],
  ['ab', /A\s*[/／-]\s*B\s*测试/iu], ['collaboration', /跨(?:团队|部门)协作/u],
  ['competitive', /竞品分析/u], ['interview', /用户访谈/u], ['logs', /日志分析/u],
  ['monitoring', /监控/u], ['reproduction', /问题复现/u], ['release', /修复发版/u],
]

export function skillDimensions(text: string): string[] {
  return SKILL_DIMENSIONS.filter(([, pattern]) => pattern.test(text)).map(([dimension]) => dimension)
}

/** A complete already-rendered list is a rewrite signal, not permission to infer an ability. */
export function hasRepeatedSkillDimensions(text: string, rendered: string[]): boolean {
  const existing = rendered.flatMap(value => value.split(/[；;。]/u)).map(skillDimensions).filter(items => items.length >= 3)
  return text.split(/[；;。]/u).some(clause => {
    const dimensions = new Set(skillDimensions(clause))
    return existing.some(items => items.every(item => dimensions.has(item)))
  })
}

/** A skill may summarize planned practice; it cannot authorize a new personal fact. */
export function isPracticeSkillEvidence(atom: EvidenceAtom, plan: V5ResumePlan) {
  if (atom.status === 'excluded' || atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text', 'conflicting'].includes(flag))) return false
  if (atom.claimType === 'skill') return plan.featuredSkillEvidenceIds.includes(atom.evidenceId)
  return ['action', 'responsibility', 'deliverable'].includes(atom.claimType)
    && plan.scopePlans.some(scope => scope.treatment !== 'omit'
      && ['experience', 'internship', 'project', 'research', 'other'].includes(scope.scopeType)
      && scope.selectedEvidenceIds.includes(atom.evidenceId))
}
