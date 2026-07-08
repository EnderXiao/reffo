/**
 * TypeScript 类型定义
 */

/**
 * 简历结构化数据
 */
export interface ResumeStructure {
  personal_info: {
    name: string
    contact?: string
    email?: string
    phone?: string
    location?: string
    current_position?: string
  }
  education: Array<{
    school: string
    major: string
    degree: string
    time_range: string
    achievements?: string[]
  }>
  experience: Array<{
    company: string
    position: string
    time_range: string
    responsibilities: string[]
    achievements: string[]
  }>
  projects?: Array<{
    name: string
    role: string
    tech_stack: string[]
    description: string
    achievements: string[]
  }>
  skills: {
    hard_skills: string[]
    soft_skills?: string[]
  }
}

/**
 * 简历分析结果
 */
export interface ResumeAnalysis {
  quality_score: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  capability_summary: string
  structured_resume: ResumeStructure
}

/**
 * JD 结构化数据
 */
export interface JDStructure {
  basic_info: {
    title: string
    company?: string
    location?: string
  }
  hard_requirements: {
    education?: string
    experience_years?: string
    required_skills: string[]
  }
  responsibilities: string[]
  tasks: string[]
  soft_skills: string[]
  nice_to_have: string[]
}

/**
 * 匹配分析结果
 */
export interface MatchAnalysis {
  match_score: number
  hard_requirements_match: Record<string, boolean>
  skill_match: {
    matched: string[]
    missing: string[]
  }
  experience_match: string
  soft_skills_match: string
  strengths: string[]
  weaknesses: string[]
  jd_structure: JDStructure
}

export interface InterviewStoryRecommendation {
  title: string
  background: string
  result: string
}

export interface InterviewSuggestions {
  questions: string[]
  story_recommendations: InterviewStoryRecommendation[]
  follow_up_questions: string[]
}

/**
 * API 响应格式
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export type MvpWorkflowStatus = 'running' | 'succeeded' | 'failed' | 'partial'

export interface MvpStepStatus {
  stepRunId: string
  stepName: string
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'partial'
  startedAt: string
  finishedAt?: string
  errorCode?: string
  errorMessage?: string
}

export interface MvpRecoverableError {
  stepName: string
  errorCode: string
  message: string
}

/**
 * MVP 流程响应
 */
export interface MvpProcessResponse {
  run_id?: string
  workflow_status?: MvpWorkflowStatus
  step_statuses?: MvpStepStatus[]
  recoverable_errors?: MvpRecoverableError[]
  step1_analysis: ResumeAnalysis
  step2_matching: MatchAnalysis
  step3_optimized_resume: string
  step4_interview_suggestions?: InterviewSuggestions
}

export type SourceResumeSourceType = 'manual' | 'file'

export interface SourceResumeRecord {
  id: string
  title: string
  resume_markdown: string
  source_type: SourceResumeSourceType
  original_file_name: string | null
  created_at: string
  updated_at: string
}

export interface SaveSourceResumeInput {
  title: string
  resume_markdown: string
  source_type: SourceResumeSourceType
  original_file_name?: string | null
}
