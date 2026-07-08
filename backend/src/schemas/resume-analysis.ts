import { z } from 'zod'
import type { ResumeAnalysis } from '@/types'

export const resumeStructureSchema = z.object({
  personal_info: z.object({
    name: z.string(),
    contact: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    location: z.string().optional(),
    current_position: z.string().optional(),
  }).passthrough(),
  education: z.array(z.object({
    school: z.string(),
    major: z.string(),
    degree: z.string(),
    time_range: z.string(),
    achievements: z.array(z.string()).optional(),
  }).passthrough()),
  experience: z.array(z.object({
    company: z.string(),
    position: z.string(),
    time_range: z.string(),
    responsibilities: z.array(z.string()),
    achievements: z.array(z.string()),
  }).passthrough()),
  projects: z.array(z.object({
    name: z.string(),
    role: z.string(),
    tech_stack: z.array(z.string()),
    description: z.string(),
    achievements: z.array(z.string()),
  }).passthrough()).optional(),
  skills: z.object({
    hard_skills: z.array(z.string()),
    soft_skills: z.array(z.string()).optional(),
  }).passthrough(),
}).passthrough()

export const resumeAnalysisSchema = z.object({
  quality_score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  suggestions: z.array(z.string()),
  capability_summary: z.string(),
  structured_resume: resumeStructureSchema,
}).passthrough()

export type ResumeAnalysisFromSchema = z.infer<typeof resumeAnalysisSchema>

export function isResumeAnalysis(value: unknown): value is ResumeAnalysis {
  return resumeAnalysisSchema.safeParse(value).success
}
