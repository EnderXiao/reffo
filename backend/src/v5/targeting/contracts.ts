import { z } from 'zod'
import { jobExtractionCandidateSchema } from '@/v5/schemas'

export const JOB_TARGETING_POLICY = 'job-targeted-v1' as const
const text = z.string().trim().min(1).max(240)
const ids = z.array(z.string().trim().min(1))
const provenance = z.object({
  basis: z.enum(['explicit', 'inferred', 'unknown']), sourceBlockIds: ids,
  reason: z.string().max(160), confidence: z.enum(['high', 'medium', 'low']),
}).strict()
const node = z.object({ id: z.string().regex(/^job:[a-z]+:[a-zA-Z0-9_-]+$/), text, provenance }).strict()
const priority = z.enum(['core', 'supporting', 'optional', 'unclear'])

export const jobSuccessProfileSchema = z.object({
  contractVersion: z.literal('job-success-profile-v1'),
  candidatePortrait: node.nullable().optional().catch(undefined),
  context: z.array(node.extend({ kind: z.enum(['business', 'audience', 'stage', 'collaboration', 'constraint']) }).strict()),
  tasks: z.array(node.extend({ priority, requirementLocalIds: ids }).strict()),
  outcomes: z.array(node.extend({ taskIds: ids, metricQuote: z.string().nullable() }).strict()),
  successConditions: z.array(node.extend({ taskIds: ids }).strict()),
  attributes: z.array(node.extend({
    dimension: z.enum(['knowledge', 'skill', 'experience', 'ability', 'behavior', 'motivation_fit']),
    taskIds: ids, conditionIds: ids, requirementLocalIds: ids, evidenceExpectation: text,
  }).strict()),
  requirements: z.array(z.object({
    requirementLocalId: z.string().min(1), condition: z.enum(['necessary', 'preferred', 'unclear']),
    sourceQuote: text,
  }).strict()),
  unknowns: z.array(text), conflicts: z.array(z.object({ sourceBlockIds: ids, description: text }).strict()),
}).strict()
export const targetedJobExtractionSchema = jobExtractionCandidateSchema.extend({ jobSuccessProfile: jobSuccessProfileSchema }).strict()
export type JobSuccessProfile = z.infer<typeof jobSuccessProfileSchema>
export type TargetedJobExtraction = z.infer<typeof targetedJobExtractionSchema>

export const jobFitMapSchema = z.object({
  contractVersion: z.literal('job-fit-map-v1'),
  links: z.array(z.object({
    targetId: z.string().min(1),
    status: z.enum(['direct', 'transferable', 'weak_signal', 'unknown', 'explicit_gap', 'conflicted']),
    evidenceIds: ids,
    similarity: z.string().max(160), difference: z.string().max(160), expressionAngle: z.string().max(160),
  }).strict()),
  narratives: z.array(z.object({ statement: text, targetIds: ids, evidenceIds: ids }).strict()).max(3),
  questions: z.array(z.object({ targetId: z.string().min(1), question: text }).strict()).max(3),
}).strict()
export type JobFitMap = z.infer<typeof jobFitMapSchema>

/** Read only server-owned envelope wrappers; source text and model repair output cannot select a contract. */
export function isJobTargetedEnvelope(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.jobTargetingPolicy === JOB_TARGETING_POLICY) return true
  return isJobTargetedEnvelope(record.payload, depth + 1) || isJobTargetedEnvelope(record.originalEnvelope, depth + 1)
}
