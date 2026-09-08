import type { EvidenceAtom, V5ResumePlan } from '@/v5/types'

export const PRACTICE_SKILL_POLICY = 'practice-skills-v1' as const

/** A skill may summarize planned practice; it cannot authorize a new personal fact. */
export function isPracticeSkillEvidence(atom: EvidenceAtom, plan: V5ResumePlan) {
  if (atom.status === 'excluded' || atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text', 'conflicting'].includes(flag))) return false
  if (atom.claimType === 'skill') return plan.featuredSkillEvidenceIds.includes(atom.evidenceId)
  return ['action', 'responsibility', 'deliverable'].includes(atom.claimType)
    && plan.scopePlans.some(scope => scope.treatment !== 'omit'
      && ['experience', 'internship', 'project', 'research', 'other'].includes(scope.scopeType)
      && scope.selectedEvidenceIds.includes(atom.evidenceId))
}
