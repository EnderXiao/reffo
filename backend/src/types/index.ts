import type { ResumeStrategyReview } from '@/shared/resume-strategy'

/**
 * TypeScript 类型定义
 */

import type { RecoverySummary } from '@/harness/runtime-state'
import type { HarnessResponseMeta } from '@/harness/harnessed-request'
import type { ResumeAgentState, V5ReleaseStatus } from '@/v5/types'
import type { RequirementAnalysis } from '@/job-analysis/requirements'

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
export type ContextConfidence = 'high' | 'medium' | 'low' | 'unknown'

export interface JDStructure {
  requirement_analysis?: RequirementAnalysis
  requirement_sources?: Array<{requirement_id: string; source_quote: string; source_span: {start: number; end: number}; source_block_id: string}>
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
  requirement_hierarchy?: {
    must_have: string[]
    core_outcomes: string[]
    differentiators: string[]
  }
  company_context?: {
    explicit_signals: string[]
    inferred_talent_preferences: string[]
    inference_basis: string[]
    confidence: ContextConfidence
  }
  location_context?: {
    explicit_signals: string[]
    inferred_role_implications: string[]
    inference_basis: string[]
    confidence: ContextConfidence
  }
  uncertainties?: string[]
}

/**
 * 匹配分析结果
 */
export type WeaknessEvidenceType = 'direct_missing' | 'implicit_evidence' | 'wording_gap'
export type MatchGapPriority = 'high' | 'medium' | 'low'

export type RequiredSkillCheckStatus = 'matched' | 'missing' | 'partial' | 'unproven' | 'not_met' | 'unclear'

export interface RequiredSkillCheck {
  requirement: string
  status: RequiredSkillCheckStatus
  evidence: string
}

export interface MatchWeaknessDetail {
  id?: string
  priority?: MatchGapPriority
  is_required?: boolean
  weakness: string
  evidence_type: WeaknessEvidenceType
  jd_requirement?: string
  evidence: string
  impact?: string
  suggestion: string
}

export interface MatchOptimizationExample {
  source_path: string
  source_quote: string
  optimized_content: string
}

export interface MatchOptimizationStrategyDetail {
  id: string
  related_gap_ids: string[]
  strategy_point: string
  rationale: string
  optimization_example: MatchOptimizationExample
}

export interface MatchAnalysis {
  requirement_judgments?: import('@/v5/targeting/judgments').RequirementJudgmentBundle
  experience_duration?: import('@/v5/experience-duration').ExperienceDuration
  action_plan?: import('@/shared/resume-actions').ResumeActionPlan
  score_formula_version?: 'match-score-v1' | 'match-score-v2' | 'match-score-v3'
  score_calibration_status?: 'pending' | 'calibrated' | 'rules_based'
  score_basis?: 'current_material_requirement_coverage'
  score_confidence?: 'high' | 'medium' | 'low'
  requirement_analysis?: RequirementAnalysis
  match_score: number | null
  hard_requirements_match: Record<string, boolean | null>
  skill_match: {
    matched: string[]
    missing: string[]
    required_skill_checks?: RequiredSkillCheck[]
  }
  experience_match: string
  soft_skills_match: string
  strengths: string[]
  weaknesses: string[]
  weakness_details?: MatchWeaknessDetail[]
  positioning_strategy?: string
  optimization_suggestions?: string[]
  optimization_strategy_details?: MatchOptimizationStrategyDetail[]
  context_fit?: {
    company_alignment: string
    location_alignment: string
    hypotheses_used: string[]
  }
  jd_structure: JDStructure
}

export interface InterviewStoryRecommendation {
  story_id?: string
  scope_id?: string
  case_group_id?: string
  source_references?: Array<{evidence_id: string; source_scope_id: string; source_quote: string; source_kind: 'source_resume' | 'user_fact'}>
  related_requirement_ids?: string[]
  action_ids?: string[]
  title: string
  background: string
  result: string
  storytelling_approach: string[]
}

export interface InterviewSuggestions {
  presentation?: InterviewPresentation
  preparation_topics?: import('@/v5/writing/information-routing').InterviewPreparationTopic[]
  questions: string[]
  story_recommendations: InterviewStoryRecommendation[]
  follow_up_questions: string[]
}

export interface InterviewPresentation {
  version: 'interview-presentation-v1'
  basedOnDocument?: {documentId: string; revision: number; resolvedDigest?: string}
  userFactSnapshot?: {documentId: string; revision: number; facts: Array<{evidenceId: string; sourceScopeId: string; sourceBlockId: string; text: string}>}
  questions: Array<{
    questionId: string
    question: string
    category?: string
    preparationFocus: string
    sourceEvidenceIds: string[]
    requirementIds: string[]
    topics: import('@/v5/writing/information-routing').InterviewPreparationTopic[]
  }>
  stories: Array<{
    storyId: string
    title: string
    resultText?: string
    scopeId: string
    caseGroupId?: string
    sourceGroups: Array<{
      sourceKind: 'source_resume' | 'user_fact'
      label: string
      stage?: string
      evidenceIds: string[]
      spans: Array<{start: number; end: number}>
      paragraphs: string[]
    }>
    jobReferences: Array<{requirementId: string; quote: string; focus?: string; evidenceIds?: string[]}>
    topics: import('@/v5/writing/information-routing').InterviewPreparationTopic[]
  }>
}

