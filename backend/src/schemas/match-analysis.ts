import { z } from 'zod'
import type { MatchAnalysis } from '@/types'

const contextConfidenceSchema = z.enum(['high', 'medium', 'low', 'unknown'])

export const jdStructureSchema = z.object({
  basic_info: z.object({
    title: z.string(),
    company: z.string().optional(),
    location: z.string().optional(),
  }).passthrough(),
  hard_requirements: z.object({
    education: z.string().optional(),
    experience_years: z.string().optional(),
    required_skills: z.array(z.string()),
  }).passthrough(),
  responsibilities: z.array(z.string()),
  tasks: z.array(z.string()),
  soft_skills: z.array(z.string()),
  nice_to_have: z.array(z.string()),
  requirement_hierarchy: z.object({
    must_have: z.array(z.string()).default([]),
    core_outcomes: z.array(z.string()).default([]),
    differentiators: z.array(z.string()).default([]),
  }).passthrough().default({
    must_have: [],
    core_outcomes: [],
    differentiators: [],
  }),
  company_context: z.object({
    explicit_signals: z.array(z.string()).default([]),
    inferred_talent_preferences: z.array(z.string()).default([]),
    inference_basis: z.array(z.string()).default([]),
    confidence: contextConfidenceSchema.default('unknown'),
  }).passthrough().default({
    explicit_signals: [],
    inferred_talent_preferences: [],
    inference_basis: [],
    confidence: 'unknown',
  }),
  location_context: z.object({
    explicit_signals: z.array(z.string()).default([]),
    inferred_role_implications: z.array(z.string()).default([]),
    inference_basis: z.array(z.string()).default([]),
    confidence: contextConfidenceSchema.default('unknown'),
  }).passthrough().default({
    explicit_signals: [],
    inferred_role_implications: [],
    inference_basis: [],
    confidence: 'unknown',
  }),
  uncertainties: z.array(z.string()).default([]),
}).passthrough()

const booleanLikeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value
  }

  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', '是', '匹配', '满足'].includes(normalized)) {
    return true
  }
  if (['false', 'no', '否', '不匹配', '不满足'].includes(normalized)) {
    return false
  }

  return value
}, z.boolean())

const weaknessEvidenceTypeSchema = z.enum(['direct_missing', 'implicit_evidence', 'wording_gap'])

const requiredSkillCheckSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {requirement: '', status: 'unclear', evidence: ''}
  }

  const item = value as Record<string, unknown>
  const status = item.status === 'matched' || item.status === 'missing' || item.status === 'unclear'
    ? item.status
    : 'unclear'

  return {
    ...item,
    requirement: typeof item.requirement === 'string' ? item.requirement : '',
    status,
    evidence: typeof item.evidence === 'string' ? item.evidence : '',
  }
}, z.object({
  requirement: z.string().default(''),
  status: z.enum(['matched', 'missing', 'unclear']).default('unclear'),
  evidence: z.string().default(''),
}).passthrough())

const requiredSkillChecksSchema = z.preprocess((value) => (
  Array.isArray(value) ? value : []
), z.array(requiredSkillCheckSchema).default([]))

const weaknessDetailSchema = z.object({
  weakness: z.string(),
  evidence_type: weaknessEvidenceTypeSchema,
  evidence: z.string().default(''),
  suggestion: z.string().default(''),
}).passthrough()

const weaknessStringArraySchema = z.preprocess((value) => {
  if (!Array.isArray(value)) {
    return value
  }

  return value.map((item) => {
    if (typeof item === 'string') {
      return item
    }
    if (item && typeof item === 'object') {
      const weakness = 'weakness' in item ? item.weakness : undefined
      const description = 'description' in item ? item.description : undefined
      const content = 'content' in item ? item.content : undefined
      return String(weakness ?? description ?? content ?? '')
    }

    return String(item ?? '')
  }).filter((item) => item.trim())
}, z.array(z.string()))

const contextFitSchema = z.object({
  company_alignment: z.string().default(''),
  location_alignment: z.string().default(''),
  hypotheses_used: z.array(z.string()).default([]),
}).passthrough()

export const matchAnalysisOutputSchema = z.object({
  match_score: z.coerce.number().min(0).max(100),
  hard_requirements_match: z.record(booleanLikeSchema).default({}),
  skill_match: z.object({
    matched: z.array(z.string()).default([]),
    missing: z.array(z.string()).default([]),
    required_skill_checks: requiredSkillChecksSchema,
  }).passthrough(),
  experience_match: z.string(),
  soft_skills_match: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  weaknesses: weaknessStringArraySchema.default([]),
  weakness_details: z.array(weaknessDetailSchema).default([]),
  positioning_strategy: z.string().default(''),
  optimization_suggestions: z.array(z.string()).default([]),
  context_fit: contextFitSchema.default({
    company_alignment: '',
    location_alignment: '',
    hypotheses_used: [],
  }),
  jd_structure: jdStructureSchema.optional(),
}).passthrough()

export const matchAnalysisSchema = z.object({
  match_score: z.coerce.number().min(0).max(100),
  hard_requirements_match: z.record(booleanLikeSchema),
  skill_match: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
    required_skill_checks: requiredSkillChecksSchema,
  }).passthrough(),
  experience_match: z.string(),
  soft_skills_match: z.string(),
  strengths: z.array(z.string()),
  weaknesses: weaknessStringArraySchema,
  weakness_details: z.array(weaknessDetailSchema).optional(),
  positioning_strategy: z.string().optional(),
  optimization_suggestions: z.array(z.string()).optional(),
  context_fit: contextFitSchema.optional(),
  jd_structure: jdStructureSchema,
}).passthrough()

export type MatchAnalysisOutputFromSchema = z.infer<typeof matchAnalysisOutputSchema>
export type MatchAnalysisFromSchema = z.infer<typeof matchAnalysisSchema>

export function isJDStructure(value: unknown): value is import('@/types').JDStructure {
  return jdStructureSchema.safeParse(value).success
}

export function isMatchAnalysis(value: unknown): value is MatchAnalysis {
  return matchAnalysisSchema.safeParse(value).success
}

export function isMatchAnalysisOutput(value: unknown): value is MatchAnalysisOutputFromSchema {
  return matchAnalysisOutputSchema.safeParse(value).success
}
