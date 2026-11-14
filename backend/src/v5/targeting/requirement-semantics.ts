import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { CanonicalSourceDocument, JobExtractionCandidate, RequirementAtom } from '@/v5/types'

export const requirementSemanticsSchema = z.object({
  kind: z.enum(['qualification', 'responsibility', 'professional_skill', 'general_ability']),
  condition: z.enum(['required', 'expected', 'preferred', 'unclear']),
  requiredOwnership: z.enum(['independent', 'lead']).nullable(),
  domainConstraint: z.string().nullable(),
  minimumYears: z.number().nonnegative().nullable(),
  preferredRange: z.object({ minimum: z.number().nonnegative(), maximum: z.number().nonnegative() }).strict().nullable(),
  scoringGroupId: z.string().min(1),
}).strict()
export type RequirementSemantics = z.infer<typeof requirementSemanticsSchema>

function headingContext(document: CanonicalSourceDocument, blockId: string) {
  let context = ''
  for (const block of document.blocks) {
    if (/^(?:#{1,6}\s*)?(?:加分项|优先条件|任职要求|岗位要求|任职资格|岗位职责|工作职责)\s*[:：]?\s*$/u.test(block.text.trim())) context = block.text
    if (block.sourceBlockId === blockId) break
  }
  return context
}

const normalized = (text: string) => text.normalize('NFKC').toLowerCase()
  .replace(/^\s*(?:[-*•]\s*|\d+[.、)）]\s*)/u, '').replace(/[\s，。；;、:：]/gu, '')

function domainConstraint(quote: string) {
  // An industry belongs only to the quoted requirement, never to neighbouring generic skills.
  const domain = quote.match(/(?:互联网金融|金融科技|金融交易|海外金融交易|金融|支付|医疗|零售|电商|银行)(?:行业|领域)?/u)
  return domain?.[0] ?? null
}

function yearsIntent(quote: string) {
  return normalized(quote).replace(/(?:至少|不少于|要求|需具备|具备|具有|拥有)/gu, '')
    .replace(/\d+(?:\.\d+)?(?:[-–—~至到]\d+(?:\.\d+)?)?年(?:及以上|以上|以内|以下|左右)?/gu, '')
    .replace(/(?:优先|的|相关|累计|全职|工作|从业|岗位|经验|经历|年限)/gu, '')
}

/** Source wording determines the gate. A model label cannot promote a preference. */
export function deriveRequirementSemantics(document: CanonicalSourceDocument,
  requirement: JobExtractionCandidate['requirementCandidates'][number]): RequirementSemantics {
  const quote = requirement.verbatimText
  const context = headingContext(document, requirement.sourceBlockId)
  const preferred = /优先|加分|最好|preferred|nice.to.have/iu.test(quote + context)
  const qualification = ['education', 'experience', 'certification', 'language', 'location', 'schedule'].includes(requirement.category)
  const explicitRequired = /必须|要求|需要|需具备|需具有|至少|不少于|不得|required|must|mandatory|minimum/iu.test(quote)
    || qualification && /(?:学历|学位|年)(?:及)?以上/u.test(quote)
  const summary = /^(?:\d+(?:\.\d+)?\s*[-–—~至到]\s*\d+(?:\.\d+)?\s*年|本科|硕士|博士|大专)(?:学历)?$/u.test(quote.trim())
  const condition = preferred ? 'preferred' : explicitRequired ? 'required' : summary ? 'expected'
    : qualification && /任职要求|岗位要求|任职资格/u.test(context) ? 'required'
      : requirement.category === 'responsibility' || /岗位职责|工作职责/u.test(context) ? 'expected'
        : requirement.importance === 'must_have' ? 'unclear' : 'expected'
  const minimum = !preferred && /(?:至少|不少于)?\s*(\d+(?:\.\d+)?)\s*年(?:及)?以上/u.exec(quote)
  const range = /(\d+(?:\.\d+)?)\s*[-–—~至到]\s*(\d+(?:\.\d+)?)\s*年/u.exec(quote)
  let intent = normalized(quote).replace(/(?:要求|需具备|具备|具有|拥有|学历|及以上|以上)/gu, '')
  if (requirement.category === 'experience' && (minimum || range)) {
    let role = yearsIntent(quote)
    if (!role) {
      // A generic header range may refer to one body experience gate. Never merge two different roles/domains.
      const bodyRoles = new Set(document.blocks.flatMap(block => [...block.text.matchAll(/(?:至少|不少于)?\d+(?:\.\d+)?\s*年(?:及)?以上[^，。；;\n]{0,40}(?:经验|经历)/gu)]
        .map(match => yearsIntent(match[0])).filter(Boolean)))
      if (bodyRoles.size === 1) role = [...bodyRoles][0]!
    }
    intent = `years:${role || 'general-employment'}`
  }
  return { kind: qualification ? 'qualification' : requirement.category === 'responsibility' ? 'responsibility'
    : requirement.category === 'skill' ? 'professional_skill' : 'general_ability', condition,
    requiredOwnership: /主导|牵头|\blead\b/iu.test(quote) ? 'lead'
      : /独立(?:完成|承担|开展|负责)/u.test(quote) ? 'independent' : null,
    domainConstraint: domainConstraint(quote),
    minimumYears: minimum ? Number(minimum[1]) : null,
    preferredRange: range ? {minimum: Number(range[1]), maximum: Number(range[2])} : null,
    scoringGroupId: `requirement_group_${createHash('sha256').update(`${requirement.category}:${intent}`).digest('hex').slice(0, 16)}` }
}

export function importanceForSemantics(semantics: RequirementSemantics, fallback: RequirementAtom['importance']) {
  if (semantics.condition === 'preferred') return 'nice_to_have' as const
  if (semantics.condition === 'required') return 'must_have' as const
  return fallback === 'must_have' ? 'differentiator' as const : fallback
}
