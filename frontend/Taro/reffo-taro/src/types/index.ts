// 类型定义

// ============ 历史记录 ============

export interface ResultSessionContext {
  company: string;
  position: string;
  resumeContent: string;
  jdContent: string;
}

export type ResultStepStatus = 'pending' | 'generating' | 'done' | 'failed';

export interface ResultSessionProgress {
  analysis: ResultStepStatus;
  matching: ResultStepStatus;
  optimized: ResultStepStatus;
  interview?: ResultStepStatus;
}

export interface ResumeHistory {
  id: string;
  position: string; // 岗位名称
  company: string; // 公司名称
  name: string; // 姓名
  createdAt: string; // 创建时间（主成就日期）
  qualityScore: number; // 质量评分 0-100
  matchScore: number; // 匹配度 0-100
  tags: string[]; // 标签（技能、领域等）
  resumeContent: string; // 原始简历内容
  jdContent: string; // JD 内容
  optimizedContent: string; // 优化后的简历
  optimizationSuggestions?: string[]; // 后端返回的岗位匹配优化建议
  changesSummary?: string[]; // 后端返回的简历改写摘要
  processResult?: ProcessResult; // 完整生成结果，用于根据 cardId 还原结果页
  resultContext?: ResultSessionContext; // 生成上下文，用于结果页继续保存/编辑
  progress?: ResultSessionProgress; // 结果生成进度快照
  cardColor?: string; // 卡片背景色
  cardPattern?: string; // 卡片图案类型
}

// ============ API 响应 ============

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

// ============ 简历分析 ============

export interface ResumeAnalysis {
  quality_score: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  capability_summary: string;
  structured_resume: StructuredResume;
}

export interface StructuredResume {
  personal_info: PersonalInfo;
  education: Education[];
  experience: WorkExperience[];
  projects: Project[];
  skills: Skills;
}

export interface PersonalInfo {
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  location?: string;
  current_position?: string;
  github?: string;
  linkedin?: string;
}

export interface Education {
  school: string;
  degree: string;
  major: string;
  time_range?: string;
  start_date?: string;
  end_date?: string;
  gpa?: string;
  achievements?: string[];
}

export interface WorkExperience {
  company: string;
  position: string;
  time_range?: string;
  start_date?: string;
  end_date?: string;
  responsibilities: string[];
  achievements: string[];
}

export interface Project {
  name: string;
  description: string;
  tech_stack: string[];
  role: string;
  achievements: string[];
  url?: string;
}

export interface Skills {
  hard_skills: string[];
  soft_skills: string[];
  languages?: string[];
  certifications?: string[];
}

// ============ 匹配结果 ============

export type ContextConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface JobDescriptionStructure {
  basic_info: {
    title: string;
    company?: string;
    location?: string;
  };
  hard_requirements: {
    education?: string;
    experience_years?: string;
    required_skills: string[];
  };
  responsibilities: string[];
  tasks: string[];
  soft_skills: string[];
  nice_to_have: string[];
  requirement_hierarchy?: {
    must_have: string[];
    core_outcomes: string[];
    differentiators: string[];
  };
  company_context?: {
    explicit_signals: string[];
    inferred_talent_preferences: string[];
    inference_basis: string[];
    confidence: ContextConfidence;
  };
  location_context?: {
    explicit_signals: string[];
    inferred_role_implications: string[];
    inference_basis: string[];
    confidence: ContextConfidence;
  };
  uncertainties?: string[];
}

export type WeaknessEvidenceType = 'direct_missing' | 'implicit_evidence' | 'wording_gap';

export interface MatchWeaknessDetail {
  weakness: string;
  evidence_type: WeaknessEvidenceType;
  evidence: string;
  suggestion: string;
}

export interface MatchingResult {
  match_score: number;
  hard_requirements_match: HardRequirement[];
  skill_match: SkillMatch;
  experience_match: ExperienceMatch;
  optimization_suggestions: string[];
  strengths?: string[];
  weaknesses?: string[];
  weakness_details?: MatchWeaknessDetail[];
  soft_skills_match?: string;
  positioning_strategy?: string;
  context_fit?: {
    company_alignment: string;
    location_alignment: string;
    hypotheses_used: string[];
  };
  jd_structure?: JobDescriptionStructure;
}

export interface HardRequirement {
  requirement: string;
  matched: boolean;
  evidence?: string;
  suggestion?: string;
}

export interface SkillMatch {
  matched_skills: string[];
  missing_skills: string[];
  match_percentage: number;
}

export interface ExperienceMatch {
  years_required: number;
  years_actual: number;
  relevant_experience: string[];
  match_percentage: number;
}

// ============ 优化结果 ============

export interface OptimizedResume {
  optimized_resume: string;
  changes_summary: string[];
  improvement_score: number;
}

export interface InterviewStoryRecommendation {
  title: string;
  background: string;
  result: string;
}

export interface InterviewSuggestions {
  questions: string[];
  story_recommendations: InterviewStoryRecommendation[];
  follow_up_questions: string[];
}

// ============ 完整处理结果 ============

export interface ProcessResult {
  analysis: ResumeAnalysis;
  matching: MatchingResult;
  optimized: OptimizedResume;
  interview: InterviewSuggestions;
}

export type SourceResumeSourceType = 'manual' | 'file';

export interface SourceResumeSummary {
  id: string;
  title: string;
  resumeMarkdown: string;
  sourceType: SourceResumeSourceType;
  originalFileName: string | null;
  createdAt: string;
  updatedAt: string;
}
