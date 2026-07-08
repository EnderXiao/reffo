import { z } from 'zod'
import type { MatchAnalysis } from '@/types'

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
}).passthrough()

export const matchAnalysisSchema = z.object({
  match_score: z.number().min(0).max(100),
  hard_requirements_match: z.record(z.boolean()),
  skill_match: z.object({
    matched: z.array(z.string()),
    missing: z.array(z.string()),
  }).passthrough(),
  experience_match: z.string(),
  soft_skills_match: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  jd_structure: jdStructureSchema,
}).passthrough()

export type MatchAnalysisFromSchema = z.infer<typeof matchAnalysisSchema>

export function isJDStructure(value: unknown): value is import('@/types').JDStructure {
  return jdStructureSchema.safeParse(value).success
}

export function isMatchAnalysis(value: unknown): value is MatchAnalysis {
  return matchAnalysisSchema.safeParse(value).success
}
