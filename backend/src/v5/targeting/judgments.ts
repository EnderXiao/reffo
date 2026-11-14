import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { EvidenceAtom, JobRequirementBundle, ResumeEvidenceBundle } from '@/v5/types'
import { calculateExperienceDuration } from '@/v5/experience-duration'
import type { JobFitMap } from './contracts'

const aspectSchema = z.object({aspectId: z.string().min(1), text: z.string().min(1), evidenceIds: z.array(z.string())}).strict()
export const requirementJudgmentBundleSchema = z.object({
  version: z.literal('requirement-judgment-v2'), judgmentRevision: z.string().min(1), sourceRevision: z.string().min(1),
  items: z.array(z.object({
    requirementId: z.string().min(1), status: z.enum(['direct', 'transferable_or_partial', 'unproven', 'not_met']),
    supportRelation: z.enum(['domain_transfer', 'partial_coverage', 'both']).nullable(),
    supportedAspects: z.array(aspectSchema), unprovenAspects: z.array(aspectSchema),
    evidenceIds: z.array(z.string()), roleBoundary: z.string(), conflict: z.string().nullable(),
  }).strict()),
}).strict()
export type RequirementJudgmentBundle = z.infer<typeof requirementJudgmentBundleSchema>

export function isConcretePractice(atom: EvidenceAtom) {
  return ['action', 'responsibility', 'deliverable', 'result'].includes(atom.claimType)
    && atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['self_assessment_only', 'future_or_planned', 'conflicting'].includes(flag))
}