/**
 * API 响应格式
 */
export interface ApiResponse<T> {
  success: boolean
  data?: T
  meta?: {
    cache?: {
      status: 'miss' | 'hit' | 'coalesced' | 'disabled' | 'not_applicable'
    }
    harness?: HarnessResponseMeta
  }
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
  recovery_summary?: RecoverySummary[]
  agent_version?: '5.0.0' | '6.0.0'
  agent_state?: ResumeAgentState
  release_status?: V5ReleaseStatus
  used_safe_fallback?: boolean
  step1_analysis: ResumeAnalysis
  step2_matching: MatchAnalysis
  step3_optimized_resume: string
  step3_completion_document?: import('@/shared/resume-completion').ResumeCompletionDocument
  step3_completion_context?: string
  step3_strategy_review?: ResumeStrategyReview
  step3_action_plan?: import('@/shared/resume-actions').ResumeActionPlan
  step3_resolved_action_plan?: import('@/shared/resume-actions').ResolvedResumeActionPlan
  step3_action_review?: import('@/shared/resume-actions').ResumeActionReview
  step3_change_manifest?: import('@/shared/resume-actions').ResumeChangeManifest
  step3_identity_state?: import('@/shared/resume-actions').ResumeIdentityState
  step3_delivery_state?: import('@/shared/resume-actions').ResumeDeliveryState
  step3_changes_summary?: string[]
  step4_interview_suggestions?: InterviewSuggestions
}

export type SourceResumeSourceType = 'manual' | 'file'

export interface SourceResumeRecord {
  id: string
  title: string
  resume_markdown: string
  source_type: SourceResumeSourceType
  original_file_name: string | null
  parse_id?: string | null
  created_at: string
  updated_at: string
}

export interface SourceResumeSummaryRecord {
  id: string
  title: string
  source_type: SourceResumeSourceType
  original_file_name: string | null
  parse_id?: string | null
  created_at: string
  updated_at: string
}

export interface SaveSourceResumeInput {
  title: string
  resume_markdown: string
  source_type: SourceResumeSourceType
  original_file_name?: string | null
  parse_id?: string | null
}

export type ResultStepStatus = 'pending' | 'generating' | 'done' | 'failed'

export interface ResultSessionContextRecord {
  company: string
  position: string
  location?: string
  resumeContent: string
  jdContent: string
  resumeParseId?: string
  jdParseId?: string
}

export interface ResultSessionProgressRecord {
  analysis: ResultStepStatus
  matching: ResultStepStatus
  optimized: ResultStepStatus
  interview?: ResultStepStatus
}

export interface ResumeHistoryRecord {
  commit_ack?: {commit_id: string; document_id: string | null; revision: number | null; resolved_digest: string | null}
  id: string
  position: string
  company: string
  name: string
  created_at: string
  updated_at: string
  quality_score: number
  match_score: number | null
  tags: string[]
  resume_content: string
  jd_content: string
  optimized_content: string
  optimization_suggestions?: string[]
  changes_summary?: string[]
  process_result?: unknown
  result_context?: ResultSessionContextRecord
  progress?: ResultSessionProgressRecord
  card_color?: string
  card_pattern?: string
}

export interface ResumeHistorySummaryRecord {
  id: string
  position: string
  company: string
  name: string
  created_at: string
  updated_at: string
  quality_score: number
  match_score: number | null
  tags: string[]
  location: string
  strategy_title?: string
  strategy_body: string
  card_color?: string
  card_pattern?: string
}

export interface SaveResumeHistoryInput {
  id?: string | null
  position: string
  company: string
  name: string
  created_at: string
  quality_score: number
  match_score: number | null
  tags: string[]
  resume_content: string
  jd_content: string
  optimized_content: string
  optimization_suggestions?: string[]
  changes_summary?: string[]
  process_result?: unknown
  completion_edit?: unknown
  expected_document?: {documentId: string; revision: number; resolvedDigest?: string}
  commit_id?: string
  /** 只由服务端生成基准加载。 */
  action_baseline?: {actionPlan: import('@/shared/resume-actions').ResumeActionPlan; resolvedPlan: import('@/shared/resume-actions').ResolvedResumeActionPlan;
    review?: import('@/shared/resume-actions').ResumeActionReview; changeManifest?: import('@/shared/resume-actions').ResumeChangeManifest; identityState?: import('@/shared/resume-actions').ResumeIdentityState; deliveryState?: import('@/shared/resume-actions').ResumeDeliveryState; interviewBasis?: import('@/v5/types').InterviewGenerationBasis; matching?: unknown}
  /** 仅服务端从已归属的生成记录读取，HTTP 不接收该字段。 */
  completion_baseline?: import('@/shared/resume-completion').ResumeCompletionDocument
  result_context?: ResultSessionContextRecord
  progress?: ResultSessionProgressRecord
  card_color?: string | null
  card_pattern?: string | null
}

export type UpdateResumeHistoryInput = Partial<Omit<SaveResumeHistoryInput, 'id'>>
