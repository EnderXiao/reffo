import { z } from 'zod'
import type { ResumeAnalysis } from '@/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function normalizeStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeString(item))
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(/\n|；|;|、/)
      .map(item => item.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean)
  }

  return []
}

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
  }

  return value === null || value === undefined ? [] : [value]
}

function normalizeAnalysisRoot(value: unknown) {
  if (!isRecord(value)) {
    return value
  }

  if (isRecord(value.analysis)) {
    return value.analysis
  }

  if (isRecord(value.resume_analysis)) {
    return value.resume_analysis
  }

  return value
}

function normalizeExperienceItem(value: unknown) {
  if (!isRecord(value)) {
    return {
      responsibilities: normalizeStringArray(value),
    }
  }

  return {
    ...value,
    time_range: value.time_range ?? value.duration ?? value.time ?? '',
    responsibilities: value.responsibilities ?? value.duties ?? value.description ?? [],
    achievements: value.achievements ?? value.results ?? [],
  }
}

function normalizeProjectItem(value: unknown) {
  if (!isRecord(value)) {
    return {
      name: normalizeString(value),
    }
  }

  return {
    ...value,
    tech_stack: value.tech_stack ?? value.technologies ?? value.skills ?? [],
    achievements: value.achievements ?? value.results ?? [],
  }
}

function normalizeSkills(value: unknown) {
  if (Array.isArray(value) || typeof value === 'string') {
    return {
      hard_skills: value,
      soft_skills: [],
    }
  }

  if (!isRecord(value)) {
    return {
      hard_skills: [],
      soft_skills: [],
    }
  }

  return {
    ...value,
    hard_skills: value.hard_skills ?? value.technical_skills ?? value.skills ?? [],
    soft_skills: value.soft_skills ?? value.soft ?? [],
  }
}

const stringFieldSchema = z.preprocess(normalizeString, z.string())
const stringArraySchema = z.preprocess(normalizeStringArray, z.array(z.string()))

export const resumeStructureSchema = z.object({
  personal_info: z.preprocess(value => isRecord(value) ? value : {}, z.object({
    name: stringFieldSchema.default(''),
    contact: stringFieldSchema.default(''),
    email: stringFieldSchema.default(''),
    phone: stringFieldSchema.default(''),
    location: stringFieldSchema.default(''),
    current_position: stringFieldSchema.default(''),
  }).passthrough()),
  education: z.preprocess(normalizeArray, z.array(z.preprocess(value => isRecord(value) ? value : { school: value }, z.object({
    school: stringFieldSchema.default(''),
    major: stringFieldSchema.default(''),
    degree: stringFieldSchema.default(''),
    time_range: stringFieldSchema.default(''),
    achievements: stringArraySchema.default([]),
  }).passthrough()))),
  experience: z.preprocess(normalizeArray, z.array(z.preprocess(normalizeExperienceItem, z.object({
    company: stringFieldSchema.default(''),
    position: stringFieldSchema.default(''),
    time_range: stringFieldSchema.default(''),
    responsibilities: stringArraySchema.default([]),
    achievements: stringArraySchema.default([]),
  }).passthrough()))),
  projects: z.preprocess(normalizeArray, z.array(z.preprocess(normalizeProjectItem, z.object({
    name: stringFieldSchema.default(''),
    role: stringFieldSchema.default(''),
    tech_stack: stringArraySchema.default([]),
    description: stringFieldSchema.default(''),
    achievements: stringArraySchema.default([]),
  }).passthrough()))).default([]),
  skills: z.preprocess(normalizeSkills, z.object({
    hard_skills: stringArraySchema.default([]),
    soft_skills: stringArraySchema.default([]),
  }).passthrough()),
}).passthrough()

export const resumeAnalysisSchema = z.preprocess(normalizeAnalysisRoot, z.object({
  quality_score: z.coerce.number().min(0).max(100).default(0),
  strengths: stringArraySchema.default([]),
  weaknesses: stringArraySchema.default([]),
  suggestions: stringArraySchema.default([]),
  capability_summary: stringFieldSchema.default(''),
  structured_resume: resumeStructureSchema,
}).passthrough())

export type ResumeAnalysisFromSchema = z.infer<typeof resumeAnalysisSchema>

export function parseResumeAnalysis(value: unknown): ResumeAnalysis {
  return resumeAnalysisSchema.parse(value) as ResumeAnalysis
}

export function isResumeAnalysis(value: unknown): value is ResumeAnalysis {
  return resumeAnalysisSchema.safeParse(value).success
}