/** Referencing a positive but incomplete fact is not contrary evidence. */
export function hasExplicitContraryEvidence(targetText: string, atoms: EvidenceAtom[]) {
  const subjects = [...targetText.matchAll(/[\p{Script=Han}]{2,}|[a-z][a-z0-9+#/-]{1,}/giu)].map(match => match[0]!)
  const minimumYears = /(?:至少|不少于)?(\d+(?:\.\d+)?)\s*年(?:及)?以上/u.exec(targetText)?.[1]
  return atoms.some(atom => atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['conflicting', 'future_or_planned'].includes(flag)) && (
    Boolean(minimumYears && [...atom.verbatimText.matchAll(/(仅|只有|不足|不满)\s*(\d+(?:\.\d+)?)\s*年/gu)]
      .some(match => ['不足', '不满'].includes(match[1]!) ? Number(match[2]) <= Number(minimumYears) : Number(match[2]) < Number(minimumYears)))
    || /(?:最高学历|仅有|只有|仅为)[^，。；;]{0,8}大专/u.test(atom.verbatimText) && /本科|学士|硕士|博士/u.test(targetText)
    || atom.verbatimText.split(/[，。；;]/u).some(clause => /(?:未曾|从未|没有|不具备|不会|不能接受|不接受)/u.test(clause)
      && !/(?:材料|简历|证据|记录|未提供|未说明|未证明|未披露|补证)/u.test(clause)
      && subjects.some(subject => {
        const fragments = subject.length > 2 ? Array.from({length: subject.length - 1}, (_, index) => subject.slice(index, index + 2)) : [subject]
        return fragments.some(fragment => !['产品', '经验', '能力', '要求', '工作', '具备', '相关', '能够', '负责'].includes(fragment) && clause.includes(fragment))
      }))
  ))
}

export function buildRequirementJudgments(fit: JobFitMap, job: JobRequirementBundle, resume: ResumeEvidenceBundle): RequirementJudgmentBundle {
  // Only the requirement's own target can certify it; linked job tasks describe separate judgments.
  const links = new Map(fit.links.map(link => [link.targetId, link]))
  const evidence = new Map(resume.evidenceAtoms.map(atom => [atom.evidenceId, atom]))
  const duration = calculateExperienceDuration(resume)
  const items = job.requirementAtoms.map(requirement => {
    const link = links.get(requirement.requirementId)
    const atoms = (link?.evidenceIds ?? []).flatMap(id => evidence.get(id) ? [evidence.get(id)!] : [])
      .filter(atom => atom.status !== 'excluded' && !atom.riskFlags.some(flag => ['sensitive_pii', 'prompt_injection_like_text', 'future_or_planned', 'conflicting'].includes(flag)))
    const evidenceIds = atoms.map(atom => atom.evidenceId)
    const concretePractice = atoms.some(isConcretePractice)
    let status: RequirementJudgmentBundle['items'][number]['status'] = !link || ['unknown', 'conflicted'].includes(link.status) || !atoms.length ? 'unproven'
      : link.status === 'direct' ? 'direct' : link.status === 'explicit_gap'
        ? hasExplicitContraryEvidence(requirement.verbatimText, atoms) ? 'not_met' : 'unproven'
        : link.similarity.trim() && concretePractice ? 'transferable_or_partial' : 'unproven'
    const supported = (link?.supportedAspects ?? []).filter(aspect => aspect.evidenceIds.length && aspect.evidenceIds.every(id => evidenceIds.includes(id)))
    let unproven = (link?.unprovenAspects ?? []).map(aspect => aspect.text)
    if (status === 'direct' && unproven.length) status = concretePractice ? 'transferable_or_partial' : 'unproven'
    const semantics = requirement.semantics
    if (status === 'direct' && semantics?.requiredOwnership && atoms.every(atom => !['owned', 'drove'].includes(atom.attributionLevel))) {
      status = concretePractice ? 'transferable_or_partial' : 'unproven'
      unproven.push(semantics.requiredOwnership === 'lead' ? '主导责任的直接证据尚不充分。' : '独立完成的责任边界尚未得到直接证明。')
    }
    // A numeric gate consumes the deterministic timeline, never an LLM's “present” arithmetic.
    if (semantics?.minimumYears !== null && semantics?.minimumYears !== undefined) {
      if (duration.fullTime.months === null) {
        status = 'unproven'
        unproven.push('全职相关年限缺少完整月份或来源时点，不能把实习计入或将至今延长到运行日期。')
      } else if (duration.fullTime.months < semantics.minimumYears * 12) {
        // A supplied timeline may be incomplete. Under-length material alone is not a declaration of incapability.
        if (status !== 'not_met') status = 'unproven'
        unproven.push(`当前可核对的全职任职时间并集为${duration.fullTime.months}个月，尚不足以证明${semantics.minimumYears}年以上相关经验。`)
      }
    }
    const supportedAspects = supported.length ? supported.map(aspect => ({
      aspectId: `${requirement.requirementId}:supported:${createHash('sha256').update(aspect.text).digest('hex').slice(0, 12)}`,
      text: aspect.text, evidenceIds: aspect.evidenceIds,
    })) : link?.similarity.trim() && evidenceIds.length && status !== 'unproven'
      ? [{aspectId: `${requirement.requirementId}:supported:0`, text: link.similarity, evidenceIds}] : []
    if (!unproven.length && status !== 'direct') unproven = [link?.difference || '现有材料尚不足以判断该项要求。']
    const unprovenAspects = [...new Set(unproven)].map(text => ({
      aspectId: `${requirement.requirementId}:unproven:${createHash('sha256').update(text).digest('hex').slice(0, 12)}`, text, evidenceIds: [] as string[],
    }))
    const roleBoundary = [...new Set([link?.roleBoundary ?? '', ...atoms.flatMap(atom => [...atom.qualifiers,
      ...(['contributed', 'supported'].includes(atom.attributionLevel) ? ['参与或协同贡献，不自动升级为独立负责。'] : [])])])].filter(Boolean).join('；')
    return {requirementId: requirement.requirementId, status,
      supportRelation: status === 'transferable_or_partial' ? link?.supportRelation ?? (link?.status === 'transferable' ? 'domain_transfer' as const : 'partial_coverage' as const) : null,
      supportedAspects, unprovenAspects, evidenceIds, roleBoundary,
      conflict: link?.status === 'conflicted' ? link.difference : null}
  })
  const sourceRevision = resume.sourceStructure?.sourceRevision ?? resume.sourceDocument.sha256
  return {version: 'requirement-judgment-v2', sourceRevision,
    judgmentRevision: `judgment_${createHash('sha256').update(JSON.stringify({sourceRevision, items})).digest('hex').slice(0, 24)}`, items}
}
